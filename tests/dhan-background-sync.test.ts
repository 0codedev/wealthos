import { describe, expect, it } from 'vitest';
import { getTradeSyncGate } from '../services/DhanBackgroundSyncService';

describe('dhan background sync gate', () => {
  it('skips auto-sync when a recent sync is still fresh', () => {
    const now = Date.now();
    const gate = getTradeSyncGate(String(now - (60 * 60 * 1000)), now, false);

    expect(gate.shouldSync).toBe(false);
    expect(gate.reason).toBe('recent-skip');
    expect(gate.nextEligibleAt).toBeGreaterThan(now);
  });

  it('allows sync when forced or due', () => {
    const now = Date.now();

    expect(getTradeSyncGate(String(now - (60 * 60 * 1000)), now, true).shouldSync).toBe(true);
    expect(getTradeSyncGate(String(now - (3 * 60 * 60 * 1000)), now, false).reason).toBe('due');
  });
});
