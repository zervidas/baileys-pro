"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeMessagesSocket = void 0;
const boom_1 = require("@hapi/boom");
const node_cache_1 = __importDefault(require("node-cache"));
const WAProto_1 = require("../../WAProto");
const Defaults_1 = require("../Defaults");
const Types_1 = require("../Types");
const Utils_1 = require("../Utils");
const link_preview_1 = require("../Utils/link-preview");
const WABinary_1 = require("../WABinary");
const WAUSync_1 = require("../WAUSync");
const newsletter_1 = require("./newsletter");
var ListType = WAProto_1.proto.Message.ListMessage.ListType;
const makeMessagesSocket = (config) => {
    const { logger, linkPreviewImageThumbnailWidth, generateHighQualityLinkPreview, options: axiosOptions, patchMessageBeforeSending, } = config;
    const sock = (0, newsletter_1.makeNewsletterSocket)(config);
    const { ev, authState, processingMutex, signalRepository, upsertMessage, query, fetchPrivacySettings, generateMessageTag, sendNode, groupMetadata, groupQuery, newsletterWMexQuery, groupToggleEphemeral } = sock;
    const userDevicesCache = config.userDevicesCache || new node_cache_1.default({
        stdTTL: Defaults_1.DEFAULT_CACHE_TTLS.USER_DEVICES,
        useClones: false
    });
    let mediaConn;
    const refreshMediaConn = async (forceGet = false) => {
        const media = await mediaConn;
        if (!media || forceGet || (new Date().getTime() - media.fetchDate.getTime()) > media.ttl * 1000) {
            mediaConn = (async () => {
                const result = await query({
                    tag: 'iq',
                    attrs: {
                        type: 'set',
                        xmlns: 'w:m',
                        to: WABinary_1.S_WHATSAPP_NET,
                    },
                    content: [{ tag: 'media_conn', attrs: {} }]
                });
                const mediaConnNode = (0, WABinary_1.getBinaryNodeChild)(result, 'media_conn');
                const node = {
                    hosts: (0, WABinary_1.getBinaryNodeChildren)(mediaConnNode, 'host').map(({ attrs }) => ({
                        hostname: attrs.hostname,
                        maxContentLengthBytes: +attrs.maxContentLengthBytes,
                    })),
                    auth: mediaConnNode.attrs.auth,
                    ttl: +mediaConnNode.attrs.ttl,
                    fetchDate: new Date()
                };
                logger.debug('fetched media conn');
                return node;
            })();
        }
        return mediaConn;
    };
    /**
     * generic send receipt function
     * used for receipts of phone call, read, delivery etc.
     * */
    const sendReceipt = async (jid, participant, messageIds, type) => {
        const node = {
            tag: 'receipt',
            attrs: {
                id: messageIds[0],
            },
        };
        const isReadReceipt = type === 'read' || type === 'read-self';
        if (isReadReceipt) {
            node.attrs.t = (0, Utils_1.unixTimestampSeconds)().toString();
        }
        if (type === 'sender' && (0, WABinary_1.isJidUser)(jid)) {
            node.attrs.recipient = jid;
            node.attrs.to = participant;
        }
        else {
            node.attrs.to = jid;
            if (participant) {
                node.attrs.participant = participant;
            }
        }
        if (type) {
            node.attrs.type = (0, WABinary_1.isJidNewsLetter)(jid) ? 'read-self' : type;
        }
        const remainingMessageIds = messageIds.slice(1);
        if (remainingMessageIds.length) {
            node.content = [
                {
                    tag: 'list',
                    attrs: {},
                    content: remainingMessageIds.map(id => ({
                        tag: 'item',
                        attrs: { id }
                    }))
                }
            ];
        }
        logger.debug({ attrs: node.attrs, messageIds }, 'sending receipt for messages');
        await sendNode(node);
    };
    /** Correctly bulk send receipts to multiple chats, participants */
    const sendReceipts = async (keys, type) => {
        const recps = (0, Utils_1.aggregateMessageKeysNotFromMe)(keys);
        for (const { jid, participant, messageIds } of recps) {
            await sendReceipt(jid, participant, messageIds, type);
        }
    };
    /** Bulk read messages. Keys can be from different chats & participants */
    const readMessages = async (keys) => {
        const privacySettings = await fetchPrivacySettings();
        // based on privacy settings, we have to change the read type
        const readType = privacySettings.readreceipts === 'all' ? 'read' : 'read-self';
        await sendReceipts(keys, readType);
    };
    const profilePictureUrl = async (jid, type = 'preview', timeoutMs) => {
        var _a, _b, _c, _d;
        jid = (0, WABinary_1.jidNormalizedUser)(jid);
        if ((0, WABinary_1.isJidNewsLetter)(jid)) {
            const node = await newsletterWMexQuery(undefined, Types_1.QueryIds.METADATA, {
                input: {
                    key: jid,
                    type: "JID",
                    'view_role': 'GUEST'
                },
                'fetch_viewer_metadata': true,
                'fetch_full_image': true,
                'fetch_creation_time': true
            });
            const result = (_b = (_a = (0, WABinary_1.getBinaryNodeChild)(node, 'result')) === null || _a === void 0 ? void 0 : _a.content) === null || _b === void 0 ? void 0 : _b.toString();
            const metadataPath = JSON.parse(result).data[Types_1.XWAPaths.NEWSLETTER];
            const pictype = type === 'image' ? 'picture' : 'preview';
            const directPath = (_c = metadataPath === null || metadataPath === void 0 ? void 0 : metadataPath.thread_metadata[pictype]) === null || _c === void 0 ? void 0 : _c.direct_path;
            return directPath ? (0, Utils_1.getUrlFromDirectPath)(directPath) : null;
        }
        else {
            const result = await query({
                tag: 'iq',
                attrs: {
                    target: jid,
                    to: WABinary_1.S_WHATSAPP_NET,
                    type: 'get',
                    xmlns: 'w:profile:picture'
                },
                content: [
                    { tag: 'picture', attrs: { type, query: 'url' } }
                ]
            }, timeoutMs);
            const child = (0, WABinary_1.getBinaryNodeChild)(result, 'picture');
            return (_d = child === null || child === void 0 ? void 0 : child.attrs) === null || _d === void 0 ? void 0 : _d.url;
        }
    };
    /** Fetch all the devices we've to send a message to */
    const getUSyncDevices = async (jids, useCache, ignoreZeroDevices) => {
        var _a;
        const deviceResults = [];
        if (!useCache) {
            logger.debug('not using cache for devices');
        }
        const toFetch = [];
        jids = Array.from(new Set(jids));
        for (let jid of jids) {
            const user = (_a = (0, WABinary_1.jidDecode)(jid)) === null || _a === void 0 ? void 0 : _a.user;
            jid = (0, WABinary_1.jidNormalizedUser)(jid);
            if (useCache) {
                const devices = userDevicesCache.get(user);
                if (devices) {
                    deviceResults.push(...devices);
                    logger.trace({ user }, 'using cache for devices');
                }
                else {
                    toFetch.push(jid);
                }
            }
            else {
                toFetch.push(jid);
            }
        }
        if (!toFetch.length) {
            return deviceResults;
        }
        const query = new WAUSync_1.USyncQuery()
            .withContext('message')
            .withDeviceProtocol();
        for (const jid of toFetch) {
            query.withUser(new WAUSync_1.USyncUser().withId(jid));
        }
        const result = await sock.executeUSyncQuery(query);
        if (result) {
            const extracted = (0, Utils_1.extractDeviceJids)(result === null || result === void 0 ? void 0 : result.list, authState.creds.me.id, ignoreZeroDevices);
            const deviceMap = {};
            for (const item of extracted) {
                deviceMap[item.user] = deviceMap[item.user] || [];
                deviceMap[item.user].push(item);
                deviceResults.push(item);
            }
            for (const key in deviceMap) {
                userDevicesCache.set(key, deviceMap[key]);
            }
        }
        return deviceResults;
    };
    const assertSessions = async (jids, force) => {
        let didFetchNewSession = false;
        let jidsRequiringFetch = [];
        if (force) {
            jidsRequiringFetch = jids;
        }
        else {
            const addrs = jids.map(jid => (signalRepository
                .jidToSignalProtocolAddress(jid)));
            const sessions = await authState.keys.get('session', addrs);
            for (const jid of jids) {
                const signalId = signalRepository
                    .jidToSignalProtocolAddress(jid);
                if (!sessions[signalId]) {
                    jidsRequiringFetch.push(jid);
                }
            }
        }
        if (jidsRequiringFetch.length) {
            logger.debug({ jidsRequiringFetch }, 'fetching sessions');
            const result = await query({
                tag: 'iq',
                attrs: {
                    xmlns: 'encrypt',
                    type: 'get',
                    to: WABinary_1.S_WHATSAPP_NET,
                },
                content: [
                    {
                        tag: 'key',
                        attrs: {},
                        content: jidsRequiringFetch.map(jid => ({
                            tag: 'user',
                            attrs: { jid },
                        }))
                    }
                ]
            });
            await (0, Utils_1.parseAndInjectE2ESessions)(result, signalRepository);
            didFetchNewSession = true;
        }
        return didFetchNewSession;
    };
    const sendPeerDataOperationMessage = async (pdoMessage) => {
        var _a;
        //TODO: for later, abstract the logic to send a Peer Message instead of just PDO - useful for App State Key Resync with phone
        if (!((_a = authState.creds.me) === null || _a === void 0 ? void 0 : _a.id)) {
            throw new boom_1.Boom('Not authenticated');
        }
        const protocolMessage = {
            protocolMessage: {
                peerDataOperationRequestMessage: pdoMessage,
                type: WAProto_1.proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
            }
        };
        const meJid = (0, WABinary_1.jidNormalizedUser)(authState.creds.me.id);
        const msgId = await relayMessage(meJid, protocolMessage, {
            additionalAttributes: {
                category: 'peer',
                // eslint-disable-next-line camelcase
                push_priority: 'high_force',
            },
        });
        return msgId;
    };
    const createParticipantNodes = async (jids, message, extraAttrs) => {
        let patched = await patchMessageBeforeSending(message, jids);
        if (!Array.isArray(patched)) {
            patched = jids ? jids.map(jid => ({ recipientJid: jid, ...patched })) : [patched];
        }
        let shouldIncludeDeviceIdentity = false;
        const nodes = await Promise.all(patched.map(async (patchedMessageWithJid) => {
            const { recipientJid: jid, ...patchedMessage } = patchedMessageWithJid;
            if (!jid) {
                return {};
            }
            const bytes = (0, Utils_1.encodeWAMessage)(patchedMessage);
            const { type, ciphertext } = await signalRepository
                .encryptMessage({ jid, data: bytes });
            if (type === 'pkmsg') {
                shouldIncludeDeviceIdentity = true;
            }
            const node = {
                tag: 'to',
                attrs: { jid },
                content: [{
                        tag: 'enc',
                        attrs: {
                            v: '2',
                            type,
                            ...extraAttrs || {}
                        },
                        content: ciphertext
                    }]
            };
            return node;
        }));
        return { nodes, shouldIncludeDeviceIdentity };
    }; //apela
    const relayMessage = async (jid, message, { messageId: msgId, participant, additionalAttributes, additionalNodes, useUserDevicesCache, cachedGroupMetadata, useCachedGroupMetadata, statusJidList }) => {
        const meId = authState.creds.me.id;
        let shouldIncludeDeviceIdentity = false;
        const { user, server } = (0, WABinary_1.jidDecode)(jid);
        const statusJid = 'status@broadcast';
        const isGroup = server === 'g.us';
        const isStatus = jid === statusJid;
        const isLid = server === 'lid';
        const isPrivate = server === 's.whatsapp.net';
        const isNewsletter = server === 'newsletter';
        msgId = msgId || (await config.generateMessageID() ?? (0, Utils_1.generateMessageID)());
        useUserDevicesCache = useUserDevicesCache !== false;
        useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus;
        const participants = [];
        const destinationJid = (!isStatus) ? (0, WABinary_1.jidEncode)(user, isLid ? 'lid' : isGroup ? 'g.us' : isNewsletter ? 'newsletter' : 's.whatsapp.net') : statusJid;
        const binaryNodeContent = [];
        const devices = [];
        const meMsg = {
            deviceSentMessage: {
                destinationJid,
                message
            }
        };
        const extraAttrs = {};
        if (participant) {
            // when the retry request is not for a group
            // only send to the specific device that asked for a retry
            // otherwise the message is sent out to every device that should be a recipient
            if (!isGroup && !isStatus) {
                additionalAttributes = { ...additionalAttributes, 'device_fanout': 'false' };
            }
            const { user, device } = (0, WABinary_1.jidDecode)(participant.jid);
            devices.push({ user, device });
        }
        await authState.keys.transaction(async () => {
            var _a, _b, _c, _d, _e, _f;
            const mediaType = getMediaType(message);
            if (mediaType) {
                extraAttrs['mediatype'] = mediaType;
            }
            if ((_a = (0, Utils_1.normalizeMessageContent)(message)) === null || _a === void 0 ? void 0 : _a.pinInChatMessage) {
                extraAttrs['decrypt-fail'] = 'hide';
            }
            if (isGroup || isStatus) {
                const [groupData, senderKeyMap] = await Promise.all([
                    (async () => {
                        let groupData = useCachedGroupMetadata && cachedGroupMetadata ? await cachedGroupMetadata(jid) : undefined;
                        if (groupData && Array.isArray(groupData === null || groupData === void 0 ? void 0 : groupData.participants)) {
                            logger.trace({ jid, participants: groupData.participants.length }, 'using cached group metadata');
                        }
                        if (!groupData && !isStatus) {
                            groupData = await groupMetadata(jid);
                        }
                        return groupData;
                    })(),
                    (async () => {
                        if (!participant && !isStatus) {
                            const result = await authState.keys.get('sender-key-memory', [jid]);
                            return result[jid] || {};
                        }
                        return {};
                    })()
                ]);
                if (!participant) {
                    const participantsList = (groupData && !isStatus) ? groupData.participants.map(p => p.id) : [];
                    if (isStatus && statusJidList) {
                        participantsList.push(...statusJidList);
                    }
                    const additionalDevices = await getUSyncDevices(participantsList, !!useUserDevicesCache, false);
                    devices.push(...additionalDevices);
                }
                const patched = await patchMessageBeforeSending(message, devices.map(d => (0, WABinary_1.jidEncode)(d.user, isLid ? 'lid' : isGroup ? 'g.us' : isNewsletter ? 'newsletter' : 's.whatsapp.net', d.device)));
                const bytes = (0, Utils_1.encodeWAMessage)(patched);
                const { ciphertext, senderKeyDistributionMessage } = await signalRepository.encryptGroupMessage({
                    group: destinationJid,
                    data: bytes,
                    meId,
                });
                const senderKeyJids = [];
                // ensure a connection is established with every device
                for (const { user, device } of devices) {
                    const jid = (0, WABinary_1.jidEncode)(user, isLid ? 'lid' : 's.whatsapp.net', device);
                    if (!senderKeyMap[jid] || !!participant) {
                        senderKeyJids.push(jid);
                        // store that this person has had the sender keys sent to them
                        senderKeyMap[jid] = true;
                    }
                }
                // if there are some participants with whom the session has not been established
                // if there are, we re-send the senderkey
                if (senderKeyJids.length) {
                    logger.debug({ senderKeyJids }, 'sending new sender key');
                    const senderKeyMsg = {
                        senderKeyDistributionMessage: {
                            axolotlSenderKeyDistributionMessage: senderKeyDistributionMessage,
                            groupId: destinationJid
                        }
                    };
                    await assertSessions(senderKeyJids, false);
                    const result = await createParticipantNodes(senderKeyJids, senderKeyMsg, mediaType ? { ...extraAttrs, mediatype: mediaType } : extraAttrs);
                    shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || result.shouldIncludeDeviceIdentity;
                    participants.push(...result.nodes);
                }
                binaryNodeContent.push({
                    tag: 'enc',
                    attrs: { v: '2', type: 'skmsg' },
                    content: ciphertext
                });
                await authState.keys.set({ 'sender-key-memory': { [jid]: senderKeyMap } });
            }
            else if (isNewsletter) {
                // Message edit
                if ((_a = message.protocolMessage) === null || _a === void 0 ? void 0 : _a.editedMessage) {
                    msgId = (_b = message.protocolMessage.key) === null || _b === void 0 ? void 0 : _b.id;
                    message = message.protocolMessage.editedMessage;
                }
                // Message delete
                if (((_c = message.protocolMessage) === null || _c === void 0 ? void 0 : _c.type) === WAProto_1.proto.Message.ProtocolMessage.Type.REVOKE) {
                    msgId = (_d = message.protocolMessage.key) === null || _d === void 0 ? void 0 : _d.id;
                    message = {};
                }
                const patched = await patchMessageBeforeSending(message, []);
                const bytes = WAProto_1.proto.Message.encode(patched).finish();
                binaryNodeContent.push({
                    tag: 'plaintext',
                    attrs: mediaType ? { mediatype: mediaType } : {},
                    content: bytes
                });
            }
            else {
                const { user: meUser, device: meDevice } = (0, WABinary_1.jidDecode)(meId);
                if (!participant) {
                    devices.push({ user });
                    // do not send message to self if the device is 0 (mobile)
                    if (meDevice !== undefined && meDevice !== 0) {
                        devices.push({ user: meUser });
                    }
                    const additionalDevices = await getUSyncDevices([meId, jid], !!useUserDevicesCache, true);
                    if ((additionalAttributes === null || additionalAttributes === void 0 ? void 0 : additionalAttributes['category']) !== 'peer') {
                        const additionalDevices = await getUSyncDevices([meId, jid], !!useUserDevicesCache, true);
                        devices.push(...additionalDevices);
                    }
                    devices.push(...additionalDevices);
                }
                const allJids = [];
                const meJids = [];
                const otherJids = [];
                for (const { user, device } of devices) {
                    const isMe = user === meUser;
                    const jid = (0, WABinary_1.jidEncode)(isMe && isLid ? ((_f = (_e = authState.creds) === null || _e === void 0 ? void 0 : _e.me) === null || _f === void 0 ? void 0 : _f.lid.split(':')[0]) || user : user, isLid ? 'lid' : isGroup ? 'g.us' : isNewsletter ? 'newsletter' : 's.whatsapp.net', device);
                    if (isMe) {
                        meJids.push(jid);
                    }
                    else {
                        otherJids.push(jid);
                    }
                    allJids.push(jid);
                }
                await assertSessions(allJids, false);
                const [{ nodes: meNodes, shouldIncludeDeviceIdentity: s1 }, { nodes: otherNodes, shouldIncludeDeviceIdentity: s2 }] = await Promise.all([
                    createParticipantNodes(meJids, meMsg, mediaType ? { ...extraAttrs, mediatype: mediaType } : extraAttrs),
                    createParticipantNodes(otherJids, message, mediaType ? { ...extraAttrs, mediatype: mediaType } : extraAttrs)
                ]);
                participants.push(...meNodes);
                participants.push(...otherNodes);
                shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || s1 || s2;
            }
            if (participants.length) {
                if ((additionalAttributes === null || additionalAttributes === void 0 ? void 0 : additionalAttributes['category']) === 'peer') {
                    const peerNode = (_e = (_d = participants[0]) === null || _d === void 0 ? void 0 : _d.content) === null || _e === void 0 ? void 0 : _e[0];
                    if (peerNode) {
                        binaryNodeContent.push(peerNode); // push only enc
                    }
                }
                else {
                    binaryNodeContent.push({
                        tag: 'participants',
                        attrs: {},
                        content: participants
                    });
                }
            }
            const stanza = {
                tag: 'message',
                attrs: {
                    id: msgId,
                    type: isNewsletter ? getTypeMessage(message) : 'text',
                    ...(additionalAttributes || {})
                },
                content: binaryNodeContent
            };
            // if the participant to send to is explicitly specified (generally retry recp)
            // ensure the message is only sent to that person
            // if a retry receipt is sent to everyone -- it'll fail decryption for everyone else who received the msg
            if (participant) {
                if ((0, WABinary_1.isJidGroup)(destinationJid)) {
                    stanza.attrs.to = destinationJid;
                    stanza.attrs.participant = participant.jid;
                }
                else if ((0, WABinary_1.areJidsSameUser)(participant.jid, meId)) {
                    stanza.attrs.to = participant.jid;
                    stanza.attrs.recipient = destinationJid;
                }
                else {
                    stanza.attrs.to = participant.jid;
                }
            }
            else {
                stanza.attrs.to = destinationJid;
            }
            if (shouldIncludeDeviceIdentity) {
                stanza.content.push({
                    tag: 'device-identity',
                    attrs: {},
                    content: (0, Utils_1.encodeSignedDeviceIdentity)(authState.creds.account, true)
                });
                logger.debug({ jid }, 'adding device identity');
            }
            if (additionalNodes && additionalNodes.length > 0) {
                stanza.content.push(...additionalNodes);
            }
            const inMsg = (0, Utils_1.normalizeMessageContent)(message) || null;
            const key = inMsg ? (0, Utils_1.getContentType)(inMsg) : null;
            if (!isNewsletter && (key === 'interactiveMessage' || key === 'buttonsMessage')) {
                const nativeNode = {
                    tag: 'biz',
                    attrs: {},
                    content: [{
                            tag: 'interactive',
                            attrs: {
                                type: 'native_flow',
                                v: '1'
                            },
                            content: [{
                                    tag: 'native_flow',
                                    attrs: {
                                        name: 'quick_reply'
                                    }
                                }]
                        }]
                };
                const resultNativeNode = filterNativeNode(additionalNodes);
                if (resultNativeNode && additionalNodes && additionalNodes.length > 0) {
                    stanza.content.push(...resultNativeNode);
                }
                else {
                    stanza.content.push(nativeNode);
                }
            }/*
            if (isPrivate) {
                const botNode = {
                    tag: 'bot',
                    attrs: { biz_bot: '1' }
                };
                const resultBotNode = filterBotNode(additionalNodes);
                if (resultBotNode && additionalNodes && additionalNodes.length > 0) {
                    stanza.content.push(...resultBotNode);
                }
                else {
                    stanza.content.push(botNode);
                }
            }*/
            if (message && message.listMessage) {
                stanza.content.push({
                    tag: 'biz',
                    attrs: {},
                    content: [
                        {
                            tag: 'list',
                            attrs: getButtonArgs(message)
                        }
                    ]
                });
                logger.debug({ jid }, 'adding business node');
            }
            logger.debug({ msgId }, `sending message to ${participants.length} devices`);
            await sendNode(stanza);
        });
        return msgId;
    };
    const filterNativeNode = (nodeContent) => {
        if (Array.isArray(nodeContent)) {
            return nodeContent.filter((item) => {
                var _a, _b, _c, _d, _e, _f, _g, _h;
                if (item.tag === 'biz' && ((_a = item === null || item === void 0 ? void 0 : item.content[0]) === null || _a === void 0 ? void 0 : _a.tag) === 'interactive' && ((_c = (_b = item === null || item === void 0 ? void 0 : item.content[0]) === null || _b === void 0 ? void 0 : _b.attrs) === null || _c === void 0 ? void 0 : _c.type) === 'native_flow' && ((_e = (_d = item === null || item === void 0 ? void 0 : item.content[0]) === null || _d === void 0 ? void 0 : _d.content[0]) === null || _e === void 0 ? void 0 : _e.tag) === 'native_flow' && ((_h = (_g = (_f = item === null || item === void 0 ? void 0 : item.content[0]) === null || _f === void 0 ? void 0 : _f.content[0]) === null || _g === void 0 ? void 0 : _g.attrs) === null || _h === void 0 ? void 0 : _h.name) === 'quick_reply') {
                    return false;
                }
                return true;
            });
        }
        else {
            return nodeContent;
        }
    };
    const filterBotNode = (nodeContent) => {
        if (Array.isArray(nodeContent)) {
            return nodeContent.filter((item) => {
                if (item.tag === 'bot' && item.attrs.biz_bot === '1') {
                    return false;
                }
                return true;
            });
        }
        else {
            return nodeContent;
        }
    };
    const getTypeMessage = (msg) => {
        if (msg.viewOnceMessage) {
            return getTypeMessage(msg.viewOnceMessage.message);
        }
        else if (msg.viewOnceMessageV2) {
            return getTypeMessage(msg.viewOnceMessageV2.message);
        }
        else if (msg.viewOnceMessageV2Extension) {
            return getTypeMessage(msg.viewOnceMessageV2Extension.message);
        }
        else if (msg.ephemeralMessage) {
            return getTypeMessage(msg.ephemeralMessage.message);
        }
        else if (msg.documentWithCaptionMessage) {
            return getTypeMessage(msg.documentWithCaptionMessage.message);
        }
        else if (msg.reactionMessage) {
            return 'reaction';
        }
        else if (msg.pollCreationMessage || msg.pollCreationMessageV2 || msg.pollCreationMessageV3 || msg.pollUpdateMessage) {
            return 'poll';
        }
        else if (getMediaType(msg)) {
            return 'media';
        }
        else {
            return 'text';
        }
    };
    const getMediaType = (message) => {
        if (message.imageMessage) {
            return 'image';
        }
        else if (message.videoMessage) {
            return message.videoMessage.gifPlayback ? 'gif' : 'video';
        }
        else if (message.audioMessage) {
            return message.audioMessage.ptt ? 'ptt' : 'audio';
        }
        else if (message.contactMessage) {
            return 'vcard';
        }
        else if (message.documentMessage) {
            return 'document';
        }
        else if (message.contactsArrayMessage) {
            return 'contact_array';
        }
        else if (message.liveLocationMessage) {
            return 'livelocation';
        }
        else if (message.stickerMessage) {
            return 'sticker';
        }
        else if (message.listMessage) {
            return 'list';
        }
        else if (message.listResponseMessage) {
            return 'list_response';
        }
        else if (message.buttonsResponseMessage) {
            return 'buttons_response';
        }
        else if (message.orderMessage) {
            return 'order';
        }
        else if (message.productMessage) {
            return 'product';
        }
        else if (message.interactiveResponseMessage) {
            return 'native_flow_response';
        }
        else if (message.groupInviteMessage) {
            return 'url';
        }
    };
    const getButtonArgs = (message) => {
        if (message.templateMessage) {
            // TODO: Add attributes
            return {};
        }
        else if (message.listMessage) {
            const type = message.listMessage.listType;
            if (!type) {
                throw new boom_1.Boom('Expected list type inside message');
            }
            return { v: '2', type: ListType[type].toLowerCase() };
        }
        else {
            return {};
        }
    };
    const getPrivacyTokens = async (jids) => {
        const t = (0, Utils_1.unixTimestampSeconds)().toString();
        const result = await query({
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'privacy'
            },
            content: [
                {
                    tag: 'tokens',
                    attrs: {},
                    content: jids.map(jid => ({
                        tag: 'token',
                        attrs: {
                            jid: (0, WABinary_1.jidNormalizedUser)(jid),
                            t,
                            type: 'trusted_contact'
                        }
                    }))
                }
            ]
        });
        return result;
    };
    const waUploadToServer = (0, Utils_1.getWAUploadToServer)(config, refreshMediaConn);
    const waitForMsgMediaUpdate = (0, Utils_1.bindWaitForEvent)(ev, 'messages.media-update');
    return {
        ...sock,
        getPrivacyTokens,
        assertSessions,
        relayMessage,
        sendReceipt,
        sendReceipts,
        getButtonArgs,
        readMessages,
        refreshMediaConn,
        getUSyncDevices,
        sendPeerDataOperationMessage,
        createParticipantNodes,
        profilePictureUrl,
        waUploadToServer,
        fetchPrivacySettings,
        updateMediaMessage: async (message) => {
            const content = (0, Utils_1.assertMediaContent)(message.message);
            const mediaKey = content.mediaKey;
            const meId = authState.creds.me.id;
            const node = await (0, Utils_1.encryptMediaRetryRequest)(message.key, mediaKey, meId);
            let error = undefined;
            await Promise.all([
                sendNode(node),
                waitForMsgMediaUpdate(async update => {
                    const result = update.find(c => c.key.id === message.key.id);
                    if (result) {
                        if (result.error) {
                            error = result.error;
                        }
                        else {
                            try {
                                const media = await (0, Utils_1.decryptMediaRetryData)(result.media, mediaKey, result.key.id);
                                if (media && media.result !== WAProto_1.proto.MediaRetryNotification.ResultType.SUCCESS) {
                                    const resultStr = WAProto_1.proto.MediaRetryNotification.ResultType[media.result];
                                    throw new boom_1.Boom(`Media re-upload failed by device (${resultStr})`, { data: media, statusCode: (0, Utils_1.getStatusCodeForMediaRetry)(media.result) || 404 });
                                }
                                content.directPath = media.directPath;
                                content.url = (0, Utils_1.getUrlFromDirectPath)(content.directPath);
                                logger.debug({ directPath: media.directPath, key: result.key }, 'media update successful');
                            }
                            catch (err) {
                                error = err;
                            }
                        }
                        return true;
                    }
                })
            ]);
            if (error) {
                throw error;
            }
            ev.emit('messages.update', [
                { key: message.key, update: { message: message.message } }
            ]);
            return message;
        },
        sendStatusMentions: async (content, jids = []) => {
            const userJid = (0, WABinary_1.jidNormalizedUser)(authState.creds.me.id);
            let allUsers = [];
            for (const id of jids) {
                const { user, server } = (0, WABinary_1.jidDecode)(id);
                const isGroup = server === 'g.us';
                const isPrivate = server === 's.whatsapp.net';
                if (isGroup) {
                    let userId = await groupMetadata(id);
                    let participant = await userId.participants;
                    let users = await Promise.all(participant.map(u => (0, WABinary_1.jidNormalizedUser)(u.id)));
                    allUsers = [...allUsers, ...users];
                }
                else if (isPrivate) {
                    let users = await Promise.all(jids.map(id => id.replace(/\b\d{18}@.{4}\b/g, '')));
                    allUsers = [...allUsers, ...users];
                }
                if (!allUsers.find(user => user.includes(userJid))) {
                    allUsers.push(userJid);
                }
            }
            ;
            const getRandomHexColor = () => {
                return "#" + Math.floor(Math.random() * 16777215)
                    .toString(16)
                    .padStart(6, "0");
            };
            let mediaHandle;
            let msg = await (0, Utils_1.generateWAMessage)(WABinary_1.STORIES_JID, content, {
                logger,
                userJid,
                getUrlInfo: text => (0, link_preview_1.getUrlInfo)(text, {
                    thumbnailWidth: linkPreviewImageThumbnailWidth,
                    fetchOpts: {
                        timeout: 3000,
                        ...axiosOptions || {}
                    },
                    logger,
                    uploadImage: generateHighQualityLinkPreview
                        ? waUploadToServer
                        : undefined
                }),
                upload: async (readStream, opts) => {
                    const up = await waUploadToServer(readStream, { ...opts });
                    mediaHandle = up.handle;
                    return up;
                },
                mediaCache: config.mediaCache,
                options: config.options,
                backgroundColor: getRandomHexColor(),
                font: Math.floor(Math.random() * 9),
            });
            await relayMessage(WABinary_1.STORIES_JID, msg.message, {
                messageId: msg.key.id,
                statusJidList: allUsers,
                additionalNodes: [
                    {
                        tag: 'meta',
                        attrs: {},
                        content: [
                            {
                                tag: 'mentioned_users',
                                attrs: {},
                                content: jids.map(jid => ({
                                    tag: 'to',
                                    attrs: { jid },
                                    content: undefined,
                                })),
                            },
                        ],
                    },
                ],
            });
            jids.forEach(async (id) => {
                id = (0, WABinary_1.jidNormalizedUser)(id);
                const { user, server } = (0, WABinary_1.jidDecode)(id);
                const isPrivate = server === 's.whatsapp.net';
                let type = isPrivate
                    ? 'statusMentionMessage'
                    : 'groupStatusMentionMessage';
                await relayMessage(id, {
                    [type]: {
                        message: {
                            protocolMessage: {
                                key: msg.key,
                                type: 25,
                            },
                        },
                    },
                }, {});
                await (0, Utils_1.delay)(2500);
            });
            return msg;
        },
        sendAlbumMessage: async (jid, medias, options = {}) => {
            const userJid = authState.creds.me.id;
            for (const media of medias) {
                if (!media.image && !media.video)
                    throw new TypeError(`medias[i] must have image or video property`);
            }
            if (medias.length < 2)
                throw new RangeError("Minimum 2 media");
            const time = options.delay || 500;
            delete options.delay;
            const album = await (0, Utils_1.generateWAMessageFromContent)(jid, {
                albumMessage: {
                    expectedImageCount: medias.filter(media => media.image).length,
                    expectedVideoCount: medias.filter(media => media.video).length,
                    ...options
                }
            }, { userJid, ...options });
            await relayMessage(jid, album.message, { messageId: album.key.id });
            let mediaHandle;
            let msg;
            for (const i in medias) {
                const media = medias[i];
                if (media.image) {
                    msg = await (0, Utils_1.generateWAMessage)(jid, {
                        image: media.image,
                        ...media,
                        ...options
                    }, {
                        userJid,
                        upload: async (readStream, opts) => {
                            const up = await waUploadToServer(readStream, { ...opts, newsletter: (0, WABinary_1.isJidNewsLetter)(jid) });
                            mediaHandle = up.handle;
                            return up;
                        },
                        ...options,
                    });
                }
                else if (media.video) {
                    msg = await (0, Utils_1.generateWAMessage)(jid, {
                        video: media.video,
                        ...media,
                        ...options
                    }, {
                        userJid,
                        upload: async (readStream, opts) => {
                            const up = await waUploadToServer(readStream, { ...opts, newsletter: (0, WABinary_1.isJidNewsLetter)(jid) });
                            mediaHandle = up.handle;
                            return up;
                        },
                        ...options,
                    });
                }
                if (msg) {
                    msg.message.messageContextInfo = {
                        messageAssociation: {
                            associationType: 1,
                            parentMessageKey: album.key
                        }
                    };
                }
                await relayMessage(jid, msg.message, { messageId: msg.key.id });
                await (0, Utils_1.delay)(time);
            }
            return album;
        },
        sendMessage: async (jid, content, options = {}) => {
            var _a, _b, _c;
            const userJid = authState.creds.me.id;
            if (typeof content === 'object' &&
                'disappearingMessagesInChat' in content &&
                typeof content['disappearingMessagesInChat'] !== 'undefined' &&
                (0, WABinary_1.isJidGroup)(jid)) {
                const { disappearingMessagesInChat } = content;
                const value = typeof disappearingMessagesInChat === 'boolean' ?
                    (disappearingMessagesInChat ? Defaults_1.WA_DEFAULT_EPHEMERAL : 0) :
                    disappearingMessagesInChat;
                await groupToggleEphemeral(jid, value);
            }
            else {
                let mediaHandle;
                const { server } = (0, WABinary_1.jidDecode)(jid);
                const isGroup = server === 'g.us';
                let eph;
                if (isGroup) {
                    const disappearingNode = await groupQuery(jid, 'get', [
                        {
                            tag: 'query',
                            attrs: { request: 'interactive' }
                        }
                    ]);
                    const group = (0, WABinary_1.getBinaryNodeChild)(disappearingNode, 'group');
                    const expiration = (0, WABinary_1.getBinaryNodeChild)(group, 'ephemeral');
                    eph = (_a = expiration === null || expiration === void 0 ? void 0 : expiration.attrs) === null || _a === void 0 ? void 0 : _a.expiration;
                }
                const fullMsg = await (0, Utils_1.generateWAMessage)(jid, content, {
                    logger,
                    userJid,
                    ephemeralExpiration: (options.ephemeralExpiration && options.ephemeralExpiration > 0) ? options.ephemeralExpiration : eph,
                    getUrlInfo: text => (0, link_preview_1.getUrlInfo)(text, {
                        thumbnailWidth: linkPreviewImageThumbnailWidth,
                        fetchOpts: {
                            timeout: 3000,
                            ...axiosOptions || {}
                        },
                        logger,
                        uploadImage: generateHighQualityLinkPreview
                            ? waUploadToServer
                            : undefined
                    }),
                    upload: async (readStream, opts) => {
                        const up = await waUploadToServer(readStream, { ...opts, newsletter: (0, WABinary_1.isJidNewsLetter)(jid) });
                        mediaHandle = up.handle;
                        return up;
                    },
                    mediaCache: config.mediaCache,
                    options: config.options,
                    messageId: await config.generateMessageIDV2((_a = sock.user) === null || _a === void 0 ? void 0 : _a.id) ?? (0, Utils_1.generateMessageIDV2)((_a = sock.user) === null || _a === void 0 ? void 0 : _a.id),
                    ...options,
                });
                const isAiMsg = 'ai' in content && !!content.ai;
                const isPinMsg = 'pin' in content && !!content.pin;
                const isKeepMsg = 'keep' in content && content.keep;
                const isPollMsg = 'poll' in content && !!content.poll;
                const isEditMsg = 'edit' in content && !!content.edit;
                const isDeleteMsg = 'delete' in content && !!content.delete;
                const additionalAttributes = {};
                const additionalNodes = [];
                // required for delete
                if (isDeleteMsg) {
                    // if the chat is a group, and I am not the author, then delete the message as an admin
                    if (((0, WABinary_1.isJidGroup)((_b = content.delete) === null || _b === void 0 ? void 0 : _b.remoteJid) && !((_c = content.delete) === null || _c === void 0 ? void 0 : _c.fromMe)) || (0, WABinary_1.isJidNewsLetter)(jid)) {
                        additionalAttributes.edit = '8';
                    }
                    else {
                        additionalAttributes.edit = '7';
                    }
                }
                else if (isEditMsg) {
                    additionalAttributes.edit = (0, WABinary_1.isJidNewsLetter)(jid) ? '3' : '1';
                }
                else if (isPinMsg) {
                    additionalAttributes.edit = '2';
                }
                else if (isAiMsg) {
                    additionalNodes.push({
                        attrs: {
                            biz_bot: '1'
                        },
                        tag: 'bot'
                    });
                    if (options.additionalNodes) {
                        additionalNodes.push(...options.additionalNodes);
                    }
                }
                if (mediaHandle) {
                    additionalAttributes['media_id'] = mediaHandle;
                }
                if ('cachedGroupMetadata' in options) {
                    console.warn('cachedGroupMetadata in sendMessage are deprecated, now cachedGroupMetadata is part of the socket config.');
                }
                await relayMessage(jid, fullMsg.message, { messageId: fullMsg.key.id, cachedGroupMetadata: options.cachedGroupMetadata, additionalNodes: isAiMsg ? additionalNodes : options.additionalNodes, additionalAttributes, statusJidList: options.statusJidList });
                if (config.emitOwnEvents) {
                    process.nextTick(() => {
                        processingMutex.mutex(() => (upsertMessage(fullMsg, 'append')));
                    });
                }
                return fullMsg;
            }
        }
    };
};
exports.makeMessagesSocket = makeMessagesSocket;
