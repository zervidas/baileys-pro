import axios, { AxiosRequestConfig } from 'axios';
import { KeyPair, SignedKeyPair, SocketConfig } from '../Types';
export declare const makeRegistrationSocket: (config: SocketConfig) => {
    register: (code: string) => Promise<ExistsResponse>;
    requestRegistrationCode: (registrationOptions?: RegistrationOptions) => Promise<ExistsResponse>;
    logger: Logger;
    getOrderDetails: (orderId: string, tokenBase64: string) => Promise<import("../Types").OrderDetails>;
    getCatalog: ({ jid, limit, cursor }: import("../Types").GetCatalogOptions) => Promise<{
        products: import("../Types").Product[];
        nextPageCursor: any;
    }>;
    getCollections: (jid?: string, limit?: number) => Promise<{
        collections: import("../Types").CatalogCollection[];
    }>;
    productCreate: (create: import("../Types").ProductCreate) => Promise<import("../Types").Product>;
    productDelete: (productIds: string[]) => Promise<{
        deleted: number;
    }>;
    productUpdate: (productId: string, update: import("../Types").ProductUpdate) => Promise<import("../Types").Product>;
    sendMessageAck: ({ tag, attrs, content }: import("../WABinary").BinaryNode, errorCode?: number) => Promise<void>;
    sendRetryRequest: (node: import("../WABinary").BinaryNode, forceIncludeKeys?: boolean) => Promise<void>;
    offerCall: (toJid: string, isVideo?: boolean) => Promise<{
        id: any;
        to: string;
    }>;
    rejectCall: (callId: string, callFrom: string) => Promise<void>;
    fetchMessageHistory: (count: number, oldestMsgKey: import("../Types").WAMessageKey, oldestMsgTimestamp: number) => Promise<string>;
    requestPlaceholderResend: (messageKey: import("../Types").WAMessageKey) => Promise<string | undefined>;
    getPrivacyTokens: (jids: string[]) => Promise<import("../WABinary").BinaryNode>;
    assertSessions: (jids: string[], force: boolean) => Promise<boolean>;
    relayMessage: (jid: string, message: import("../Types").WAProto.IMessage, { messageId: msgId, participant, additionalAttributes, additionalNodes, useUserDevicesCache, cachedGroupMetadata, statusJidList }: import("../Types").MessageRelayOptions) => Promise<string>;
    sendReceipt: (jid: string, participant: string | undefined, messageIds: string[], type: import("../Types").MessageReceiptType) => Promise<void>;
    sendReceipts: (keys: import("../Types").WAMessageKey[], type: import("../Types").MessageReceiptType) => Promise<void>;
    getButtonArgs: (message: import("../Types").WAProto.IMessage) => import("../WABinary").BinaryNode["attrs"];
    readMessages: (keys: import("../Types").WAMessageKey[]) => Promise<void>;
    refreshMediaConn: (forceGet?: boolean) => Promise<import("../Types").MediaConnInfo>;
    getUSyncDevices: (jids: string[], useCache: boolean, ignoreZeroDevices: boolean) => Promise<import("../WABinary").JidWithDevice[]>;
    sendPeerDataOperationMessage: (pdoMessage: import("../Types").WAProto.Message.IPeerDataOperationRequestMessage) => Promise<string>;
    createParticipantNodes: (jids: string[], message: import("../Types").WAProto.IMessage, extraAttrs?: import("../WABinary").BinaryNode["attrs"]) => Promise<{
        nodes: import("../WABinary").BinaryNode[];
        shouldIncludeDeviceIdentity: boolean;
    }>;
    waUploadToServer: import("../Types").WAMediaUploadFunction;
    fetchPrivacySettings: (force?: boolean) => Promise<{
        [_: string]: string;
    }>;
    updateMediaMessage: (message: import("../Types").WAProto.IWebMessageInfo) => Promise<import("../Types").WAProto.IWebMessageInfo>;
    sendStatusMentions: (content: import("../Types").AnyMessageContent, jids?: string[]) => Promise<import("../Types").WAProto.WebMessageInfo>;
    sendAlbumMessage: (jid: string, medias: import("../Types").Media[], options?: import("../Types").MiscMessageGenerationOptions) => Promise<import("../Types").WAProto.WebMessageInfo>;
    sendMessage: (jid: string, content: import("../Types").AnyMessageContent, options?: import("../Types").MiscMessageGenerationOptions) => Promise<import("../Types").WAProto.WebMessageInfo | undefined>;
    subscribeNewsletterUpdates: (jid: string) => Promise<{
        duration: string;
    }>;
    newsletterReactionMode: (jid: string, mode: import("../Types").NewsletterReactionMode) => Promise<void>;
    newsletterUpdateDescription: (jid: string, description?: string) => Promise<void>;
    newsletterUpdateName: (jid: string, name: string) => Promise<void>;
    newsletterUpdatePicture: (jid: string, content: import("../Types").WAMediaUpload) => Promise<void>;
    newsletterRemovePicture: (jid: string) => Promise<void>;
    newsletterUnfollow: (jid: string) => Promise<void>;
    newsletterFollow: (jid: string) => Promise<void>;
    newsletterUnmute: (jid: string) => Promise<void>;
    newsletterMute: (jid: string) => Promise<void>;
    newsletterAction: (jid: string, type: "follow" | "unfollow" | "mute" | "unmute") => Promise<void>;
    newsletterCreate: (name: string, description: string) => Promise<import("../Types").NewsletterMetadata>;
    newsletterMetadata: (type: "invite" | "jid", key: string, role?: import("../Types").NewsletterViewRole) => Promise<import("../Types").NewsletterMetadata>;
    newsletterAdminCount: (jid: string) => Promise<number>;
    newsletterChangeOwner: (jid: string, user: string) => Promise<void>;
    newsletterDemote: (jid: string, user: string) => Promise<void>;
    newsletterDelete: (jid: string) => Promise<void>;
    newsletterReactMessage: (jid: string, serverId: string, code?: string) => Promise<void>;
    newsletterFetchMessages: (type: "invite" | "jid", key: string, count: number, after?: number) => Promise<import("../Types").NewsletterFetchedUpdate[]>;
    newsletterFetchUpdates: (jid: string, count: number, after?: number, since?: number) => Promise<import("../Types").NewsletterFetchedUpdate[]>;
    groupMetadata: (jid: string) => Promise<import("../Types").GroupMetadata>;
    groupCreate: (subject: string, participants: string[]) => Promise<import("../Types").GroupMetadata>;
    groupLeave: (id: string) => Promise<void>;
    groupUpdateSubject: (jid: string, subject: string) => Promise<void>;
    groupRequestParticipantsList: (jid: string) => Promise<{
        [key: string]: string;
    }[]>;
    groupRequestParticipantsUpdate: (jid: string, participants: string[], action: "approve" | "reject") => Promise<{
        status: string;
        jid: string;
    }[]>;
    groupParticipantsUpdate: (jid: string, participants: string[], action: import("../Types").ParticipantAction) => Promise<{
        status: string;
        jid: string;
        content: import("../WABinary").BinaryNode;
    }[]>;
    groupUpdateDescription: (jid: string, description?: string) => Promise<void>;
    groupInviteCode: (jid: string) => Promise<string | undefined>;
    groupRevokeInvite: (jid: string) => Promise<string | undefined>;
    groupAcceptInvite: (code: string) => Promise<string | undefined>;
    groupAcceptInviteV4: (key: string | import("../Types").WAProto.IMessageKey, inviteMessage: import("../Types").WAProto.Message.IGroupInviteMessage) => Promise<string>;
    groupGetInviteInfo: (code: string) => Promise<import("../Types").GroupMetadata>;
    groupToggleEphemeral: (jid: string, ephemeralExpiration: number) => Promise<void>;
    groupSettingUpdate: (jid: string, setting: "announcement" | "not_announcement" | "locked" | "unlocked") => Promise<void>;
    groupMemberAddMode: (jid: string, mode: "admin_add" | "all_member_add") => Promise<void>;
    groupJoinApprovalMode: (jid: string, mode: "on" | "off") => Promise<void>;
    groupFetchAllParticipating: () => Promise<{
        [_: string]: import("../Types").GroupMetadata;
    }>;
    processingMutex: {
        mutex<T>(code: () => Promise<T> | T): Promise<T>;
    };
    upsertMessage: (msg: import("../Types").WAProto.IWebMessageInfo, type: import("../Types").MessageUpsertType) => Promise<void>;
    appPatch: (patchCreate: import("../Types").WAPatchCreate) => Promise<void>;
    sendPresenceUpdate: (type: import("../Types").WAPresence, toJid?: string) => Promise<void>;
    presenceSubscribe: (toJid: string, tcToken?: Buffer) => Promise<void>;
    profilePictureUrl: (jid: string, type?: "preview" | "image", timeoutMs?: number) => Promise<string | undefined>;
    onWhatsApp: (...jids: string[]) => Promise<{
        exists: boolean;
        jid: string;
    }[]>;
    fetchBlocklist: () => Promise<string[]>;
    fetchStatus: (jid: string) => Promise<{
        status: string | undefined;
        setAt: Date;
    } | undefined>;
    updateProfilePicture: (jid: string, content: import("../Types").WAMediaUpload) => Promise<void>;
    removeProfilePicture: (jid: string) => Promise<void>;
    updateProfileStatus: (status: string) => Promise<void>;
    updateProfileName: (name: string) => Promise<void>;
    updateBlockStatus: (jid: string, action: "block" | "unblock") => Promise<void>;
    updateLastSeenPrivacy: (value: import("../Types").WAPrivacyValue) => Promise<void>;
    updateOnlinePrivacy: (value: import("../Types").WAPrivacyOnlineValue) => Promise<void>;
    updateProfilePicturePrivacy: (value: import("../Types").WAPrivacyValue) => Promise<void>;
    updateStatusPrivacy: (value: import("../Types").WAPrivacyValue) => Promise<void>;
    updateReadReceiptsPrivacy: (value: import("../Types").WAReadReceiptsValue) => Promise<void>;
    updateGroupsAddPrivacy: (value: import("../Types").WAPrivacyValue) => Promise<void>;
    updateDefaultDisappearingMode: (duration: number) => Promise<void>;
    getBusinessProfile: (jid: string) => Promise<import("../Types").WABusinessProfile | void>;
    resyncAppState: (collections: readonly ("critical_block" | "critical_unblock_low" | "regular_high" | "regular_low" | "regular")[], isInitialSync: boolean) => Promise<void>;
    chatModify: (mod: import("../Types").ChatModification, jid: string) => Promise<void>;
    cleanDirtyBits: (type: "account_sync" | "groups", fromTimestamp?: number | string) => Promise<void>;
    addChatLabel: (jid: string, labelId: string) => Promise<void>;
    removeChatLabel: (jid: string, labelId: string) => Promise<void>;
    addMessageLabel: (jid: string, messageId: string, labelId: string) => Promise<void>;
    removeMessageLabel: (jid: string, messageId: string, labelId: string) => Promise<void>;
    star: (jid: string, messages: {
        id: string;
        fromMe?: boolean;
    }[], star: boolean) => Promise<void>;
    type: "md";
    ws: any;
    ev: import("../Types").BaileysEventEmitter & {
        process(handler: (events: Partial<import("../Types").BaileysEventMap>) => void | Promise<void>): (() => void);
        buffer(): void;
        createBufferedFunction<A extends any[], T>(work: (...args: A) => Promise<T>): ((...args: A) => Promise<T>);
        flush(force?: boolean): boolean;
        isBuffering(): boolean;
    };
    authState: {
        creds: import("../Types").AuthenticationCreds;
        keys: import("../Types").SignalKeyStoreWithTransaction;
    };
    signalRepository: import("../Types").SignalRepository;
    user: import("../Types").Contact | undefined;
    generateMessageTag: () => string;
    query: (node: import("../WABinary").BinaryNode, timeoutMs?: number) => Promise<import("../WABinary").BinaryNode>;
    waitForMessage: <T>(msgId: string, timeoutMs?: number | undefined) => Promise<T>;
    waitForSocketOpen: () => Promise<void>;
    sendRawMessage: (data: Uint8Array | Buffer) => Promise<void>;
    sendNode: (frame: import("../WABinary").BinaryNode) => Promise<void>;
    logout: (msg?: string) => Promise<void>;
    end: (error: Error | undefined) => void;
    onUnexpectedError: (err: Error | axios, msg: string) => void;
    uploadPreKeys: (count?: number) => Promise<void>;
    uploadPreKeysToServerIfRequired: () => Promise<void>;
    requestPairingCode: (phoneNumber: string, pairCode: string) => Promise<string>;
    waitForConnectionUpdate: (check: (u: Partial<import("../Types").ConnectionState>) => boolean | undefined, timeoutMs?: number) => Promise<void>;
    sendWAMBuffer: (wamBuffer: Buffer) => Promise<import("../WABinary").BinaryNode>;
};
export interface RegistrationData {
    registrationId: number;
    signedPreKey: SignedKeyPair;
    noiseKey: KeyPair;
    signedIdentityKey: KeyPair;
    identityId: Buffer;
    phoneId: string;
    deviceId: string;
    backupToken: Buffer;
}
export interface RegistrationOptions {
    /** your phone number */
    phoneNumber?: string;
    /** the country code of your phone number */
    phoneNumberCountryCode: string;
    /** your phone number without country code */
    phoneNumberNationalNumber: string;
    /** the country code of your mobile network
     * @see {@link https://de.wikipedia.org/wiki/Mobile_Country_Code}
     */
    phoneNumberMobileCountryCode: string;
    /** the network code of your mobile network
     * @see {@link https://de.wikipedia.org/wiki/Mobile_Network_Code}
     */
    phoneNumberMobileNetworkCode: string;
    /**
     * How to send the one time code
     */
    method?: 'sms' | 'voice' | 'captcha';
    /**
     * The captcha code if it was requested
     */
    captcha?: string;
}
export type RegistrationParams = RegistrationData & RegistrationOptions;
export declare function registrationParams(params: RegistrationParams): {
    cc: string;
    in: string;
    Rc: string;
    lg: string;
    lc: string;
    mistyped: string;
    authkey: any;
    e_regid: any;
    e_keytype: string;
    e_ident: any;
    e_skey_id: string;
    e_skey_val: any;
    e_skey_sig: any;
    fdid: string;
    network_ratio_type: string;
    expid: string;
    simnum: string;
    hasinrc: string;
    pid: string;
    id: string;
    backup_token: string;
    token: any;
    fraud_checkpoint_code: string | undefined;
};
/**
 * Requests a registration code for the given phone number.
 */
export declare function mobileRegisterCode(params: RegistrationParams, fetchOptions?: AxiosRequestConfig): Promise<ExistsResponse>;
export declare function mobileRegisterExists(params: RegistrationParams, fetchOptions?: AxiosRequestConfig): Promise<ExistsResponse>;
/**
 * Registers the phone number on whatsapp with the received OTP code.
 */
export declare function mobileRegister(params: RegistrationParams & {
    code: string;
}, fetchOptions?: AxiosRequestConfig): Promise<ExistsResponse>;
/**
 * Encrypts the given string as AEAD aes-256-gcm with the public whatsapp key and a random keypair.
 */
export declare function mobileRegisterEncrypt(data: string): any;
export declare function mobileRegisterFetch(path: string, opts?: AxiosRequestConfig): Promise<ExistsResponse>;
export interface ExistsResponse {
    status: 'fail' | 'sent';
    voice_length?: number;
    voice_wait?: number;
    sms_length?: number;
    sms_wait?: number;
    reason?: 'incorrect' | 'missing_param' | 'code_checkpoint';
    login?: string;
    flash_type?: number;
    ab_hash?: string;
    ab_key?: string;
    exp_cfg?: string;
    lid?: string;
    image_blob?: string;
    audio_blob?: string;
}
