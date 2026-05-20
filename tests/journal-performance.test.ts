import { describe, expect, it } from 'vitest';
import { rankSetups, summarizeJournalPerformance } from '../services/JournalPerformanceService';
import { Trade } from '../database';

const sampleTrades: Trade[] = [
  {
    ticker: 'ABC',
    entryPrice: 100,
    exitPrice: 110,
    stopLoss: 95,
    quantity: 10,
    direction: 'Long',
    date: '2026-03-30',
    moodEntry: 'Focused',
    moodExit: 'Satisfied',
    mistakes: [],
    setup: 'Breakout',
    pnl: 100,
    complianceScore: 88,
    reviewStatus: 'ANNOTATED',
    isTextbook: true,
    coreLesson: 'Hold winners',
  },
  {
    ticker: 'XYZ',
    entryPrice: 200,
    exitPrice: 188,
    stopLoss: 206,
    quantity: 10,
    direction: 'Short',
    date: '2026-03-29',
    moodEntry: 'Focused',
    moodExit: 'Regret',
    mistakes: ['FOMO'],
    setup: 'Breakout',
    pnl: 120,
    complianceScore: 80,
    reviewStatus: 'READY_FOR_LESSON',
  },
  {
    ticker: 'DEF',
    entryPrice: 100,
    exitPrice: 96,
    stopLoss: 95,
    quantity: 10,
    direction: 'Long',
    date: '2026-03-28',
    moodEntry: 'Revenge',
    moodExit: 'Regret',
    mistakes: ['Revenge Trade'],
    setup: 'Mean Reversion',
    pnl: -40,
    complianceScore: 55,
    reviewStatus: 'NEEDS_ANNOTATION',
    forcedTrade: true,
    fomoLevel: 8,
  },
];

describe('journal performance service', () => {
  it('ranks setups by expectancy and process quality', () => {
    const ranked = rankSetups(sampleTrades);

    expect(ranked[0].setup).toBe('Breakout');
    expect(ranked[0].count).toBe(2);
    expect(ranked[0].expectancy).toBeGreaterThan(0);
  });

  it('summarizes coaching metrics and notes', () => {
    const summary = summarizeJournalPerformance(sampleTrades);

    expect(summary.tradeCount).toBe(3);
    expect(summary.processScore).toBeGreaterThan(0);
    expect(summary.bestSetup?.setup).toBe('Breakout');
    expect(summary.coachingNotes.length).toBeGreaterThan(0);
  });
});
