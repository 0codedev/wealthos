import { db } from '../database';
import { logger } from './Logger';
import * as FirebaseSync from './FirebaseSyncService';
import { secureBrokerStorage, secureExternalApiStorage } from '../utils/Encryption';
import { useSettingsStore, getPersistedBrokerCreds, saveAllBrokerCreds } from '../store/settingsStore';
import { usePortfolioStore } from '../store/portfolioStore';
import { useFirstRunStore } from '../store/firstRunStore';
import { CREDENTIAL_STORAGE_KEYS } from './backupManifest';
import { getBridgeIdToken } from './bridgeAuthFetch';
import { isSyncTombstoned, recordSyncTombstone } from './syncTombstones';

const PRODUCTION_CLOUD_BRIDGE_URL = 'https://wealthos-sudhanshu.xyz/api/python-nse';

function getBridgeBaseUrl(): string {
    if (typeof window !== 'undefined') {
        const customUrl = localStorage.getItem('wealthos_cloud_sync_url');
        if (customUrl && customUrl.trim()) {
            return customUrl.trim().replace(/\/$/, '');
        }

        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (!isLocal && window.location.origin) {
            return `${window.location.origin}/api/python-nse`;
        }

        // Cross-environment sync is suppressed by default to protect the Cloud app from local dev data conflicts.
        // It can be re-enabled in the future via localStorage.setItem('wealthos_enable_cross_env_sync', 'true')
        const enableCrossEnvSync = localStorage.getItem('wealthos_enable_cross_env_sync') === 'true';
        if (isLocal && enableCrossEnvSync) {
            const hasLoggedIn = localStorage.getItem('wealthos_has_logged_in') === 'true' || Boolean(localStorage.getItem('wealthos_data_owner_uid'));
            if (hasLoggedIn) {
                return PRODUCTION_CLOUD_BRIDGE_URL;
            }
        }
    }
    return 'http://127.0.0.1:8765';
}

// User-critical Dexie tables to sync
const SYNCABLE_TABLE_NAMES = new Set([
    'trades', 'sandbox_trades', 'investments', 'transactions', 'dividends',
    'goals', 'strategies', 'tax_records', 'realized_transactions',
    'paper_trades', 'mistakes', 'daily_reviews', 'life_events',
    'beneficiaries', 'friends', 'ipo_applications', 'missed_trades',
    'alerts', 'signal_providers', 'parsed_signals', 'shared_journal',
    'daily_digest', 'mirror_rules', 'watchlist', 'ear_configs',
    'user_settings', 'pool_items', 'pool_verdicts', 'history',
    // Parity sweep: AI memory, journal depth, IPO vault, signal ledger
    'chat_messages', 'conversations', 'voice_sessions', 'jarvis_briefs',
    'trade_legs', 'parsed_signal_records', 'forward_duels',
    'quiz_progress', 'pool_sources', 'model_versions',
]);

export interface SyncEngineStatus {
    status: 'idle' | 'syncing' | 'synced' | 'error';
    lastSyncedAt: number | null;
    message: string;
    pendingCount: number;
    syncedStats?: {
        investments: number;
        trades: number;
        hasTokens: boolean;
    };
}

type SyncListener = (status: SyncEngineStatus) => void;

class SyncEngine {
    private listeners: Set<SyncListener> = new Set();
    private isSyncing = false;
    private pushDebounceTimer: number | null = null;
    private lastPushTime = 0;
    private lastPullTime = 0;
    private lastSyncedAt: number | null = null;
    private status: 'idle' | 'syncing' | 'synced' | 'error' = 'idle';
    private statusMessage = 'Idle';
    private currentUserId: string | null = null;
    public isRestoring = false;

    private readonly MIN_PUSH_INTERVAL_MS = 5000; // Minimum 5s between auto-pushes
    private readonly MIN_PULL_INTERVAL_MS = 20000; // 20s minimum between background incremental auto-pulls

    constructor() {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('wealthos_last_sync_timestamp');
            if (saved) {
                this.lastSyncedAt = parseInt(saved, 10);
            }
            const savedUid = localStorage.getItem('wealthos_data_owner_uid');
            if (savedUid) {
                this.currentUserId = savedUid;
            }

            // Register Dexie mutation hooks on all syncable tables to auto-stamp updated_at and schedule sync push
            try {
                for (const table of db.tables) {
                    if (!SYNCABLE_TABLE_NAMES.has(table.name)) continue;
                    table.hook('creating', (primKey, obj, trans) => {
                        if (!obj.updated_at) {
                            obj.updated_at = Date.now();
                        }
                        if (trans && typeof trans.on === 'function') {
                            trans.on('complete', () => {
                                this.notifyDataChanged(table.name);
                            });
                        }
                    });
                    table.hook('updating', (mods: any, primKey, obj, trans) => {
                        if (!mods.updated_at) {
                            mods.updated_at = Date.now();
                        }
                        if (trans && typeof trans.on === 'function') {
                            trans.on('complete', () => {
                                this.notifyDataChanged(table.name);
                            });
                        }
                    });
                    table.hook('deleting', (primKey, obj, trans) => {
                        const keyStr = String(primKey);
                        recordSyncTombstone(table.name, keyStr);
                        if (trans && typeof trans.on === 'function') {
                            trans.on('complete', () => {
                                this.notifyDeleted(table.name, keyStr).catch(() => {});
                                this.notifyDataChanged(table.name);
                            });
                        }
                    });
                }
            } catch (err) {
                logger.warn('[SyncEngine] Failed to register Dexie table hooks:', err);
            }

            // Window focus & mobile visibility auto-sync: incremental pull with 60s clock skew buffer
            const handleVisibilityOrFocus = () => {
                if (!this.isAutoPullEnabled()) {
                    return; // Auto-pull disabled by user preference
                }
                // Protect active inputs: never pull while user is typing
                const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
                if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                    return;
                }
                if (this.currentUserId && (Date.now() - this.lastPullTime > this.MIN_PULL_INTERVAL_MS)) {
                    logger.info('[SyncEngine] App visibility/focus detected. Pulling incremental cloud state...');
                    const safeSince = this.lastSyncedAt ? Math.max(0, this.lastSyncedAt - 60000) : 0;
                    this.performPull(this.currentUserId, safeSince).catch(() => {});
                }
            };

            window.addEventListener('focus', handleVisibilityOrFocus);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    handleVisibilityOrFocus();
                }
            });

            // Network online restoration auto-flush
            window.addEventListener('online', () => {
                if (this.currentUserId) {
                    logger.info('[SyncEngine] Network connection restored. Flushing queued sync push...');
                    this.queuePush(this.currentUserId, 1000);
                }
            });
        }
    }

    public subscribe(listener: SyncListener): () => void {
        this.listeners.add(listener);
        listener(this.getStatus());
        return () => {
            this.listeners.delete(listener);
        };
    }

    public getStatus(): SyncEngineStatus {
        return {
            status: this.status,
            lastSyncedAt: this.lastSyncedAt,
            message: this.statusMessage,
            pendingCount: this.pushDebounceTimer !== null ? 1 : 0
        };
    }

    private updateStatus(status: 'idle' | 'syncing' | 'synced' | 'error', message: string) {
        this.status = status;
        this.statusMessage = message;
        if (status === 'synced') {
            this.lastSyncedAt = Date.now();
            if (typeof window !== 'undefined') {
                localStorage.setItem('wealthos_last_sync_timestamp', String(this.lastSyncedAt));
            }
        }
        const current = this.getStatus();
        this.listeners.forEach((l) => {
            try { l(current); } catch (e) { /* ignore */ }
        });
    }

    /**
     * User Preference: Controls whether background pulls (tab focus / visibility) can run automatically.
     * Defaults to false so the user's active local workstation is never touched in the background.
     */
    public isAutoPullEnabled(): boolean {
        if (typeof window === 'undefined') return false;
        return localStorage.getItem('wealthos_auto_pull_enabled') === 'true';
    }

    public setAutoPullEnabled(enabled: boolean): void {
        if (typeof window === 'undefined') return;
        localStorage.setItem('wealthos_auto_pull_enabled', enabled ? 'true' : 'false');
    }

    /**
     * Clear all local storage, Dexie tables, and in-memory caches when switching users or signing out.
     */
    public async clearLocalDataForUserSwitch(newUserId: string): Promise<void> {
        logger.info(`[SyncEngine] Clearing local data for user switch. Target new user: ${newUserId || 'none (sign-out)'}`);
        
        // 1. Clear all syncable Dexie tables
        for (const table of db.tables) {
            if (SYNCABLE_TABLE_NAMES.has(table.name)) {
                try {
                    await table.clear();
                } catch (e) {
                    logger.warn(`Failed to clear table ${table.name}:`, e);
                }
            }
        }

        // 2. Clear credentials and user settings in localStorage and secure storage
        if (typeof window !== 'undefined') {
            const keysToRemove = [
                'wealth-aggregator-logic',
                'wealthos_persistent_broker_creds_v2',
                'wealthos_dhan_pulse_last_synced_token_v2',
                'wealthos_last_sync_timestamp',
                'wealth-secure-broker-creds',
                'wealthos_has_logged_in',
                'upstox_access_token',
                'wealthos_first_install_done',
                ...CREDENTIAL_STORAGE_KEYS
            ];
            for (const key of keysToRemove) {
                try {
                    localStorage.removeItem(key);
                } catch {
                    // ignore
                }
            }

            if (newUserId) {
                localStorage.setItem('wealthos_data_owner_uid', newUserId);
            } else {
                localStorage.removeItem('wealthos_data_owner_uid');
            }
        }

        try {
            secureBrokerStorage.remove();
            secureExternalApiStorage.remove();
        } catch {
            // ignore
        }

        try {
            useSettingsStore.getState().resetDefaults();
        } catch {
            // ignore
        }

        this.currentUserId = newUserId || null;
        this.lastSyncedAt = null;
        this.lastPullTime = 0;
        this.lastPushTime = 0;
    }

    /**
     * Called automatically by FirebaseAuthContext on login.
     */
    public async onUserLogin(userId: string): Promise<void> {
        if (!userId) return;

        // Check if device has data from a DIFFERENT user
        if (typeof window !== 'undefined') {
            const previousOwnerUid = localStorage.getItem('wealthos_data_owner_uid');
            if (previousOwnerUid && previousOwnerUid !== userId) {
                logger.warn(`[SyncEngine] User switch detected (${previousOwnerUid} -> ${userId}). Isolating data...`);
                await this.clearLocalDataForUserSwitch(userId);
            } else {
                localStorage.setItem('wealthos_data_owner_uid', userId);
            }
        }

        this.currentUserId = userId;
        logger.info(`[SyncEngine] User authenticated: ${userId}. Checking local database...`);

        try {
            // Dismiss first-run onboarding screen for returning authenticated users
            try {
                useFirstRunStore.getState().dismissFirstRun('empty');
            } catch (e) {
                // ignore
            }

            // Count rows only across SYNCABLE tables
            let totalLocalRows = 0;
            for (const table of db.tables) {
                if (!SYNCABLE_TABLE_NAMES.has(table.name)) continue;
                try {
                    const count = await table.count();
                    totalLocalRows += count;
                } catch (e) {
                    // ignore
                }
            }

            logger.info(`[SyncEngine] Total whitelisted local rows: ${totalLocalRows}`);

            if (totalLocalRows === 0) {
                // Device is clean/empty -> Auto-restore from Cloud
                logger.info('[SyncEngine] Local state is empty. Pulling from Cloud...');
                this.updateStatus('syncing', 'Restoring data from Cloud...');
                
                const pullResult = await this.performPull(userId, 0);
                if (pullResult.success) {
                    this.updateStatus('synced', 'All data restored from Cloud');
                    return;
                }
            } else {
                // Device has local state -> Only pull if auto-pull is explicitly enabled by user
                if (this.isAutoPullEnabled()) {
                    logger.info('[SyncEngine] Local rows detected and Auto-Pull enabled. Pulling latest cloud state...');
                    const safeSince = this.lastSyncedAt ? Math.max(0, this.lastSyncedAt - 60000) : 0;
                    await this.performPull(userId, safeSince).catch(() => {});
                } else {
                    logger.info('[SyncEngine] Auto-pull disabled by user preference. Preserving local workstation state.');
                }
                this.queuePush(userId, 4000);
            }
        } catch (err: any) {
            logger.warn('[SyncEngine] Sync on login error:', err);
            this.updateStatus('error', err?.message || 'Sync failed');
        }
    }

    public notifyDataChanged(tableName?: string): void {
        if (this.isRestoring) return;
        const uid = this.currentUserId || (typeof window !== 'undefined' ? localStorage.getItem('wealthos_data_owner_uid') : null);
        if (uid) {
            this.queuePush(uid, 2500);
        }
    }

    /**
     * Propagate record deletion to Cloud VPS and Firebase Firestore,
     * and persist a local tombstone so background pulls will not resurrect it.
     */
    public async notifyDeleted(tableName: string, entityId: string | number): Promise<void> {
        const idStr = String(entityId);
        recordSyncTombstone(tableName, idStr);

        const uid = this.currentUserId || (typeof window !== 'undefined' ? localStorage.getItem('wealthos_data_owner_uid') : null);
        if (!uid) return;

        // 1. Send deletion to VPS
        try {
            const apiBase = getBridgeBaseUrl();
            const idToken = await getBridgeIdToken();
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

            await fetch(`${apiBase}/api/sync/delete`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    user_id: uid,
                    entity_type: tableName,
                    entity_id: idStr
                })
            });
        } catch (err) {
            logger.warn(`[SyncEngine] VPS deletion notify failed for ${tableName}:${idStr}:`, err);
        }

        // 2. Send deletion to Firebase
        const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
        const enableCrossEnv = typeof window !== 'undefined' && localStorage.getItem('wealthos_enable_cross_env_sync') === 'true';
        if (!isLocal || enableCrossEnv) {
            FirebaseSync.deleteFromCloud(uid, tableName, idStr).catch((err) => {
                logger.warn(`[SyncEngine] Firebase deleteDoc skipped for ${tableName}:${idStr}:`, err);
            });
        }
    }

    public queuePush(userId?: string, delayMs = 5000): void {
        const uid = userId || this.currentUserId || (typeof window !== 'undefined' ? localStorage.getItem('wealthos_data_owner_uid') : null);
        if (!uid) return;

        if (typeof window !== 'undefined' && !window.navigator.onLine) {
            logger.info('[SyncEngine] Device is offline. Sync push queued.');
            return;
        }

        if (this.pushDebounceTimer) {
            window.clearTimeout(this.pushDebounceTimer);
        }

        this.pushDebounceTimer = window.setTimeout(async () => {
            this.pushDebounceTimer = null;
            const elapsed = Date.now() - this.lastPushTime;
            if (elapsed < this.MIN_PUSH_INTERVAL_MS) {
                const remaining = this.MIN_PUSH_INTERVAL_MS - elapsed;
                this.queuePush(uid, remaining + 500);
                return;
            }
            await this.performPush(uid);
        }, delayMs);
    }

    /**
     * Immediate push to VPS & Firebase including Dexie tables, Settings, and Broker Tokens.
     */
    public async performPush(userId?: string): Promise<{ success: boolean; message: string }> {
        const uid = userId || this.currentUserId;
        if (!uid) return { success: false, message: 'User not authenticated' };

        if (this.isSyncing) return { success: false, message: 'Sync already in progress' };
        this.isSyncing = true;
        this.lastPushTime = Date.now();
        this.updateStatus('syncing', 'Uploading data and credentials to Cloud...');

        try {
            const vpsRes = await this.pushToVps(uid);
            
            // Push to Firebase in background for redundancy (isolated to Cloud domain or when cross-env is explicitly enabled)
            const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
            const enableCrossEnv = typeof window !== 'undefined' && localStorage.getItem('wealthos_enable_cross_env_sync') === 'true';
            if (!isLocal || enableCrossEnv) {
                FirebaseSync.syncToCloud(uid).catch((err) => {
                    logger.warn('[SyncEngine] Firebase auxiliary sync skipped:', err);
                });
            }

            this.updateStatus(vpsRes.success ? 'synced' : 'error', vpsRes.message);
            this.isSyncing = false;
            return vpsRes;
        } catch (err: any) {
            const msg = err?.message || 'Sync push failed';
            this.updateStatus('error', msg);
            this.isSyncing = false;
            return { success: false, message: msg };
        }
    }

    /**
     * Immediate pull from Cloud (Forces refresh from VPS & Firebase).
     */
    public async performPull(userId?: string, since = 0): Promise<{ success: boolean; message: string }> {
        const uid = userId || this.currentUserId;
        if (!uid) return { success: false, message: 'User not authenticated' };

        if (this.isSyncing) return { success: false, message: 'Sync already in progress' };
        this.isSyncing = true;
        this.lastPullTime = Date.now();
        this.updateStatus('syncing', 'Downloading latest portfolio & credentials from Cloud...');

        const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
        const enableCrossEnv = typeof window !== 'undefined' && localStorage.getItem('wealthos_enable_cross_env_sync') === 'true';

        try {
            const vpsRes = await this.pullFromVps(uid, since);
            if (vpsRes.success) {
                this.updateStatus('synced', 'Database and session tokens restored');
                this.isSyncing = false;
                
                // Re-hydrate portfolio store & settings so UI renders immediately
                try {
                    await usePortfolioStore.getState().refreshPortfolio();
                } catch (e) {
                    // ignore
                }
                return vpsRes;
            } else if (!isLocal || enableCrossEnv) {
                // Try Firebase as fallback only on Cloud domain or when cross-env is explicitly enabled
                const fbRes = await FirebaseSync.pullFromCloud(uid);
                this.updateStatus(fbRes.success ? 'synced' : 'error', fbRes.message);
                this.isSyncing = false;
                if (fbRes.success) {
                    usePortfolioStore.getState().refreshPortfolio().catch(() => {});
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('wealthos-cloud-restored', {
                            detail: { count: 1, timestamp: Date.now() }
                        }));
                    }
                }
                return fbRes;
            } else {
                this.updateStatus('idle', 'Local sync complete (cloud fallback isolated)');
                this.isSyncing = false;
                return vpsRes;
            }
        } catch (err: any) {
            // If VPS threw, attempt Firebase fallback only on Cloud domain or when cross-env is enabled
            if (!isLocal || enableCrossEnv) {
                try {
                    const fbRes = await FirebaseSync.pullFromCloud(uid);
                    if (fbRes.success) {
                        this.updateStatus('synced', 'Database and session tokens restored via Firebase fallback');
                        this.isSyncing = false;
                        usePortfolioStore.getState().refreshPortfolio().catch(() => {});
                        if (typeof window !== 'undefined') {
                            window.dispatchEvent(new CustomEvent('wealthos-cloud-restored', {
                                detail: { count: 1, timestamp: Date.now() }
                            }));
                        }
                        return fbRes;
                    }
                } catch {
                    // ignore
                }
            }
            const msg = err?.message || 'Sync pull failed';
            this.updateStatus('error', msg);
            this.isSyncing = false;
            return { success: false, message: msg };
        }
    }

    private async pushToVps(userId: string): Promise<{ success: boolean; message: string }> {
        try {
            const apiBase = getBridgeBaseUrl();
            const items: any[] = [];
            const now = Date.now();

            // 1. Gather all Dexie tables
            for (const table of db.tables) {
                if (!SYNCABLE_TABLE_NAMES.has(table.name)) continue;

                const rows = await table.toArray();
                for (const row of rows) {
                    const rowId = String(row.id || row.channelId || row.date || Math.random());
                    const rowUpdatedAt = typeof row.updated_at === 'number' ? row.updated_at : (
                        typeof row.lastModified === 'number' ? row.lastModified : (
                            typeof row.timestamp === 'number' ? row.timestamp : (
                                row.date && !isNaN(new Date(row.date).getTime()) ? new Date(row.date).getTime() : now
                            )
                        )
                    );
                    const currentDeviceId = typeof window !== 'undefined'
                        ? (localStorage.getItem('wealthos_device_id') || window.navigator.userAgent.slice(0, 30))
                        : 'web';
                    items.push({
                        entity_type: table.name,
                        entity_id: rowId,
                        data: row,
                        updated_at: !isNaN(rowUpdatedAt) && rowUpdatedAt > 0 ? rowUpdatedAt : now,
                        device_id: currentDeviceId
                    });
                }
            }

            // 2. Gather Zustand Settings & Themes
            if (typeof window !== 'undefined') {
                const currentDeviceId = localStorage.getItem('wealthos_device_id') || 'web';
                const settingsRaw = localStorage.getItem('wealth-aggregator-logic');
                if (settingsRaw) {
                    items.push({
                        entity_type: 'user_settings',
                        entity_id: 'app_settings',
                        data: { raw: settingsRaw },
                        updated_at: now,
                        device_id: currentDeviceId
                    });
                }

                // 3. Gather Broker Configuration (safe identifiers & active daily tokens)
                const localCreds = getPersistedBrokerCreds();
                const state = useSettingsStore.getState();
                const activeUpstoxToken = state.upstoxAccessToken || localStorage.getItem('upstox_access_token') || '';
                const upstoxCreatedAt = Number(localStorage.getItem('upstox_token_created_at')) || 0;
                // Upstox tokens are valid for up to 18 hours (daily reset at 3:30 AM IST)
                const isUpstoxTokenFresh = Boolean(activeUpstoxToken && (!upstoxCreatedAt || (now - upstoxCreatedAt < 18 * 3600 * 1000)));

                const safeBrokerConfig: Record<string, string> = {
                    dhanClientId: state.dhanClientId || localCreds.dhanClientId || '',
                    dhanApiKey: state.dhanApiKey || localCreds.dhanApiKey || '',
                    upstoxApiKey: state.upstoxApiKey || localCreds.upstoxApiKey || '',
                    upstoxRedirectUri: state.upstoxRedirectUri || localCreds.upstoxRedirectUri || '',
                    upstoxAccessToken: isUpstoxTokenFresh ? activeUpstoxToken : '',
                    upstoxTokenCreatedAt: isUpstoxTokenFresh ? String(upstoxCreatedAt || now) : '',
                };

                const hasAnyConfig = Object.values(safeBrokerConfig).some(v => Boolean(v && typeof v === 'string' && v.trim()));
                if (hasAnyConfig) {
                    items.push({
                        entity_type: 'broker_credentials',
                        entity_id: 'broker_keys',
                        data: safeBrokerConfig,
                        updated_at: now,
                        device_id: currentDeviceId
                    });
                }

                // 4. Gather External API Keys
                const extKeys = secureExternalApiStorage.get<any>();
                if (extKeys && Object.keys(extKeys).length > 0) {
                    items.push({
                        entity_type: 'external_api_keys',
                        entity_id: 'api_keys',
                        data: extKeys,
                        updated_at: now,
                        device_id: 'web'
                    });
                }

                // 5. Gather AI provider credential bundle (localStorage keys).
                // Without this a freshly pulled device has no working AI providers.
                const appCreds: Record<string, string> = {};
                for (const credKey of CREDENTIAL_STORAGE_KEYS) {
                    const val = localStorage.getItem(credKey);
                    if (val) appCreds[credKey] = val;
                }
                if (Object.keys(appCreds).length > 0) {
                    items.push({
                        entity_type: 'app_credentials',
                        entity_id: 'ai_provider_keys',
                        data: appCreds,
                        updated_at: now,
                        device_id: 'web'
                    });
                }
            }

            const idToken = await getBridgeIdToken();
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (idToken) {
                headers['Authorization'] = `Bearer ${idToken}`;
            }

            if (items.length === 0) {
                return { success: true, message: 'Nothing to sync' };
            }

            // Batch in chunks of 500 to prevent payload exhaustion or network timeouts
            const CHUNK_SIZE = 500;
            let totalSynced = 0;
            for (let i = 0; i < items.length; i += CHUNK_SIZE) {
                const chunk = items.slice(i, i + CHUNK_SIZE);
                const response = await fetch(`${apiBase}/api/sync/push`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ user_id: userId, items: chunk })
                });

                if (!response.ok) throw new Error(`HTTP ${response.status} from VPS sync`);
                const data = await response.json();
                totalSynced += (data.synced_count || 0);
            }

            return { success: true, message: `Synced ${totalSynced} records to Cloud VPS` };
        } catch (err: any) {
            return { success: false, message: err?.message || 'VPS push failed' };
        }
    }

    private async pullFromVps(userId: string, since = 0): Promise<{ success: boolean; message: string }> {
        try {
            const apiBase = getBridgeBaseUrl();
            const idToken = await getBridgeIdToken();
            const headers: Record<string, string> = {};
            if (idToken) {
                headers['Authorization'] = `Bearer ${idToken}`;
            }

            // Looping pagination to download all records without truncation
            let currentSince = since;
            const allItems: any[] = [];
            let hasMore = true;
            let iteration = 0;
            const MAX_ITERATIONS = 10; // Up to 25,000 items

            while (hasMore && iteration < MAX_ITERATIONS) {
                iteration++;
                const response = await fetch(`${apiBase}/api/sync/pull?user_id=${encodeURIComponent(userId)}&since=${currentSince}&limit=2500`, {
                    headers
                });
                if (!response.ok) throw new Error(`HTTP ${response.status} from VPS sync`);
                const result = await response.json();
                const batch = result.items || [];
                if (batch.length === 0) {
                    hasMore = false;
                    break;
                }
                allItems.push(...batch);
                if (batch.length < 2500) {
                    hasMore = false;
                    break;
                }
                const lastItem = batch[batch.length - 1];
                const nextSince = Number(lastItem.updated_at);
                if (!nextSince || nextSince <= currentSince) {
                    hasMore = false;
                    break;
                }
                currentSince = nextSince;
            }

            if (allItems.length === 0) {
                return { success: false, message: 'No new cloud records found on VPS' };
            }

            // Identity guard: Verify the active authenticated user has not changed during async fetch
            if (this.currentUserId !== userId) {
                logger.warn(`[SyncEngine] Aborting pull restore: user switched during fetch (${this.currentUserId} !== ${userId})`);
                return { success: false, message: 'User context changed' };
            }

            const grouped: Record<string, any[]> = {};
            for (const item of allItems) {
                const table = item.entity_type;
                if (!grouped[table]) grouped[table] = [];
                grouped[table].push(item);
            }

            this.isRestoring = true;
            try {
                // 1. Restore Dexie tables with Last-Write-Wins (LWW) resolution
                for (const [tableName, itemsList] of Object.entries(grouped)) {
                    if (tableName === 'user_settings' || tableName === 'broker_credentials' || tableName === 'external_api_keys' || tableName === 'app_credentials') {
                        continue;
                    }
                    try {
                        const table = db.table(tableName);
                        if (!table) continue; // phantom entity_type (schema drift) - skip silently

                        let hasLocalNewerChanges = false;
                        const rowsToPut: any[] = [];

                        // High-Performance In-Memory Pre-fetch Map:
                        // Loads the table in a single IPC call instead of thousands of sequential round-trips.
                        const localRowsArray = await table.toArray();
                        const localMap = new Map<string | number, any>();
                        for (const r of localRowsArray) {
                            if (r.id !== undefined && r.id !== null) {
                                localMap.set(r.id, r);
                                localMap.set(String(r.id), r);
                                if (!isNaN(Number(r.id))) localMap.set(Number(r.id), r);
                            }
                            if (r.date !== undefined && r.date !== null) {
                                localMap.set(r.date, r);
                                localMap.set(String(r.date), r);
                            }
                            if (r.channelId !== undefined && r.channelId !== null) {
                                localMap.set(r.channelId, r);
                                localMap.set(String(r.channelId), r);
                            }
                        }

                        for (const item of itemsList) {
                            const entityId = item.entity_id;
                            const cloudRow = item.data;
                            const cloudUpdatedAt = Number(item.updated_at) || 0;

                            // Lookup existing local record safely across primary keys (id, date, etc.)
                            const primKeyPath = typeof table.schema?.primKey?.keyPath === 'string' ? table.schema.primKey.keyPath : 'id';
                            const primaryKey = (cloudRow && cloudRow[primKeyPath] !== undefined)
                                ? cloudRow[primKeyPath]
                                : (cloudRow?.id !== undefined ? cloudRow.id : (!isNaN(Number(entityId)) ? Number(entityId) : entityId));

                            // Deletion Guard: Never restore records that have been deleted locally or marked as deleted in cloud
                            if (isSyncTombstoned(tableName, primaryKey, cloudUpdatedAt) || isSyncTombstoned(tableName, entityId, cloudUpdatedAt) || cloudRow?.isDeleted) {
                                await table.delete(primaryKey).catch(() => {});
                                this.notifyDeleted(tableName, entityId).catch(() => {});
                                continue;
                            }

                            // O(1) in-memory lookup
                            const localRow = localMap.get(primaryKey)
                                || localMap.get(String(primaryKey))
                                || (!isNaN(Number(primaryKey)) ? localMap.get(Number(primaryKey)) : undefined);

                            if (localRow) {
                                // Extract local record timestamp
                                let localUpdatedAt = Number(localRow.updated_at || localRow.lastModified || localRow.timestamp) || 0;
                                if (!localUpdatedAt && Array.isArray(localRow.history) && localRow.history.length > 0) {
                                    for (let hIdx = localRow.history.length - 1; hIdx >= 0; hIdx--) {
                                        const hDate = localRow.history[hIdx]?.date;
                                        if (hDate) {
                                            const parsed = new Date(hDate).getTime();
                                            if (!isNaN(parsed) && parsed > localUpdatedAt) {
                                                localUpdatedAt = parsed;
                                            }
                                        }
                                    }
                                }
                                if (!localUpdatedAt && localRow.date) {
                                    const parsed = new Date(localRow.date).getTime();
                                    if (!isNaN(parsed) && parsed > localUpdatedAt) {
                                        localUpdatedAt = parsed;
                                    }
                                }

                                // If local record is strictly NEWER than cloud snapshot, DO NOT OVERWRITE!
                                if (localUpdatedAt > cloudUpdatedAt) {
                                    hasLocalNewerChanges = true;
                                    continue;
                                }
                            }

                            rowsToPut.push(cloudRow);
                        }

                        if (rowsToPut.length > 0) {
                            await table.bulkPut(rowsToPut);
                        }

                        // If local has newer records that cloud lacked, schedule background push to update cloud
                        if (hasLocalNewerChanges) {
                            this.queuePush(userId, 2500);
                        }
                    } catch (e) {
                        logger.warn(`Could not restore table ${tableName}:`, e);
                    }
                }
            } finally {
                this.isRestoring = false;
            }

            // 2. Restore User Settings (only if user matches)
            if (grouped['user_settings'] && grouped['user_settings'].length > 0 && this.currentUserId === userId) {
                const settingsPayload = grouped['user_settings'][0].data;
                if (settingsPayload?.raw && typeof window !== 'undefined') {
                    localStorage.setItem('wealth-aggregator-logic', settingsPayload.raw);
                }
            }

            // 3. Restore Broker Configuration non-destructively (local PIN, TOTP, and tokens strictly preserved)
            if (grouped['broker_credentials'] && grouped['broker_credentials'].length > 0 && this.currentUserId === userId) {
                const cloudBroker = grouped['broker_credentials'][0].data || {};
                const localBroker = getPersistedBrokerCreds();
                const currentState = useSettingsStore.getState();

                // Non-destructive merge: local secrets (PIN, TOTP, tokens) are strictly preserved
                const mergedBroker: Record<string, string> = {
                    dhanClientId: (cloudBroker.dhanClientId && String(cloudBroker.dhanClientId).trim()) || localBroker.dhanClientId || currentState.dhanClientId || '',
                    dhanAccessToken: localBroker.dhanAccessToken || currentState.dhanAccessToken || (cloudBroker.dhanAccessToken && String(cloudBroker.dhanAccessToken).trim()) || (typeof window !== 'undefined' ? localStorage.getItem('wealthos_dhan_pulse_last_synced_token_v2') || '' : ''),
                    dhanPin: localBroker.dhanPin || currentState.dhanPin || (cloudBroker.dhanPin && String(cloudBroker.dhanPin).trim()) || '',
                    dhanTotpSecret: localBroker.dhanTotpSecret || currentState.dhanTotpSecret || (cloudBroker.dhanTotpSecret && String(cloudBroker.dhanTotpSecret).trim()) || '',
                    dhanApiKey: (cloudBroker.dhanApiKey && String(cloudBroker.dhanApiKey).trim()) || localBroker.dhanApiKey || currentState.dhanApiKey || '',
                    dhanApiSecret: localBroker.dhanApiSecret || currentState.dhanApiSecret || (cloudBroker.dhanApiSecret && String(cloudBroker.dhanApiSecret).trim()) || '',
                    upstoxApiKey: (cloudBroker.upstoxApiKey && String(cloudBroker.upstoxApiKey).trim()) || localBroker.upstoxApiKey || currentState.upstoxApiKey || '',
                    upstoxApiSecret: localBroker.upstoxApiSecret || currentState.upstoxApiSecret || (cloudBroker.upstoxApiSecret && String(cloudBroker.upstoxApiSecret).trim()) || '',
                    upstoxAccessToken: localBroker.upstoxAccessToken || currentState.upstoxAccessToken || (cloudBroker.upstoxAccessToken && String(cloudBroker.upstoxAccessToken).trim()) || (typeof window !== 'undefined' ? localStorage.getItem('upstox_access_token') || '' : ''),
                    upstoxRedirectUri: (cloudBroker.upstoxRedirectUri && String(cloudBroker.upstoxRedirectUri).trim()) || localBroker.upstoxRedirectUri || currentState.upstoxRedirectUri || '',
                };

                // Sync newly restored token to localStorage if present
                if (typeof window !== 'undefined' && mergedBroker.upstoxAccessToken) {
                    localStorage.setItem('upstox_access_token', mergedBroker.upstoxAccessToken);
                    if (cloudBroker.upstoxTokenCreatedAt) {
                        localStorage.setItem('upstox_token_created_at', String(cloudBroker.upstoxTokenCreatedAt));
                    }
                }

                saveAllBrokerCreds(mergedBroker);
                useSettingsStore.setState(mergedBroker);
            }

            // 4. Restore External API Keys
            if (grouped['external_api_keys'] && grouped['external_api_keys'].length > 0 && this.currentUserId === userId) {
                const extData = grouped['external_api_keys'][0].data;
                if (extData && typeof window !== 'undefined') {
                    secureExternalApiStorage.set(extData);
                    useSettingsStore.setState({ apiKeys: extData });
                }
            }

            // 5. Restore AI provider & market screener credential bundle (localStorage keys)
            if (grouped['app_credentials'] && grouped['app_credentials'].length > 0 && typeof window !== 'undefined' && this.currentUserId === userId) {
                const creds = grouped['app_credentials'][0].data;
                if (creds) {
                    let restored = 0;
                    Object.entries(creds).forEach(([key, val]) => {
                        if (typeof val === 'string' && val && CREDENTIAL_STORAGE_KEYS.includes(key)) {
                            localStorage.setItem(key, val);
                            restored++;

                            if (key === 'stockezee_token') {
                                window.dispatchEvent(new CustomEvent('wealthos-stockezee-token-restored', { detail: val }));
                            } else if (key === 'upstox_access_token') {
                                useSettingsStore.setState({ upstoxAccessToken: val });
                                window.dispatchEvent(new CustomEvent('wealthos-upstox-token-restored', { detail: val }));
                            }
                        }
                    });
                    logger.info(`[SyncEngine] Restored ${restored} credential(s) from Cloud VPS (including market tokens)`);
                }
            }

            // 6. Dispatch reactive event so any listening UI widgets re-query or refresh
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('wealthos-cloud-restored', {
                    detail: { count: allItems.length, timestamp: Date.now() }
                }));
            }

            return { success: true, message: `Restored ${allItems.length} records & tokens from Cloud VPS` };
        } catch (err: any) {
            return { success: false, message: err?.message || 'VPS pull failed' };
        }
    }
}

export const syncEngine = new SyncEngine();
