import { create } from 'zustand';
import { DhanFundLimitResponse, DhanPositionResponse } from '../services/DhanBrokerService';
import { dhanMarketDataService } from '../services/DhanMarketDataService';
import { dhanAuthService } from '../services/DhanAuthService';
import { dhanPortfolioSyncService } from '../services/DhanPortfolioSyncService';
import { encryptData, decryptData } from '../utils/Encryption';

interface DhanState {
    fundLimit: DhanFundLimitResponse | null;
    positions: DhanPositionResponse[];
    isLoadingFundLimit: boolean;
    isLoadingPositions: boolean;
    error: string | null;
    lastUpdated: Date | null;
    isPolling: boolean; // Kept for backwards compatibility if UI checks it

    // Actions
    fetchFundLimit: (force?: boolean) => Promise<void>;
    fetchPositions: (force?: boolean) => Promise<void>;
    fetchAll: (force?: boolean) => Promise<void>;
    refreshBrokerState: (force?: boolean) => Promise<void>;
}

const getCachedFundLimit = (): DhanFundLimitResponse | null => {
    try {
        const cached = localStorage.getItem('dhan_cached_fund_limit');
        if (!cached) return null;
        if (cached.trim().startsWith('{')) {
            try {
                const encrypted = encryptData(cached);
                if (encrypted) {
                    localStorage.setItem('dhan_cached_fund_limit', encrypted);
                }
            } catch (e) {}
            return JSON.parse(cached);
        }
        const decrypted = decryptData(cached);
        return decrypted ? JSON.parse(decrypted) : null;
    } catch (e) {
        return null;
    }
};

const getCachedPositions = (): DhanPositionResponse[] => {
    try {
        const cached = localStorage.getItem('dhan_cached_positions');
        if (!cached) return [];
        if (cached.trim().startsWith('[')) {
            try {
                const encrypted = encryptData(cached);
                if (encrypted) {
                    localStorage.setItem('dhan_cached_positions', encrypted);
                }
            } catch (e) {}
            return JSON.parse(cached);
        }
        const decrypted = decryptData(cached);
        return decrypted ? JSON.parse(decrypted) : [];
    } catch (e) {
        return [];
    }
};

const getCachedLastUpdated = (): Date | null => {
    try {
        const t1 = localStorage.getItem('dhan_last_fund_limit_fetch');
        const t2 = localStorage.getItem('dhan_last_positions_fetch');
        const ts = Math.max(t1 ? parseInt(t1, 10) : 0, t2 ? parseInt(t2, 10) : 0);
        return ts > 0 ? new Date(ts) : null;
    } catch (e) {
        return null;
    }
};

export const useDhanStore = create<DhanState>((set, get) => ({
    fundLimit: getCachedFundLimit(),
    positions: getCachedPositions(),
    isLoadingFundLimit: false,
    isLoadingPositions: false,
    error: null,
    lastUpdated: getCachedLastUpdated(),
    isPolling: false,

    fetchFundLimit: async (force = false) => {
        // 1. Try to load from localStorage cache first if state is null
        if (!get().fundLimit) {
            const cached = getCachedFundLimit();
            if (cached) {
                set({ fundLimit: cached });
            }
        }

        // 2. Check if cache is expired (older than 3 hours)
        const lastFetchStr = localStorage.getItem('dhan_last_fund_limit_fetch');
        const lastFetch = lastFetchStr ? parseInt(lastFetchStr, 10) : 0;
        const now = Date.now();
        const cacheDurationMs = 3 * 60 * 60 * 1000; // 3 hours
        const isCacheExpired = now - lastFetch > cacheDurationMs;

        // 3. Only fetch from API if forced, cache is expired, or we don't have a value in state
        if (force || isCacheExpired || !get().fundLimit) {
            if (!dhanAuthService.isConfigured()) return;

            set({ isLoadingFundLimit: true });
            try {
                const limit = await dhanMarketDataService.fetchFundLimit();
                set({ fundLimit: limit, lastUpdated: new Date(), error: null });
                if (limit) {
                    const encrypted = encryptData(JSON.stringify(limit));
                    if (encrypted) {
                        localStorage.setItem('dhan_cached_fund_limit', encrypted);
                    }
                }
                localStorage.setItem('dhan_last_fund_limit_fetch', Date.now().toString());
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                // If it fails but we have cached data, keep the cached data
                if (get().fundLimit) {
                    set({ error: `Sync failed: ${message || 'Offline'}` });
                } else {
                    set({ error: message || 'Failed to fetch fund limit', fundLimit: null });
                }
            } finally {
                set({ isLoadingFundLimit: false });
            }
        }
    },

    fetchPositions: async (force = false) => {
        // 1. Try to load from localStorage cache first if state is empty
        if (get().positions.length === 0) {
            const cached = getCachedPositions();
            if (cached && cached.length > 0) {
                set({ positions: cached });
            }
        }

        // 2. Check if cache is expired (older than 3 hours)
        const lastFetchStr = localStorage.getItem('dhan_last_positions_fetch');
        const lastFetch = lastFetchStr ? parseInt(lastFetchStr, 10) : 0;
        const now = Date.now();
        const cacheDurationMs = 3 * 60 * 60 * 1000; // 3 hours
        const isCacheExpired = now - lastFetch > cacheDurationMs;

        // 3. Only fetch from API if forced, cache is expired, or we don't have a value in state
        if (force || isCacheExpired || get().positions.length === 0) {
            if (!dhanAuthService.isConfigured()) return;

            set({ isLoadingPositions: true });
            try {
                const data = await dhanMarketDataService.fetchPositions();
                const openPositions = data.filter(p => p.positionType !== 'CLOSED' && p.netQty !== 0);
                set({ positions: openPositions, lastUpdated: new Date(), error: null });
                const encrypted = encryptData(JSON.stringify(openPositions));
                if (encrypted) {
                    localStorage.setItem('dhan_cached_positions', encrypted);
                }
                localStorage.setItem('dhan_last_positions_fetch', Date.now().toString());
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                // If it fails but we have cached positions, retain them
                if (get().positions.length > 0) {
                    set({ error: `Sync failed: ${message || 'Offline'}` });
                } else {
                    set({ error: message || 'Failed to fetch positions' });
                }
            } finally {
                set({ isLoadingPositions: false });
            }
        }
    },

    fetchAll: async (force = false) => {
        const { fetchFundLimit, fetchPositions } = get();
        await Promise.all([
            fetchFundLimit(force),
            fetchPositions(force)
        ]);
        // Holdings are intentionally omitted from auto-poll as per optimization plan
    },

    refreshBrokerState: async (force = false) => {
        const { fetchAll } = get();
        await fetchAll(force);
        // Portfolio sync for holdings remains manual or on-demand
        await dhanPortfolioSyncService.refreshBrokerCache().catch(console.error);
    }
}));
