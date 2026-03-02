import { UnifiedCommandInsight } from './UnifiedCommandCenterService';

export interface ResolvedCommandInsight extends UnifiedCommandInsight {
  resolvedAt: number;
}

export const computeResolvedCommandInsights = (
  previous: UnifiedCommandInsight[],
  current: UnifiedCommandInsight[],
  resolvedAt: number = Date.now(),
): ResolvedCommandInsight[] => {
  const currentIds = new Set(current.map((item) => item.id));

  return previous
    .filter((item) => !currentIds.has(item.id))
    .map((item) => ({
      ...item,
      resolvedAt,
    }));
};
