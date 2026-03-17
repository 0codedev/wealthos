/**
 * SecurityService - Encryption, Audit Trail, UPI Tracking, Credit Card Optimizer
 * Enterprise-grade security implementation with proper AES encryption
 */

import CryptoJS from 'crypto-js';

// ==================== SECURE ENCRYPTION ====================

/**
 * Generate a cryptographically secure random key
 */
export function generateSecureKey(length: number = 32): string {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Derive encryption key from password using PBKDF2
 * @param password - User password
 * @param salt - Salt for key derivation (should be stored securely)
 * @param iterations - Number of iterations (higher = more secure but slower)
 */
export async function deriveKeyFromPassword(
    password: string,
    salt: string,
    iterations: number = 100000
): Promise<string> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: encoder.encode(salt),
            iterations,
            hash: 'SHA-256'
        },
        keyMaterial,
        256
    );

    return Array.from(new Uint8Array(derivedBits))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * AES-256 encryption with proper key management
 */
export class SecureEncryption {
    private key: string;
    private static instance: SecureEncryption | null = null;

    private constructor(key?: string) {
        // Use provided key or generate/get from storage
        this.key = key || SecureEncryption.getOrCreateKey();
    }

    static getInstance(key?: string): SecureEncryption {
        if (!SecureEncryption.instance) {
            SecureEncryption.instance = new SecureEncryption(key);
        }
        return SecureEncryption.instance;
    }

    static resetInstance(): void {
        SecureEncryption.instance = null;
    }

    private static getOrCreateKey(): string {
        const STORAGE_KEY = 'wealth_encryption_key';
        let key = localStorage.getItem(STORAGE_KEY);
        
        if (!key) {
            key = generateSecureKey(32);
            localStorage.setItem(STORAGE_KEY, key);
        }
        
        return key;
    }

    /**
     * Encrypt data using AES-256-CBC
     */
    encrypt(plaintext: string): string {
        if (!plaintext) return '';
        
        try {
            // Generate random IV for each encryption
            const iv = CryptoJS.lib.WordArray.random(16);
            
            // Encrypt
            const encrypted = CryptoJS.AES.encrypt(plaintext, this.key, {
                iv,
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            });

            // Return IV + ciphertext (IV is needed for decryption)
            return iv.toString() + ':' + encrypted.toString();
        } catch (error) {
            console.error('Encryption failed:', error);
            throw new Error('Encryption failed');
        }
    }

    /**
     * Decrypt data encrypted with AES-256-CBC
     */
    decrypt(ciphertext: string): string {
        if (!ciphertext) return '';
        
        try {
            // Split IV and ciphertext
            const parts = ciphertext.split(':');
            if (parts.length !== 2) {
                throw new Error('Invalid ciphertext format');
            }

            const iv = CryptoJS.enc.Hex.parse(parts[0]);
            const encrypted = parts[1];

            // Decrypt
            const decrypted = CryptoJS.AES.decrypt(encrypted, this.key, {
                iv,
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            });

            return decrypted.toString(CryptoJS.enc.Utf8);
        } catch (error) {
            console.error('Decryption failed:', error);
            return '';
        }
    }

    /**
     * Encrypt object to JSON string
     */
    encryptObject<T>(obj: T): string {
        return this.encrypt(JSON.stringify(obj));
    }

    /**
     * Decrypt JSON string to object
     */
    decryptObject<T>(ciphertext: string): T | null {
        try {
            const decrypted = this.decrypt(ciphertext);
            if (!decrypted) return null;
            return JSON.parse(decrypted) as T;
        } catch {
            return null;
        }
    }
}

// Backward-compatible functions using the class
export function encrypt(data: string, key?: string): string {
    return SecureEncryption.getInstance(key).encrypt(data);
}

export function decrypt(encrypted: string, key?: string): string {
    return SecureEncryption.getInstance(key).decrypt(encrypted);
}

const PROTECTED_STORAGE_KEYS = new Set([
    // App data that may embed sensitive context
    'wealth-aggregator-logic',
    'wealth-aggregator-settings',
    'advisor_chat_history',
    'advisor_report_data',
    // Private notes / vaults
    'fortress_notes',
    'fortress_notes_v2',
    'fortress_hash',
    'secure_vault_docs',
    'vault_master_hash',
    'ecas:pan',
    // AI provider keys (plaintext at rest in localStorage - MUST be encrypted in backups)
    'gemini-api-key',
    'wealth-api-key-gemini',
    'wealth-api-key-groq',
    'wealth-api-key-openrouter',
    'wealth-api-key-mistral',
    'wealth-api-key-cerebras',
    'wealth-api-key-github',
    'wealth-api-key-cloudflare',
    'wealth-api-key-cohere',
    'wealth-api-key-telegrambot',
    'stockezee_token',
    // Auth material
    'wealth_auth_pin_hash',
    'wealth_biometric_lock_settings',
]);

export function shouldProtectStorageKey(storageKey: string): boolean {
    return PROTECTED_STORAGE_KEYS.has(storageKey);
}

export function protectSensitiveStorageValue(storageKey: string, rawValue: string): string {
    if (!shouldProtectStorageKey(storageKey) || !rawValue) {
        return rawValue;
    }

    return JSON.stringify({
        __protected: true,
        storageKey,
        protectedAt: new Date().toISOString(),
        payload: encrypt(rawValue),
    });
}

export function restoreSensitiveStorageValue(storageKey: string, rawValue: string): string {
    if (!rawValue) {
        return rawValue;
    }

    try {
        const parsed = JSON.parse(rawValue);
        if (parsed?.__protected && parsed.storageKey === storageKey && typeof parsed.payload === 'string') {
            return decrypt(parsed.payload);
        }
    } catch {
        // Not a protected payload, fall through.
    }

    return rawValue;
}

// Keep deriveKey for backward compatibility
export async function deriveKey(password: string, salt: string): Promise<string> {
    return deriveKeyFromPassword(password, salt);
}

// ==================== AUDIT TRAIL ====================

export type AuditAction =
    | 'login'
    | 'logout'
    | 'view_portfolio'
    | 'add_investment'
    | 'edit_investment'
    | 'delete_investment'
    | 'export_data'
    | 'import_data'
    | 'backup_created'
    | 'backup_restored'
    | 'settings_changed'
    | 'alert_created'
    | 'alert_triggered'
    | 'pin_changed'
    | 'api_key_updated'
    | 'data_export'
    | 'security_event'
    | 'advisor_query'
    | 'advisor_report_generated'
    | 'advisor_voice_session';

export interface AuditEntry {
    id: string;
    timestamp: string;
    action: AuditAction;
    details: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
}

class AuditTrailService {
    private entries: AuditEntry[] = [];
    private maxEntries = 1000;
    private storageKey = 'wealth_aggregator_audit';
    private sessionId: string;

    constructor() {
        this.sessionId = generateSecureKey(8);
        this.loadFromStorage();
    }

    private loadFromStorage(): void {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                if (stored.trim().startsWith('[')) {
                    // Legacy unencrypted JSON array — parse & upgrade to encrypted storage
                    this.entries = JSON.parse(stored);
                    this.saveToStorage();
                } else {
                    const decrypted = decrypt(stored);
                    if (decrypted) {
                        this.entries = JSON.parse(decrypted);
                    }
                }
            }
        } catch {
            this.entries = [];
        }
    }

    private saveToStorage(): void {
        try {
            const payload = JSON.stringify(this.entries);
            const encrypted = encrypt(payload);
            localStorage.setItem(this.storageKey, encrypted);
        } catch {
            // Storage full, trim entries and attempt saving
            this.entries = this.entries.slice(-500);
            try {
                const payload = JSON.stringify(this.entries);
                const encrypted = encrypt(payload);
                localStorage.setItem(this.storageKey, encrypted);
            } catch {
                // Ignore
            }
        }
    }

    /**
     * Log an action
     */
    log(action: AuditAction, details: string, metadata?: Record<string, unknown>): void {
        const entry: AuditEntry = {
            id: `audit-${Date.now()}-${generateSecureKey(4)}`,
            timestamp: new Date().toISOString(),
            action,
            details,
            metadata: this.sanitizeMetadata(metadata),
            userAgent: this.getSimplifiedUserAgent(),
            sessionId: this.sessionId
        };

        this.entries.push(entry);

        // Trim old entries
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(-this.maxEntries);
        }

        this.saveToStorage();
    }

    /**
     * Sanitize metadata to prevent sensitive data leakage
     */
    private sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
        if (!metadata) return undefined;

        const sensitiveKeys = ['password', 'pin', 'apiKey', 'token', 'secret', 'credential'];
        const sanitized: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(metadata)) {
            if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
                sanitized[key] = '[REDACTED]';
            } else if (typeof value === 'object' && value !== null) {
                sanitized[key] = this.sanitizeMetadata(value as Record<string, unknown>);
            } else {
                sanitized[key] = value;
            }
        }

        return sanitized;
    }

    /**
     * Get simplified user agent (browser + OS)
     */
    private getSimplifiedUserAgent(): string {
        const ua = navigator.userAgent;
        let browser = 'Unknown';
        let os = 'Unknown';

        if (ua.includes('Firefox')) browser = 'Firefox';
        else if (ua.includes('Chrome')) browser = 'Chrome';
        else if (ua.includes('Safari')) browser = 'Safari';
        else if (ua.includes('Edge')) browser = 'Edge';

        if (ua.includes('Windows')) os = 'Windows';
        else if (ua.includes('Mac')) os = 'MacOS';
        else if (ua.includes('Linux')) os = 'Linux';
        else if (ua.includes('Android')) os = 'Android';
        else if (ua.includes('iOS')) os = 'iOS';

        return `${browser}/${os}`;
    }

    /**
     * Get all entries
     */
    getAll(): AuditEntry[] {
        return [...this.entries].reverse();
    }

    /**
     * Get entries by action type
     */
    getByAction(action: AuditAction): AuditEntry[] {
        return this.entries.filter(e => e.action === action).reverse();
    }

    /**
     * Get entries in date range
     */
    getByDateRange(startDate: Date, endDate: Date): AuditEntry[] {
        return this.entries.filter(e => {
            const date = new Date(e.timestamp);
            return date >= startDate && date <= endDate;
        }).reverse();
    }

    /**
     * Get entries for current session
     */
    getCurrentSession(): AuditEntry[] {
        return this.entries.filter(e => e.sessionId === this.sessionId).reverse();
    }

    /**
     * Clear audit trail
     */
    clear(): void {
        this.entries = [];
        localStorage.removeItem(this.storageKey);
    }

    /**
     * Export audit trail
     */
    export(): string {
        return JSON.stringify(this.entries, null, 2);
    }

    /**
     * Get security summary
     */
    getSecuritySummary(): {
        failedLogins: number;
        lastLogin: string | null;
        suspiciousActivity: boolean;
    } {
        const failedLogins = this.entries.filter(
            e => e.action === 'login' && e.details.includes('Failed')
        ).length;

        const successfulLogins = this.entries.filter(
            e => e.action === 'login' && !e.details.includes('Failed')
        );
        const lastLogin = successfulLogins.length > 0 
            ? successfulLogins[successfulLogins.length - 1].timestamp 
            : null;

        // Flag suspicious activity: multiple failed logins in short time
        const recentFailures = this.entries.filter(
            e => e.action === 'login' && e.details.includes('Failed')
        ).slice(-5);
        const suspiciousActivity = recentFailures.length >= 3;

        return { failedLogins, lastLogin, suspiciousActivity };
    }
}

export const auditTrail = new AuditTrailService();

// ==================== UPI TRANSACTION TRACKER ====================

export interface UPITransaction {
    id: string;
    date: string;
    time: string;
    upiId: string;
    merchantName: string;
    amount: number;
    type: 'sent' | 'received';
    category?: string;
    tags?: string[];
    note?: string;
}

export interface UPIAnalytics {
    totalSpent: number;
    totalReceived: number;
    transactionCount: number;
    avgTransactionSize: number;
    topMerchants: Array<{ name: string; amount: number; count: number }>;
    byCategory: Record<string, number>;
    byDayOfWeek: Record<string, number>;
    spendingTrend: Array<{ date: string; amount: number }>;
}

// UPI merchant patterns for categorization
const UPI_CATEGORIES: Array<{ pattern: RegExp; category: string }> = [
    { pattern: /swiggy|zomato|dominos|mcdonalds|kfc|pizza/i, category: 'Food Delivery' },
    { pattern: /amazon|flipkart|myntra|ajio|meesho/i, category: 'Shopping' },
    { pattern: /uber|ola|rapido|metro|irctc/i, category: 'Transport' },
    { pattern: /netflix|hotstar|prime|spotify|youtube/i, category: 'Entertainment' },
    { pattern: /paytm|phonepe|gpay/i, category: 'Wallet' },
    { pattern: /jio|airtel|vodafone|bsnl/i, category: 'Mobile Recharge' },
    { pattern: /electricity|water|gas|bescom|torrent/i, category: 'Utilities' },
    { pattern: /zerodha|groww|upstox|coin|mf/i, category: 'Investments' },
    { pattern: /hospital|pharmacy|apollo|medplus/i, category: 'Healthcare' },
    { pattern: /dmart|bigbasket|blinkit|instamart/i, category: 'Groceries' },
];

export function categorizeUPITransaction(merchantName: string): string {
    for (const { pattern, category } of UPI_CATEGORIES) {
        if (pattern.test(merchantName)) {
            return category;
        }
    }
    return 'Other';
}

export function analyzeUPITransactions(transactions: UPITransaction[]): UPIAnalytics {
    const sent = transactions.filter(t => t.type === 'sent');
    const received = transactions.filter(t => t.type === 'received');

    const totalSpent = sent.reduce((sum, t) => sum + t.amount, 0);
    const totalReceived = received.reduce((sum, t) => sum + t.amount, 0);

    // Top merchants
    const merchantMap: Record<string, { amount: number; count: number }> = {};
    sent.forEach(t => {
        if (!merchantMap[t.merchantName]) {
            merchantMap[t.merchantName] = { amount: 0, count: 0 };
        }
        merchantMap[t.merchantName].amount += t.amount;
        merchantMap[t.merchantName].count++;
    });

    const topMerchants = Object.entries(merchantMap)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10);

    // By category
    const byCategory: Record<string, number> = {};
    sent.forEach(t => {
        const category = t.category || categorizeUPITransaction(t.merchantName);
        byCategory[category] = (byCategory[category] || 0) + t.amount;
    });

    // By day of week
    const byDayOfWeek: Record<string, number> = {
        'Sun': 0, 'Mon': 0, 'Tue': 0, 'Wed': 0, 'Thu': 0, 'Fri': 0, 'Sat': 0
    };
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    sent.forEach(t => {
        const day = days[new Date(t.date).getDay()];
        byDayOfWeek[day] += t.amount;
    });

    // Spending trend (last 30 days)
    const spendingTrend: Array<{ date: string; amount: number }> = [];
    const dateMap: Record<string, number> = {};
    sent.forEach(t => {
        dateMap[t.date] = (dateMap[t.date] || 0) + t.amount;
    });
    Object.entries(dateMap)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-30)
        .forEach(([date, amount]) => spendingTrend.push({ date, amount }));

    return {
        totalSpent,
        totalReceived,
        transactionCount: transactions.length,
        avgTransactionSize: sent.length > 0 ? totalSpent / sent.length : 0,
        topMerchants,
        byCategory,
        byDayOfWeek,
        spendingTrend
    };
}

// ==================== CREDIT CARD OPTIMIZER ====================

export interface CreditCard {
    id: string;
    name: string;
    bank: string;
    network: 'Visa' | 'Mastercard' | 'Rupay' | 'Amex';
    annualFee: number;
    rewards: Array<{
        category: string;
        rewardRate: number; // Percentage cashback/points
        limit?: number;
    }>;
    benefits: string[];
}

export const POPULAR_CARDS: CreditCard[] = [
    {
        id: 'hdfc-infinia',
        name: 'HDFC Infinia',
        bank: 'HDFC',
        network: 'Visa',
        annualFee: 12500,
        rewards: [
            { category: 'All', rewardRate: 3.3 },
            { category: 'Travel', rewardRate: 5 }
        ],
        benefits: ['Airport lounge', 'Golf privileges', 'Concierge']
    },
    {
        id: 'amex-mrcc',
        name: 'Amex Membership Rewards',
        bank: 'Amex',
        network: 'Amex',
        annualFee: 4500,
        rewards: [
            { category: 'All', rewardRate: 2 },
            { category: 'Amazon/Flipkart', rewardRate: 5 }
        ],
        benefits: ['Milestone bonuses', 'Travel insurance']
    },
    {
        id: 'axis-magnus',
        name: 'Axis Magnus',
        bank: 'Axis',
        network: 'Visa',
        annualFee: 12500,
        rewards: [
            { category: 'All', rewardRate: 2.5 },
            { category: 'Travel', rewardRate: 5 }
        ],
        benefits: ['Airport lounge', 'Golf', 'Movie tickets']
    },
    {
        id: 'sbi-elite',
        name: 'SBI Elite',
        bank: 'SBI',
        network: 'Mastercard',
        annualFee: 4999,
        rewards: [
            { category: 'All', rewardRate: 2 },
            { category: 'Dining', rewardRate: 5 }
        ],
        benefits: ['Movie tickets', 'Lounge access']
    }
];

export interface CardRecommendation {
    card: CreditCard;
    estimatedRewards: number;
    bestFor: string[];
    score: number;
}

export function recommendBestCard(
    monthlySpend: Record<string, number>,
    userCards: CreditCard[]
): CardRecommendation[] {
    const recommendations: CardRecommendation[] = [];

    userCards.forEach(card => {
        let totalRewards = 0;
        const bestFor: string[] = [];

        Object.entries(monthlySpend).forEach(([category, amount]) => {
            const reward = card.rewards.find(r =>
                r.category.toLowerCase() === category.toLowerCase() ||
                r.category === 'All'
            );

            if (reward) {
                const rewardAmount = (amount * reward.rewardRate) / 100;
                totalRewards += rewardAmount;

                if (reward.rewardRate >= 3) {
                    bestFor.push(category);
                }
            }
        });

        // Account for annual fee
        const netRewards = (totalRewards * 12) - card.annualFee;
        const score = netRewards > 0 ? (netRewards / (totalRewards * 12)) * 100 : 0;

        recommendations.push({
            card,
            estimatedRewards: totalRewards,
            bestFor,
            score
        });
    });

    return recommendations.sort((a, b) => b.estimatedRewards - a.estimatedRewards);
}

/**
 * Sanitize prompt input to prevent Prompt Injection and basic Script/XSS Injection
 */
export function sanitizePromptInput(input: string): string {
    if (!input) return '';
    let sanitized = input;
    const dangerousPatterns = [
        /ignore\s+previous\s+instructions/gi,
        /system\s+override/gi,
        /bypass\s+restrictions/gi,
        /you\s+are\s+now\s+a/gi,
        /acting\s+as\s+a/gi,
        /do\s+not\s+follow/gi,
        /ignore\s+rules/gi,
        /Developer\s+Mode/gi,
        /DAN\s+mode/gi
    ];
    for (const pattern of dangerousPatterns) {
        sanitized = sanitized.replace(pattern, '[REDACTED INJECTION ATTEMPT]');
    }
    // Escape HTML tags to prevent XSS/Script Injection
    sanitized = sanitized
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    return sanitized;
}

export default {
    auditTrail,
    categorizeUPITransaction,
    analyzeUPITransactions,
    POPULAR_CARDS,
    recommendBestCard,
    encrypt,
    decrypt,
    deriveKey,
    SecureEncryption,
    generateSecureKey,
    sanitizePromptInput
};
