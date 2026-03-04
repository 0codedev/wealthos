import { db } from '../database';
import { getFirebaseFirestoreService } from '../lib/firebase';
import { logger } from './Logger';
import { buildSyncPreview, recordSyncStatus, recordTableSyncBatch } from './SyncGovernanceService';
import { getPersistedBrokerCreds, saveAllBrokerCreds, useSettingsStore } from '../store/settingsStore';
import { secureBrokerStorage, secureExternalApiStorage } from '../utils/Encryption';
import { CREDENTIAL_STORAGE_KEYS } from './backupManifest';
import { isSyncTombstoned } from './syncTombstones';

const CLOUD_TABLES = [
    'trades', 'sandbox_trades', 'investments', 'transactions', 'dividends',
    'goals', 'strategies', 'tax_records', 'realized_transactions',
    'paper_trades', 'mistakes', 'daily_reviews', 'life_events',
    'beneficiaries', 'friends', 'ipo_applications', 'missed_trades',
    'conversations', 'chat_messages', 'alerts', 'quiz_progress',
    'history', 'forward_duels', 'signal_providers', 'parsed_signals',
    'telegram_messages', 'telegram_ear_cache', 'jarvis_briefs',
    'brain_vectors', 'rl_experiences', 'model_versions', 'voice_sessions',
    'parsed_signal_records', 'pool_items', 'pool_verdicts', 'pool_sources',
    'ml_models', 'ml_weights', 'trade_legs', 'first_run_meta',
    'shared_journal', 'daily_digest', 'mirror_rules'
];

/**
 * Pushes all Dexie local data to Firebase Firestore.
 * Stores data under: users/{userId}/{tableName}/{docId}
 * This is a heavy operation meant for manual sync.
 */
export const syncToCloud = async (userId: string): Promise<{ success: boolean; message: string }> => {
    try {
        logger.info('Starting full sync to Firebase Cloud...');
        const { firestore, firestoreModule } = await getFirebaseFirestoreService();

        // Acquire Sync Lock to prevent concurrent device writes
        const lockRef = firestoreModule.doc(firestore, 'users', userId, 'sync_meta', 'sync_lock');
        const lockSnap = await firestoreModule.getDoc(lockRef);
        if (lockSnap.exists()) {
            const lockData = lockSnap.data();
            const lockAgeMs = Date.now() - (lockData?.timestamp || 0);
            // Lock expires after 2 minutes (120000ms)
            if (lockData?.locked && lockAgeMs < 120000) {
                logger.warn(`Sync aborted: locked by another process (${lockData.deviceId || 'unknown'}) ${Math.round(lockAgeMs/1000)}s ago.`);
                return { success: false, message: `Sync locked by another active device/session (${Math.round(lockAgeMs/1000)}s ago).` };
            }
        }

        // Set Lock
        await firestoreModule.setDoc(lockRef, {
            locked: true,
            timestamp: Date.now(),
            deviceId: typeof window !== 'undefined' ? window.navigator.userAgent.slice(0, 30) : 'node'
        });

        try {
            // 1. Gather all local data dynamically
            const tables: Record<string, any[]> = {};
            for (const tableName of CLOUD_TABLES) {
                try {
                    tables[tableName] = await db.table(tableName).toArray();
                } catch (err) {
                    logger.warn(`Could not read table ${tableName} from Dexie:`, err);
                }
            }

            // Tables that use delta/merge strategy rather than wipe-and-replace
            const MERGE_TABLES = new Set(['signal_providers', 'parsed_signals', 'telegram_messages']);

            // 2. Write each table to Firestore using batched writes
            for (const [tableName, rows] of Object.entries(tables)) {
                if (rows.length === 0) continue;

                const isMergeTable = MERGE_TABLES.has(tableName);

                if (!isMergeTable) {
                    // Delete existing docs in the collection for full-sync tables
                    const colRef = firestoreModule.collection(firestore, 'users', userId, tableName);
                    const existingDocs = await firestoreModule.getDocs(colRef);

                    // Delete in batches of 500 (Firestore limit)
                    const deleteBatches: ReturnType<typeof firestoreModule.writeBatch>[] = [];
                    let currentDeleteBatch = firestoreModule.writeBatch(firestore);
                    let deleteCount = 0;

                    existingDocs.forEach((docSnap) => {
                        currentDeleteBatch.delete(docSnap.ref);
                        deleteCount++;
                        if (deleteCount % 500 === 0) {
                            deleteBatches.push(currentDeleteBatch);
                            currentDeleteBatch = firestoreModule.writeBatch(firestore);
                        }
                    });
                    deleteBatches.push(currentDeleteBatch);
                    await Promise.all(deleteBatches.map(b => b.commit()));
                }

                // Now write data in batches of 500
                const writeBatches: ReturnType<typeof firestoreModule.writeBatch>[] = [];
                let currentBatch = firestoreModule.writeBatch(firestore);
                let writeCount = 0;

                for (const item of rows) {
                    // Use the item's id as document id, or generate one
                    const docId = String(item.id || item.channelId || item.date || `${tableName}_${writeCount}`);
                    const docRef = firestoreModule.doc(firestore, 'users', userId, tableName, docId);

                    // Clean the item (remove undefined values that Firestore doesn't like)
                    const cleanItem = JSON.parse(JSON.stringify(item));
                    if (isMergeTable) {
                        currentBatch.set(docRef, cleanItem, { merge: true });
                    } else {
                        currentBatch.set(docRef, cleanItem);
                    }
                    writeCount++;

                    if (writeCount % 500 === 0) {
                        writeBatches.push(currentBatch);
                        currentBatch = firestoreModule.writeBatch(firestore);
                    }
                }
                writeBatches.push(currentBatch);
                await Promise.all(writeBatches.map(b => b.commit()));

                logger.info(`Synced ${rows.length} records to ${tableName} (merge=${isMergeTable})`);
                await recordSyncStatus({
                    source: 'firebase',
                    scope: 'push',
                    entityType: 'table',
                    entityId: tableName,
                    sourceId: userId,
                    syncStatus: 'SYNCED',
                    diagnostic: `Uploaded ${rows.length} rows to Firebase Cloud (merge=${isMergeTable}).`,
                });
            }

            // 3. Sync Broker Configuration (safe identifiers only), Settings, and AI Keys to users/{userId}/config
            try {
                const localBroker = getPersistedBrokerCreds();
                const state = useSettingsStore.getState();
                // Never push raw PINs, TOTP seeds, or broker API secrets to cloud Firestore
                const safeBrokerConfig: Record<string, string> = {
                    dhanClientId: state.dhanClientId || localBroker.dhanClientId || '',
                    dhanApiKey: state.dhanApiKey || localBroker.dhanApiKey || '',
                    upstoxApiKey: state.upstoxApiKey || localBroker.upstoxApiKey || '',
                    upstoxRedirectUri: state.upstoxRedirectUri || localBroker.upstoxRedirectUri || '',
                };
                const hasAnyConfig = Object.values(safeBrokerConfig).some(v => Boolean(v && typeof v === 'string' && v.trim()));
                if (hasAnyConfig) {
                    const brokerRef = firestoreModule.doc(firestore, 'users', userId, 'config', 'broker_credentials');
                    await firestoreModule.setDoc(brokerRef, { data: safeBrokerConfig, updated_at: Date.now() }, { merge: true });
                }

                const settingsRaw = typeof window !== 'undefined' ? localStorage.getItem('wealth-aggregator-logic') : null;
                if (settingsRaw) {
                    const settingsRef = firestoreModule.doc(firestore, 'users', userId, 'config', 'user_settings');
                    await firestoreModule.setDoc(settingsRef, { raw: settingsRaw, updated_at: Date.now() }, { merge: true });
                }

                if (typeof window !== 'undefined') {
                    const appCreds: Record<string, string> = {};
                    for (const credKey of CREDENTIAL_STORAGE_KEYS) {
                        const val = localStorage.getItem(credKey);
                        if (val) appCreds[credKey] = val;
                    }
                    if (Object.keys(appCreds).length > 0) {
                        const appCredsRef = firestoreModule.doc(firestore, 'users', userId, 'config', 'app_credentials');
                        await firestoreModule.setDoc(appCredsRef, { data: appCreds, updated_at: Date.now() }, { merge: true });
                    }
                }

                const extKeys = secureExternalApiStorage.get<any>();
                if (extKeys && Object.keys(extKeys).length > 0) {
                    const extKeysRef = firestoreModule.doc(firestore, 'users', userId, 'config', 'external_api_keys');
                    await firestoreModule.setDoc(extKeysRef, { data: extKeys, updated_at: Date.now() }, { merge: true });
                }
            } catch (configErr) {
                logger.warn('Failed to sync credentials/settings to Firestore:', configErr);
            }
        } finally {
            // Always Release Lock
            await firestoreModule.setDoc(lockRef, { locked: false, timestamp: Date.now() });
        }

        logger.info('Firebase Cloud sync complete!');
        return { success: true, message: 'Successfully synced to Firebase Cloud!' };

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Failed to sync to Firebase:', err);
        await recordSyncStatus({
            source: 'firebase',
            scope: 'push',
            entityType: 'pipeline',
            entityId: 'cloud-sync',
            sourceId: userId,
            syncStatus: 'ERROR',
            diagnostic: message || 'Firebase push failed.',
        });
        return { success: false, message: message || 'Sync failed.' };
    }
};

export const previewPullFromCloud = async (userId: string) => {
    const { firestore, firestoreModule } = await getFirebaseFirestoreService();
    const cloudData: Record<string, any[]> = {};

    for (const tableName of CLOUD_TABLES) {
        const colRef = firestoreModule.collection(firestore, 'users', userId, tableName);
        const snapshot = await firestoreModule.getDocs(colRef);
        cloudData[tableName] = snapshot.docs.map(d => d.data());
    }

    return buildSyncPreview(cloudData, 'firebase-pull');
};

/**
 * Pulls all data from Firebase Firestore with Last-Write-Wins (LWW) resolution
 * and restores broker credentials and settings.
 */
export const pullFromCloud = async (userId: string): Promise<{ success: boolean; message: string }> => {
    try {
        logger.info('Starting full pull from Firebase Cloud...');
        const { firestore, firestoreModule } = await getFirebaseFirestoreService();

        const cloudData: Record<string, any[]> = {};

        for (const tableName of CLOUD_TABLES) {
            const colRef = firestoreModule.collection(firestore, 'users', userId, tableName);
            const snapshot = await firestoreModule.getDocs(colRef);
            cloudData[tableName] = snapshot.docs.map(d => d.data());
        }

        // 1. Restore Dexie tables with Last-Write-Wins (LWW) conflict check
        for (const [tableName, rows] of Object.entries(cloudData)) {
            if (!Array.isArray(rows) || rows.length === 0) continue;
            try {
                const table = db.table(tableName);
                if (!table) continue;

                const primKeyPath = typeof table.schema?.primKey?.keyPath === 'string' ? table.schema.primKey.keyPath : 'id';
                const rowsToPut: any[] = [];

                for (const cloudRow of rows) {
                    const primaryKey = cloudRow[primKeyPath] !== undefined ? cloudRow[primKeyPath] : cloudRow.id;
                    const cloudUpdatedAt = Number(cloudRow.updated_at || cloudRow.lastModified || cloudRow.timestamp) || 0;

                    // Deletion Guard: Ignore records that were deleted locally or marked as deleted in cloud
                    if (isSyncTombstoned(tableName, primaryKey, cloudUpdatedAt) || cloudRow.isDeleted) {
                        continue;
                    }

                    let localRow: any = await table.get(primaryKey);
                    if (!localRow && typeof primaryKey === 'number') {
                        localRow = await table.get(String(primaryKey));
                    } else if (!localRow && typeof primaryKey === 'string' && !isNaN(Number(primaryKey))) {
                        localRow = await table.get(Number(primaryKey));
                    }

                    if (localRow) {
                        const localUpdatedAt = Number(localRow.updated_at || localRow.lastModified || localRow.timestamp) || 0;
                        if (localUpdatedAt > cloudUpdatedAt) {
                            continue; // Local is strictly newer!
                        }
                    }
                    rowsToPut.push(cloudRow);
                }

                if (rowsToPut.length > 0) {
                    await table.bulkPut(rowsToPut);
                }
            } catch (err: unknown) {
                logger.warn(`Skipping table ${tableName} during restore:`, err);
            }
        }

        // 2. Restore credentials and settings from users/{userId}/config/
        try {
            // Broker credentials
            const brokerDocRef = firestoreModule.doc(firestore, 'users', userId, 'config', 'broker_credentials');
            const brokerDoc = await firestoreModule.getDoc(brokerDocRef);
            if (brokerDoc.exists()) {
                const cloudBroker = brokerDoc.data()?.data || {};
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
                saveAllBrokerCreds(mergedBroker);
                useSettingsStore.setState(mergedBroker);
            }

            // User settings
            const settingsDocRef = firestoreModule.doc(firestore, 'users', userId, 'config', 'user_settings');
            const settingsDoc = await firestoreModule.getDoc(settingsDocRef);
            if (settingsDoc.exists() && typeof window !== 'undefined') {
                const raw = settingsDoc.data()?.raw;
                if (raw) localStorage.setItem('wealth-aggregator-logic', raw);
            }

            // AI app credentials
            const appCredsDocRef = firestoreModule.doc(firestore, 'users', userId, 'config', 'app_credentials');
            const appCredsDoc = await firestoreModule.getDoc(appCredsDocRef);
            if (appCredsDoc.exists() && typeof window !== 'undefined') {
                const creds = appCredsDoc.data()?.data || {};
                Object.entries(creds).forEach(([k, v]) => {
                    if (typeof v === 'string' && v && CREDENTIAL_STORAGE_KEYS.includes(k)) {
                        localStorage.setItem(k, v);
                    }
                });
            }

            // External API keys
            const extKeysDocRef = firestoreModule.doc(firestore, 'users', userId, 'config', 'external_api_keys');
            const extKeysDoc = await firestoreModule.getDoc(extKeysDocRef);
            if (extKeysDoc.exists()) {
                const data = extKeysDoc.data()?.data;
                if (data && typeof window !== 'undefined') {
                    secureExternalApiStorage.set(data);
                    useSettingsStore.setState({ apiKeys: data });
                }
            }
        } catch (confPullErr) {
            logger.warn('Failed to restore config from Firestore:', confPullErr);
        }

        await recordTableSyncBatch('firebase', 'pull', cloudData, 'SYNCED', 'Restored from Firebase Cloud.');
        logger.info('Local database updated from Firebase!');
        return { success: true, message: 'Data restored successfully from Firebase!' };

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Failed to pull from Firebase:', err);
        await recordSyncStatus({
            source: 'firebase',
            scope: 'pull',
            entityType: 'pipeline',
            entityId: 'cloud-restore',
            sourceId: userId,
            syncStatus: 'ERROR',
            diagnostic: message || 'Firebase pull failed.',
        });
        return { success: false, message: message || 'Pull failed.' };
    }
};

/**
 * Deletes a document from Firebase Firestore under users/{userId}/{tableName}/{entityId}.
 */
export const deleteFromCloud = async (
    userId: string,
    tableName: string,
    entityId: string | number
): Promise<{ success: boolean; message: string }> => {
    try {
        const { firestore, firestoreModule } = await getFirebaseFirestoreService();
        const docRef = firestoreModule.doc(firestore, 'users', userId, tableName, String(entityId));
        await firestoreModule.deleteDoc(docRef);
        logger.info(`[FirebaseSync] Deleted document ${tableName}/${entityId} from Firestore`);
        return { success: true, message: `Deleted ${tableName}/${entityId}` };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[FirebaseSync] Failed to delete document ${tableName}/${entityId}:`, err);
        return { success: false, message };
    }
};
