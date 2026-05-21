import { describe, expect, it } from 'vitest';
import { generatePortfolioActionProposals, summarizePortfolioActionProposals } from '../services/PortfolioActionService';
import { InvestmentType } from '../types';

describe('portfolio action proposals', () => {
  it('creates deploy-cash, rebalance, trim, and tax-harvest proposals from portfolio drift', () => {
    const proposals = generatePortfolioActionProposals(
      [
        {
          id: 'cash-1',
          name: 'Savings',
          type: InvestmentType.CASH,
          platform: 'Bank',
          investedAmount: 400000,
          currentValue: 400000,
          lastUpdated: '2026-03-30T00:00:00.000Z',
        },
        {
          id: 'stock-1',
          name: 'RELIANCE',
          ticker: 'RELIANCE',
          type: InvestmentType.STOCKS,
          platform: 'DhanHQ',
          investedAmount: 500000,
          currentValue: 700000,
          lastUpdated: '2026-03-30T00:00:00.000Z',
        },
        {
          id: 'crypto-1',
          name: 'BTC',
          type: InvestmentType.CRYPTO,
          platform: 'Coinbase',
          investedAmount: 180000,
          currentValue: 140000,
          lastUpdated: '2026-03-30T00:00:00.000Z',
        },
      ],
      {
        'Equity & Related': 50,
        'Commodities': 10,
        'Fixed Income': 20,
        'Crypto': 5,
        'Real Estate': 10,
        'Other': 5,
      }
    );

    expect(proposals.some((proposal) => proposal.category === 'deploy-cash')).toBe(true);
    expect(proposals.some((proposal) => proposal.category === 'rebalance')).toBe(true);
    expect(proposals.some((proposal) => proposal.category === 'trim')).toBe(true);
    expect(proposals.some((proposal) => proposal.category === 'tax-harvest')).toBe(true);
  });

  it('returns no proposals for an empty portfolio', () => {
    expect(generatePortfolioActionProposals([], {})).toEqual([]);
  });

  it('summarizes the action queue so the UI can guide the next move', () => {
    const proposals = generatePortfolioActionProposals(
      [
        {
          id: 'cash-1',
          name: 'Savings',
          type: InvestmentType.CASH,
          platform: 'Bank',
          investedAmount: 400000,
          currentValue: 400000,
          lastUpdated: '2026-03-30T00:00:00.000Z',
        },
        {
          id: 'stock-1',
          name: 'RELIANCE',
          ticker: 'RELIANCE',
          type: InvestmentType.STOCKS,
          platform: 'DhanHQ',
          investedAmount: 500000,
          currentValue: 700000,
          lastUpdated: '2026-03-30T00:00:00.000Z',
        },
        {
          id: 'crypto-1',
          name: 'BTC',
          type: InvestmentType.CRYPTO,
          platform: 'Coinbase',
          investedAmount: 180000,
          currentValue: 140000,
          lastUpdated: '2026-03-30T00:00:00.000Z',
        },
      ],
      {
        'Equity & Related': 50,
        'Commodities': 10,
        'Fixed Income': 20,
        'Crypto': 5,
        'Real Estate': 10,
        'Other': 5,
      }
    );

    const summary = summarizePortfolioActionProposals(proposals);
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.topProposal).not.toBeNull();
    expect(summary.rebalance + summary.deployCash + summary.trim + summary.taxHarvest).toBe(summary.total);
  });
});
