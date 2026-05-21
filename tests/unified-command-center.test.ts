import { describe, expect, it } from 'vitest';
import { InvestmentType } from '../types';
import { buildUnifiedCommandInsights } from '../services/UnifiedCommandCenterService';

describe('unified command center', () => {
  it('combines broker, portfolio, and journal insights into one ranked queue', () => {
    const insights = buildUnifiedCommandInsights(
      [
        {
          id: 'cash-1',
          name: 'Cash',
          type: InvestmentType.CASH,
          platform: 'Bank',
          investedAmount: 300000,
          currentValue: 300000,
          acquiredAt: '2026-01-01',
          owner: 'SELF',
          status: 'ACTIVE',
          lastUpdated: '2026-04-02',
        },
        {
          id: 'stock-1',
          name: 'Alpha Corp',
          type: InvestmentType.STOCKS,
          platform: 'Broker',
          investedAmount: 100000,
          currentValue: 160000,
          acquiredAt: '2026-01-01',
          owner: 'SELF',
          status: 'ACTIVE',
          lastUpdated: '2026-04-02',
        },
      ],
      [
        {
          ticker: 'ALPHA',
          entryPrice: 100,
          exitPrice: 90,
          quantity: 10,
          direction: 'Long',
          date: '2026-04-01',
          moodEntry: 'Focused',
          moodExit: 'Regret',
          mistakes: ['FOMO'],
          complianceScore: 52,
          reviewStatus: 'NEEDS_ANNOTATION',
          isImported: true,
          broker: 'dhan',
          setup: 'Breakout',
        },
        {
          ticker: 'BETA',
          entryPrice: 100,
          exitPrice: 130,
          quantity: 10,
          direction: 'Long',
          date: '2026-04-01',
          moodEntry: 'Focused',
          moodExit: 'Satisfied',
          mistakes: [],
          complianceScore: 88,
          reviewStatus: 'ANNOTATED',
          setup: 'Pullback',
          checklist: { items: [], completed: true },
          wouldTakeAgain: true,
          isTextbook: true,
        },
        {
          ticker: 'GAMMA',
          entryPrice: 100,
          exitPrice: 95,
          quantity: 10,
          direction: 'Long',
          date: '2026-04-01',
          moodEntry: 'Anxious',
          moodExit: 'Regret',
          mistakes: ['Chasing'],
          complianceScore: 48,
          reviewStatus: 'NEEDS_SCREENSHOTS',
          setup: 'Breakout',
        },
      ],
      [
        {
          id: 'firebase:pull:table:trades',
          scope: 'pull',
          entityType: 'table',
          entityId: 'trades',
          source: 'firebase',
          syncVersion: 1,
          syncStatus: 'CONFLICT',
          lastSyncedAt: '2026-04-02T00:00:00.000Z',
        },
      ],
      {
        'Equity & Related': 40,
        'Fixed Income': 20,
        'Commodities': 10,
        'Crypto': 5,
        'Real Estate': 5,
        'Other': 20,
      },
    );

    expect(insights.length).toBeGreaterThan(0);
    expect(insights.some((item) => item.lane === 'broker')).toBe(true);
    expect(insights.some((item) => item.lane === 'portfolio')).toBe(true);
    expect(insights.some((item) => item.lane === 'journal')).toBe(true);
    expect(insights[0].priority).toBe('high');
  });

  it('promotes fresh broker executions into the mission queue immediately', () => {
    const insights = buildUnifiedCommandInsights(
      [],
      [],
      [],
      {},
      [
        {
          id: 'ALPHA:BUY:quick',
          ticker: 'ALPHA',
          action: 'BUY',
          orderStyle: 'quick',
          createdAt: 1,
          expiresAt: 2,
        },
      ],
    );

    expect(insights[0]?.lane).toBe('broker');
    expect(insights[0]?.action).toBe('broker-sync');
    expect(insights[0]?.title).toContain('Verify fresh buy execution');
  });
});
