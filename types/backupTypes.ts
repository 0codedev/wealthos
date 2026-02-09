
/**
 * WealthOS backup format (v3).
 *
 * Mirrors services/BackupService.ts::BackupPayload and
 * services/backupManifest.ts (BACKUP_FORMAT_VERSION). The actual snapshot is
 * manifest-driven and dynamic - Dexie tables are discovered via `db.tables`,
 * so this interface documents shape, it does not constrain it.
 */

export const BACKUP_SCHEMA_VERSION = 3;

export type BackupMode = 'optimized' | 'full';

export interface BackupMeta {
    formatVersion: number;
    /** Dexie schema version at snapshot time (db.verno). */
    version: number;
    timestamp: string;
    app: 'WealthAggregator';
    mode: BackupMode;
    /** SHA-256 hex over JSON.stringify({ data, storage }). Empty in legacy v2 files. */
    checksum: string;
    counts: { tables: number; rows: number };
    protectedStorageKeys: string[];
}

/** Dynamic table map - keys are any Dexie table name present at snapshot time. */
export interface DexieData {
    [tableName: string]: any[];
}

export interface BackupSchema {
    meta: BackupMeta;
    data: DexieData;
    /** localStorage snapshot (sensitive values protection-transformed). */
    storage: Record<string, string>;
    /** Best-effort server-side configs (ear-server routing rules). */
    bridgeConfigs?: {
        ears?: any[] | null;
    };
}
