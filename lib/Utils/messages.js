"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertMediaContent = exports.downloadMediaMessage = exports.aggregateMessageKeysNotFromMe = exports.getAggregateVotesInPollMessage = exports.updateMessageWithPollUpdate = exports.updateMessageWithReaction = exports.updateMessageWithReceipt = exports.getDevice = exports.extractMessageContent = exports.normalizeMessageContent = exports.getContentType = exports.generateWAMessage = exports.generateWAMessageFromContent = exports.generateWAMessageContent = exports.generateForwardMessageContent = exports.prepareDisappearingMessageSettingContent = exports.prepareWAMessageMedia = exports.generateLinkPreviewIfRequired = exports.extractUrlFromText = void 0;
const boom_1 = require("@hapi/boom");
const axios_1 = __importDefault(require("axios"));
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const WAProto_1 = require("../../WAProto");
const Defaults_1 = require("../Defaults");
const Types_1 = require("../Types");
const WABinary_1 = require("../WABinary");
const crypto_2 = require("./crypto");
const generics_1 = require("./generics");
const messages_media_1 = require("./messages-media");
const MIMETYPE_MAP = {
    image: 'image/jpeg',
    video: 'video/mp4',
    document: 'application/pdf',
    audio: 'audio/ogg; codecs=opus',
    sticker: 'image/webp',
    'product-catalog-image': 'image/jpeg',
};
const MessageTypeProto = {
    'image': Types_1.WAProto.Message.ImageMessage,
    'video': Types_1.WAProto.Message.VideoMessage,
    'audio': Types_1.WAProto.Message.AudioMessage,
    'sticker': Types_1.WAProto.Message.StickerMessage,
    'document': Types_1.WAProto.Message.DocumentMessage,
};
const ButtonType = WAProto_1.proto.Message.ButtonsMessage.HeaderType;
/**
 * Uses a regex to test whether the string contains a URL, and returns the URL if it does.
 * @param text eg. hello https://google.com
 * @returns the URL, eg. https://google.com
 */
const extractUrlFromText = (text) => { var _a; return (_a = text.match(Defaults_1.URL_REGEX)) === null || _a === void 0 ? void 0 : _a[0]; };
exports.extractUrlFromText = extractUrlFromText;
const generateLinkPreviewIfRequired = async (text, getUrlInfo, logger) => {
    const url = (0, exports.extractUrlFromText)(text);
    if (!!getUrlInfo && url) {
        try {
            const urlInfo = await getUrlInfo(url);
            return urlInfo;
        }
        catch (error) { // ignore if fails
            logger === null || logger === void 0 ? void 0 : logger.warn({ trace: error.stack }, 'url generation failed');
        }
    }
};
exports.generateLinkPreviewIfRequired = generateLinkPreviewIfRequired;
const assertColor = async (color) => {
    let assertedColor;
    if (typeof color === 'number') {
        assertedColor = color > 0 ? color : 0xffffffff + Number(color) + 1;
    }
    else {
        let hex = color.trim().replace('#', '');
        if (hex.length <= 6) {
            hex = 'FF' + hex.padStart(6, '0');
        }
        assertedColor = parseInt(hex, 16);
        return assertedColor;
    }
};
const prepareWAMessageMedia = async (message, options) => {
    const logger = options.logger;
    let mediaType;
    for (const key of Defaults_1.MEDIA_KEYS) {
        if (key in message) {
            mediaType = key;
        }
    }
    if (!mediaType) {
        throw new boom_1.Boom('Invalid media type', { statusCode: 400 });
    }
    const uploadData = {
        ...message,
        media: message[mediaType]
    };
    delete uploadData[mediaType];
    // check if cacheable + generate cache key
    const cacheableKey = typeof uploadData.media === 'object' &&
        ('url' in uploadData.media) &&
        !!uploadData.media.url &&
        !!options.mediaCache && (
    // generate the key
    mediaType + ':' + uploadData.media.url.toString());
    if (mediaType === 'document' && !uploadData.fileName) {
        uploadData.fileName = 'file';
    }
    if (!uploadData.mimetype) {
        uploadData.mimetype = MIMETYPE_MAP[mediaType];
    }
    // check for cache hit
    if (cacheableKey) {
        const mediaBuff = options.mediaCache.get(cacheableKey);
        if (mediaBuff) {
            logger === null || logger === void 0 ? void 0 : logger.debug({ cacheableKey }, 'got media cache hit');
            const obj = Types_1.WAProto.Message.decode(mediaBuff);
            const key = `${mediaType}Message`;
            Object.assign(obj[key], { ...uploadData, media: undefined });
            return obj;
        }
    }
    const requiresDurationComputation = mediaType === 'audio' && typeof uploadData.seconds === 'undefined';
    const requiresThumbnailComputation = (mediaType === 'image' || mediaType === 'video') &&
        (typeof uploadData['jpegThumbnail'] === 'undefined');
    const requiresWaveformProcessing = mediaType === 'audio' && uploadData.ptt === true;
    const requiresAudioBackground = options.backgroundColor && mediaType === 'audio' && uploadData.ptt === true;
    const requiresOriginalForSomeProcessing = requiresDurationComputation || requiresThumbnailComputation;
    const { mediaKey, encWriteStream, bodyPath, fileEncSha256, fileSha256, fileLength, didSaveToTmpPath, } = await (options.newsletter ? messages_media_1.prepareStream : messages_media_1.encryptedStream)(uploadData.media, options.mediaTypeOverride || mediaType, {
        logger,
        saveOriginalFileIfRequired: requiresOriginalForSomeProcessing,
        opts: options.options
    });
    // url safe Base64 encode the SHA256 hash of the body
    const fileEncSha256B64 = (options.newsletter ? fileSha256 : fileEncSha256 !== null && fileEncSha256 !== void 0 ? fileEncSha256 : fileSha256).toString('base64');
    const [{ mediaUrl, directPath, handle }] = await Promise.all([
        (async () => {
            const result = await options.upload(encWriteStream, { fileEncSha256B64, mediaType, timeoutMs: options.mediaUploadTimeoutMs });
            logger === null || logger === void 0 ? void 0 : logger.debug({ mediaType, cacheableKey }, 'uploaded media');
            return result;
        })(),
        (async () => {
            try {
                if (requiresThumbnailComputation) {
                    const { thumbnail, originalImageDimensions } = await (0, messages_media_1.generateThumbnail)(bodyPath, mediaType, options);
                    uploadData.jpegThumbnail = thumbnail;
                    if (!uploadData.width && originalImageDimensions) {
                        uploadData.width = originalImageDimensions.width;
                        uploadData.height = originalImageDimensions.height;
                        logger === null || logger === void 0 ? void 0 : logger.debug('set dimensions');
                    }
                    logger === null || logger === void 0 ? void 0 : logger.debug('generated thumbnail');
                }
                if (requiresDurationComputation) {
                    uploadData.seconds = await (0, messages_media_1.getAudioDuration)(bodyPath);
                    logger === null || logger === void 0 ? void 0 : logger.debug('computed audio duration');
                }
                if (requiresWaveformProcessing) {
                    uploadData.waveform = await (0, messages_media_1.getAudioWaveform)(bodyPath, logger);
                    logger === null || logger === void 0 ? void 0 : logger.debug('processed waveform');
                }
                if (requiresWaveformProcessing) {
                    uploadData.waveform = await (0, messages_media_1.getAudioWaveform)(bodyPath, logger);
                    logger === null || logger === void 0 ? void 0 : logger.debug('processed waveform');
                }
                if (requiresAudioBackground) {
                    uploadData.backgroundArgb = await assertColor(options.backgroundColor);
                    logger === null || logger === void 0 ? void 0 : logger.debug('computed backgroundColor audio status');
                }
            }
            catch (error) {
                logger === null || logger === void 0 ? void 0 : logger.warn({ trace: error.stack }, 'failed to obtain extra info');
            }
        })(),
    ])
        .finally(async () => {
        if (!Buffer.isBuffer(encWriteStream)) {
            encWriteStream.destroy();
        }
        // remove tmp files
        if (didSaveToTmpPath && bodyPath) {
            await fs_1.promises.unlink(bodyPath);
            logger === null || logger === void 0 ? void 0 : logger.debug('removed tmp files');
        }
    });
    const obj = Types_1.WAProto.Message.fromObject({
        [`${mediaType}Message`]: MessageTypeProto[mediaType].fromObject({
            url: handle ? undefined : mediaUrl,
            directPath,
            mediaKey: mediaKey,
            fileEncSha256: fileEncSha256,
            fileSha256,
            fileLength,
            mediaKeyTimestamp: handle ? undefined : (0, generics_1.unixTimestampSeconds)(),
            ...uploadData,
            media: undefined
        })
    });
    if (uploadData.ptv) {
        obj.ptvMessage = obj.videoMessage;
        delete obj.videoMessage;
    }
    if (cacheableKey) {
        logger === null || logger === void 0 ? void 0 : logger.debug({ cacheableKey }, 'set cache');
        options.mediaCache.set(cacheableKey, Types_1.WAProto.Message.encode(obj).finish());
    }
    return obj;
};
exports.prepareWAMessageMedia = prepareWAMessageMedia;
const prepareDisappearingMessageSettingContent = (ephemeralExpiration) => {
    ephemeralExpiration = ephemeralExpiration || 0;
    const content = {
        ephemeralMessage: {
            message: {
                protocolMessage: {
                    type: Types_1.WAProto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING,
                    ephemeralExpiration
                }
            }
        }
    };
    return Types_1.WAProto.Message.fromObject(content);
};
exports.prepareDisappearingMessageSettingContent = prepareDisappearingMessageSettingContent;
/**
 * Generate forwarded message content like WA does
 * @param message the message to forward
 * @param options.forceForward will show the message as forwarded even if it is from you
 */
const generateForwardMessageContent = (message, forceForward) => {
    var _a;
    let content = message.message;
    if (!content) {
        throw new boom_1.Boom('no content in message', { statusCode: 400 });
    }
    // hacky copy
    content = (0, exports.normalizeMessageContent)(content);
    content = WAProto_1.proto.Message.decode(WAProto_1.proto.Message.encode(content).finish());
    let key = Object.keys(content)[0];
    let score = ((_a = content[key].contextInfo) === null || _a === void 0 ? void 0 : _a.forwardingScore) || 0;
    score += message.key.fromMe && !forceForward ? 0 : 1;
    if (key === 'conversation') {
        content.extendedTextMessage = { text: content[key] };
        delete content.conversation;
        key = 'extendedTextMessage';
    }
    if (score > 0) {
        content[key].contextInfo = { forwardingScore: score, isForwarded: true };
    }
    else {
        content[key].contextInfo = {};
    }
    return content;
};
exports.generateForwardMessageContent = generateForwardMessageContent;
const generateWAMessageContent = async (message, options) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5;
    var _6, _7;
    let m = {};
    if ('text' in message) {
        const extContent = { text: message.text };
        let urlInfo = message.linkPreview;
        if (typeof urlInfo === 'undefined') {
            urlInfo = await (0, exports.generateLinkPreviewIfRequired)(message.text, options.getUrlInfo, options.logger);
        }
        if (urlInfo) {
            extContent.canonicalUrl = urlInfo['canonical-url'];
            extContent.matchedText = urlInfo['matched-text'];
            extContent.jpegThumbnail = urlInfo.jpegThumbnail;
            extContent.description = urlInfo.description;
            extContent.title = urlInfo.title;
            extContent.previewType = 0;
            const img = urlInfo.highQualityThumbnail;
            if (img) {
                extContent.thumbnailDirectPath = img.directPath;
                extContent.mediaKey = img.mediaKey;
                extContent.mediaKeyTimestamp = img.mediaKeyTimestamp;
                extContent.thumbnailWidth = img.width;
                extContent.thumbnailHeight = img.height;
                extContent.thumbnailSha256 = img.fileSha256;
                extContent.thumbnailEncSha256 = img.fileEncSha256;
            }
        }
        if (options.backgroundColor) {
            extContent.backgroundArgb = await assertColor(options.backgroundColor);
        }
        if (options.font) {
            extContent.font = options.font;
        }
        m.extendedTextMessage = extContent;
    }
    else if ('contacts' in message) {
        const contactLen = message.contacts.contacts.length;
        if (!contactLen) {
            throw new boom_1.Boom('require atleast 1 contact', { statusCode: 400 });
        }
        if (contactLen === 1) {
            m.contactMessage = Types_1.WAProto.Message.ContactMessage.fromObject(message.contacts.contacts[0]);
        }
        else {
            m.contactsArrayMessage = Types_1.WAProto.Message.ContactsArrayMessage.fromObject(message.contacts);
        }
    }
    else if ('location' in message) {
        m.locationMessage = Types_1.WAProto.Message.LocationMessage.fromObject(message.location);
        if ('contextInfo' in message && !!message.contextInfo) {
            m.locationMessage.contextInfo = message.contextInfo;
        }
    }
    else if ('liveLocation' in message) {
        m.liveLocationMessage = Types_1.WAProto.Message.LiveLocationMessage.fromObject(message.liveLocation);
        if ('contextInfo' in message && !!message.contextInfo) {
            m.liveLocationMessage.contextInfo = message.contextInfo;
        }
    }
    else if ('react' in message) {
        if (!message.react.senderTimestampMs) {
            message.react.senderTimestampMs = Date.now();
        }
        m.reactionMessage = Types_1.WAProto.Message.ReactionMessage.fromObject(message.react);
    }
    else if ('delete' in message) {
        m.protocolMessage = {
            key: message.delete,
            type: Types_1.WAProto.Message.ProtocolMessage.Type.REVOKE
        };
    }
    else if ('forward' in message) {
        m = (0, exports.generateForwardMessageContent)(message.forward, message.force);
    }
    else if ('disappearingMessagesInChat' in message) {
        const exp = typeof message.disappearingMessagesInChat === 'boolean' ?
            (message.disappearingMessagesInChat ? Defaults_1.WA_DEFAULT_EPHEMERAL : 0) :
            message.disappearingMessagesInChat;
        m = (0, exports.prepareDisappearingMessageSettingContent)(exp);
    }
    else if ('groupInvite' in message) {
        m.groupInviteMessage = {};
        m.groupInviteMessage.inviteCode = message.groupInvite.inviteCode;
        m.groupInviteMessage.inviteExpiration = message.groupInvite.inviteExpiration;
        m.groupInviteMessage.caption = message.groupInvite.text;
        m.groupInviteMessage.groupJid = message.groupInvite.jid;
        m.groupInviteMessage.groupName = message.groupInvite.subject;
        m.groupInviteMessage.jpegThumbnail = message.groupInvite.thumbnail;
        //TODO: use built-in interface and get disappearing mode info etc.
        //TODO: cache / use store!?
        if (options.getProfilePicUrl) {
            let pfpUrl;
            try {
                pfpUrl = await options.getProfilePicUrl(message.groupInvite.jid, 'preview');
            }
            catch (_8) {
                pfpUrl = null;
            }
            if (pfpUrl) {
                const resp = await axios_1.default.get(pfpUrl, { responseType: 'arraybuffer' });
                if (resp.status === 200) {
                    m.groupInviteMessage.jpegThumbnail = resp.data;
                }
            }
            else {
                m.groupInviteMessage.jpegThumbnail = null;
            }
        }
    }
    else if ('pin' in message) {
        m.pinInChatMessage = {};
        m.messageContextInfo = {};
        m.pinInChatMessage.key = message.pin;
        m.pinInChatMessage.type = message.type;
        m.pinInChatMessage.senderTimestampMs = Date.now();
        m.messageContextInfo.messageAddOnDurationInSecs = message.type === 1 ? message.time || 86400 : 0;
    }
    else if ('keep' in message) {
        m.keepInChatMessage = {};
        m.keepInChatMessage.key = message.keep;
        m.keepInChatMessage.keepType = message.type;
        m.keepInChatMessage.timestampMs = Date.now();
    }
    else if ('call' in message) {
        m = {
            scheduledCallCreationMessage: {
                scheduledTimestampMs: (_a = message.call.time) !== null && _a !== void 0 ? _a : Date.now(),
                callType: (_b = message.call.type) !== null && _b !== void 0 ? _b : 1,
                title: message.call.title
            }
        };
    }
    else if ('paymentInvite' in message) {
        m.paymentInviteMessage = {
            serviceType: message.paymentInvite.type,
            expiryTimestamp: message.paymentInvite.expiry
        };
    }
    else if ('buttonReply' in message) {
        switch (message.type) {
            case 'template':
                m.templateButtonReplyMessage = {
                    selectedDisplayText: message.buttonReply.displayText,
                    selectedId: message.buttonReply.id,
                    selectedIndex: message.buttonReply.index,
                };
                break;
            case 'plain':
                m.buttonsResponseMessage = {
                    selectedButtonId: message.buttonReply.id,
                    selectedDisplayText: message.buttonReply.displayText,
                    type: WAProto_1.proto.Message.ButtonsResponseMessage.Type.DISPLAY_TEXT,
                };
                break;
            case 'interactive':
                m.interactiveResponseMessage = {
                    body: {
                        text: message.buttonReply.text,
                        format: WAProto_1.proto.Message.InteractiveResponseMessage.Body.Format.EXTENSIONS_1
                    },
                    nativeFlowResponseMessage: {
                        name: message.buttonReply.nativeFlow.name,
                        paramsJson: message.buttonReply.nativeFlow.paramsJson,
                        version: message.buttonReply.nativeFlow.version
                    }
                };
                break;
        }
    }
    else if ('ptv' in message && message.ptv) {
        const { videoMessage } = await (0, exports.prepareWAMessageMedia)({ video: message.video }, options);
        m.ptvMessage = videoMessage;
    }
    else if ('product' in message) {
        const { imageMessage } = await (0, exports.prepareWAMessageMedia)({ image: (_c = message === null || message === void 0 ? void 0 : message.product) === null || _c === void 0 ? void 0 : _c.productImage }, options);
        m.productMessage = Types_1.WAProto.Message.ProductMessage.fromObject({
            ...message,
            product: {
                ...message.product,
                productImage: imageMessage,
            }
        });
        if ('contextInfo' in message && !!message.contextInfo) {
            m.productMessage.contextInfo = message.contextInfo;
        }
        if ('mentions' in message && !!message.mentions) {
            m.productMessage.contextInfo = { mentionedJid: message.mentions };
        }
    }
    else if ('order' in message) {
        m.orderMessage = Types_1.WAProto.Message.OrderMessage.fromObject({
            orderId: message.order.id,
            thumbnail: message.order.thumbnail,
            itemCount: message.order.itemCount,
            status: message.order.status,
            surface: message.order.surface,
            orderTitle: message.order.title,
            message: message.order.text,
            sellerJid: message.order.seller,
            token: message.order.token,
            totalAmount1000: message.order.amount,
            totalCurrencyCode: message.order.currency
        });
    }
    else if ('listReply' in message) {
        m.listResponseMessage = { ...message.listReply };
    }
    else if ('poll' in message) {
        (_6 = message.poll).selectableCount || (_6.selectableCount = 0);
        (_7 = message.poll).toAnnouncementGroup || (_7.toAnnouncementGroup = false);
        if (!Array.isArray(message.poll.values)) {
            throw new boom_1.Boom('Invalid poll values', { statusCode: 400 });
        }
        if (message.poll.selectableCount < 0
            || message.poll.selectableCount > message.poll.values.length) {
            throw new boom_1.Boom(`poll.selectableCount in poll should be >= 0 and <= ${message.poll.values.length}`, { statusCode: 400 });
        }
        m.messageContextInfo = {
            // encKey
            messageSecret: message.poll.messageSecret || (0, crypto_1.randomBytes)(32),
        };
        const pollCreationMessage = {
            name: message.poll.name,
            selectableOptionsCount: message.poll.selectableCount,
            options: message.poll.values.map(optionName => ({ optionName })),
        };
        if (message.poll.toAnnouncementGroup) {
            // poll v2 is for community announcement groups (single select and multiple)
            m.pollCreationMessageV2 = pollCreationMessage;
        }
        else {
            if (message.poll.selectableCount > 0) {
                //poll v3 is for single select polls
                m.pollCreationMessageV3 = pollCreationMessage;
            }
            else {
                // poll v3 for multiple choice polls
                m.pollCreationMessage = pollCreationMessage;
            }
        }
        if ('contextInfo' in message && !!message.contextInfo) {
            pollCreationMessage.contextInfo = message.contextInfo;
        }
    }
    else if ('pollResult' in message) {
        if (!Array.isArray(message.pollResult.votes)) {
            throw new boom_1.Boom('Invalid poll votes result', { statusCode: 400 });
        }
        m.messageContextInfo = {
            // encKey
            messageSecret: message.pollResult.messageSecret || (0, crypto_1.randomBytes)(32),
        };
        const pollResultSnapshotMessage = {
            name: message.pollResult.name,
            pollVotes: message.pollResult.votes.map((option) => ({
                optionName: option[0],
                optionVoteCount: option[1]
            })),
        };
        if ('contextInfo' in message && !!message.contextInfo) {
            pollResultSnapshotMessage.contextInfo = message.contextInfo;
        }
        if ('mentions' in message && !!message.mentions) {
            pollResultSnapshotMessage.contextInfo = { mentionedJid: message.mentions };
        }
        m.pollResultSnapshotMessage = pollResultSnapshotMessage;
    }
    else if ('event' in message) {
        m.messageContextInfo = {
            messageSecret: message.event.messageSecret || (0, crypto_1.randomBytes)(32),
        };
        m.eventMessage = { ...message.event };
    }
    else if ('inviteAdmin' in message) {
        m.newsletterAdminInviteMessage = {};
        m.newsletterAdminInviteMessage.inviteExpiration = message.inviteAdmin.inviteExpiration;
        m.newsletterAdminInviteMessage.caption = message.inviteAdmin.text;
        m.newsletterAdminInviteMessage.newsletterJid = message.inviteAdmin.jid;
        m.newsletterAdminInviteMessage.newsletterName = message.inviteAdmin.subject;
        m.newsletterAdminInviteMessage.jpegThumbnail = message.inviteAdmin.thumbnail;
        //TODO: use built-in interface and get disappearing mode info etc.
        //TODO: cache / use store!?
        if (options.getProfilePicUrl) {
            let pfpUrl;
            try {
                pfpUrl = await options.getProfilePicUrl(message.inviteAdmin.jid, 'preview');
            }
            catch (_9) {
                pfpUrl = null;
            }
            if (pfpUrl) {
                const resp = await axios_1.default.get(pfpUrl, { responseType: 'arraybuffer' });
                if (resp.status === 200) {
                    m.newsletterAdminInviteMessage.jpegThumbnail = resp.data;
                }
            }
            else {
                m.newsletterAdminInviteMessage.jpegThumbnail = null;
            }
        }
    }
    else if ('requestPayment' in message) {
        const sticker = ((_d = message === null || message === void 0 ? void 0 : message.requestPayment) === null || _d === void 0 ? void 0 : _d.sticker) ?
            await (0, exports.prepareWAMessageMedia)({ sticker: (_e = message === null || message === void 0 ? void 0 : message.requestPayment) === null || _e === void 0 ? void 0 : _e.sticker, ...options }, options)
            : null;
        let notes = {};
        if ((_f = message === null || message === void 0 ? void 0 : message.requestPayment) === null || _f === void 0 ? void 0 : _f.sticker) {
            notes = {
                stickerMessage: {
                    ...sticker === null || sticker === void 0 ? void 0 : sticker.stickerMessage,
                    contextInfo: {
                        stanzaId: (_h = (_g = options === null || options === void 0 ? void 0 : options.quoted) === null || _g === void 0 ? void 0 : _g.key) === null || _h === void 0 ? void 0 : _h.id,
                        participant: (_k = (_j = options === null || options === void 0 ? void 0 : options.quoted) === null || _j === void 0 ? void 0 : _j.key) === null || _k === void 0 ? void 0 : _k.participant,
                        quotedMessage: (_l = options === null || options === void 0 ? void 0 : options.quoted) === null || _l === void 0 ? void 0 : _l.message,
                        ...(_m = message === null || message === void 0 ? void 0 : message.requestPayment) === null || _m === void 0 ? void 0 : _m.contextInfo,
                    }
                }
            };
        }
        else if (message.requestPayment.note) {
            notes = {
                extendedTextMessage: {
                    text: message.requestPayment.note,
                    contextInfo: {
                        stanzaId: (_p = (_o = options === null || options === void 0 ? void 0 : options.quoted) === null || _o === void 0 ? void 0 : _o.key) === null || _p === void 0 ? void 0 : _p.id,
                        participant: (_r = (_q = options === null || options === void 0 ? void 0 : options.quoted) === null || _q === void 0 ? void 0 : _q.key) === null || _r === void 0 ? void 0 : _r.participant,
                        quotedMessage: (_s = options === null || options === void 0 ? void 0 : options.quoted) === null || _s === void 0 ? void 0 : _s.message,
                        ...(_t = message === null || message === void 0 ? void 0 : message.requestPayment) === null || _t === void 0 ? void 0 : _t.contextInfo,
                    }
                }
            };
        }
        m.requestPaymentMessage = Types_1.WAProto.Message.RequestPaymentMessage.fromObject({
            expiryTimestamp: message.requestPayment.expiry,
            amount1000: message.requestPayment.amount,
            currencyCodeIso4217: message.requestPayment.currency,
            requestFrom: message.requestPayment.from,
            noteMessage: { ...notes },
            background: (_u = message.requestPayment.background) !== null && _u !== void 0 ? _u : null,
        });
    }
    else if ('sharePhoneNumber' in message) {
        m.protocolMessage = {
            type: WAProto_1.proto.Message.ProtocolMessage.Type.SHARE_PHONE_NUMBER
        };
    }
    else if ('requestPhoneNumber' in message) {
        m.requestPhoneNumberMessage = {};
    }
    else {
        m = await (0, exports.prepareWAMessageMedia)(message, options);
    }
    if ('buttons' in message && !!message.buttons) {
        const buttonsMessage = {
            buttons: message.buttons.map(b => ({ ...b, type: WAProto_1.proto.Message.ButtonsMessage.Button.Type.RESPONSE }))
        };
        if ('text' in message) {
            buttonsMessage.contentText = message.text;
            buttonsMessage.headerType = ButtonType.EMPTY;
        }
        else {
            if ('caption' in message) {
                buttonsMessage.contentText = message.caption;
            }
            const type = Object.keys(m)[0].replace('Message', '').toUpperCase();
            buttonsMessage.headerType = ButtonType[type];
            Object.assign(buttonsMessage, m);
        }
        if ('footer' in message && !!message.footer) {
            buttonsMessage.footerText = message.footer;
        }
        if ('title' in message && !!message.title) {
            buttonsMessage.text = message.title,
                buttonsMessage.headerType = ButtonType.TEXT;
        }
        if ('contextInfo' in message && !!message.contextInfo) {
            buttonsMessage.contextInfo = message.contextInfo;
        }
        if ('mentions' in message && !!message.mentions) {
            buttonsMessage.contextInfo = { mentionedJid: message.mentions };
        }
        m = { buttonsMessage };
    }
    else if ('templateButtons' in message && !!message.templateButtons) {
        const msg = {
            hydratedButtons: message.hasOwnProperty("templateButtons") ? message.templateButtons : message.templateButtons
        };
        if ('text' in message) {
            msg.hydratedContentText = message.text;
        }
        else {
            if ('caption' in message) {
                msg.hydratedContentText = message.caption;
            }
            Object.assign(msg, m);
        }
        if ('footer' in message && !!message.footer) {
            msg.hydratedFooterText = message.footer;
        }
        m = {
            templateMessage: {
                fourRowTemplate: msg,
                hydratedTemplate: msg
            }
        };
    }
    if ('interactiveButtons' in message && !!message.interactiveButtons) {
        const interactiveMessage = {
            nativeFlowMessage: Types_1.WAProto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                buttons: message.interactiveButtons,
            })
        };
        if ('text' in message) {
            body: interactiveMessage.body = {
                text: message.text
            };
            header: interactiveMessage.header = {
                title: message.title,
                subtitle: message.subtitle,
                hasMediaAttachment: (_v = message === null || message === void 0 ? void 0 : message.media) !== null && _v !== void 0 ? _v : false,
            };
        }
        else {
            if ('caption' in message) {
                body: interactiveMessage.body = {
                    text: message.caption
                };
                header: interactiveMessage.header = {
                    title: message.title,
                    subtitle: message.subtitle,
                    hasMediaAttachment: (_w = message === null || message === void 0 ? void 0 : message.media) !== null && _w !== void 0 ? _w : false,
                };
                Object.assign(interactiveMessage.header, m);
            }
        }
        if ('footer' in message && !!message.footer) {
            footer: interactiveMessage.footer = {
                text: message.footer
            };
        }
        if ('contextInfo' in message && !!message.contextInfo) {
            interactiveMessage.contextInfo = message.contextInfo;
        }
        if ('mentions' in message && !!message.mentions) {
            interactiveMessage.contextInfo = { mentionedJid: message.mentions };
        }
        m = { interactiveMessage };
    }
    if ('shop' in message && !!message.shop) {
        const interactiveMessage = {
            shopStorefrontMessage: Types_1.WAProto.Message.InteractiveMessage.ShopMessage.fromObject({
                surface: message.shop,
                id: message.id
            })
        };
        if ('text' in message) {
            body: interactiveMessage.body = {
                text: message.text
            };
            header: interactiveMessage.header = {
                title: message.title,
                subtitle: message.subtitle,
                hasMediaAttachment: (_x = message === null || message === void 0 ? void 0 : message.media) !== null && _x !== void 0 ? _x : false,
            };
        }
        else {
            if ('caption' in message) {
                body: interactiveMessage.body = {
                    text: message.caption
                };
                header: interactiveMessage.header = {
                    title: message.title,
                    subtitle: message.subtitle,
                    hasMediaAttachment: (_y = message === null || message === void 0 ? void 0 : message.media) !== null && _y !== void 0 ? _y : false,
                };
                Object.assign(interactiveMessage.header, m);
            }
        }
        if ('footer' in message && !!message.footer) {
            footer: interactiveMessage.footer = {
                text: message.footer
            };
        }
        if ('contextInfo' in message && !!message.contextInfo) {
            interactiveMessage.contextInfo = message.contextInfo;
        }
        if ('mentions' in message && !!message.mentions) {
            interactiveMessage.contextInfo = { mentionedJid: message.mentions };
        }
        m = { interactiveMessage };
    }
    if ('collection' in message && !!message.shop) {
        const interactiveMessage = {
            collectionMessage: Types_1.WAProto.Message.InteractiveMessage.CollectionMessage.fromObject({
                bizJid: (_z = message === null || message === void 0 ? void 0 : message.collection) === null || _z === void 0 ? void 0 : _z.bizJid,
                id: (_0 = message === null || message === void 0 ? void 0 : message.collection) === null || _0 === void 0 ? void 0 : _0.id,
                messageVersion: (_1 = message === null || message === void 0 ? void 0 : message.collection) === null || _1 === void 0 ? void 0 : _1.version
            })
        };
        if ('text' in message) {
            body: interactiveMessage.body = {
                text: message.text
            };
            header: interactiveMessage.header = {
                title: message.title,
                subtitle: message.subtitle,
                hasMediaAttachment: (_2 = message === null || message === void 0 ? void 0 : message.media) !== null && _2 !== void 0 ? _2 : false,
            };
        }
        else {
            if ('caption' in message) {
                body: interactiveMessage.body = {
                    text: message.caption
                };
                header: interactiveMessage.header = {
                    title: message.title,
                    subtitle: message.subtitle,
                    hasMediaAttachment: (_3 = message === null || message === void 0 ? void 0 : message.media) !== null && _3 !== void 0 ? _3 : false,
                };
                Object.assign(interactiveMessage.header, m);
            }
        }
        if ('footer' in message && !!message.footer) {
            footer: interactiveMessage.footer = {
                text: message.footer
            };
        }
        if ('contextInfo' in message && !!message.contextInfo) {
            interactiveMessage.contextInfo = message.contextInfo;
        }
        if ('mentions' in message && !!message.mentions) {
            interactiveMessage.contextInfo = { mentionedJid: message.mentions };
        }
        m = { interactiveMessage };
    }
    if ('cards' in message && !!message.cards) {
        const slides = await Promise.all(message.cards.map(async (slide) => {
            const { image, video, product, title, caption, footer, buttons } = slide;
            let header;
            if (product) {
                const { imageMessage } = await (0, exports.prepareWAMessageMedia)({ image: product.productImage, ...options }, options);
                header = {
                    productMesage: Types_1.WAProto.Message.ProductMessage.fromObject({
                        product: {
                            ...product,
                            productImage: imageMessage,
                        },
                        ...slide
                    })
                };
            }
            else if (image) {
                header = await (0, exports.prepareWAMessageMedia)({ image: image, ...options }, options);
            }
            else if (video) {
                header = await (0, exports.prepareWAMessageMedia)({ video: video, ...options }, options);
            }
            const msg = {
                header: {
                    title,
                    hasMediaAttachment: true,
                    ...header
                },
                body: {
                    text: caption
                },
                footer: {
                    text: footer
                },
                nativeFlowMessage: {
                    buttons,
                },
            };
            return msg;
        }));
        const interactiveMessage = {
            carouselMessage: Types_1.WAProto.Message.InteractiveMessage.CarouselMessage.fromObject({
                cards: slides
            })
        };
        if ('text' in message) {
            body: interactiveMessage.body = {
                text: message.text
            };
            header: interactiveMessage.header = {
                title: message.title,
                subtitle: message.subtitle,
                hasMediaAttachment: (_4 = message === null || message === void 0 ? void 0 : message.media) !== null && _4 !== void 0 ? _4 : false,
            };
        }
        if ('footer' in message && !!message.footer) {
            footer: interactiveMessage.footer = {
                text: message.footer
            };
        }
        if ('contextInfo' in message && !!message.contextInfo) {
            interactiveMessage.contextInfo = message.contextInfo;
        }
        if ('mentions' in message && !!message.mentions) {
            interactiveMessage.contextInfo = { mentionedJid: message.mentions };
        }
        m = { interactiveMessage };
    }
    if ('sections' in message && !!message.sections) {
        const listMessage = {
            sections: message.sections,
            buttonText: message.buttonText,
            title: message.title,
            footerText: message.footer,
            description: message.text,
            listType: WAProto_1.proto.Message.ListMessage.ListType.SINGLE_SELECT
        };
        m = { listMessage };
    }
    if ('viewOnce' in message && !!message.viewOnce) {
        m = { viewOnceMessage: { message: m } };
    }
    if ('viewOnceV2' in message && !!message.viewOnceV2) {
        m = { viewOnceMessageV2: { message: m } };
    }
    if ('viewOnceV2Extension' in message && !!message.viewOnceV2Extension) {
        m = { viewOnceMessageV2Extension: { message: m } };
    }
    if ('ephemeral' in message && !!message.ephemeral) {
        m = { ephemeralMessage: { message: m } };
    }
    if ('lottie' in message && !!message.lottie) {
        m = { lottieStickerMessage: { message: m } };
    }
    if ('mentions' in message && ((_5 = message.mentions) === null || _5 === void 0 ? void 0 : _5.length)) {
        const [messageType] = Object.keys(m);
        m[messageType].contextInfo = m[messageType] || {};
        m[messageType].contextInfo.mentionedJid = message.mentions;
    }
    if ('edit' in message) {
        m = {
            protocolMessage: {
                key: message.edit,
                editedMessage: m,
                timestampMs: Date.now(),
                type: Types_1.WAProto.Message.ProtocolMessage.Type.MESSAGE_EDIT
            }
        };
    }
    if ('contextInfo' in message && !!message.contextInfo) {
        const [messageType] = Object.keys(m);
        m[messageType] = m[messageType] || {};
        m[messageType].contextInfo = message.contextInfo;
    }
    return Types_1.WAProto.Message.fromObject(m);
};
exports.generateWAMessageContent = generateWAMessageContent;
const generateWAMessageFromContent = (jid, message, options) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    // set timestamp to now
    // if not specified
    if (!options.timestamp) {
        options.timestamp = new Date();
    }
    const innerMessage = (0, exports.normalizeMessageContent)(message);
    const key = (0, exports.getContentType)(innerMessage);
    const timestamp = (0, generics_1.unixTimestampSeconds)(options.timestamp);
    const { quoted, userJid } = options;
    if (quoted && !(0, WABinary_1.isJidNewsLetter)(jid)) {
        const participant = quoted.key.fromMe ? userJid : (quoted.participant || quoted.key.participant || quoted.key.remoteJid);
        let quotedMsg = (0, exports.normalizeMessageContent)(quoted.message);
        const msgType = (0, exports.getContentType)(quotedMsg);
        // strip any redundant properties
        quotedMsg = WAProto_1.proto.Message.fromObject({ [msgType]: quotedMsg[msgType] });
        const quotedContent = quotedMsg[msgType];
        if (typeof quotedContent === 'object' && quotedContent && 'contextInfo' in quotedContent) {
            delete quotedContent.contextInfo;
        }
        let requestPayment;
        if (key === 'requestPaymentMessage') {
            if (((_a = innerMessage === null || innerMessage === void 0 ? void 0 : innerMessage.requestPaymentMessage) === null || _a === void 0 ? void 0 : _a.noteMessage) && ((_c = (_b = innerMessage === null || innerMessage === void 0 ? void 0 : innerMessage.requestPaymentMessage) === null || _b === void 0 ? void 0 : _b.noteMessage) === null || _c === void 0 ? void 0 : _c.extendedTextMessage)) {
                requestPayment = (_e = (_d = innerMessage === null || innerMessage === void 0 ? void 0 : innerMessage.requestPaymentMessage) === null || _d === void 0 ? void 0 : _d.noteMessage) === null || _e === void 0 ? void 0 : _e.extendedTextMessage;
            }
            else if (((_f = innerMessage === null || innerMessage === void 0 ? void 0 : innerMessage.requestPaymentMessage) === null || _f === void 0 ? void 0 : _f.noteMessage) && ((_h = (_g = innerMessage === null || innerMessage === void 0 ? void 0 : innerMessage.requestPaymentMessage) === null || _g === void 0 ? void 0 : _g.noteMessage) === null || _h === void 0 ? void 0 : _h.stickerMessage)) {
                requestPayment = (_k = (_j = innerMessage.requestPaymentMessage) === null || _j === void 0 ? void 0 : _j.noteMessage) === null || _k === void 0 ? void 0 : _k.stickerMessage;
            }
        }
        const contextInfo = (key === 'requestPaymentMessage' ? requestPayment.contextInfo : innerMessage[key].contextInfo) || {};
        contextInfo.participant = (0, WABinary_1.jidNormalizedUser)(participant);
        contextInfo.stanzaId = quoted.key.id;
        contextInfo.quotedMessage = quotedMsg;
        // if a participant is quoted, then it must be a group
        // hence, remoteJid of group must also be entered
        if (jid !== quoted.key.remoteJid) {
            contextInfo.remoteJid = quoted.key.remoteJid;
        }
        innerMessage[key].contextInfo = contextInfo;
    }
    if (
    // if we want to send a disappearing message
    !!(options === null || options === void 0 ? void 0 : options.ephemeralExpiration) &&
        // and it's not a protocol message -- delete, toggle disappear message
        key !== 'protocolMessage' &&
        // already not converted to disappearing message
        key !== 'ephemeralMessage' &&
        // newsletter not accept disappearing messages
        !(0, WABinary_1.isJidNewsLetter)(jid)) {
        innerMessage[key].contextInfo = {
            ...(innerMessage[key].contextInfo || {}),
            expiration: options.ephemeralExpiration || Defaults_1.WA_DEFAULT_EPHEMERAL,
            //ephemeralSettingTimestamp: options.ephemeralOptions.eph_setting_ts?.toString()
        };
    }
    message = Types_1.WAProto.Message.fromObject(message);
    const messageJSON = {
        key: {
            remoteJid: jid,
            fromMe: true,
            id: (options === null || options === void 0 ? void 0 : options.messageId) || (0, generics_1.generateMessageID)(),
        },
        message: message,
        messageTimestamp: timestamp,
        messageStubParameters: [],
        participant: (0, WABinary_1.isJidGroup)(jid) || (0, WABinary_1.isJidStatusBroadcast)(jid) ? userJid : undefined,
        status: Types_1.WAMessageStatus.PENDING
    };
    return Types_1.WAProto.WebMessageInfo.fromObject(messageJSON);
};
exports.generateWAMessageFromContent = generateWAMessageFromContent;
const generateWAMessage = async (jid, content, options) => {
    var _a;
    // ensure msg ID is with every log
    options.logger = (_a = options === null || options === void 0 ? void 0 : options.logger) === null || _a === void 0 ? void 0 : _a.child({ msgId: options.messageId });
    return (0, exports.generateWAMessageFromContent)(jid, await (0, exports.generateWAMessageContent)(content, { newsletter: (0, WABinary_1.isJidNewsLetter)(jid), ...options }), options);
};
exports.generateWAMessage = generateWAMessage;
/** Get the key to access the true type of content */
const getContentType = (content) => {
    if (content) {
        const keys = Object.keys(content);
        const key = keys.find(k => (k === 'conversation' || k.includes('Message')) && k !== 'senderKeyDistributionMessage');
        return key;
    }
};
exports.getContentType = getContentType;
/**
 * Normalizes ephemeral, view once messages to regular message content
 * Eg. image messages in ephemeral messages, in view once messages etc.
 * @param content
 * @returns
 */
const normalizeMessageContent = (content) => {
    if (!content) {
        return undefined;
    }
    // set max iterations to prevent an infinite loop
    for (let i = 0; i < 5; i++) {
        const inner = getFutureProofMessage(content);
        if (!inner) {
            break;
        }
        content = inner.message;
    }
    return content;
    function getFutureProofMessage(message) {
        return ((message === null || message === void 0 ? void 0 : message.ephemeralMessage)
            || (message === null || message === void 0 ? void 0 : message.viewOnceMessage)
            || (message === null || message === void 0 ? void 0 : message.documentWithCaptionMessage)
            || (message === null || message === void 0 ? void 0 : message.viewOnceMessageV2)
            || (message === null || message === void 0 ? void 0 : message.viewOnceMessageV2Extension)
            || (message === null || message === void 0 ? void 0 : message.editedMessage));
    }
};
exports.normalizeMessageContent = normalizeMessageContent;
/**
 * Extract the true message content from a message
 * Eg. extracts the inner message from a disappearing message/view once message
 */
const extractMessageContent = (content) => {
    var _a, _b, _c, _d, _e, _f;
    const extractFromTemplateMessage = (msg) => {
        if (msg.imageMessage) {
            return { imageMessage: msg.imageMessage };
        }
        else if (msg.documentMessage) {
            return { documentMessage: msg.documentMessage };
        }
        else if (msg.videoMessage) {
            return { videoMessage: msg.videoMessage };
        }
        else if (msg.locationMessage) {
            return { locationMessage: msg.locationMessage };
        }
        else {
            return {
                conversation: 'contentText' in msg
                    ? msg.contentText
                    : ('hydratedContentText' in msg ? msg.hydratedContentText : '')
            };
        }
    };
    content = (0, exports.normalizeMessageContent)(content);
    if (content === null || content === void 0 ? void 0 : content.buttonsMessage) {
        return extractFromTemplateMessage(content.buttonsMessage);
    }
    if ((_a = content === null || content === void 0 ? void 0 : content.templateMessage) === null || _a === void 0 ? void 0 : _a.hydratedFourRowTemplate) {
        return extractFromTemplateMessage((_b = content === null || content === void 0 ? void 0 : content.templateMessage) === null || _b === void 0 ? void 0 : _b.hydratedFourRowTemplate);
    }
    if ((_c = content === null || content === void 0 ? void 0 : content.templateMessage) === null || _c === void 0 ? void 0 : _c.hydratedTemplate) {
        return extractFromTemplateMessage((_d = content === null || content === void 0 ? void 0 : content.templateMessage) === null || _d === void 0 ? void 0 : _d.hydratedTemplate);
    }
    if ((_e = content === null || content === void 0 ? void 0 : content.templateMessage) === null || _e === void 0 ? void 0 : _e.fourRowTemplate) {
        return extractFromTemplateMessage((_f = content === null || content === void 0 ? void 0 : content.templateMessage) === null || _f === void 0 ? void 0 : _f.fourRowTemplate);
    }
    return content;
};
exports.extractMessageContent = extractMessageContent;
/**
 * Returns the device predicted by message ID
 */
const getDevice = (id) => /^3A.{18}$/.test(id) ? 'ios' : /^3E.{20}$/.test(id) ? 'web' : /^(.{21}|.{32})$/.test(id) ? 'android' : /^.{18}$/.test(id) ? 'desktop' : 'unknown';
exports.getDevice = getDevice;
/** Upserts a receipt in the message */
const updateMessageWithReceipt = (msg, receipt) => {
    msg.userReceipt = msg.userReceipt || [];
    const recp = msg.userReceipt.find(m => m.userJid === receipt.userJid);
    if (recp) {
        Object.assign(recp, receipt);
    }
    else {
        msg.userReceipt.push(receipt);
    }
};
exports.updateMessageWithReceipt = updateMessageWithReceipt;
/** Update the message with a new reaction */
const updateMessageWithReaction = (msg, reaction) => {
    const authorID = (0, generics_1.getKeyAuthor)(reaction.key);
    const reactions = (msg.reactions || [])
        .filter(r => (0, generics_1.getKeyAuthor)(r.key) !== authorID);
    if (reaction.text) {
        reactions.push(reaction);
    }
    msg.reactions = reactions;
};
exports.updateMessageWithReaction = updateMessageWithReaction;
/** Update the message with a new poll update */
const updateMessageWithPollUpdate = (msg, update) => {
    var _a, _b;
    const authorID = (0, generics_1.getKeyAuthor)(update.pollUpdateMessageKey);
    const reactions = (msg.pollUpdates || [])
        .filter(r => (0, generics_1.getKeyAuthor)(r.pollUpdateMessageKey) !== authorID);
    if ((_b = (_a = update.vote) === null || _a === void 0 ? void 0 : _a.selectedOptions) === null || _b === void 0 ? void 0 : _b.length) {
        reactions.push(update);
    }
    msg.pollUpdates = reactions;
};
exports.updateMessageWithPollUpdate = updateMessageWithPollUpdate;
/**
 * Aggregates all poll updates in a poll.
 * @param msg the poll creation message
 * @param meId your jid
 * @returns A list of options & their voters
 */
function getAggregateVotesInPollMessage({ message, pollUpdates }, meId) {
    var _a, _b, _c;
    const opts = ((_a = message === null || message === void 0 ? void 0 : message.pollCreationMessage) === null || _a === void 0 ? void 0 : _a.options) || ((_b = message === null || message === void 0 ? void 0 : message.pollCreationMessageV2) === null || _b === void 0 ? void 0 : _b.options) || ((_c = message === null || message === void 0 ? void 0 : message.pollCreationMessageV3) === null || _c === void 0 ? void 0 : _c.options) || [];
    const voteHashMap = opts.reduce((acc, opt) => {
        const hash = (0, crypto_2.sha256)(Buffer.from(opt.optionName || '')).toString();
        acc[hash] = {
            name: opt.optionName || '',
            voters: []
        };
        return acc;
    }, {});
    for (const update of pollUpdates || []) {
        const { vote } = update;
        if (!vote) {
            continue;
        }
        for (const option of vote.selectedOptions || []) {
            const hash = option.toString();
            let data = voteHashMap[hash];
            if (!data) {
                voteHashMap[hash] = {
                    name: 'Unknown',
                    voters: []
                };
                data = voteHashMap[hash];
            }
            voteHashMap[hash].voters.push((0, generics_1.getKeyAuthor)(update.pollUpdateMessageKey, meId));
        }
    }
    return Object.values(voteHashMap);
}
exports.getAggregateVotesInPollMessage = getAggregateVotesInPollMessage;
/** Given a list of message keys, aggregates them by chat & sender. Useful for sending read receipts in bulk */
const aggregateMessageKeysNotFromMe = (keys) => {
    const keyMap = {};
    for (const { remoteJid, id, participant, fromMe } of keys) {
        if (!fromMe) {
            const uqKey = `${remoteJid}:${participant || ''}`;
            if (!keyMap[uqKey]) {
                keyMap[uqKey] = {
                    jid: remoteJid,
                    participant: participant,
                    messageIds: []
                };
            }
            keyMap[uqKey].messageIds.push(id);
        }
    }
    return Object.values(keyMap);
};
exports.aggregateMessageKeysNotFromMe = aggregateMessageKeysNotFromMe;
const REUPLOAD_REQUIRED_STATUS = [410, 404];
/**
 * Downloads the given message. Throws an error if it's not a media message
 */
const downloadMediaMessage = async (message, type, options, ctx) => {
    const result = await downloadMsg()
        .catch(async (error) => {
        var _a;
        if (ctx) {
            if (axios_1.default.isAxiosError(error)) {
                // check if the message requires a reupload
                if (REUPLOAD_REQUIRED_STATUS.includes((_a = error.response) === null || _a === void 0 ? void 0 : _a.status)) {
                    ctx.logger.info({ key: message.key }, 'sending reupload media request...');
                    // request reupload
                    message = await ctx.reuploadRequest(message);
                    const result = await downloadMsg();
                    return result;
                }
            }
        }
        throw error;
    });
    return result;
    async function downloadMsg() {
        const mContent = (0, exports.extractMessageContent)(message.message);
        if (!mContent) {
            throw new boom_1.Boom('No message present', { statusCode: 400, data: message });
        }
        const contentType = (0, exports.getContentType)(mContent);
        let mediaType = contentType === null || contentType === void 0 ? void 0 : contentType.replace('Message', '');
        const media = mContent[contentType];
        if (!media || typeof media !== 'object' || (!('url' in media) && !('thumbnailDirectPath' in media))) {
            throw new boom_1.Boom(`"${contentType}" message is not a media message`);
        }
        let download;
        if ('thumbnailDirectPath' in media && !('url' in media)) {
            download = {
                directPath: media.thumbnailDirectPath,
                mediaKey: media.mediaKey
            };
            mediaType = 'thumbnail-link';
        }
        else {
            download = media;
        }
        const stream = await (0, messages_media_1.downloadContentFromMessage)(download, mediaType, options);
        if (type === 'buffer') {
            const bufferArray = [];
            for await (const chunk of stream) {
                bufferArray.push(chunk);
            }
            return Buffer.concat(bufferArray);
        }
        return stream;
    }
};
exports.downloadMediaMessage = downloadMediaMessage;
/** Checks whether the given message is a media message; if it is returns the inner content */
const assertMediaContent = (content) => {
    content = (0, exports.extractMessageContent)(content);
    const mediaContent = (content === null || content === void 0 ? void 0 : content.documentMessage)
        || (content === null || content === void 0 ? void 0 : content.imageMessage)
        || (content === null || content === void 0 ? void 0 : content.videoMessage)
        || (content === null || content === void 0 ? void 0 : content.audioMessage)
        || (content === null || content === void 0 ? void 0 : content.stickerMessage);
    if (!mediaContent) {
        throw new boom_1.Boom('given message is not a media message', { statusCode: 400, data: content });
    }
    return mediaContent;
};
exports.assertMediaContent = assertMediaContent;
