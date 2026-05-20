import { describe, expect, it } from 'vitest';
import { InvestmentType } from '../types';
import { findBrokerHoldingMatch, reconcileBrokerPortfolio } from '../services/DhanReconciliationService';
import { resolveTradeReviewStatus } from '../services/BrokerReviewWorkflowService';
import { Trade } from '../database';

describe('dhan reconciliation', () => {
  it('flags ticker fallback matches as partial conflicts', () => {
    const result = findBrokerHoldingMatch(
      {
        brokerSecurityId: '2885',
        tradingSymbol: 'RELIANCE',
        quantity: 10,
        avgCostPrice: 2500,
      },
      [
        {
          id: 'inv-1',
          name: 'Reliance',
          ticker: 'RELIANCE',
          type: InvestmentType.STOCKS,
          platform: 'DhanHQ',
          investedAmount: 25000,
          currentValue: 26000,
          lastUpdated: '2026-03-30T00:00:00.000Z',
        },
      ]
    );

    expect(result.matchType).toBe('ticker-fallback');
    expect(result.reconciliationStatus).toBe('PARTIAL');
    expect(result.syncStatus).toBe('CONFLICT');
  });

  it('detects orphaned local broker holdings missing from the broker snapshot', () => {
    const summary = reconcileBrokerPortfolio(
      [
        {
          id: 'inv-2',
          name: 'TCS',
          ticker: 'TCS',
          type: InvestmentType.STOCKS,
          platform: 'DhanHQ',
          broker: 'dhan',
          brokerSecurityId: '11536',
          investedAmount: 10000,
          currentValue: 12000,
          lastUpdated: '2026-03-30T00:00:00.000Z',
          status: 'ACTIVE',
        },
      ],
      []
    );

    expect(summary.orphanedLocal).toBe(1);
    expect(summary.issues.some((issue) => issue.reconciliationStatus === 'ORPHANED')).toBe(true);
  });
});

describe('broker review workflow', () => {
  it('moves imported trades through annotation, screenshot, and lesson states', () => {
    const baseTrade: Trade = {
      ticker: 'RELIANCE',
      direction: 'Long',
      quantity: 10,
      entryPrice: 100,
      exitPrice: 110,
      date: '2026-03-30',
      moodEntry: 'Focused',
      moodExit: 'Satisfied',
      mistakes: [],
      isImported: true,
      broker: 'dhan',
      source: 'dhan',
    };

    expect(resolveTradeReviewStatus(baseTrade)).toBe('NEEDS_ANNOTATION');
    expect(resolveTradeReviewStatus({ ...baseTrade, notes: 'Good breakout trade' })).toBe('NEEDS_SCREENSHOTS');
    expect(resolveTradeReviewStatus({ ...baseTrade, notes: 'Good breakout trade', screenshotEntry: 'chart.png' })).toBe('READY_FOR_LESSON');
    expect(resolveTradeReviewStatus({ ...baseTrade, notes: 'Good breakout trade', screenshotEntry: 'chart.png', coreLesson: 'Wait for volume confirmation' })).toBe('ANNOTATED');
  });
});
