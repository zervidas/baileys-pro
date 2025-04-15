"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signedKeyPair = exports.Curve = exports.generateSignalPubKey = void 0;
exports.aesEncryptGCM = aesEncryptGCM;
exports.aesDecryptGCM = aesDecryptGCM;
exports.aesEncryptCTR = aesEncryptCTR;
exports.aesDecryptCTR = aesDecryptCTR;
exports.aesDecrypt = aesDecrypt;
exports.aesDecryptWithIV = aesDecryptWithIV;
exports.aesEncrypt = aesEncrypt;
exports.aesEncrypWithIV = aesEncrypWithIV;
exports.hmacSign = hmacSign;
exports.sha256 = sha256;
exports.md5 = md5;
exports.hkdf = hkdf;
exports.derivePairingCodeKey = derivePairingCodeKey;
const crypto_1 = require("crypto");
const futoin_hkdf_1 = __importDefault(require("futoin-hkdf"));
const libsignal = __importStar(require("libsignal"));
const util_1 = require("util");
const Defaults_1 = require("../Defaults");
const pbkdf2Promise = (0, util_1.promisify)(crypto_1.pbkdf2);
/** prefix version byte to the pub keys, required for some curve crypto functions */
const generateSignalPubKey = (pubKey) => (pubKey.length === 33
    ? pubKey
    : Buffer.concat([Defaults_1.KEY_BUNDLE_TYPE, pubKey]));
exports.generateSignalPubKey = generateSignalPubKey;
exports.Curve = {
    generateKeyPair: () => {
        const { pubKey, privKey } = libsignal.curve.generateKeyPair();
        return {
            private: Buffer.from(privKey),
            // remove version byte
            public: Buffer.from(pubKey.slice(1))
        };
    },
    sharedKey: (privateKey, publicKey) => {
        const shared = libsignal.curve.calculateAgreement((0, exports.generateSignalPubKey)(publicKey), privateKey);
        return Buffer.from(shared);
    },
    sign: (privateKey, buf) => (libsignal.curve.calculateSignature(privateKey, buf)),
    verify: (pubKey, message, signature) => {
        try {
            libsignal.curve.verifySignature((0, exports.generateSignalPubKey)(pubKey), message, signature);
            return true;
        }
        catch (error) {
            return false;
        }
    }
};
const signedKeyPair = (identityKeyPair, keyId) => {
    const preKey = exports.Curve.generateKeyPair();
    const pubKey = (0, exports.generateSignalPubKey)(preKey.public);
    const signature = exports.Curve.sign(identityKeyPair.private, pubKey);
    return { keyPair: preKey, signature, keyId };
};
exports.signedKeyPair = signedKeyPair;
const GCM_TAG_LENGTH = 128 >> 3;
/**
 * encrypt AES 256 GCM;
 * where the tag tag is suffixed to the ciphertext
 * */
function aesEncryptGCM(plaintext, key, iv, additionalData) {
    const cipher = (0, crypto_1.createCipheriv)('aes-256-gcm', key, iv);
    cipher.setAAD(additionalData);
    return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}
/**
 * decrypt AES 256 GCM;
 * where the auth tag is suffixed to the ciphertext
 * */
function aesDecryptGCM(ciphertext, key, iv, additionalData) {
    const decipher = (0, crypto_1.createDecipheriv)('aes-256-gcm', key, iv);
    // decrypt additional adata
    const enc = ciphertext.slice(0, ciphertext.length - GCM_TAG_LENGTH);
    const tag = ciphertext.slice(ciphertext.length - GCM_TAG_LENGTH);
    // set additional data
    decipher.setAAD(additionalData);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]);
}
function aesEncryptCTR(plaintext, key, iv) {
    const cipher = (0, crypto_1.createCipheriv)('aes-256-ctr', key, iv);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}
function aesDecryptCTR(ciphertext, key, iv) {
    const decipher = (0, crypto_1.createDecipheriv)('aes-256-ctr', key, iv);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
/** decrypt AES 256 CBC; where the IV is prefixed to the buffer */
function aesDecrypt(buffer, key) {
    return aesDecryptWithIV(buffer.slice(16, buffer.length), key, buffer.slice(0, 16));
}
/** decrypt AES 256 CBC */
function aesDecryptWithIV(buffer, key, IV) {
    const aes = (0, crypto_1.createDecipheriv)('aes-256-cbc', key, IV);
    return Buffer.concat([aes.update(buffer), aes.final()]);
}
// encrypt AES 256 CBC; where a random IV is prefixed to the buffer
function aesEncrypt(buffer, key) {
    const IV = (0, crypto_1.randomBytes)(16);
    const aes = (0, crypto_1.createCipheriv)('aes-256-cbc', key, IV);
    return Buffer.concat([IV, aes.update(buffer), aes.final()]); // prefix IV to the buffer
}
// encrypt AES 256 CBC with a given IV
function aesEncrypWithIV(buffer, key, IV) {
    const aes = (0, crypto_1.createCipheriv)('aes-256-cbc', key, IV);
    return Buffer.concat([aes.update(buffer), aes.final()]); // prefix IV to the buffer
}
// sign HMAC using SHA 256
function hmacSign(buffer, key, variant = 'sha256') {
    return (0, crypto_1.createHmac)(variant, key).update(buffer).digest();
}
function sha256(buffer) {
    return (0, crypto_1.createHash)('sha256').update(buffer).digest();
}
function md5(buffer) {
    return (0, crypto_1.createHash)('md5').update(buffer).digest();
}
// HKDF key expansion
function hkdf(buffer, expandedLength, info) {
    return (0, futoin_hkdf_1.default)(!Buffer.isBuffer(buffer) ? Buffer.from(buffer) : buffer, expandedLength, info);
}
async function derivePairingCodeKey(pairingCode, salt) {
    return await pbkdf2Promise(pairingCode, salt, 2 << 16, 32, 'sha256');
}
