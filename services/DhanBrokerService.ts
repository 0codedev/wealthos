/**
 * DhanBrokerService - Native DhanHQ API Integration for Real-Time Indian Market Data
 * 
 * Provides:
 * - Live LTP (Last Traded Price) for NSE/BSE stocks & indices
 * - Real-time NIFTY 50, SENSEX, Bank Nifty, India VIX
 * - Historical OHLC data for charting
 * 
 * API Docs: https://dhanhq.co/docs/v2/
 */

import { logger } from './Logger';
import { useSettingsStore } from '../store/settingsStore';
import { usePortfolioStore } from '../store/portfolioStore';
import { InvestmentType } from '../types';
import { TOTP } from 'totp-generator';
import { useGuardrailStore } from '../store/useGuardrailStore';
import { gateSideEffect, isSideEffectAllowed } from '../lib/demoMode';
import { gateNetworkAction, isNetworkActionAllowed } from '../lib/offline';
import { useSandboxStore } from '../store/sandboxStore';


// ============================================================
// TYPES
// ============================================================

export interface DhanLTPResponse {
    securityId: string;
    lastPrice: number;
    lastTradedTime?: string;
}

export interface DhanOHLCResponse {
    securityId: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface DhanFundLimitResponse {
    dhanClientId?: string;
    availabelBalance: number;
    sodLimit?: number;
    collateralAmount: number;
    receiveableAmount?: number;
    utilizedAmount: number;
    blockedPayoutAmount?: number;
    withdrawableBalance?: number;
}

export interface DhanPositionResponse {
    tradingSymbol: string;
    securityId: string;
    positionType: 'LONG' | 'SHORT' | 'CLOSED';
    exchangeSegment: string;
    productType: string;
    buyAvg: number;
    buyQty: number;
    sellAvg: number;
    sellQty: number;
    netQty: number;
    realizedProfit: number;
    unrealizedProfit: number;
    crossCurrency?: boolean;
    costPrice: number;
}

export interface DhanConvertPositionRequest {
    dhanClientId?: string;
    fromProductType: 'INTRADAY' | 'MARGIN' | 'MTF' | 'CNC';
    exchangeSegment: 'NSE_EQ' | 'NSE_FNO' | 'BSE_EQ' | 'MCX_COMM';
    positionType: 'LONG' | 'SHORT' | 'CLOSED';
    securityId: string;
    tradingSymbol: string;
    convertQty: number;
    toProductType: 'INTRADAY' | 'MARGIN' | 'MTF' | 'CNC';
}

export interface DhanTradeResponse {
    dhanClientId?: string;
    orderId?: string;
    exchangeOrderId: string;
    exchangeTradeId?: string;
    tradingSymbol: string | null;
    customSymbol: string;
    securityId: string;
    transactionType: 'BUY' | 'SELL';
    exchangeSegment: string;
    productType: string;
    orderType?: string;
    tradedQuantity: number;
    tradedPrice: number;
    isin?: string;
    instrument?: string;
    // Regulatory & Brokerage Charges (per-leg)
    sebiTax?: number;
    stt?: number;
    brokerageCharges?: number;
    serviceTax?: number;
    exchangeTransactionCharges?: number;
    stampDuty?: number;
    exchangeTime: string; // "2023-10-25 10:15:30"
    createTime?: string;
    updateTime?: string;
    // Derivative-specific
    drvExpiryDate?: string;
    drvOptionType?: string;
    drvStrikePrice?: number;
}

export interface DhanHoldingResponse {
    dhanClientId?: string;
    tradingSymbol: string;
    securityId: string;
    isin: string;
    totalQty: number;
    dpQty: number;
    t1Qty: number;
    availableQty: number;
    collateralQty: number;
    avgCostPrice: number;
    exchangeSegment?: string; // Not always returned by /v2/holdings — default to NSE_EQ
}

export interface DhanOrderRequest {
    dhanClientId?: string;
    correlationId?: string;
    transactionType: 'BUY' | 'SELL';
    exchangeSegment: 'NSE_EQ' | 'NSE_FNO' | 'BSE_EQ' | 'MCX_COMM';
    productType: 'CNC' | 'INTRADAY' | 'MARGIN' | 'MTF' | 'CO' | 'BO';
    orderType: 'LIMIT' | 'MARKET' | 'STOP_LOSS' | 'STOP_LOSS_MARKET';
    validity: 'DAY' | 'IOC';
    tradingSymbol: string;
    securityId?: string;
    quantity: number;
    disclosedQuantity?: number;
    price: number;
    triggerPrice?: number;
    afterMarketOrder?: boolean;
    amoTime?: 'OPEN' | 'OPEN_30' | 'OPEN_60';
    boProfitValue?: number;
    boStopLossValue?: number;
}

export interface DhanGTTOrderRequest {
    correlationId?: string;
    orderFlag: 'SINGLE' | 'OCO';
    transactionType: 'BUY' | 'SELL';
    exchangeSegment: 'NSE_EQ' | 'NSE_FNO' | 'BSE_EQ' | 'MCX_COMM';
    productType: 'CNC' | 'MARGIN' | 'MTF' | 'INTRADAY';
    orderType: 'LIMIT' | 'MARKET';
    validity: 'DAY';
    tradingSymbol: string;
    securityId: string;
    quantity: number;
    disclosedQuantity?: number;
    price: number;
    triggerPrice: number;
    price1?: number;
    triggerPrice1?: number;
}

export interface DhanLedgerResponse {
    dhanClientId: string;
    narration: string;
    voucherDate: string; // "2024-02-15"
    exchangeReceiptNo: string;
    voucherDesc: string;
    voucherTypeCode: string;
    debit: number;
    credit: number;
    runBal: number;
}

export interface DhanMarginRequest {
    dhanClientId?: string;
    exchangeSegment: 'NSE_EQ' | 'NSE_FNO' | 'BSE_EQ' | 'MCX_COMM';
    transactionType: 'BUY' | 'SELL';
    quantity: number;
    productType: 'CNC' | 'INTRADAY' | 'MARGIN' | 'MTF' | 'CO' | 'BO';
    securityId: string;
    price: number;
    triggerPrice?: number;
}

export interface DhanMarginResponse {
    totalMargin: number;
    spanMargin: number;
    exposureMargin: number;
    availableMargin: number;
    variableMargin: number;
    insufficientBalance?: number;
    sdCrossShortfall?: number;
}

export interface DhanQuoteResult {
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
    source: 'dhan';
}

// ============================================================
// EXCHANGE SEGMENT ENUMS (from DhanHQ docs)
// ============================================================

export const EXCHANGE_SEGMENTS = {
    NSE_EQ: 'NSE_EQ',       // NSE Equity Cash
    BSE_EQ: 'BSE_EQ',       // BSE Equity Cash
    NSE_FNO: 'NSE_FNO',     // NSE Futures & Options
    BSE_FNO: 'BSE_FNO',     // BSE Futures & Options
    IDX_I: 'IDX_I',         // Index
    MCX_COMM: 'MCX_COMM',   // Commodity
} as const;

// ============================================================
// SECURITY ID MAPPINGS (from DhanHQ Instrument Master)
// These are the official DhanHQ security IDs for key instruments
// ============================================================

export const SECURITY_IDS: Record<string, { id: string; segment: string; name: string }> = {
    // === INDICES ===
    'NIFTY 50': { id: '13', segment: EXCHANGE_SEGMENTS.IDX_I, name: 'NIFTY 50' },
    'SENSEX': { id: '51', segment: EXCHANGE_SEGMENTS.IDX_I, name: 'S&P BSE SENSEX' },
    'NIFTY BANK': { id: '25', segment: EXCHANGE_SEGMENTS.IDX_I, name: 'NIFTY BANK' },
    'INDIA VIX': { id: '26', segment: EXCHANGE_SEGMENTS.IDX_I, name: 'INDIA VIX' },
    'NIFTY IT': { id: '30', segment: EXCHANGE_SEGMENTS.IDX_I, name: 'NIFTY IT' },
    'NIFTY MIDCAP': { id: '101', segment: EXCHANGE_SEGMENTS.IDX_I, name: 'NIFTY MIDCAP 50' },
    'FIN NIFTY': { id: '27', segment: EXCHANGE_SEGMENTS.IDX_I, name: 'NIFTY FIN SERVICE' },

    // === POPULAR NSE EQUITIES ===
    'RELIANCE': { id: '2885', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Reliance Industries' },
    'TCS': { id: '11536', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Tata Consultancy Services' },
    'HDFCBANK': { id: '1333', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'HDFC Bank' },
    'INFY': { id: '1594', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Infosys' },
    'ICICIBANK': { id: '4963', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'ICICI Bank' },
    'HINDUNILVR': { id: '1394', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Hindustan Unilever' },
    'ITC': { id: '1660', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'ITC Limited' },
    'SBIN': { id: '3045', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'State Bank of India' },
    'BHARTIARTL': { id: '10604', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Bharti Airtel' },
    'KOTAKBANK': { id: '1922', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Kotak Mahindra Bank' },
    'LT': { id: '11483', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Larsen & Toubro' },
    'AXISBANK': { id: '5900', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Axis Bank' },
    'WIPRO': { id: '3787', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Wipro' },
    'TATAMOTORS': { id: '3456', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Tata Motors' },
    'TATAMOTRS': { id: '3456', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Tata Motors' },
    'TATASTEEL': { id: '3499', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Tata Steel' },
    'ADANIENT': { id: '25', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Adani Enterprises' },
    'BAJFINANCE': { id: '317', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Bajaj Finance' },
    'MARUTI': { id: '10999', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Maruti Suzuki' },
    'SUNPHARMA': { id: '3351', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Sun Pharma' },
    'TITAN': { id: '3506', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Titan Company' },
    'ASIANPAINT': { id: '236', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Asian Paints' },
    'ULTRACEMCO': { id: '11532', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'UltraTech Cement' },
    'NESTLEIND': { id: '17963', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Nestle India' },
    'TECHM': { id: '13538', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Tech Mahindra' },
    'POWERGRID': { id: '14977', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Power Grid Corp' },
    'NTPC': { id: '11630', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'NTPC' },
    'M&M': { id: '2031', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Mahindra & Mahindra' },
    'HCLTECH': { id: '7229', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'HCL Technologies' },
    'ONGC': { id: '2475', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Oil & Natural Gas' },
    'COALINDIA': { id: '20374', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Coal India' },
    'DRREDDY': { id: '881', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: "Dr. Reddy's Lab" },
    'BAJAJFINSV': { id: '16669', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Bajaj Finserv' },
    'JSWSTEEL': { id: '11723', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'JSW Steel' },
    'CIPLA': { id: '694', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Cipla' },
    'TATACONSUM': { id: '3432', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Tata Consumer Products' },
    'EICHERMOT': { id: '910', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Eicher Motors' },
    'APOLLOHOSP': { id: '157', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Apollo Hospitals' },
    'DIVISLAB': { id: '10940', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: "Divi's Laboratories" },
    'HEROMOTOCO': { id: '1348', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Hero MotoCorp' },
    'GRASIM': { id: '1232', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Grasim Industries' },
    'BPCL': { id: '526', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Bharat Petroleum' },
    'BRITANNIA': { id: '547', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Britannia Industries' },
    'INDUSINDBK': { id: '5258', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'IndusInd Bank' },
    'SBILIFE': { id: '21808', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'SBI Life Insurance' },
    'HINDALCO': { id: '1363', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Hindalco Industries' },
    'ZOMATO': { id: '5097', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'Zomato' },
    'PAYTM': { id: '6705', segment: EXCHANGE_SEGMENTS.NSE_EQ, name: 'One 97 Communications' },
};

// ============================================================
// PREVIOUS CLOSE CACHE (for calculating change %)
// ============================================================
const getPrevCloseCache = (): Record<string, number> => {
    try {
        const stored = sessionStorage.getItem('dhan-prev-close-cache');
        return stored ? JSON.parse(stored) : {};
    } catch {
        return {};
    }
};

const setPrevCloseCache = (secId: string, price: number) => {
    try {
        const cache = getPrevCloseCache();
        cache[secId] = price;
        sessionStorage.setItem('dhan-prev-close-cache', JSON.stringify(cache));
    } catch {}
};

// ============================================================
// CORE SERVICE
// ============================================================

class DhanBrokerServiceClass {
    private BASE_URL = '/api/dhan'; // Proxied via Vite in dev
    private ltpCache = new Map<string, { price: number; timestamp: number }>();
    private readonly LTP_CACHE_TTL_MS = 5000;


    // State for rate limiting auth
    private lastAuthAttemptTime: number = 0;
    private readonly AUTH_COOLDOWN_MS = 130000; // 2min 10s — DhanHQ enforces 2-min minimum between token calls
    private authPromise: Promise<boolean> | null = null;
    // One-shot warning flag for the not-subscribed skip path (noise fix)
    private static dataApiSkipWarned = false;
    private get dataApiSubscribed(): boolean {
        return useSettingsStore.getState().isDhanDataApiEnabled;
    }
    private set dataApiSubscribed(value: boolean) {
        useSettingsStore.getState().updateSetting('isDhanDataApiEnabled', value);
    }

    private getHeaders(): Record<string, string> {
        const settings = useSettingsStore.getState();
        return {
            'access-token': settings.dhanAccessToken || '',
            'client-id': settings.dhanClientId || '',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
    }

    /**
     * Helper to perform fetch with exponential backoff for HTTP 429 and 5xx errors.
     */
    private async fetchWithRetry(url: string, options: RequestInit, retries = 3, timeoutMs = 10000): Promise<Response> {
        let attempt = 0;
        let delay = 1000; // start with 1 second

        while (attempt < retries) {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const res = await fetch(url, {
                    ...options,
                    signal: controller.signal
                });
                clearTimeout(id);

                // If it's a rate limit or server error, we retry
                if (res.status === 429) {
                    const retryAfter = res.headers.get('Retry-After');
                    if (retryAfter) {
                        const waitSec = parseInt(retryAfter, 10) || 5;
                        logger.warn(`DhanHQ Rate Limit (429). Retrying after ${waitSec}s as requested by server...`);
                        await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
                        attempt++;
                        continue;
                    } else {
                        logger.error(`DhanHQ Rate Limit (429) without Retry-After. Aborting to avoid hammering API.`);
                        return res; // Let the caller handle the 429
                    }
                }

                if (res.status >= 500) {
                    logger.warn(`DhanHQ API returned ${res.status} on ${url}. Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    attempt++;
                    delay *= 2; // exponential backoff
                    continue;
                }

                // Return normally for 200, 400, 401, 404, etc.
                return res;
            } catch (err: unknown) {
                clearTimeout(id);
                const isAbortError = err instanceof Error && err.name === 'AbortError';
                if (isAbortError) {
                    logger.warn(`DhanHQ Timeout (${timeoutMs}ms) on ${url}. Retrying...`);
                } else {
                    // Network error (fetch failed completely, offline, etc.)
                    logger.warn(`DhanHQ Network Error on ${url}. Retrying in ${delay}ms...`, err);
                }
                
                await new Promise(resolve => setTimeout(resolve, delay));
                attempt++;
                delay *= 2;
                if (attempt >= retries) throw err;
            }
        }

        throw new Error(`DhanHQ fetch failed after ${retries} attempts for ${url}`);
    }

    /**
     * Check if Dhan credentials are configured
     */
    isConfigured(): boolean {
        const settings = useSettingsStore.getState();
        return !!(settings.dhanClientId && (settings.dhanAccessToken || (settings.dhanPin && settings.dhanTotpSecret)));
    }

    /**
     * Authenticate using PIN and TOTP to get a fresh Access Token
     * Proxied to https://auth.dhan.co
     */
    private async authenticateWithTotp(): Promise<boolean> {
        // If an auth request is currently in-flight, await its completion
        // This prevents the race condition where `dhanStore.fetchAll()`
        // makes multiple API calls concurrently that all try to auth.
        if (this.authPromise) {
            logger.debug('Waiting for in-flight DhanHQ auth to complete...');
            return this.authPromise;
        }

        this.authPromise = this._executeAuthenticateWithTotp();
        try {
            return await this.authPromise;
        } finally {
            this.authPromise = null;
        }
    }

    private async _executeAuthenticateWithTotp(): Promise<boolean> {
        const settings = useSettingsStore.getState();
        if (!settings.dhanClientId || !settings.dhanPin || !settings.dhanTotpSecret) {
            logger.debug('DhanHQ Auth: Missing clientId, PIN, or TOTP secret. Skipping auto-login.');
            return false;
        }

        // DhanHQ enforces a strict 2-minute minimum between token generation calls.
        // Our cooldown MUST be longer than 2 minutes, applied on EVERY attempt (success or failure).
        const now = Date.now();
        if (now - this.lastAuthAttemptTime < this.AUTH_COOLDOWN_MS) {
            const waitSec = Math.ceil((this.AUTH_COOLDOWN_MS - (now - this.lastAuthAttemptTime)) / 1000);
            logger.debug(`DhanHQ Auth: Rate-limit cooldown active. Retry in ${waitSec}s.`);
            return false;
        }
        this.lastAuthAttemptTime = now; // Mark attempt BEFORE calling, to prevent concurrent retries

        try {
            // Sanitize TOTP secret (remove spaces/dashes, ensure uppercase)
            const cleanSecret = settings.dhanTotpSecret.replace(/[\s-]+/g, '').toUpperCase();
            if (cleanSecret.length < 16) {
                logger.error('DhanHQ Auth: TOTP secret too short after sanitization. Check Settings.');
                return false;
            }

            // Generate the current 6-digit TOTP code
            const { otp: currentTotp } = await TOTP.generate(cleanSecret);
            logger.info('DhanHQ: Attempting auto-login...');

            // POST to the confirmed working endpoint: /app/generateAccessToken
            const authUrl = `/auth/dhan/app/generateAccessToken?dhanClientId=${settings.dhanClientId}&pin=${settings.dhanPin}&totp=${currentTotp}`;
            const response = await fetch(authUrl, {
                method: 'POST',
                headers: { 'Accept': 'application/json' },
            });

            const data = await response.json().catch(() => ({}));

            // Handle DhanHQ's rate-limit response: {"status":"error","message":"Token can be generated once every 2 minutes."}
            if (data?.status === 'error' && data?.message?.includes('2 minutes')) {
                logger.info('DhanHQ: Rate-limited by server. Will retry after cooldown.');
                return false;
            }

            // Handle successful token generation
            const accessToken = data?.data?.accessToken || data?.accessToken || null;
            if (accessToken) {
                useSettingsStore.getState().updateSetting('dhanAccessToken', accessToken);
                logger.info('✅ DhanHQ: Auto-login successful! Access token saved.');
                return true;
            }

            // Handle other errors
            if (!response.ok) {
                logger.warn(`DhanHQ Auth failed (${response.status}): ${JSON.stringify(data)}`);
            } else {
                logger.warn('DhanHQ Auth: Response OK but no accessToken found in:', data);
            }
        } catch (err) {
            logger.error('DhanHQ Auth: Network or TOTP generation error:', err);
        }
        return false;
    }

    /**
     * Explicitly regenerate Dhan access token manually using credentials (PIN + TOTP).
     */
    async regenerateToken(): Promise<{ success: boolean; message: string }> {
        const settings = useSettingsStore.getState();
        if (!settings.dhanClientId || !settings.dhanPin || !settings.dhanTotpSecret) {
            return { success: false, message: 'Missing Client ID, PIN, or TOTP Secret in settings.' };
        }

        // Reset the rate limit cooldown for manual click
        this.lastAuthAttemptTime = 0;
        const ok = await this.authenticateWithTotp();
        if (ok) {
            return { success: true, message: '✅ Dhan Access Token generated successfully!' };
        }
        return { success: false, message: 'Failed to auto-generate token. Check PIN & TOTP Secret.' };
    }

    /**
     * Test DhanHQ connection by attempting to fetch fund limit.
     * Returns { success, message } for UI feedback.
     */
    async testConnection(): Promise<{ success: boolean; message: string }> {
        const settings = useSettingsStore.getState();
        if (!settings.dhanClientId) {
            return { success: false, message: 'Client ID is empty. Enter it in Settings.' };
        }

        // If we have a token, test it directly
        if (settings.dhanAccessToken) {
            try {
                const res = await fetch(`${this.BASE_URL}/v2/fundlimit`, {
                    method: 'GET',
                    headers: this.getHeaders(),
                });
                const errText = await res.text().catch(() => '');
                const isInvalid = res.status === 401 || (res.status === 400 && (errText.includes('DH-906') || errText.includes('Invalid Token')));

                if (res.ok) {
                    return { success: true, message: '✅ Connected! Token is valid.' };
                } else if (isInvalid) {
                    if (settings.dhanPin && settings.dhanTotpSecret) {
                        logger.info('DhanHQ: Test connection detected expired/invalid token. Attempting auto-login...');
                        // Reset rate-limit cooldown for manual connection test click
                        this.lastAuthAttemptTime = 0;
                        const ok = await this.authenticateWithTotp();
                        if (ok) {
                            return { success: true, message: '✅ Token was expired, but auto-login successfully regenerated a new one!' };
                        }
                    }
                    return { success: false, message: 'Token is expired/invalid. Please check your PIN & TOTP Secret for auto-generation.' };
                } else {
                    return { success: false, message: `API Error ${res.status}: ${errText || res.statusText}` };
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                return { success: false, message: `Network Error: ${message || 'Check if Vite proxy is running'}` };
            }
        }

        // No token — try auto-login
        if (settings.dhanPin && settings.dhanTotpSecret) {
            const ok = await this.regenerateToken();
            if (ok.success) {
                return ok;
            }
            return { success: false, message: 'Auto-login failed. Check PIN & TOTP Secret, or paste a token from web.dhan.co.' };
        }

        return { success: false, message: 'No Access Token and no PIN/TOTP configured.' };
    }

    /**
     * Internal async helper to ensure we have a valid token before API calls
     */
    private async ensureValidToken(): Promise<boolean> {
        const settings = useSettingsStore.getState();

        // If we already have a token, assume it's valid. (If requests fail later with 401, we handle it there)
        if (settings.dhanAccessToken) {
            return true;
        }

        // If no token but we have PIN+TOTP configured, try logging in
        if (settings.dhanPin && settings.dhanTotpSecret) {
            return await this.authenticateWithTotp();
        }

        return false;
    }

    /**
     * Fetch LTP (Last Traded Price) for multiple instruments
     * POST /v2/marketfeed/ltp
     */
    async fetchLTP(instruments: { segment: string; securityId: string }[]): Promise<Record<string, number>> {
        const now = Date.now();
        const results: Record<string, number> = {};
        const missingInstruments: { segment: string; securityId: string }[] = [];

        for (const inst of instruments) {
            const cached = this.ltpCache.get(inst.securityId);
            if (cached && (now - cached.timestamp < this.LTP_CACHE_TTL_MS)) {
                results[inst.securityId] = cached.price;
            } else {
                missingInstruments.push(inst);
            }
        }

        if (missingInstruments.length === 0) {
            return results;
        }

        const hasToken = await this.ensureValidToken();
        if (!hasToken) {
            console.warn('[fetchLTP] ❌ No valid token — skipping LTP fetch');
            return results;
        }

        if (!this.dataApiSubscribed) {
            // SPRINT-0 noise fix: this state never changes mid-session, yet the
            // warning fired on every LTP poll (51x/72h observed). Warn once,
            // stay silent after.
            if (!DhanBrokerServiceClass.dataApiSkipWarned) {
                DhanBrokerServiceClass.dataApiSkipWarned = true;
                console.warn('[fetchLTP] 🛡️ Data API not subscribed — skipping calls to avoid 401s (further skips silent this session)');
            }
            return results;
        }

        // Group by exchange segment — Dhan API requires INTEGER security IDs, not strings!
        const requestBody: Record<string, number[]> = {};
        for (const inst of missingInstruments) {
            if (!requestBody[inst.segment]) {
                requestBody[inst.segment] = [];
            }
            requestBody[inst.segment].push(parseInt(inst.securityId, 10));
        }

        try {
            let response = await this.fetchWithRetry(`${this.BASE_URL}/v2/marketfeed/ltp`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(requestBody),
            });

            // Handle token expiry (401 Unauthorized) or Permission issues (403 Forbidden)
            if (response.status === 401 || response.status === 403) {
                // If it's a 403, it's almost certainly a subscription issue
                if (response.status === 403) {
                    this.dataApiSubscribed = false;
                    logger.warn('DhanHQ: Received 403 Forbidden. This account is likely not subscribed to the "Data API". Switching to fallback sources.');
                    return {};
                }

                logger.warn('DhanHQ access token expired or invalid (401). Attempting automated login renewal...');
                const renewed = await this.authenticateWithTotp();
                if (renewed) {
                    response = await this.fetchWithRetry(`${this.BASE_URL}/v2/marketfeed/ltp`, {
                        method: 'POST',
                        headers: this.getHeaders(),
                        body: JSON.stringify(requestBody),
                    });
                    console.log(`[fetchLTP] 📥 Retry response status: ${response.status}`);
                } else {
                    // Renewal failed — disable Data API for this session to prevent spamming Dhan servers
                    this.dataApiSubscribed = false; 
                    logger.error('DhanHQ: Automated token renewal failed after 401. Market Data API calls are now disabled for this session to prevent spam.');
                    return {};
                }
            }

            // Handle Rate Limiting (429) - disable for session if it persists beyond retry logic
            if (response.status === 429) {
                this.dataApiSubscribed = false;
                logger.error('DhanHQ: Received 429 Too Many Requests even after retries. Market Data API calls are disabled for this session.');
                return {};
            }

            if (!response.ok) {
                const errText = await response.text();
                console.error(`[fetchLTP] ❌ API Error ${response.status}: ${errText}`);
                throw new Error(`DhanHQ API error: ${response.status}`);
            }

            const data = await response.json();
            console.log('[fetchLTP] 📦 Raw API response:', JSON.stringify(data).substring(0, 500));

            // Check for "Data APIs not Subscribed" error (806)
            if (data?.data?.["806"] === "Data APIs not Subscribed" || data?.data?.["806"]?.includes("not Subscribed")) {
                this.dataApiSubscribed = false;
                logger.warn('DhanHQ: "Data API" not subscribed on this account. Switching to fallback sources.');
                return {};
            }

            if (data?.data) {
                for (const segment of Object.keys(data.data)) {
                    for (const secId of Object.keys(data.data[segment])) {
                        const ltpData = data.data[segment][secId];
                        const price = ltpData?.last_price ?? ltpData?.lastPrice ?? 0;
                        results[secId] = price;
                        this.ltpCache.set(secId, { price, timestamp: now });
                    }
                }
            }
            console.log(`[fetchLTP] ✅ Parsed ${Object.keys(results).length} prices:`, results);
            return results;
        } catch (err) {
            console.error('[fetchLTP] 💥 EXCEPTION:', err);
            return results;
        }
    }

    /**
     * Fetch OHLC data for multiple instruments
     * POST /v2/marketfeed/ohlc
     */
    async fetchOHLC(instruments: { segment: string; securityId: string }[]): Promise<Record<string, DhanOHLCResponse>> {
        const hasToken = await this.ensureValidToken();
        if (!hasToken) {
            logger.debug('DhanHQ credentials not configured for OHLC fetch.');
            return {};
        }

        if (!this.dataApiSubscribed) {
            return {};
        }

        const requestBody: Record<string, number[]> = {};
        for (const inst of instruments) {
            if (!requestBody[inst.segment]) {
                requestBody[inst.segment] = [];
            }
            requestBody[inst.segment].push(parseInt(inst.securityId, 10));
        }

        try {
            let response = await this.fetchWithRetry(`${this.BASE_URL}/v2/marketfeed/ohlc`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(requestBody),
            });

            // Handle token expiry (401 Unauthorized) or Permission issues (403 Forbidden)
            if (response.status === 401 || response.status === 403) {
                if (response.status === 403) {
                    this.dataApiSubscribed = false;
                    return {};
                }
                logger.warn('DhanHQ access token expired or invalid (401). Attempting automated login renewal for OHLC...');
                const renewed = await this.authenticateWithTotp();
                if (renewed) {
                    response = await this.fetchWithRetry(`${this.BASE_URL}/v2/marketfeed/ohlc`, {
                        method: 'POST',
                        headers: this.getHeaders(),
                        body: JSON.stringify(requestBody),
                    });
                } else {
                    this.dataApiSubscribed = false;
                    return {};
                }
            }

            if (!response.ok) {
                throw new Error(`DhanHQ OHLC error: ${response.status}`);
            }

            const data = await response.json();
            const result: Record<string, DhanOHLCResponse> = {};
            if (data?.data) {
                for (const segment of Object.keys(data.data)) {
                    for (const secId of Object.keys(data.data[segment])) {
                        const ohlc = data.data[segment][secId];
                        result[secId] = {
                            securityId: secId,
                            open: ohlc.open ?? 0,
                            high: ohlc.high ?? 0,
                            low: ohlc.low ?? 0,
                            close: ohlc.close ?? 0,
                            volume: ohlc.volume ?? 0,
                        };
                    }
                }
            }
            return result;
        } catch (err) {
            logger.error('DhanHQ fetchOHLC failed:', err);
            return {};
        }
    }

    /**
     * Fetch all user holdings from DhanHQ
     * GET /v2/holdings
     */
    async fetchHoldings(): Promise<DhanHoldingResponse[]> {
        const hasToken = await this.ensureValidToken();
        if (!hasToken) {
            logger.debug('DhanHQ credentials not configured for holdings fetch.');
            return [];
        }

        try {
            let response = await this.fetchWithRetry(`${this.BASE_URL}/v2/holdings`, {
                method: 'GET',
                headers: this.getHeaders(),
            });

            if (response.status === 401) {
                // Token may be expired — attempt auto-renewal without wiping the stored token
                if (await this.authenticateWithTotp()) {
                    response = await this.fetchWithRetry(`${this.BASE_URL}/v2/holdings`, {
                        method: 'GET',
                        headers: this.getHeaders(),
                    });
                }
            }

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                throw new Error(`DhanHQ Holdings Error (${response.status}): ${errText || response.statusText}`);
            }
            const data = await response.json();
            return Array.isArray(data) ? data : (data.data || []);
        } catch (err) {
            logger.error('DhanHQ fetchHoldings failed:', err);
            throw err;
        }
    }

    /**
     * Fetch all intraday/daily positions from DhanHQ
     * GET /v2/positions
     */
    async fetchPositions(): Promise<DhanPositionResponse[]> {
        const hasToken = await this.ensureValidToken();
        if (!hasToken) {
            logger.debug('DhanHQ credentials not configured for positions fetch.');
            return [];
        }

        try {
            let response = await this.fetchWithRetry(`${this.BASE_URL}/v2/positions`, {
                method: 'GET',
                headers: this.getHeaders(),
            });

            if (response.status === 401) {
                // Token may be expired — attempt auto-renewal without wiping the stored token
                if (await this.authenticateWithTotp()) {
                    response = await this.fetchWithRetry(`${this.BASE_URL}/v2/positions`, {
                        method: 'GET',
                        headers: this.getHeaders(),
                    });
                }
            }

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                throw new Error(`DhanHQ Positions Error (${response.status}): ${errText || response.statusText}`);
            }
            const data = await response.json();
            return Array.isArray(data) ? data : (data.data || []);
        } catch (err) {
            logger.error('DhanHQ fetchPositions failed:', err);
            throw err;
        }
    }

    /**
     * Convert an open position
     * POST /v2/positions/convert
     */
    async convertPosition(req: DhanConvertPositionRequest): Promise<any> {
        const hasToken = await this.ensureValidToken();
        if (!hasToken) {
            throw new Error('DhanHQ Login Failed. Please check your Client ID, PIN, and TOTP Secret in Settings.');
        }

        try {
            const finalReq = {
                dhanClientId: useSettingsStore.getState().dhanClientId,
                ...req
            };

            let response = await this.fetchWithRetry(`${this.BASE_URL}/v2/positions/convert`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(finalReq)
            });

            if (response.status === 401) {
                // Token may be expired — attempt auto-renewal without wiping the stored token
                if (await this.authenticateWithTotp()) {
                    response = await this.fetchWithRetry(`${this.BASE_URL}/v2/positions/convert`, {
                        method: 'POST',
                        headers: this.getHeaders(),
                        body: JSON.stringify(finalReq)
                    });
                }
            }

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(`DhanHQ Position Convert Failed: ${errData.errorMessage || response.statusText}`);
            }

            return await response.json();
        } catch (err) {
            logger.error('DhanHQ convertPosition failed:', err);
            throw err;
        }
    }

    /**
     * Exit All Open Positions (Kill Switch)
     * DELETE /v2/positions
     */
    async exitAllPositions(): Promise<any> {
        // --- Sandbox safety gate ---
        const { isSandboxMode } = useSandboxStore.getState();
        if (isSandboxMode) {
            logger.info('Sandbox mode active - simulating exitAllPositions (zero live broker traffic).');
            return { status: 'SUCCESS', message: 'Sandbox positions liquidated virtually', isSandbox: true };
        }

        const hasToken = await this.ensureValidToken();
        if (!hasToken) {
            throw new Error('DhanHQ Login Failed. Please check your Client ID, PIN, and TOTP Secret in Settings.');
        }

        try {
            let response = await this.fetchWithRetry(`${this.BASE_URL}/v2/positions`, {
                method: 'DELETE',
                headers: {
                    ...this.getHeaders(),
                    'X-Confirm': 'YES_LIQUIDATE_MY_ENTIRE_PORTFOLIO_NOW'
                }
            });

            if (response.status === 401) {
                // Token may be expired — attempt auto-renewal without wiping the stored token
                if (await this.authenticateWithTotp()) {
                    response = await this.fetchWithRetry(`${this.BASE_URL}/v2/positions`, {
                        method: 'DELETE',
                        headers: {
                            ...this.getHeaders(),
                            'X-Confirm': 'YES_LIQUIDATE_MY_ENTIRE_PORTFOLIO_NOW'
                        }
                    });
                }
            }

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(`DhanHQ Exit Positions Failed: ${errData.errorMessage || response.statusText}`);
            }

            return await response.json();
        } catch (err) {
            logger.error('DhanHQ exitAllPositions failed:', err);
            throw err;
        }
    }

    /**
     * Fetch executed trades for the day from DhanHQ
     * GET /v2/trades
     */
    async fetchTrades(): Promise<DhanTradeResponse[]> {
        const hasToken = await this.ensureValidToken();
        if (!hasToken) {
            logger.debug('DhanHQ credentials not configured for trades fetch.');
            return [];
        }

        try {
            let response = await this.fetchWithRetry(`${this.BASE_URL}/v2/trades`, {
                method: 'GET',
                headers: this.getHeaders(),
            });

            if (response.status === 401) {
                // Token may be expired — attempt auto-renewal without wiping the stored token
                if (await this.authenticateWithTotp()) {
                    response = await this.fetchWithRetry(`${this.BASE_URL}/v2/trades`, {
                        method: 'GET',
                        headers: this.getHeaders(),
                    });
                }
            }

            if (!response.ok) {
                throw new Error(`DhanHQ Trades error: ${response.status}`);
            }

            const data = await response.json();
            return Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
        } catch (err) {
            logger.error('DhanHQ fetchTrades failed:', err);
            return [];
        }
    }

    /**
     * Fetch historical trades for a specific date range from DhanHQ
     * GET /v2/trades/{from-date}/{to-date}/{page}
     * Use this instead of fetchTrades() when you need trades from a past date.
     */
    async fetchTradeHistory(fromDate: string, toDate: string, page = 0): Promise<DhanTradeResponse[]> {
        const hasToken = await this.ensureValidToken();
        if (!hasToken) {
            logger.debug('DhanHQ credentials not configured for trade history fetch.');
            return [];
        }

        try {
            const url = `${this.BASE_URL}/v2/trades/${fromDate}/${toDate}/${page}`;
            let response = await this.fetchWithRetry(url, {
                method: 'GET',
                headers: this.getHeaders(),
            });

            if (response.status === 401) {
                // Token may be expired — attempt auto-renewal without wiping the stored token
                if (await this.authenticateWithTotp()) {
                    response = await this.fetchWithRetry(url, {
                        method: 'GET',
                        headers: this.getHeaders(),
                    });
                }
            }

            if (!response.ok) {
                throw new Error(`DhanHQ Trade History error: ${response.status}`);
            }

            const data = await response.json();
            return Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
        } catch (err) {
            logger.error('DhanHQ fetchTradeHistory failed:', err);
            return [];
        }

    }

    /**
     * Place an order via DhanHQ
     * POST /v2/orders
     */
    async placeOrder(orderReq: DhanOrderRequest): Promise<any> {
        // --- Offline gate (Top-10 #4) ---
        if (!isNetworkActionAllowed('dhan-order')) {
            throw new Error('Offline — broker order placement is blocked. Will retry when online.');
        }
        // --- Demo-mode side-effect gate (Top-10 #1, audit gap G1) ---
        // Demo data must NEVER reach a broker order endpoint.
        if (!isSideEffectAllowed('dhan-order')) {
            throw new Error('Demo mode active — broker orders are blocked. Clear demo data to continue.');
        }

        // --- Sandbox mode safety gate ---
        const { isSandboxMode } = useSandboxStore.getState();
        if (isSandboxMode) {
            logger.info('Sandbox mode active - simulating broker order placement (zero live broker traffic).');
            return {
                orderId: `SANDBOX-${Date.now()}`,
                orderStatus: 'TRANSIT',
                isSandbox: true,
                message: 'Sandbox order simulated successfully'
            };
        }

        const hasToken = await this.ensureValidToken();
        if (!hasToken) {
            throw new Error('DhanHQ Login Failed. Please check your PIN and TOTP Secret.');
        }

        // --- AI GUARDRAIL CHECK ---
        const { activeBreaker, breakerReason } = useGuardrailStore.getState();
        if (activeBreaker === 'lockout' || activeBreaker === 'cooldown') {
            const errorMsg = `🚫 GUARDRAIL ACTIVE: ${breakerReason}`;
            logger.error(errorMsg);
            throw new Error(errorMsg);
        }

        try {
            // Apply client ID and auto-resolve securityId from master map if empty
            const symbolKey = (orderReq.tradingSymbol || '').toUpperCase().trim();
            const secInfo = SECURITY_IDS[symbolKey];
            const resolvedSecurityId = (!orderReq.securityId || orderReq.securityId.trim() === '')
                ? (secInfo?.id || orderReq.securityId || '')
                : orderReq.securityId;

            const finalOrderReq: Record<string, any> = {
                dhanClientId: useSettingsStore.getState().dhanClientId,
                ...orderReq,
                securityId: resolvedSecurityId
            };

            // Bracket Order validation and payload alignment
            if (orderReq.productType === 'BO') {
                if (!finalOrderReq.boProfitValue || finalOrderReq.boProfitValue <= 0) {
                    throw new Error('DhanHQ BO Order Failed: Target points (boProfitValue) must be greater than 0.');
                }
                if (!finalOrderReq.boStopLossValue || finalOrderReq.boStopLossValue <= 0) {
                    throw new Error('DhanHQ BO Order Failed: Stop-loss points (boStopLossValue) must be greater than 0.');
                }
            }

            let response = await this.fetchWithRetry(`${this.BASE_URL}/v2/orders`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(finalOrderReq)
            });

            if (response.status === 401) {
                // Token may be expired — attempt auto-renewal without wiping the stored token
                if (await this.authenticateWithTotp()) {
                    response = await this.fetchWithRetry(`${this.BASE_URL}/v2/orders`, {
                        method: 'POST',
                        headers: this.getHeaders(),
                        body: JSON.stringify(finalOrderReq)
                    });
                }
            }

            if (!response.ok) {
                const errText = await response.text();
                let detail = response.statusText || `HTTP ${response.status}`;
                try {
                    const errJson = JSON.parse(errText);
                    detail = errJson.errorMessage || errJson.internalMessage || errJson.error_message || errJson.remarks || detail;
                } catch {
                    if (errText && errText.length < 200) detail = errText.trim();
                }
                throw new Error(`DhanHQ Order Failed: ${detail}`);
            }

            const result = await response.json();
            logger.info('DhanHQ placeOrder successful:', result);
            return result;
        } catch (err) {
            logger.error('DhanHQ placeOrder failed:', err);
            throw err;
        }
    }

    /**
     * Fetch all active/historical orders for the day via DhanHQ
     * GET /v2/orders
     */
    async fetchOrders(): Promise<any[]> {
        const hasToken = await this.ensureValidToken();
        if (!hasToken) {
            throw new Error('DhanHQ Login Failed. Please check your PIN and TOTP Secret.');
        }

        try {
            let response = await this.fetchWithRetry(`${this.BASE_URL}/v2/orders`, {
                method: 'GET',
                headers: this.getHeaders(),
            });

            if (response.status === 401) {
                if (await this.authenticateWithTotp()) {
                    response = await this.fetchWithRetry(`${this.BASE_URL}/v2/orders`, {
                        method: 'GET',
                        headers: this.getHeaders(),
                    });
                }
            }

            if (!response.ok) {
                throw new Error(`DhanHQ Fetch Orders error: ${response.status}`);
            }

            const data = await response.json();
            return Array.isArray(data) ? data : (data?.data || []);
        } catch (err) {
            logger.error('DhanHQ fetchOrders failed:', err);
            return [];
        }
    }

    /**
     * Modify an existing pending order via DhanHQ
     * PUT /v2/orders/{orderId}
     */
    async modifyOrder(orderId: string, orderReq: any): Promise<any> {
        // --- Sandbox safety gate ---
        const { isSandboxMode } = useSandboxStore.getState();
        if (isSandboxMode) {
            logger.info('Sandbox mode active - simulating modifyOrder (zero live broker traffic).');
            return { orderId, status: 'SUCCESS', message: 'Sandbox order modified virtually', isSandbox: true };
        }

        const hasToken = await this.ensureValidToken();
        if (!hasToken) {
            throw new Error('DhanHQ Login Failed. Please check your PIN and TOTP Secret.');
        }

        try {
            const finalOrderReq = {
                dhanClientId: useSettingsStore.getState().dhanClientId,
                ...orderReq
            };

            let response = await this.fetchWithRetry(`${this.BASE_URL}/v2/orders/${orderId}`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify(finalOrderReq)
            });

            if (response.status === 401) {
                if (await this.authenticateWithTotp()) {
                    response = await this.fetchWithRetry(`${this.BASE_URL}/v2/orders/${orderId}`, {
                        method: 'PUT',
                        headers: this.getHeaders(),
                        body: JSON.stringify(finalOrderReq)
                    });
                }
            }

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(`DhanHQ Modify Order Failed: ${errData.errorMessage || response.statusText}`);
            }

            return await response.json();
        } catch (err) {
            logger.error('DhanHQ modifyOrder failed:', err);
            throw err;
        }
    }


    /**
     * Fetch Forever (GTT) Orders
     * GET /v2/forever/orders
     */
    async fetchForeverOrders(): Promise<any[]> {
        const hasToken = await this.ensureValidToken();
        if (!hasToken) {
            return [];
        }

        try {
            let response = await this.fetchWithRetry(`${this.BASE_URL}/v2/forever/orders`, {
                method: 'GET',
                headers: this.getHeaders(),
            });

            if (response.status === 401) {
                // Token may be expired — attempt auto-renewal without wiping the stored token
                if (await this.authenticateWithTotp()) {
                    response = await this.fetchWithRetry(`${this.BASE_URL}/v2/forever/orders`, {
                        method: 'GET',
                        headers: this.getHeaders(),
                    });
                }
            }

            if (!response.ok) {
                throw new Error(`DhanHQ Forever Orders error: ${response.status}`);
            }

            const data = await response.json();
            return Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
        } catch (err) {
            logger.error('DhanHQ fetchForeverOrders failed:', err);
            return [];
        }
    }

    /**
     * Place a Forever (GTT) Order
     * POST /v2/forever/orders
     */
    async placeForeverOrder(orderReq: DhanGTTOrderRequest): Promise<any> {
        // --- Sandbox safety gate ---
        const { isSandboxMode } = useSandboxStore.getState();
        if (isSandboxMode) {
            logger.info('Sandbox mode active - simulating placeForeverOrder (zero live broker traffic).');
            return {
                orderId: `SANDBOX-GTT-${Date.now()}`,
                orderStatus: 'TRANSIT',
                isSandbox: true,
                message: 'Sandbox GTT order simulated successfully'
            };
        }

        const hasToken = await this.ensureValidToken();
        if (!hasToken) {
            throw new Error('DhanHQ Login Failed. Please check your PIN and TOTP Secret.');
        }

        try {
            const finalReq = {
                dhanClientId: useSettingsStore.getState().dhanClientId,
                ...orderReq
            };

            let response = await this.fetchWithRetry(`${this.BASE_URL}/v2/forever/orders`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(finalReq)
            });

            if (response.status === 401) {
                // Token may be expired — attempt auto-renewal without wiping the stored token
                if (await this.authenticateWithTotp()) {
                    response = await this.fetchWithRetry(`${this.BASE_URL}/v2/forever/orders`, {
                        method: 'POST',
                        headers: this.getHeaders(),
                        body: JSON.stringify(finalReq)
                    });
                }
            }

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(`DhanHQ GTT Order Failed: ${errData.errorMessage || response.statusText}`);
            }

            return await response.json();
        } catch (err) {
            logger.error('DhanHQ placeForeverOrder failed:', err);
            throw err;
        }
    }

    /**
     * Fetch Ledger Data
     * GET /v2/ledger
     */
    async fetchLedger(fromDate: string, toDate: string): Promise<DhanLedgerResponse[]> {
        const hasToken = await this.ensureValidToken();
        if (!hasToken) {
            return [];
        }

        try {
            // from-date and to-date parameters should be YYYY-MM-DD
            let response = await this.fetchWithRetry(`${this.BASE_URL}/v2/ledger?from-date=${fromDate}&to-date=${toDate}`, {
                method: 'GET',
                headers: this.getHeaders(),
            });

            if (response.status === 401) {
                // Token may be expired — attempt auto-renewal without wiping the stored token
                if (await this.authenticateWithTotp()) {
                    response = await this.fetchWithRetry(`${this.BASE_URL}/v2/ledger?from-date=${fromDate}&to-date=${toDate}`, {
                        method: 'GET',
                        headers: this.getHeaders(),
                    });
                }
            }

            if (!response.ok) {
                throw new Error(`DhanHQ Ledger error: ${response.status}`);
            }

            const data = await response.json();
            return Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
        } catch (err) {
            logger.error('DhanHQ fetchLedger failed:', err);
            return [];
        }
    }

    /**
     * Calculate Required Margin for a Trade
     * POST /v2/margincalculator
     */
    async calculateMargin(req: DhanMarginRequest): Promise<DhanMarginResponse> {
        const hasToken = await this.ensureValidToken();
        if (!hasToken) {
            throw new Error('DhanHQ Login Failed. Check your Client ID, PIN, and TOTP Secret in Settings.');
        }

        try {
            const finalReq = {
                dhanClientId: useSettingsStore.getState().dhanClientId,
                ...req
            };

            let response = await this.fetchWithRetry(`${this.BASE_URL}/v2/margincalculator`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(finalReq)
            });

            if (response.status === 401) {
                // Token may be expired — attempt auto-renewal without wiping the stored token
                if (await this.authenticateWithTotp()) {
                    response = await this.fetchWithRetry(`${this.BASE_URL}/v2/margincalculator`, {
                        method: 'POST',
                        headers: this.getHeaders(),
                        body: JSON.stringify(finalReq)
                    });
                } else {
                    throw new Error('DhanHQ Access Token is expired or invalid. Please generate a new one from web.dhan.co or configure Auto-Login (PIN+TOTP).');
                }
            }

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(`Margin API Error ${response.status}: ${errData.errorMessage || errData.message || response.statusText}`);
            }

            return await response.json();
        } catch (err) {
            logger.error('DhanHQ calculateMargin failed:', err);
            throw err;
        }
    }

    /**
     * Fetch Live Fund Limit from DhanHQ
     * GET /v2/fundlimit
     */
    async fetchFundLimit(): Promise<DhanFundLimitResponse | null> {
        const hasToken = await this.ensureValidToken();
        if (!hasToken) {
            logger.debug('DhanHQ credentials not configured for fund limit fetch.');
            return null;
        }

        try {
            let response = await this.fetchWithRetry(`${this.BASE_URL}/v2/fundlimit`, {
                method: 'GET',
                headers: this.getHeaders(),
            });

            if (response.status === 401) {
                // Token may be expired — attempt auto-renewal without wiping the stored token
                if (await this.authenticateWithTotp()) {
                    response = await this.fetchWithRetry(`${this.BASE_URL}/v2/fundlimit`, {
                        method: 'GET',
                        headers: this.getHeaders(),
                    });
                }
            }

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                throw new Error(`DhanHQ Fund Limit Error (${response.status}): ${errText || response.statusText}`);
            }

            const data = await response.json();
            return data.data || data;
        } catch (err: unknown) {
            logger.error('DhanHQ fetchFundLimit failed:', err);
            throw err;
        }
    }

    /**
     * Smart sync DhanHQ portfolio (holdings + positions) to the local Dexie DB.
     * Merges based on ticker symbol and platform = 'DhanHQ'.
     */
    async syncPortfolioToStore(): Promise<void> {
        if (!this.isConfigured()) return;

        try {
            logger.info('Starting DhanHQ Portfolio Sync...');

            const [holdings, positions] = await Promise.all([
                this.fetchHoldings(),
                this.fetchPositions()
            ]);

            const dhanMap = new Map<string, {
                ticker: string;
                name: string;
                type: InvestmentType;
                quantity: number;
                investedAmount: number;
            }>();

            // 1. Process Delivery Holdings
            for (const h of holdings) {
                if (!h.tradingSymbol) continue;
                const ticker = h.tradingSymbol;
                const qty = h.totalQty || 0;
                const avgPrice = h.avgCostPrice || 0;

                if (!dhanMap.has(ticker)) {
                    dhanMap.set(ticker, {
                        ticker,
                        name: h.tradingSymbol,
                        type: InvestmentType.STOCKS,
                        quantity: 0,
                        investedAmount: 0
                    });
                }
                const entry = dhanMap.get(ticker)!;
                entry.quantity += qty;
                entry.investedAmount += (qty * avgPrice);
            }

            // 2. Process Intraday/MTF Positions
            for (const p of positions) {
                if (!p.tradingSymbol || p.positionType === 'CLOSED') continue;
                const qty = p.buyQty - p.sellQty;
                if (qty === 0) continue;

                const ticker = p.tradingSymbol;
                const avgPrice = p.costPrice || 0;

                if (!dhanMap.has(ticker)) {
                    dhanMap.set(ticker, {
                        ticker,
                        name: p.tradingSymbol,
                        type: InvestmentType.TRADING,
                        quantity: 0,
                        investedAmount: 0
                    });
                }
                const entry = dhanMap.get(ticker)!;
                entry.quantity += qty;
                entry.investedAmount += (qty * avgPrice);
            }

            // 3. Batch Fetch LTP for Live `currentValue`
            const tickers = Array.from(dhanMap.keys());
            let ltpMap = new Map<string, number>();

            if (tickers.length > 0) {
                const ltpQuotes = await this.getBatchStockLTP(tickers);
                ltpMap = new Map(ltpQuotes.map(q => [q.symbol, q.price]));
            }

            const portfolioStore = usePortfolioStore.getState();
            const existingDhanInvestments = portfolioStore.investments.filter(i => i.platform === 'DhanHQ');
            const processedLocalIds = new Set<string>();

            // 4. Update existing or Add new
            for (const [ticker, data] of dhanMap.entries()) {
                const livePrice = ltpMap.get(ticker) || (data.quantity > 0 ? (data.investedAmount / data.quantity) : 0);
                const currentValue = data.quantity * livePrice;

                const existing = existingDhanInvestments.find(i => i.ticker === ticker);

                if (existing) {
                    processedLocalIds.add(existing.id);
                    await portfolioStore.updateInvestment(existing.id, {
                        quantity: data.quantity,
                        investedAmount: data.investedAmount,
                        currentValue: currentValue,
                        lastUpdated: new Date().toISOString()
                    });
                } else {
                    await portfolioStore.addInvestment({
                        id: `inv_dhan_${Date.now()}_${ticker}`,
                        name: data.name,
                        ticker: ticker,
                        type: data.type,
                        platform: 'DhanHQ',
                        quantity: data.quantity,
                        investedAmount: data.investedAmount,
                        currentValue: currentValue,
                        lastUpdated: new Date().toISOString(),
                        owner: 'SELF',
                        status: 'ACTIVE'
                    });
                }
            }

            // 5. Delete local Dhan investments that were sold/closed
            const orphanedInvestments = existingDhanInvestments.filter(i => !processedLocalIds.has(i.id));
            if (orphanedInvestments.length > 0) {
                logger.info(`Cleaning up ${orphanedInvestments.length} closed DhanHQ positions...`);
                for (const orphan of orphanedInvestments) {
                    await portfolioStore.deleteInvestment(orphan.id);
                }
            }

            logger.info(`DhanHQ Sync Complete: Processed ${dhanMap.size} active positions.`);
            await portfolioStore.refreshPortfolio();

        } catch (err) {
            logger.error('Failed to sync DhanHQ portfolio:', err);
        }
    }

    /**
     * High-level: Get formatted quotes for the dashboard tickers & macro pulse
     * Returns pre-formatted data for NIFTY 50, SENSEX, Bank Nifty, India VIX
     */
    async getIndexQuotes(): Promise<DhanQuoteResult[]> {
        const indices = ['NIFTY 50', 'SENSEX', 'NIFTY BANK', 'INDIA VIX', 'NIFTY IT', 'NIFTY MIDCAP', 'FIN NIFTY'];
        const instruments = indices
            .filter(name => SECURITY_IDS[name])
            .map(name => ({
                segment: SECURITY_IDS[name].segment,
                securityId: SECURITY_IDS[name].id,
            }));

        // Fetch both LTP and OHLC for change calculation
        const [ltpData, ohlcData] = await Promise.all([
            this.fetchLTP(instruments),
            this.fetchOHLC(instruments),
        ]);

        const results: DhanQuoteResult[] = [];
        const cache = getPrevCloseCache();
        for (const name of indices) {
            const secInfo = SECURITY_IDS[name];
            if (!secInfo) continue;
            const ltp = ltpData[secInfo.id] ?? 0;
            const ohlc = ohlcData[secInfo.id];
            const prevClose = ohlc?.close ?? cache[secInfo.id] ?? ltp;

            // Cache previous close
            if (ohlc?.close) {
                setPrevCloseCache(secInfo.id, ohlc.close);
            }

            const change = ltp - prevClose;
            const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

            results.push({
                symbol: name,
                name: secInfo.name,
                price: ltp,
                change: Math.round(change * 100) / 100,
                changePercent: Math.round(changePercent * 100) / 100,
                source: 'dhan',
            });
        }

        return results;
    }

    /**
     * Get LTP for a specific stock by ticker symbol
     */
    async getStockLTP(ticker: string): Promise<DhanQuoteResult | null> {
        const secInfo = SECURITY_IDS[ticker.toUpperCase()];
        if (!secInfo) {
            logger.warn(`DhanBrokerService: No security ID mapping for ${ticker}`);
            return null;
        }

        try {
            const ltpData = await this.fetchLTP([{ segment: secInfo.segment, securityId: secInfo.id }]);
            const ltp = ltpData[secInfo.id] ?? 0;
            const cache = getPrevCloseCache();
            const prevClose = cache[secInfo.id] ?? ltp;
            const change = ltp - prevClose;
            const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

            return {
                symbol: ticker.toUpperCase(),
                name: secInfo.name,
                price: ltp,
                change: Math.round(change * 100) / 100,
                changePercent: Math.round(changePercent * 100) / 100,
                source: 'dhan',
            };
        } catch {
            return null;
        }
    }

    /**
     * Batch fetch LTPs for multiple stocks by ticker symbols
     */
    async getBatchStockLTP(tickers: string[]): Promise<DhanQuoteResult[]> {
        const validTickers = tickers.filter(t => SECURITY_IDS[t.toUpperCase()]);
        if (validTickers.length === 0) return [];

        const instruments = validTickers.map(t => ({
            segment: SECURITY_IDS[t.toUpperCase()].segment,
            securityId: SECURITY_IDS[t.toUpperCase()].id,
        }));

        try {
            const ltpData = await this.fetchLTP(instruments);
            const cache = getPrevCloseCache();
            return validTickers.map(ticker => {
                const secInfo = SECURITY_IDS[ticker.toUpperCase()];
                const ltp = ltpData[secInfo.id] ?? 0;
                const prevClose = cache[secInfo.id] ?? ltp;
                const change = ltp - prevClose;
                const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

                return {
                    symbol: ticker.toUpperCase(),
                    name: secInfo.name,
                    price: ltp,
                    change: Math.round(change * 100) / 100,
                    changePercent: Math.round(changePercent * 100) / 100,
                    source: 'dhan' as const,
                };
            });
        } catch {
            return [];
        }
    }

    /**
     * Get India VIX value specifically (used by Macro Pulse)
     */
    async getIndiaVIX(): Promise<{ value: number; change: number } | null> {
        try {
            const quote = await this.getStockLTP('INDIA VIX');
            if (quote && quote.price > 0) {
                return { value: quote.price, change: quote.changePercent };
            }
            return null;
        } catch {
            return null;
        }
    }
}

// Singleton Export
export const dhanBrokerService = new DhanBrokerServiceClass();
