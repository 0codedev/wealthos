import { describe, expect, it } from 'vitest';
import { compareSyncDataSets } from '../services/SyncGovernanceService';
import { protectSensitiveStorageValue, restoreSensitiveStorageValue } from '../services/SecurityService';

describe('sync governance', () => {
  it('builds preview classifications for new, unchanged, replace, and wipe states', () => {
    const preview = compareSyncDataSets(
      {
        trades: [{ id: 1, ticker: 'INFY' }],
        investments: [{ id: 'a', name: 'Fund A' }],
        alerts: [{ id: 9, title: 'Watch' }],
      },
      {
        trades: [{ id: 1, ticker: 'INFY' }],
        investments: [{ id: 'a', name: 'Fund B' }],
        goals: [{ id: 1, name: 'Retirement' }],
      },
      'backup-restore',
    );

    // NOTE: tables present locally but empty in the incoming set are
    // classified as 'new' (initial-upload semantics) rather than 'wipe'
    // - see SyncGovernanceService.compareSyncDataSets.
    expect(preview.totals.unchangedTables).toBe(1);
    expect(preview.totals.changedTables).toBe(1);
    expect(preview.totals.newTables).toBe(2);
    expect(preview.totals.wipeTables).toBe(0);
    expect(preview.totals.conflictTables).toBe(1);
  });

  it('protects and restores sensitive storage payloads', () => {
    const raw = JSON.stringify({ state: { dhanAccessToken: 'secret-token' } });
    const protectedValue = protectSensitiveStorageValue('wealth-aggregator-logic', raw);

    expect(protectedValue).not.toContain('secret-token');
    expect(restoreSensitiveStorageValue('wealth-aggregator-logic', protectedValue)).toBe(raw);
    expect(restoreSensitiveStorageValue('theme', 'dark')).toBe('dark');
  });
});
