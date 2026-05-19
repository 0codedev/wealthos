import { describe, expect, it } from 'vitest';
import { buildPortfolioAIContext } from '../services/AIContextService';
import { inferMarketContext } from '../services/RiskEngine';
import { InvestmentType } from '../types';

const investments = [
  {
    id: '1',
    name: 'Silver ETF',
    ticker: 'SILVER',
    type: InvestmentType.DIGITAL_SILVER,
    platform: 'DhanHQ',
    investedAmount: 100000,
    currentValue: 140000,
    lastUpdated: '2026-03-30T00:00:00.000Z',
    source: 'dhan' as const,
  },
  {
    id: '2',
    name: 'Cash',
    ticker: 'CASH',
    type: InvestmentType.CASH,
    platform: 'Bank',
    investedAmount: 60000,
    currentValue: 60000,
    lastUpdated: '2026-03-30T00:00:00.000Z',
    source: 'manual' as const,
  },
];

describe('ai context firewall', () => {
  it('redacts absolute values by default', () => {
    const context = buildPortfolioAIContext(investments, '₹2,00,000');

    expect(context.contextText).not.toContain('₹2,00,000');
    expect(context.contextText).toContain('Silver ETF');
    expect(context.contextObject.netWorth).toBeUndefined();
    expect(context.contextObject.holdings[0].currentValue).toBeUndefined();
  });

  it('includes absolute values only on explicit opt-in', () => {
    const context = buildPortfolioAIContext(investments, '₹2,00,000', {
      includeAbsoluteValues: true,
    });

    expect(context.contextText).toContain('₹2,00,000');
    expect(context.contextObject.netWorth).toBe(200000);
    expect(context.contextObject.holdings[0].currentValue).toBe(140000);
  });
});

describe('market context inference', () => {
  it('detects silver crash context from exposure and ratio', () => {
    const context = inferMarketContext(investments, 18, 92);
    expect(context.scenario).toBe('SILVER_CRASH');
  });
});
