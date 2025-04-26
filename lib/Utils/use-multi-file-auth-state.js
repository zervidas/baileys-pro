"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.useMultiFileAuthState = void 0;
const async_lock_1 = __importDefault(require("async-lock"));
const promises_1 = require("fs/promises");
const path_1 = require("path");
const WAProto_1 = require("../../WAProto");
const auth_utils_1 = require("./auth-utils");
const generics_1 = require("./generics");
const node_cache_1 = __importDefault(require("node-cache"));
const Defaults_1 = require("../Defaults");

// Enhanced locking mechanism
const fileLock = new async_lock_1.default({ 
    maxPending: Infinity,
    timeout: 5000 // 5s timeout to prevent deadlocks
});
const globalAuthLock = new async_lock_1.default(); // Additional global lock

// Debugging utilities
let AUTH_DEBUG = false;
function authDebug(...args) {
    if (AUTH_DEBUG) {
        console.log('[AUTH DEBUG]', new Date().toISOString(), ...args);
    }
}

/**
 * Enhanced multi-file auth state storage with:
 * - Better error handling
 * - Additional locking
 * - Data validation
 * - Auto-repair mechanisms
 */
const useMultiFileAuthState = async (folder, options = {}) => {
    AUTH_DEBUG = options.authDebug ?? false;
    const cache = options.syncCache ? new node_cache_1.default({
      stdTTL: Defaults_1.DEFAULT_CACHE_TTLS.SIGNAL_STORE,
      useClones: false,
      deleteOnExpire: true,
      checkperiod: 120
    }) : null;
    // Validate and prepare folder
    const prepareFolder = async () => {
        try {
            const folderInfo = await (0, promises_1.stat)(folder).catch(() => null);
            
            if (folderInfo) {
                if (!folderInfo.isDirectory()) {
                    throw new Error(`Path exists but is not a directory: ${folder}`);
                }
            } else {
                authDebug('Creating auth folder:', folder);
                await (0, promises_1.mkdir)(folder, { recursive: true });
            }
            
            // Verify folder is writable
            await testFolderAccess();
        } catch (error) {
            authDebug('Folder preparation failed:', error);
            throw new Error(`Auth folder initialization failed: ${error.message}`);
        }
    };

    const testFolderAccess = async () => {
        const testFile = (0, path_1.join)(folder, '.temp_test');
        try {
            await (0, promises_1.writeFile)(testFile, 'test');
            await (0, promises_1.unlink)(testFile);
        } catch (error) {
            throw new Error(`Folder not writable: ${error.message}`);
        }
    };

    const fixFileName = (file) => {
        if (!file) return file;
        return file.replace(/\//g, '__').replace(/:/g, '-');
    };
    
    function getUniqueId(type, id) {
        return `${type}.${id}`;
    }

    // Enhanced write with retries
    const writeData = async (data, file) => {
        return globalAuthLock.acquire('write', async () => {
            const filePath = (0, path_1.join)(folder, fixFileName(file));
            let attempts = 0;
            const maxAttempts = 3;
            
            while (attempts < maxAttempts) {
                attempts++;
                try {
                    await fileLock.acquire(filePath, async () => {
                        const serialized = JSON.stringify(data, generics_1.BufferJSON.replacer);
                        await (0, promises_1.writeFile)(filePath, serialized);
                        authDebug('Write successful:', file);
                    });
                    return;
                } catch (error) {
                    authDebug(`Write attempt ${attempts} failed for ${file}:`, error);
                    if (attempts >= maxAttempts) {
                        throw new Error(`Failed to write after ${maxAttempts} attempts: ${error.message}`);
                    }
                    await new Promise(resolve => setTimeout(resolve, 100 * attempts));
                }
            }
        });
    };

    // Enhanced read with validation
    const readData = async (file) => {
        return globalAuthLock.acquire('read', async () => {
            const filePath = (0, path_1.join)(folder, fixFileName(file));
            
            try {
                const data = await fileLock.acquire(filePath, async () => {
                    const content = await (0, promises_1.readFile)(filePath, { encoding: 'utf-8' });
                    authDebug('Read successful:', file);
                    return content;
                });
                
                const parsed = JSON.parse(data, generics_1.BufferJSON.reviver);
                
                // Basic data validation
                if (file === 'creds.json' && !parsed.me) {
                    authDebug('Invalid creds data detected');
                    return null;
                }
                
                return parsed;
            } catch (error) {
                if (error.code !== 'ENOENT') { // Ignore "file not found" errors
                    authDebug('Read error:', file, error);
                }
                return null;
            }
        });
    };

    // Safe removal
    const removeData = async (file) => {
        return globalAuthLock.acquire('remove', async () => {
            const filePath = (0, path_1.join)(folder, fixFileName(file));
            
            try {
                await fileLock.acquire(filePath, async () => {
                    await (0, promises_1.unlink)(filePath);
                    authDebug('Removed:', file);
                });
            } catch (error) {
                if (error.code !== 'ENOENT') { // Ignore "file not found" errors
                    authDebug('Remove error:', file, error);
                }
            }
        });
    };

    // Initialize
    await prepareFolder();
    
    // Load or initialize credentials
    let creds = await readData('creds.json');
    if (!creds) {
        authDebug('No existing creds found, initializing new ones');
        creds = (0, auth_utils_1.initAuthCreds)();
        await writeData(creds, 'creds.json');
    }
    
    async function warmUpCache() {
      try {
        const files = await promises_1.readdir(folder);
        for (const file of files) {
          if (file.endsWith('.json') && file !== 'creds.json') {
            const parts = file.split('-');
            if (parts.length === 2) {
              const type = parts[0];
              const id = parts[1].replace('.json', '');
              const data = await readData(file);
              if (data) {
                cache.set(getUniqueId(type, id), data);
                authDebug(`Cache warmed: ${type}-${id}`);
              }
            }
          }
        }
      } catch (error) {
        authDebug('Cache warm-up failed:', error);
      }
    }
    
    if (cache) warmUpCache();

    // Auto-save mechanism
    let saveTimeout;
    const scheduleSave = () => {
       if (saveTimeout) clearTimeout(saveTimeout);
       saveTimeout = setTimeout(() => {
           saveCreds().catch(error => {
               authDebug('Auto-save failed, retrying sooner:', error);
               setTimeout(scheduleSave, 60000);
           });
       }, 180000);
    };
    // Enhanced save function
    const saveCreds = async () => {
        try {
            await writeData(creds, 'creds.json');
            scheduleSave();
        } catch (error) {
            authDebug('Critical: Creds save failed:', error);
            throw error;
        }
    };
    
    process.on('beforeExit', async () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      await saveCreds().catch(error => {
        authDebug('Emergency save failed:', error);
      });
    });
    
    process.on('uncaughtException', async (error) => {
      authDebug('Uncaught exception, attempting emergency save:', error);
      if (saveTimeout) clearTimeout(saveTimeout);
      await saveCreds().catch(e => {
        authDebug('Emergency save failed:', e);
      });
      process.exit(1);
    });
    // Start auto-save loop
    scheduleSave();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}.json`);
                        
                        if (type === 'app-state-sync-key' && value) {
                            try {
                                value = WAProto_1.proto.Message.AppStateSyncKeyData.fromObject(value);
                            } catch (error) {
                                authDebug('Key conversion failed:', type, id, error);
                                value = null;
                            }
                        }
                        
                        data[id] = value;
                    }));
                    
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const file = `${category}-${id}.json`;
                            
                            if (value) {
                                tasks.push(writeData(value, file));
                            } else {
                                tasks.push(removeData(file));
                            }
                        }
                    }
                    
                    try {
                        await Promise.all(tasks);
                    } catch (error) {
                        authDebug('Bulk key update failed:', error);
                        throw error;
                    }
                }
            }
        },
        saveCreds,
        // Additional maintenance API
        cleanup: async () => {
            if (saveTimeout) clearTimeout(saveTimeout);
            await saveCreds();
        },
        cache
    };
};
exports.useMultiFileAuthState = useMultiFileAuthState;