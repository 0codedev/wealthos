import { SyncRecordRow } from '../database';

export interface SyncHealthSummary {
    trackedPipelines: number;
    conflictedRecords: number;
    erroredRecords: number;
    staleRecords: number;
    lastCloudPushAt: string | null;
    lastCloudPullAt: string | null;
    lastBackupAt: string | null;
    lastRestoreAt: string | null;
    recentRecords: SyncRecordRow[];
}

const pickLatest = (records: SyncRecordRow[], source: string, scope: string): string | null => {
    const matches = records
        .filter((record) => record.source === source && record.scope === scope)
        .sort((a, b) => new Date(b.lastSyncedAt).getTime() - new Date(a.lastSyncedAt).getTime());
    return matches[0]?.lastSyncedAt || null;
};

export const buildSyncHealthSummary = (
    records: SyncRecordRow[],
    markers?: { lastBackupAt?: string | null; lastRestoreAt?: string | null; },
): SyncHealthSummary => {
    const sortedRecords = [...records].sort((a, b) => new Date(b.lastSyncedAt).getTime() - new Date(a.lastSyncedAt).getTime());

    return {
        trackedPipelines: records.length,
        conflictedRecords: records.filter((record) => record.syncStatus === 'CONFLICT').length,
        erroredRecords: records.filter((record) => record.syncStatus === 'ERROR').length,
        staleRecords: records.filter((record) => record.syncStatus === 'STALE').length,
        lastCloudPushAt: pickLatest(records, 'firebase', 'push'),
        lastCloudPullAt: pickLatest(records, 'firebase', 'pull'),
        lastBackupAt: markers?.lastBackupAt || null,
        lastRestoreAt: markers?.lastRestoreAt || null,
        recentRecords: sortedRecords.slice(0, 6),
    };
};
