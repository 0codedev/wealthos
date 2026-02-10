import { AggregatedData, Investment, InvestmentType, PortfolioStats } from '../../types';

export const getInvestmentTimestamp = (
  investment: Partial<Investment>,
  fields: Array<keyof Investment>
): string | null => {
  for (const field of fields) {
    const value = investment[field];
    if (typeof value === 'string' && value.trim()) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
  }

  return null;
};

export const getInvestmentAcquiredAt = (investment: Partial<Investment>): string => {
  return (
    getInvestmentTimestamp(investment, ['acquiredAt', 'effectiveAt', 'createdAt', 'lastUpdated']) ||
    new Date().toISOString()
  );
};

export const normalizeInvestmentMetadata = (investment: Investment): Investment => {
  const acquiredAt = getInvestmentAcquiredAt(investment);
  const lastUpdated = getInvestmentTimestamp(investment, ['lastUpdated', 'brokerUpdatedAt']) || acquiredAt;

  const realizedPnL = investment.realizedPnL || 0;
  const unrealizedPnL =
    investment.unrealizedPnL !== undefined
      ? investment.unrealizedPnL
      : (investment.currentValue || 0) - (investment.investedAmount || 0);

  return {
    ...investment,
    createdAt: getInvestmentTimestamp(investment, ['createdAt']) || acquiredAt,
    effectiveAt: getInvestmentTimestamp(investment, ['effectiveAt']) || acquiredAt,
    acquiredAt,
    lastUpdated,
    source: investment.source || 'manual',
    sourceId: investment.sourceId || investment.id,
    syncStatus: investment.syncStatus || 'PENDING',
    syncVersion: investment.syncVersion || 1,
    reconciliationStatus: investment.reconciliationStatus || 'UNMATCHED',
    broker: investment.broker || (investment.source === 'dhan' ? 'dhan' : 'manual'),
    brokerSecurityId: investment.brokerSecurityId || investment.dhanSecurityId,
    realizedPnL,
    unrealizedPnL,
  };
};

export const selectInvestmentsForEntity = (
  investments: Investment[],
  activeEntity: Investment['owner'] | 'ALL'
): Investment[] => {
  if (activeEntity === 'ALL') return investments;

  return investments.filter((investment) => (investment.owner || 'SELF') === activeEntity);
};

const calculateDiversityScore = (investments: Investment[]): number => {
  const activeInvestments = investments.filter((investment) => !investment.isHiddenFromTotals && investment.status !== 'ARCHIVED');
  if (activeInvestments.length <= 1) return 0;

  const totalValue = activeInvestments.reduce((sum, investment) => sum + (investment.currentValue || 0), 0);
  if (totalValue === 0) return 0;

  const weights = activeInvestments.map((investment) => (investment.currentValue || 0) / totalValue);
  const hhi = weights.reduce((sum, weight) => sum + weight * weight, 0);
  const maxDiversity = 1 / activeInvestments.length;
  const normalizedScore = Math.max(0, ((1 - hhi) / (1 - maxDiversity)) * 100);

  return Math.min(100, Math.round(normalizedScore));
};

const findTopAsset = (investments: Investment[]): { name: string; percent: number } => {
  const activeInvestments = investments.filter(
    (investment) => !investment.isHiddenFromTotals && (investment.investedAmount || 0) > 0 && investment.status !== 'ARCHIVED'
  );

  if (activeInvestments.length === 0) {
    return { name: 'None', percent: 0 };
  }

  const [top] = [...activeInvestments].sort((left, right) => {
    const leftGain = ((left.currentValue || 0) - (left.investedAmount || 0)) / Math.max(left.investedAmount || 0, 1);
    const rightGain = ((right.currentValue || 0) - (right.investedAmount || 0)) / Math.max(right.investedAmount || 0, 1);
    return rightGain - leftGain;
  });

  const gainPercent =
    (((top.currentValue || 0) - (top.investedAmount || 0)) / Math.max(top.investedAmount || 0, 1)) * 100;

  return {
    name: top.name,
    percent: Math.round(gainPercent * 100) / 100,
  };
};

const sortAggregation = (items: AggregatedData[]): AggregatedData[] => items.sort((left, right) => right.value - left.value);

export interface PortfolioComputedView {
  normalizedInvestments: Investment[];
  stats: PortfolioStats;
  allocationData: AggregatedData[];
  assetClassData: AggregatedData[];
  platformData: AggregatedData[];
}

export const computePortfolioView = (
  investments: Investment[],
  liabilityValue: number = 0,
  baseStats?: Partial<PortfolioStats>
): PortfolioComputedView => {
  const normalizedInvestments = investments.map(normalizeInvestmentMetadata);
  const activeInvestments = normalizedInvestments.filter(
    (investment) => !investment.isHiddenFromTotals && investment.status !== 'ARCHIVED'
  );

  // Split assets and manual liabilities (negative investments)
  const assetInvestments = activeInvestments.filter(inv => (inv.currentValue || 0) > 0);
  const liabilityInvestments = activeInvestments.filter(inv => (inv.currentValue || 0) < 0);

  // Audit Fix: Implement paise math to prevent floating point drift during aggregation
  const totalAssets = assetInvestments.reduce((sum, investment) => sum + Math.round((investment.currentValue || 0) * 100), 0) / 100;
  const investmentLiabilities = Math.abs(liabilityInvestments.reduce((sum, investment) => sum + Math.round((investment.currentValue || 0) * 100), 0)) / 100;

  const totalInvested = activeInvestments.reduce((sum, investment) => sum + Math.round((investment.investedAmount || 0) * 100), 0) / 100;
  const totalGain = totalAssets - investmentLiabilities - totalInvested;
  const totalGainPercent = totalInvested > 0 ? ((totalGain / totalInvested) * 100).toFixed(2) : '0.00';

  const totalLiability = liabilityValue + investmentLiabilities;

  const allocationMap = new Map<string, number>();
  const assetClassMap = new Map<string, number>();
  const platformMap = new Map<string, number>();

  const byCategory: Record<string, number> = {
    Equity: 0,
    Debt: 0,
    'Fixed Income': 0,
    Gold: 0,
    Commodities: 0,
    Cash: 0,
    Liabilities: totalLiability,
    Other: 0,
  };

  activeInvestments.forEach((investment) => {
    const currentValue = investment.currentValue || 0;
    allocationMap.set(investment.name, (allocationMap.get(investment.name) || 0) + currentValue);
    assetClassMap.set(investment.type, (assetClassMap.get(investment.type) || 0) + currentValue);
    platformMap.set(investment.platform || 'Unknown', (platformMap.get(investment.platform || 'Unknown') || 0) + currentValue);

    if (currentValue > 0) {
      switch (investment.type) {
        case InvestmentType.STOCKS:
        case InvestmentType.MUTUAL_FUND:
        case InvestmentType.SMALLCASE:
        case InvestmentType.ETF:
        case InvestmentType.TRADING:
        case InvestmentType.IPO:
          byCategory.Equity = (byCategory.Equity || 0) + currentValue;
          break;
        case InvestmentType.FD:
          byCategory.Debt = (byCategory.Debt || 0) + currentValue;
          byCategory['Fixed Income'] = (byCategory['Fixed Income'] || 0) + currentValue;
          break;
        case InvestmentType.DIGITAL_GOLD:
        case InvestmentType.DIGITAL_SILVER:
          byCategory.Gold = (byCategory.Gold || 0) + currentValue;
          byCategory.Commodities = (byCategory.Commodities || 0) + currentValue;
          break;
        case InvestmentType.CASH:
          byCategory.Cash = (byCategory.Cash || 0) + currentValue;
          break;
        default:
          byCategory.Other = (byCategory.Other || 0) + currentValue;
          break;
      }
    }
  });

  for (const k of Object.keys(byCategory)) {
    byCategory[k] = Math.round(byCategory[k] * 100) / 100;
  }

  const stats: PortfolioStats = {
    totalValue: totalAssets - totalLiability,
    totalCurrent: totalAssets - totalLiability,
    totalAssets,
    totalLiability,
    totalInvested,
    totalGain,
    totalPL: totalGain,
    totalGainPercent,
    totalPLPercent: totalGainPercent,
    dayChange: baseStats?.dayChange || 0,
    dayChangePercent: baseStats?.dayChangePercent || 0,
    diversityScore: calculateDiversityScore(normalizedInvestments),
    topAsset: findTopAsset(normalizedInvestments),
    byCategory,
  };

  const allocationData = sortAggregation(Array.from(allocationMap.entries()).map(([name, value]) => ({ name, value })));
  const assetClassData = sortAggregation(Array.from(assetClassMap.entries()).map(([name, value]) => ({ name, value })));
  const platformData = sortAggregation(Array.from(platformMap.entries()).map(([name, value]) => ({ name, value })));

  // 2026-06-19 Portfolio Hub render-loop fix: return the SAME object reference
  // when the input data is structurally identical to the previous call.
  // Zustand's `set` will see `===` and skip the re-render entirely. This is
  // the lowest-cost, highest-impact fix — it eliminates the feedback loop at
  // the source, not in every consumer.
  // The cache is bounded to one entry (we only ever need the most recent
  // "same" comparison).
  type CacheKey = {
    sig: string;
    liabilityValue: number;
    baseStatsDayChange: number;
    baseStatsDayChangePercent: number;
  };
  type CacheVal = { result: PortfolioComputedView };
  const __cacheSlot = (computePortfolioView as any).__loopCache as CacheVal | undefined;
  // Build a structural signature over the inputs.
  let sig =
    normalizedInvestments.length + ':' +
    liabilityValue + ':' +
    (baseStats?.dayChange || 0) + ':' +
    (baseStats?.dayChangePercent || 0) + ':' +
    totalAssets + ':' +
    totalLiability + ':' +
    totalInvested + ':' +
    totalGain + ':' +
    allocationMap.size + ':' +
    assetClassMap.size + ':' +
    platformMap.size;
  // Include per-investment tuple that affects outputs. This catches a
  // re-emit where a single investment's currentValue or investedAmount
  // changed without changing the count.
  for (const inv of normalizedInvestments) {
    sig += '|' + inv.id + ':' + (inv.currentValue || 0) + ':' + (inv.investedAmount || 0) + ':' + (inv.status || '');
  }
  if (__cacheSlot) {
    const cached = __cacheSlot as CacheVal & { _sig?: string };
    if ((cached as any)._sig === sig) {
      return cached.result;
    }
  }
  const result: PortfolioComputedView = {
    normalizedInvestments,
    stats: {
      ...baseStats,
      ...stats,
    },
    allocationData,
    assetClassData,
    platformData,
  };
  (computePortfolioView as any).__loopCache = { _sig: sig, result } as any;
  return result;
};

export const getAllocationSummary = (investments: Investment[]): Array<{ name: string; value: number; weight: number }> => {
  const { assetClassData, stats } = computePortfolioView(investments);
  const totalAssets = stats.totalAssets || 0;

  return assetClassData.map((entry) => ({
    ...entry,
    weight: totalAssets > 0 ? Number(((entry.value / totalAssets) * 100).toFixed(2)) : 0,
  }));
};
