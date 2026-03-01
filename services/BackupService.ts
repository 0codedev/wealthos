import { db } from '../database';
import { logger } from "./Logger";
import { buildSyncPreview, recordTableSyncBatch } from './SyncGovernanceService';
import { protectSensitiveStorageValue, restoreSensitiveStorageValue, shouldProtectStorageKey, SecureEncryption } from './SecurityService';
import { sanitizeBackupRows, isSafeTableName, SanitizeOptions } from '../utils/backupValidation';
import {
    BACKUP_FORMAT_VERSION,
    BackupMode,
    collectRawStorageSnapshot,
    getExcludedTables,
} from './backupManifest';

const LAST_BACKUP_AT_KEY = 'wealth-last-backup-at';
const LAST_RESTORE_AT_KEY = 'wealth-last-restore-at';

// ---------------------------------------------------------------------------
// Integrity + compression primitives (game-save format v3)
// ---------------------------------------------------------------------------

/** SHA-256 hex of a string. Returns '' when WebCrypto is unavailable (non-secure context). */
async function sha256Hex(text: string): Promise<string> {
    try {
        if (typeof crypto === 'undefined' || !crypto.subtle) return '';
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
        return '';
    }
}

function supportsGzip(): boolean {
    try {
        return (
            typeof CompressionStream === 'function' &&
            typeof DecompressionStream === 'function' &&
            typeof Response === 'function' &&
            typeof Blob === 'function' &&
            typeof Blob.prototype?.stream === 'function'
        );
    } catch {
        return false;
    }
}

async function gzipString(text: string): Promise<Uint8Array> {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipToText(bytes: Uint8Array): Promise<string> {
    const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
}

function isGzipBytes(bytes: Uint8Array): boolean {
    // gzip magic number: 0x1F 0x8B
    return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Computes the integrity checksum over the canonical data payload. Stored in
 * meta.checksum so a truncated / corrupted save can never restore silently.
 */
async function computePayloadChecksum(payload: { data: unknown; storage: unknown }): Promise<string> {
    return sha256Hex(JSON.stringify({ data: payload.data, storage: payload.storage }));
}

// ---------------------------------------------------------------------------
// Snapshot builder - shared by JSON export AND cloud upload
// ---------------------------------------------------------------------------

interface DexieTableLike {
    name: string;
    toArray(): Promise<any[]>;
}

export interface BackupPayload {
    meta: {
        formatVersion: number;
        version: number;          // Dexie schema version at snapshot time
        timestamp: string;
        app: 'WealthAggregator';
        mode: BackupMode;
        checksum: string;
        counts: { tables: number; rows: number };
        protectedStorageKeys: string[];
    };
    data: Record<string, any[]>;
    storage: Record<string, string>;
    /** Server-side configs captured best-effort (ear server routing rules). */
    bridgeConfigs?: {
        ears?: any[] | null;
    };
}

/**
 * Builds the complete backup payload (Dexie + localStorage) for a mode.
 * Minified serialization happens at call site - this returns the object.
 */
export const buildBackupPayload = async (mode: BackupMode): Promise<BackupPayload> => {
    const excluded = getExcludedTables(mode);
    const data: Record<string, any[]> = {};
    let totalRows = 0;

    for (const table of db.tables as DexieTableLike[]) {
        if (excluded.includes(table.name)) {
            logger.info(`[BACKUP] Skipping table ${table.name} (${mode} mode)`);
            continue;
        }
        const rows = await table.toArray();
        data[table.name] = rows;
        totalRows += rows.length;
    }

    const rawStorage = collectRawStorageSnapshot(mode);
    const protectedStorageKeys: string[] = [];
    const storage: Record<string, string> = {};
    Object.entries(rawStorage).forEach(([key, val]) => {
        if (shouldProtectStorageKey(key)) protectedStorageKeys.push(key);
        storage[key] = protectSensitiveStorageValue(key, val);
    });

    const payload: BackupPayload = {
        meta: {
            formatVersion: BACKUP_FORMAT_VERSION,
            version: db.verno,
            timestamp: new Date().toISOString(),
            app: 'WealthAggregator',
            mode,
            checksum: '',
            counts: { tables: Object.keys(data).length, rows: totalRows },
            protectedStorageKeys,
        },
        data,
        storage,
    };

    // Checksum over the canonical data+storage projection (order-stable).
    payload.meta.checksum = await computePayloadChecksum(payload);

    // Best-effort capture of ear-server routing config (channel IDs, tiers).
    // Telegram bot tokens/names already live in settings.telegramBots (storage),
    // which auto-repushes to the bridge after any restore.
    try {
        const { telegramEarManager } = await import('./TelegramEarManager');
        const ears = await telegramEarManager.exportEarConfig();
        if (ears && ears.length > 0) {
            payload.bridgeConfigs = { ears };
        }
    } catch {
        // Ear server not reachable from this device - snapshot continues without it.
    }

    return payload;
};

// ---------------------------------------------------------------------------
// Export (download)
// ---------------------------------------------------------------------------

export interface BackupDownloadSummary {
    fileName: string;
    originalBytes: number;
    finalBytes: number;
    compressed: boolean;
    tables: number;
    rows: number;
    storageKeys: number;
}

/**
 * Generates and downloads a save file of the DB and LocalStorage.
 *
 * Format v3: minified JSON, gzip-compressed via CompressionStream when the
 * browser supports it (typical 85-95% reduction on JSON), with a SHA-256
 * integrity checksum embedded in meta. Falls back to plain .json everywhere
 * else, and legacy .json files remain fully restorable.
 */
export const handleDownloadBackup = async (
    mode: BackupMode = 'optimized'
): Promise<BackupDownloadSummary | undefined> => {
    let summary: BackupDownloadSummary | undefined;

    try {
        const payload = await buildBackupPayload(mode);
        const jsonStr = JSON.stringify(payload); // minified - game-save discipline

        const dateStamp = new Date().toISOString().split('T')[0];
        const useGzip = supportsGzip();

        if (useGzip) {
            const bytes = await gzipString(jsonStr);
            summary = {
                fileName: `WealthBackup_${dateStamp}.json.gz`,
                originalBytes: jsonStr.length,
                finalBytes: bytes.byteLength,
                compressed: true,
                tables: payload.meta.counts.tables,
                rows: payload.meta.counts.rows,
                storageKeys: Object.keys(payload.storage).length,
            };

            try {
                // @ts-ignore - File System Access API
                const handle = await window.showSaveFilePicker({
                    suggestedName: summary.fileName,
                    types: [{
                        description: 'Wealth Aggregator Backup (compressed)',
                        accept: { 'application/gzip': ['.gz'] },
                    }],
                });
                const writable = await handle.createWritable();
                await writable.write(new Blob([bytes as unknown as BlobPart], { type: 'application/gzip' }));
                await writable.close();
            } catch (fsError: any) {
                if (fsError?.name === 'AbortError') return; // User cancelled
                logger.warn('[BACKUP] FileSystem API failed, falling back to legacy download:', fsError);
                legacyDownload(jsonStr, `WealthBackup_${dateStamp}.json`);
            }
        } else {
            summary = {
                fileName: `WealthBackup_${dateStamp}.json`,
                originalBytes: jsonStr.length,
                finalBytes: jsonStr.length,
                compressed: false,
                tables: payload.meta.counts.tables,
                rows: payload.meta.counts.rows,
                storageKeys: Object.keys(payload.storage).length,
            };

            try {
                // @ts-ignore - File System Access API
                const handle = await window.showSaveFilePicker({
                    suggestedName: summary.fileName,
                    types: [{
                        description: 'Wealth Aggregator Backup',
                        accept: { 'application/json': ['.json'] },
                    }],
                });
                const writable = await handle.createWritable();
                await writable.write(jsonStr);
                await writable.close();
            } catch (fsError: any) {
                if (fsError?.name === 'AbortError') return; // User cancelled
                logger.warn('[BACKUP] FileSystem API failed, falling back to legacy download:', fsError);
                legacyDownload(jsonStr, summary.fileName);
            }
        }
    } catch (err) {
        logger.error('Backup Export Failed:', err instanceof Error ? err.stack : JSON.stringify(err) ?? String(err));
        throw new Error('Failed to generate backup file.');
    }

    localStorage.setItem(LAST_BACKUP_AT_KEY, new Date().toISOString());
    if (summary) {
        logger.info(
            `[BACKUP] ${summary.compressed ? 'Compressed' : 'Plain'} save: ${(summary.finalBytes / 1024).toFixed(1)} KB ` +
            `(raw ${(summary.originalBytes / 1024).toFixed(1)} KB), ${summary.rows} rows across ${summary.tables} tables`
        );
    }
    return summary;
};

/** Universal fallback: plaintext data-URI download (works everywhere incl. jsdom). */
const legacyDownload = (jsonStr: string, fileName: string) => {
    const dataUri = 'data:text/json;charset=utf-8,' + encodeURIComponent(jsonStr);
    const link = document.createElement('a');
    link.href = dataUri;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    setTimeout(() => document.body.removeChild(link), 100);
};

// ---------------------------------------------------------------------------
// Import (restore) - accepts gzip bytes, plain text, or a parsed object
// ---------------------------------------------------------------------------

export interface ParsedBackup {
    payload: any;
    warnings: string[];
}

/**
 * Parses any supported backup input:
 *   - ArrayBuffer / TypedArray (gzip magic-detected or raw UTF-8)
 *   - JSON string (pretty-printed legacy files included)
 *   - Already-parsed object (cloud sync path)
 * Verifies the v3 integrity checksum when present; legacy files restore with
 * a warning instead of failing.
 */
export const parseBackupInput = async (input: unknown): Promise<ParsedBackup> => {
    const warnings: string[] = [];
    let payload: any = input;

    if (typeof ArrayBuffer !== 'undefined' &&
        (input instanceof ArrayBuffer || (ArrayBuffer.isView(input as any)))) {
        const bytes = input instanceof ArrayBuffer
            ? new Uint8Array(input)
            : new Uint8Array((input as any).buffer, (input as any).byteOffset, (input as any).byteLength);

        if (isGzipBytes(bytes)) {
            payload = await gunzipToText(bytes);
            logger.info('[BACKUP] Detected gzip save file - decompressed.');
        } else {
            payload = new TextDecoder().decode(bytes);
        }
    }

    if (typeof payload === 'string') {
        payload = JSON.parse(payload); // throws SyntaxError on garbage input
    }

    if (!payload || typeof payload !== 'object') {
        throw new Error("Invalid backup file format: Missing 'data' object.");
    }

    if (!payload.data) {
        throw new Error("Invalid backup file format: Missing 'data' object.");
    }

    // Integrity verification
    const expectedChecksum = payload.meta?.checksum;
    if (expectedChecksum) {
        const actual = await computePayloadChecksum(payload);
        if (actual && actual !== expectedChecksum) {
            throw new Error(
                'Backup integrity check FAILED (checksum mismatch). The file is corrupted or was tampered with. Restore aborted.'
            );
        }
    } else {
        warnings.push('Legacy backup without integrity checksum - restored without verification.');
    }

    return { payload, warnings };
};

/** Convenience wrapper for File inputs coming from the restore UI. */
export const readBackupFile = async (file: File): Promise<ParsedBackup> =>
    parseBackupInput(await file.arrayBuffer());

export const previewRestoreFromJSON = async (input: unknown) => {
    const { payload, warnings } = await parseBackupInput(input);
    const preview = await buildSyncPreview(payload.data, 'backup-restore');
    return {
        ...preview,
        protectedStorageKeys: Array.isArray(payload.meta?.protectedStorageKeys)
            ? payload.meta.protectedStorageKeys
            : [],
        backupTimestamp: payload.meta?.timestamp || null,
        backupMode: payload.meta?.mode || null,
        warnings,
    };
};

/**
 * Nuclear Restore:
 * 1. Atomically wipes DB.
 * 2. Sanitizes and Inserts new data.
 * 3. Restores LocalStorage.
 */
export const restoreFromJSON = async (input: unknown): Promise<void> => {
    const { payload: jsonData, warnings } = await parseBackupInput(input);
    if (warnings.length > 0) {
        warnings.forEach((w) => logger.warn(`[BACKUP SERVICE] ${w}`));
    }
    logger.info("[BACKUP SERVICE] Starting restore...", {
        mode: jsonData.meta?.mode,
        schemaVersion: jsonData.meta?.version,
        timestamp: jsonData.meta?.timestamp,
    });

    // Transaction guarantees all-or-nothing execution
    // @ts-ignore
    await db.transaction('rw', db.tables, async () => {
        // 1. WIPE EVERYTHING
        logger.info("[BACKUP SERVICE] Clearing all tables...");
        // @ts-ignore
        await Promise.all(db.tables.map(table => table.clear()));

        // 2. RESTORE TABLES using bulkPut (handles existing IDs)
        const tables = Object.keys(jsonData.data);
        const validationOptions: SanitizeOptions = { mode: 'coerce', stripProtoKeys: true };
        let totalDropped = 0;
        for (const tableName of tables) {
            if (!isSafeTableName(tableName)) {
                logger.warn(`[BACKUP SERVICE] Skipping unsafe table name: ${String(tableName)}`);
                continue;
            }
            // @ts-ignore
            const table = db.table(tableName);
            if (!table) {
                logger.warn(`[BACKUP SERVICE] Table "${tableName}" does not exist in current schema, skipping.`);
                continue;
            }

            const rawRows = jsonData.data[tableName];
            if (!Array.isArray(rawRows)) {
                logger.warn(`[BACKUP SERVICE] Rows for "${tableName}" is not an array, skipping.`);
                continue;
            }
            if (rawRows.length === 0) continue;

            // Agent I: validate & sanitize every row before bulkPut to prevent
            // NaN/Infinity, prototype-pollution, or invalid dates from corrupting
            // the local IndexedDB.
            const { rows: cleanRows, dropped, errors } = sanitizeBackupRows(rawRows, validationOptions);
            totalDropped += dropped;
            if (errors.length > 0) {
                logger.warn(`[BACKUP SERVICE] ${errors.length} row validation errors in "${tableName}" (first: ${errors[0]})`);
            }

            logger.info(`[BACKUP SERVICE] Restoring ${cleanRows.length} rows to ${tableName} (dropped ${dropped})`);
            if (cleanRows.length > 0) {
                await table.bulkPut(cleanRows); // Use bulkPut instead of bulkAdd
            }
        }
        if (totalDropped > 0) {
            logger.warn(`[BACKUP SERVICE] Total rows dropped during validation: ${totalDropped}`);
        }
    });

    logger.info("[BACKUP SERVICE] Database restore complete.");
    await recordTableSyncBatch('backup', 'restore', jsonData.data, 'SYNCED', 'Restored from local backup');

    // 2b. Best-effort restore of ear-server routing config (when included + reachable)
    const earConfig = jsonData.bridgeConfigs?.ears;
    if (Array.isArray(earConfig) && earConfig.length > 0) {
        try {
            const { telegramEarManager } = await import('./TelegramEarManager');
            const ok = await telegramEarManager.importEarConfig(earConfig);
            logger.info(`[BACKUP SERVICE] Ear config restore ${ok ? 'succeeded' : 'skipped (server unreachable)'}.`);
        } catch {
            logger.warn('[BACKUP SERVICE] Ear config restore skipped.');
        }
    }

    // 3. RESTORE LOCALSTORAGE
    if (jsonData.storage) {
        // A. Restore Master Encryption Keys first to bootstrap decryption
        const masterKeys = ['wealth_encryption_key', 'wealth-encryption-key-v3', 'wealth-encryption-salt'];
        masterKeys.forEach(key => {
            const val = jsonData.storage[key];
            if (val && typeof val === 'string') {
                localStorage.setItem(key, val);
            }
        });

        // Reset SecureEncryption singleton to reload restored keys
        SecureEncryption.resetInstance();

        // B. Restore all other keys
        Object.entries(jsonData.storage).forEach(([key, val]) => {
            if (masterKeys.includes(key)) return; // Already restored
            if (typeof val === 'string') {
                localStorage.setItem(key, restoreSensitiveStorageValue(key, val));
            }
        });
        logger.info("[BACKUP SERVICE] LocalStorage restored.");
    }
    localStorage.setItem(LAST_RESTORE_AT_KEY, new Date().toISOString());
};

export const getBackupMarkers = () => ({
    lastBackupAt: localStorage.getItem(LAST_BACKUP_AT_KEY),
    lastRestoreAt: localStorage.getItem(LAST_RESTORE_AT_KEY),
});


/**
 * Convert JSON array to CSV string
 */
const exportToCSV = (data: any[], filename: string) => {
    if (!data || !data.length) {
        logger.warn("No data to export");
        return;
    }

    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(fieldName => {
            const val = row[fieldName];
            // Escape quotes and handle complex types
            if (val instanceof Blob) {
                return '"[BLOB]"';
            }
            if (typeof val === 'object' && val !== null) {
                // Flatten objects/arrays for CSV
                return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
            }
            if (typeof val === 'string') {
                return `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        }).join(','))
    ].join('\n');

    try {
        // Create Blob and download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        logger.error("CSV Export Failed:", err);
    }
}

/**
 * Exports current holdings as CSV
 */
export const handleExportHoldings = async () => {
    try {
        const holdings = await db.investments.toArray();
        if (holdings.length === 0) {
            alert("No holdings to export.");
            return;
        }

        // Format for readability
        const formatted = holdings.map(h => ({
            Name: h.name,
            Ticker: h.ticker || '',
            Type: h.type,
            Platform: h.platform,
            Quantity: h.quantity || 0,
            Invested: h.investedAmount,
            CurrentValue: h.currentValue,
            NetPL: h.currentValue - h.investedAmount,
            Sector: h.sector || '',
            LastUpdated: h.lastUpdated
        }));

        exportToCSV(formatted, `WealthHoldings_${new Date().toISOString().split('T')[0]}.csv`);
        logger.info("Holdings exported successfully");
    } catch (err) {
        logger.error("Failed to export holdings:", err);
        alert("Failed to export holdings");
    }
};

/**
 * Packages all local data and uploads it to the Python backend GCS bridge.
 * Uses the SAME manifest-driven snapshot builder as the file export, so cloud
 * sync and JSON saves can never drift apart.
 */
export const uploadBackupToCloud = async (userId: string): Promise<{ success: boolean; message: string }> => {
    try {
        logger.info("Building full backup for Cloud Storage...");
        const payload = await buildBackupPayload('full');

        // Upload via Python Bridge (minified JSON body - smaller transfer).
        const response = await fetch('/api/python-nse/api/backup/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId,
                backupData: payload
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || "Bridge upload failed");
        }

        const res = await response.json();
        logger.info("Cloud Backup Sync Successful:", res);
        localStorage.setItem(LAST_BACKUP_AT_KEY, new Date().toISOString());
        return { success: true, message: "Successfully uploaded backup to Cloud!" };

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("Cloud Backup Upload Failed:", err);
        return { success: false, message: msg || "Failed to upload cloud backup." };
    }
};

/**
 * Downloads the JSON backup from GCS via Python Bridge and performs a nuclear restore.
 */
export const downloadBackupFromCloud = async (userId: string): Promise<{ success: boolean; message: string }> => {
    try {
        logger.info("Downloading backup payload from GCS bucket via python-bridge...");

        // Add 15-second AbortController timeout to prevent hanging on Cloudflare/slow connections
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(`/api/python-nse/api/backup/download?userId=${userId}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error("No backup file found in your cloud storage.");
            }
            const errText = await response.text();
            throw new Error(errText || "Bridge download failed");
        }

        const res = await response.json();
        if (!res.backupData) {
            throw new Error("Invalid backup data received from bridge.");
        }

        logger.info("Cloud Backup downloaded. Triggering restore...");
        await restoreFromJSON(res.backupData);

        return { success: true, message: "Cloud backup restored successfully!" };
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("Cloud Backup Restore Failed:", err);
        return { success: false, message: msg || "Failed to restore cloud backup." };
    }
};
