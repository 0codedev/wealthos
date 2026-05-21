import { describe, expect, it } from 'vitest';
import { buildSyncHealthSummary } from '../services/SyncHealthService';

describe('sync health summary', () => {
  it('summarizes sync records and recovery markers', () => {
    const summary = buildSyncHealthSummary([
      {
        id: 'firebase:push:table:investments',
        scope: 'push',
        entityType: 'table',
        entityId: 'investments',
        source: 'firebase',
        syncVersion: 2,
        syncStatus: 'SYNCED',
        lastSyncedAt: '2026-03-30T04:00:00.000Z',
      },
      {
        id: 'firebase:pull:table:trades',
        scope: 'pull',
        entityType: 'table',
        entityId: 'trades',
        source: 'firebase',
        syncVersion: 1,
        syncStatus: 'CONFLICT',
        lastSyncedAt: '2026-03-30T05:00:00.000Z',
      },
      {
        id: 'firebase:pull:pipeline:cloud-restore',
        scope: 'pull',
        entityType: 'pipeline',
        entityId: 'cloud-restore',
        source: 'firebase',
        syncVersion: 1,
        syncStatus: 'ERROR',
        lastSyncedAt: '2026-03-30T06:00:00.000Z',
      },
    ], {
      lastBackupAt: '2026-03-29T10:00:00.000Z',
      lastRestoreAt: '2026-03-29T11:00:00.000Z',
    });

    expect(summary.trackedPipelines).toBe(3);
    expect(summary.conflictedRecords).toBe(1);
    expect(summary.erroredRecords).toBe(1);
    expect(summary.lastCloudPushAt).toBe('2026-03-30T04:00:00.000Z');
    expect(summary.lastCloudPullAt).toBe('2026-03-30T06:00:00.000Z');
    expect(summary.lastBackupAt).toBe('2026-03-29T10:00:00.000Z');
    expect(summary.recentRecords[0].entityId).toBe('cloud-restore');
  });
});
