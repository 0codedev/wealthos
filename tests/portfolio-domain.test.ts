import { describe, expect, it } from 'vitest';
import { computePortfolioView, normalizeInvestmentMetadata, selectInvestmentsForEntity } from '../lib/domain/portfolio';
import { InvestmentType } from '../types';

describe('portfolio domain helpers', () => {
  it('normalizes acquisition metadata and broker defaults', () => {
    const investment = normalizeInvestmentMetadata({
      id: 'inv_1',
      name: 'Alpha',
      type: InvestmentType.STOCKS,
      platform: 'DhanHQ',
      investedAmount: 100,
      currentValue: 120,
      lastUpdated: '2026-03-30T10:00:00.000Z',
      source: 'dhan',
    });

    expect(investment.acquiredAt).toBe('2026-03-30T10:00:00.000Z');
    expect(investment.broker).toBe('dhan');
    expect(investment.syncStatus).toBe('PENDING');
    expect(investment.unrealizedPnL).toBe(20);
  });

  it('filters investments by family entity', () => {
    const investments = [
      {
        id: '1',
        name: 'Self Asset',
        type: InvestmentType.STOCKS,
        platform: 'Manual',
        investedAmount: 10,
        currentValue: 15,
        lastUpdated: '2026-03-30T10:00:00.000Z',
        owner: 'SELF' as const,
      },
      {
        id: '2',
        name: 'Spouse Asset',
        type: InvestmentType.ETF,
        platform: 'Manual',
        investedAmount: 10,
        currentValue: 20,
        lastUpdated: '2026-03-30T10:00:00.000Z',
        owner: 'SPOUSE' as const,
      },
    ];

    expect(selectInvestmentsForEntity(investments, 'ALL')).toHaveLength(2);
    expect(selectInvestmentsForEntity(investments, 'SELF')).toHaveLength(1);
    expect(selectInvestmentsForEntity(investments, 'SPOUSE')[0].name).toBe('Spouse Asset');
  });

  it('computes consistent portfolio stats and aggregations', () => {
    const view = computePortfolioView([
      {
        id: '1',
        name: 'Alpha',
        type: InvestmentType.STOCKS,
        platform: 'DhanHQ',
        investedAmount: 100,
        currentValue: 130,
        lastUpdated: '2026-03-30T10:00:00.000Z',
      },
      {
        id: '2',
        name: 'Gold',
        type: InvestmentType.DIGITAL_GOLD,
        platform: 'Manual',
        investedAmount: 200,
        currentValue: 220,
        lastUpdated: '2026-03-30T10:00:00.000Z',
      },
    ], 50);

    expect(view.stats.totalAssets).toBe(350);
    expect(view.stats.totalValue).toBe(300);
    expect(view.stats.totalInvested).toBe(300);
    expect(view.stats.totalGain).toBe(50);
    expect(view.assetClassData).toHaveLength(2);
    expect(view.platformData[0].name).toBe('Manual');
    expect(view.stats.byCategory?.['Equity']).toBe(130);
    expect(view.stats.byCategory?.['Gold']).toBe(220);
    expect(view.stats.byCategory?.['Commodities']).toBe(220);
  });
});
