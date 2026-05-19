import { describe, expect, it } from 'vitest';
import { generateSmartActions } from '../services/ActionCenterService';
import { analyzeTradePatterns } from '../services/JournalIntelligenceService';
import { InvestmentType } from '../types';
import { Trade, SyncRecordRow } from '../database';

describe('action center', () => {
  it('creates smart actions from sync, trade review, cash, and concentration signals', () => {
    const actions = generateSmartActions(
      [
        {
          id: '1',
          name: 'Cash',
          type: InvestmentType.CASH,
          platform: 'Bank',
          investedAmount: 500000,
          currentValue: 500000,
          lastUpdated: '2026-03-30T00:00:00.000Z',
        },
        {
          id: '2',
          name: 'Core Equity',
          type: InvestmentType.STOCKS,
          platform: 'DhanHQ',
          investedAmount: 900000,
          currentValue: 1100000,
          lastUpdated: '2026-03-30T00:00:00.000Z',
        },
      ],
      [
        {
          ticker: 'RELIANCE',
          entryPrice: 100,
          exitPrice: 110,
          quantity: 10,
          direction: 'Long',
          date: '2026-03-30',
          moodEntry: 'Focused',
          moodExit: 'Satisfied',
          mistakes: [],
          reviewStatus: 'NEEDS_ANNOTATION',
        } as Trade,
      ],
      [
        {
          id: 'dhan:trade-sync',
          scope: 'broker',
          entityType: 'trade-sync',
          entityId: 'primary',
          source: 'dhan',
          syncVersion: 1,
          syncStatus: 'STALE',
          lastSyncedAt: '2026-03-30T00:00:00.000Z',
        } as SyncRecordRow,
      ]
    );

    expect(actions.some(action => action.action === 'broker-sync')).toBe(true);
    expect(actions.some(action => action.action === 'trade-review')).toBe(true);
    expect(actions.some(action => action.action === 'idle-cash')).toBe(true);
    expect(actions.some(action => action.action === 'rebalance')).toBe(true);
  });
});

describe('journal intelligence', () => {
  it('finds review queue, emotional drift, and late-day weakness', () => {
    const insights = analyzeTradePatterns([
      {
        ticker: 'ABC',
        entryPrice: 100,
        exitPrice: 90,
        quantity: 10,
        direction: 'Long',
        date: '2026-03-30',
        entryTime: '14:15',
        moodEntry: 'Revenge',
        moodExit: 'Regret',
        mistakes: ['FOMO'],
        pnl: -100,
        reviewStatus: 'NEEDS_ANNOTATION',
        setup: 'Breakout',
      } as Trade,
      {
        ticker: 'ABC',
        entryPrice: 100,
        exitPrice: 95,
        quantity: 10,
        direction: 'Long',
        date: '2026-03-29',
        entryTime: '14:30',
        moodEntry: 'Focused',
        moodExit: 'Regret',
        mistakes: [],
        pnl: -50,
        setup: 'Breakout',
      } as Trade,
      {
        ticker: 'XYZ',
        entryPrice: 50,
        exitPrice: 60,
        quantity: 10,
        direction: 'Long',
        date: '2026-03-28',
        entryTime: '14:45',
        moodEntry: 'Focused',
        moodExit: 'Satisfied',
        mistakes: [],
        pnl: 100,
        setup: 'Breakout',
      } as Trade,
    ]);

    expect(insights.some(insight => insight.id === 'review-queue')).toBe(true);
    expect(insights.some(insight => insight.id === 'emotional-drift')).toBe(true);
    expect(insights.some(insight => insight.id === 'late-day-drag')).toBe(true);
  });
});
