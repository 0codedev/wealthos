import { describe, expect, it } from 'vitest';
import { summarizeDhanDiagnostics } from '../services/DhanDiagnosticsService';
import { InvestmentType } from '../types';

describe('dhan diagnostics summary', () => {
  it('marks the broker surface critical when sync errors and orphaned holdings exist', () => {
    const summary = summarizeDhanDiagnostics({
      configured: true,
      syncRecords: [
        {
          id: 'dhan:trade-sync',
          scope: 'broker',
          entityType: 'trade-sync',
          entityId: 'primary',
          source: 'dhan',
          syncVersion: 1,
          syncStatus: 'ERROR',
          lastSyncedAt: '2026-03-30T00:00:00.000Z',
        },
      ],
      trades: [
        {
          ticker: 'RELIANCE',
          direction: 'Long',
          quantity: 10,
          entryPrice: 100,
          exitPrice: 110,
          date: '2026-03-30',
          moodEntry: 'Focused',
          moodExit: 'Satisfied',
          mistakes: [],
          reviewStatus: 'NEEDS_ANNOTATION',
          isImported: true,
          broker: 'dhan',
          source: 'dhan',
        },
      ],
      investments: [
        {
          id: 'inv-1',
          name: 'TCS',
          ticker: 'TCS',
          type: InvestmentType.STOCKS,
          platform: 'DhanHQ',
          broker: 'dhan',
          investedAmount: 10000,
          currentValue: 12000,
          lastUpdated: '2026-03-30T00:00:00.000Z',
          reconciliationStatus: 'ORPHANED',
        },
      ],
      positions: [],
      fundLimit: { availabelBalance: 15000, collateralAmount: 0, utilizedAmount: 0 },
    });

    expect(summary.syncHealth).toBe('critical');
    expect(summary.pendingReviewTrades).toBe(1);
    expect(summary.orphanedHoldings).toBe(1);
    expect(summary.diagnostics.length).toBeGreaterThan(0);
  });

  it('marks the broker surface healthy when queues and conflicts are clear', () => {
    const summary = summarizeDhanDiagnostics({
      configured: true,
      syncRecords: [
        {
          id: 'dhan:portfolio-reconciliation',
          scope: 'broker',
          entityType: 'reconciliation',
          entityId: 'primary',
          source: 'dhan',
          syncVersion: 1,
          syncStatus: 'SYNCED',
          lastSyncedAt: '2026-03-30T00:00:00.000Z',
        },
      ],
      trades: [],
      investments: [],
      positions: [],
      fundLimit: { availabelBalance: 200000, collateralAmount: 0, utilizedAmount: 0 },
    });

    expect(summary.syncHealth).toBe('healthy');
    expect(summary.diagnostics.some((item) => item.includes('tight'))).toBe(false);
  });
});
