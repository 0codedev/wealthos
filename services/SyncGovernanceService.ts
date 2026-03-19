import { db, SyncRecordRow } from '../database';

export interface SyncTablePreview {
    tableName: string;
    localCount: number;
    incomingCount: number;
    localChecksum: string;
    incomingChecksum: string;
    status: 'new' | 'unchanged' | 'replace' | 'wipe';
    conflict: boolean;
}

export interface SyncPreviewSummary {
    source: string;
    generatedAt: string;
    tables: SyncTablePreview[];
    totals: {
        tables: number;
        newTables: number;
        unchangedTables: number;
        changedTables: number;
        wipeTables: number;
        conflictTables: number;
    };
}

const hashString = (value: string): string => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(16);
};

export const buildChecksum = (value: unknown): string => hashString(JSON.stringify(value ?? null));

export const compareSyncDataSets = (
    localData: Record<string, unknown[]>,
    incomingData: Record<string, unknown[]>,
    source: string,
): SyncPreviewSummary => {
    const tableNames = Array.from(new Set([
        ...Object.keys(localData || {}),
        ...Object.keys(incomingData || {}),
    ])).sort();

    const tables = tableNames.map<SyncTablePreview>((tableName) => {
        const localRows = localData[tableName] || [];
        const incomingRows = incomingData[tableName] || [];
        const localChecksum = buildChecksum(localRows);
        const incomingChecksum = buildChecksum(incomingRows);
        const localCount = localRows.length;
        const incomingCount = incomingRows.length;
        const samePayload = localChecksum === incomingChecksum;

        let status: SyncTablePreview['status'] = 'replace';
        if (localCount === 0 && incomingCount > 0) {
            status = 'new';
        } else if (localCount > 0 && incomingCount === 0) {
            // When local has data and incoming/cloud has 0 rows, treat as 'new' initial upload rather than 'wipe'
            status = 'new';
        } else if (samePayload) {
            status = 'unchanged';
        }

        return {
            tableName,
            localCount,
            incomingCount,
            localChecksum,
            incomingChecksum,
            status,
            conflict: localCount > 0 && incomingCount > 0 && !samePayload,
        };
    });

    return {
        source,
        generatedAt: new Date().toISOString(),
        tables,
        totals: {
            tables: tables.length,
            newTables: tables.filter((table) => table.status === 'new').length,
            unchangedTables: tables.filter((table) => table.status === 'unchanged').length,
            changedTables: tables.filter((table) => table.status === 'replace').length,
            wipeTables: tables.filter((table) => table.status === 'wipe').length,
            conflictTables: tables.filter((table) => table.conflict).length,
        },
    };
};

export const getLocalTableData = async (tableNames: string[]): Promise<Record<string, unknown[]>> => {
    const snapshots: Record<string, unknown[]> = {};
    for (const tableName of tableNames) {
        snapshots[tableName] = await db.table(tableName).toArray();
    }
    return snapshots;
};

export const buildSyncPreview = async (
    incomingData: Record<string, unknown[]>,
    source: string,
): Promise<SyncPreviewSummary> => {
    const localData = await getLocalTableData(Object.keys(incomingData || {}));
    return compareSyncDataSets(localData, incomingData, source);
};

interface SyncRecordInput {
    scope: string;
    entityType: string;
    entityId: string;
    source: string;
    sourceId?: string;
    syncStatus: SyncRecordRow['syncStatus'];
    checksum?: string;
    diagnostic?: string;
}

export const recordSyncStatus = async (input: SyncRecordInput): Promise<void> => {
    const id = `${input.source}:${input.scope}:${input.entityType}:${input.entityId}`;
    const existing = await db.sync_records.get(id);

    await db.sync_records.put({
        id,
        scope: input.scope,
        entityType: input.entityType,
        entityId: input.entityId,
        source: input.source,
        sourceId: input.sourceId,
        syncVersion: (existing?.syncVersion || 0) + 1,
        syncStatus: input.syncStatus,
        checksum: input.checksum,
        lastSyncedAt: new Date().toISOString(),
        lastConflictAt: input.syncStatus === 'CONFLICT'
            ? new Date().toISOString()
            : existing?.lastConflictAt,
        diagnostic: input.diagnostic,
    });
};

export const recordTableSyncBatch = async (
    source: string,
    scope: string,
    tables: Record<string, unknown[]>,
    syncStatus: SyncRecordRow['syncStatus'],
    diagnostic?: string,
): Promise<void> => {
    for (const [tableName, rows] of Object.entries(tables)) {
        await recordSyncStatus({
            source,
            scope,
            entityType: 'table',
            entityId: tableName,
            syncStatus,
            checksum: buildChecksum(rows),
            diagnostic,
        });
    }
};
