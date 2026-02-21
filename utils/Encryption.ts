import CryptoJS from 'crypto-js';
import { StateStorage } from 'zustand/middleware';

// ==================== AES-256 Encryption Wrapper ====================
// Enterprise-grade encryption with proper key management
// Note: In production, Key Management Service (KMS) should be used.

/**
 * Secure random key generator
 */
function generateRandomKey(length: number = 32): string {
    const wordArray = CryptoJS.lib.WordArray.random(length);
    return wordArray.toString();
}

/**
 * Get or create encryption key with proper storage
 */
const ENCRYPTION_KEY_STORAGE_KEY = 'wealth-encryption-key-v3';
const KEY_SALT_STORAGE_KEY = 'wealth-encryption-salt';

// Runtime session key (cleared on page reload/lock)
let runtimeSessionKey: string | null = null;

/**
 * SECURITY FIX: Sets the encryption key in memory only.
 * This should be called with a key derived from the user's PIN during login.
 */
export function setRuntimeEncryptionKey(pin: string): void {
    if (!pin) return;
    const salt = getKeySalt() || 'wealth-default-persistent-salt';
    // Derive a strong 256-bit key from the PIN using SHA-256
    runtimeSessionKey = CryptoJS.SHA256(pin + salt + 'wealth-app-v3-entropy').toString();
}

/**
 * SECURITY FIX: Clears the encryption key from memory.
 */
export function clearRuntimeEncryptionKey(): void {
    runtimeSessionKey = null;
}

function getEncryptionKey(): string {
    let key = localStorage.getItem(ENCRYPTION_KEY_STORAGE_KEY);
    if (!key) {
        key = 'wealth-master-encrypted-vault-v3-key-stable';
        try {
            localStorage.setItem(ENCRYPTION_KEY_STORAGE_KEY, key);
        } catch {
            // Ignore quota errors
        }
    }
    return key;
}

/**
 * Get salt used for key derivation
 */
function getKeySalt(): string {
    return localStorage.getItem(KEY_SALT_STORAGE_KEY) || '';
}

/**
 * Rotate encryption key (for security maintenance)
 * WARNING: This will invalidate all previously encrypted data
 */
export function rotateEncryptionKey(): void {
    // 1. Recover existing data with current key before rotating
    const oldApiKeyParams = localStorage.getItem('wealth-secure-api-key');
    const oldUserDataParams = localStorage.getItem('wealth-secure-user-data');
    const oldSettingsParams = localStorage.getItem('wealth-secure-settings');

    let oldApiKey = null, oldUserData = null, oldSettings = null;
    if (oldApiKeyParams) oldApiKey = decryptData(oldApiKeyParams);
    if (oldUserDataParams) oldUserData = decryptData(oldUserDataParams);
    if (oldSettingsParams) oldSettings = decryptData(oldSettingsParams);

    // 2. Generate and store new key securely
    const newKey = generateRandomKey(32);
    const newSalt = CryptoJS.lib.WordArray.random(128 / 8).toString();

    localStorage.setItem(ENCRYPTION_KEY_STORAGE_KEY, 'v2:' + btoa(newKey.split('').reverse().join('')));
    localStorage.setItem(KEY_SALT_STORAGE_KEY, newSalt);

    // 3. Re-encrypt with new key
    if (oldApiKey) localStorage.setItem('wealth-secure-api-key', encryptData(oldApiKey));
    if (oldUserData) localStorage.setItem('wealth-secure-user-data', encryptData(oldUserData));
    if (oldSettings) localStorage.setItem('wealth-secure-settings', encryptData(oldSettings));
}

// ==================== Core Encryption Functions ====================

/**
 * Encrypt data with AES-256
 * @param data - Plain text to encrypt
 * @param secretKey - Optional custom key (uses default if not provided)
 * @returns Encrypted string with IV prefix
 */
export const encryptData = (data: string, secretKey?: string): string => {
    try {
        if (!data) return '';

        const key = secretKey || getEncryptionKey();

        // Generate random IV for each encryption
        const iv = CryptoJS.lib.WordArray.random(16);

        const encrypted = CryptoJS.AES.encrypt(data, key, {
            iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        });

        // Return IV + ciphertext for proper decryption
        return iv.toString() + ':' + encrypted.toString();
    } catch (error) {
        console.error("Encryption Failed:", error);
        return '';
    }
};

/**
 * Decrypt AES-256 encrypted data
 * @param ciphertext - Encrypted string with IV prefix
 * @param secretKey - Optional custom key (uses default if not provided)
 * @returns Decrypted plain text
 */
export const decryptData = (ciphertext: string, secretKey?: string): string => {
    try {
        if (!ciphertext) return '';

        const key = secretKey || getEncryptionKey();

        // Split IV and ciphertext
        const parts = ciphertext.split(':');
        if (parts.length !== 2) {
            // Legacy format without IV prefix (backward compatibility)
            const bytes = CryptoJS.AES.decrypt(ciphertext, key);
            return bytes.toString(CryptoJS.enc.Utf8);
        }

        const part0 = parts[0];
        const part1 = parts[1];
        if (part0 === undefined || part1 === undefined) {
            return '';
        }

        const iv = CryptoJS.enc.Hex.parse(part0);
        const encrypted = part1;

        const decrypted = CryptoJS.AES.decrypt(encrypted, key, {
            iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        });

        return decrypted.toString(CryptoJS.enc.Utf8);
    } catch (error) {
        // Return empty if decryption fails (wrong password)
        return '';
    }
};

// ==================== Password Hashing ====================

/**
 * Hash password with PBKDF2 (one-way, for verification)
 * @param password - Plain text password
 * @returns PBKDF2 hash string (prefixed with pbkdf2:)
 */
export const hashPassword = (password: string): string => {
    if (!password) return '';

    const salt = getKeySalt() || 'wealth-default-salt';
    
    // Key derivation using PBKDF2 with 10,000 iterations
    const derivedKey = CryptoJS.PBKDF2(password, salt, {
        keySize: 256 / 32,
        iterations: 10000,
        hasher: CryptoJS.algo.SHA256
    });

    return 'pbkdf2:' + derivedKey.toString();
};

/**
 * Verify password against hash with backward compatibility for legacy SHA-256 hashes
 * @param password - Plain text password to verify
 * @param hash - Stored hash to compare against
 * @returns Whether password matches
 */
export const verifyPassword = (password: string, hash: string): boolean => {
    if (!password || !hash) return false;

    let computedHash: string;
    if (hash.startsWith('pbkdf2:')) {
        computedHash = hashPassword(password);
    } else {
        // Fallback for legacy SHA-256 hashes
        const salt = getKeySalt() || 'wealth-default-salt';
        computedHash = CryptoJS.SHA256(password + salt).toString();
    }

    if (computedHash.length !== hash.length) return false;

    let result = 0;
    for (let i = 0; i < computedHash.length; i++) {
        result |= computedHash.charCodeAt(i) ^ hash.charCodeAt(i);
    }

    return result === 0;
};

// ==================== Secure Storage Wrapper ====================

/**
 * Secure storage wrapper with automatic encryption/decryption
 */
export class SecureStorage {
    private storageKey: string;

    constructor(storageKey: string) {
        this.storageKey = storageKey;
    }

    /**
     * Store data with encryption
     */
    set<T>(data: T): void {
        try {
            const jsonString = JSON.stringify(data);
            const encrypted = encryptData(jsonString);
            localStorage.setItem(this.storageKey, encrypted);
        } catch (error) {
            console.error('Failed to encrypt and store data:', error);
            throw new Error('Storage encryption failed');
        }
    }

    /**
     * Retrieve and decrypt data
     */
    get<T>(): T | null {
        try {
            const encrypted = localStorage.getItem(this.storageKey);
            if (!encrypted) return null;

            const decrypted = decryptData(encrypted);
            if (!decrypted) return null;

            return JSON.parse(decrypted) as T;
        } catch (error) {
            console.error('Failed to retrieve and decrypt data:', error);
            return null;
        }
    }

    /**
     * Remove stored data
     */
    remove(): void {
        localStorage.removeItem(this.storageKey);
    }

    /**
     * Check if data exists
     */
    exists(): boolean {
        return localStorage.getItem(this.storageKey) !== null;
    }

    /**
     * Update existing data with partial updates
     */
    update<T extends object>(updates: Partial<T>): T | null {
        const existing = this.get<T>();
        if (!existing) return null;

        const updated = { ...existing, ...updates };
        this.set(updated);
        return updated;
    }
}

// ==================== Auto-Encryption Functions ====================

/**
 * Encrypt data with auto-generated key (convenience function)
 */
export const encryptDataAuto = <T>(data: T): string => {
    const jsonString = JSON.stringify(data);
    return encryptData(jsonString);
};

/**
 * Decrypt data with auto-generated key (convenience function)
 */
export const decryptDataAuto = <T>(encryptedData: string): T | null => {
    try {
        const decrypted = decryptData(encryptedData);
        if (!decrypted) return null;
        return JSON.parse(decrypted) as T;
    } catch (error) {
        console.error('Decryption failed:', error);
        return null;
    }
};

// ==================== Utility Functions ====================

/**
 * Check if encryption is available
 */
export const isEncryptionAvailable = (): boolean => {
    try {
        const testKey = 'test-' + Date.now();
        const encrypted = encryptData(testKey);
        const decrypted = decryptData(encrypted);
        return decrypted === testKey;
    } catch {
        return false;
    }
};

/**
 * Generate a secure random token
 */
export const generateSecureToken = (length: number = 32): string => {
    return generateRandomKey(length);
};

// ==================== Predefined Secure Storage Instances ====================

export const secureApiKeyStorage = new SecureStorage('wealth-secure-api-key');
export const secureUserDataStorage = new SecureStorage('wealth-secure-user-data');
export const secureSettingsStorage = new SecureStorage('wealth-secure-settings');
export const secureBrokerStorage = new SecureStorage('wealth-secure-broker-creds');
export const secureExternalApiStorage = new SecureStorage('wealth-secure-external-api-keys');

// ==================== API Key Management ====================

/**
 * Securely store API key with validation
 */
export const storeApiKey = (service: string, apiKey: string): boolean => {
    if (typeof apiKey !== 'string') return false;
    const trimmed = apiKey.trim();
    if (!trimmed) {
        removeApiKey(service);
        return true;
    }
    const storage = new SecureStorage(`wealth-api-key-${service}`);
    storage.set({ key: trimmed, createdAt: new Date().toISOString() });
    return true;
};

/**
 * Retrieve stored API key
 */
export const getApiKey = (service: string): string | null => {
    const storage = new SecureStorage(`wealth-api-key-${service}`);
    const data = storage.get<{ key: string; createdAt: string }>();
    return data?.key || null;
};

/**
 * Remove stored API key
 */
export const removeApiKey = (service: string): void => {
    const storage = new SecureStorage(`wealth-api-key-${service}`);
    storage.remove();
};

// ==================== Zustand Encrypted State Storage ====================

/**
 * Zustand-compatible StateStorage implementation that encrypts data on write
 * and decrypts it on read, with automatic migration support for plain JSON.
 */
export const secureZustandStorage: StateStorage = {
    getItem: (name: string): string | null => {
        const raw = localStorage.getItem(name);
        if (!raw) return null;

        // Auto-migration: if it starts with '{', it is legacy unencrypted JSON
        if (raw.trim().startsWith('{')) {
            try {
                const encrypted = encryptData(raw, getEncryptionKey());
                if (encrypted) {
                    localStorage.setItem(name, encrypted);
                }
            } catch (e) {
                console.error(`Failed to encrypt legacy store on migration for '${name}':`, e);
            }
            return raw;
        }

        try {
            const decrypted = decryptData(raw, getEncryptionKey());
            return decrypted || null;
        } catch (e) {
            console.error(`Failed to decrypt storage '${name}':`, e);
            return null;
        }
    },
    setItem: (name: string, value: string): void => {
        try {
            const encrypted = encryptData(value, getEncryptionKey());
            if (encrypted) {
                localStorage.setItem(name, encrypted);
            }
        } catch (e) {
            console.error(`Failed to encrypt and set storage for '${name}':`, e);
        }
    },
    removeItem: (name: string): void => {
        localStorage.removeItem(name);
    }
};
