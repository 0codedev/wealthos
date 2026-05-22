import { describe, expect, it } from 'vitest';
import { buildPortfolioCashFlows } from '../utils/xirr';

describe('xirr helpers', () => {
  it('prefers explicit acquiredAt over synthetic id timestamps', () => {
    const flows = buildPortfolioCashFlows(
      [
        {
          id: 'inv_1710000000000_abc',
          acquiredAt: '2024-01-15T00:00:00.000Z',
          investedAmount: 100000,
          currentValue: 120000,
          lastUpdated: '2026-03-30T00:00:00.000Z',
        },
      ],
      120000
    );

    expect(flows[0].date.toISOString()).toBe('2024-01-15T00:00:00.000Z');
    expect(flows[0].amount).toBe(-100000);
    expect(flows[1].amount).toBe(120000);
  });
});
