import { UnifiedCommandInsight } from './UnifiedCommandCenterService';

export interface AcknowledgedCommandInsight extends UnifiedCommandInsight {
  resolvedAt: number;
  expiresAt: number;
}

const STORAGE_KEY = 'wealth-command-center-acknowledged';
const ACK_TTL_MS = 1000 * 60 * 20;
export const COMMAND_CENTER_ACK_EVENT = 'wealth-command-center-acknowledged';
const ACTION_ACK_PREFIX = '__action__';

export const isAcknowledgedActionInsight = (id: string): boolean => id.startsWith(ACTION_ACK_PREFIX);

const canUseWindow = () => typeof window !== 'undefined';

const readAcknowledgements = (): AcknowledgedCommandInsight[] => {
  if (!canUseWindow()) return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is AcknowledgedCommandInsight =>
      Boolean(item && item.id && item.title && item.lane && item.action && item.resolvedAt && item.expiresAt)
    );
  } catch {
    return [];
  }
};

const writeAcknowledgements = (items: AcknowledgedCommandInsight[]) => {
  if (!canUseWindow()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(COMMAND_CENTER_ACK_EVENT));
};

export const getActiveAcknowledgedInsights = (now: number = Date.now()): AcknowledgedCommandInsight[] => {
  const active = readAcknowledgements().filter((item) => item.expiresAt > now);
  if (active.length !== readAcknowledgements().length) {
    writeAcknowledgements(active);
  }
  return active.sort((left, right) => right.resolvedAt - left.resolvedAt);
};

export const acknowledgeCommandInsight = (
  insight: UnifiedCommandInsight,
  now: number = Date.now(),
): AcknowledgedCommandInsight => {
  const active = getActiveAcknowledgedInsights(now).filter((item) => item.id !== insight.id);
  const acknowledged: AcknowledgedCommandInsight = {
    ...insight,
    resolvedAt: now,
    expiresAt: now + ACK_TTL_MS,
  };

  writeAcknowledgements([acknowledged, ...active].slice(0, 12));
  return acknowledged;
};

export const acknowledgeCommandAction = (
  lane: UnifiedCommandInsight['lane'],
  action: string,
  title: string,
  now: number = Date.now(),
): AcknowledgedCommandInsight => {
  const actionId = `${ACTION_ACK_PREFIX}${lane}:${action}`;
  const active = getActiveAcknowledgedInsights(now).filter((item) => item.id !== actionId);
  const acknowledged: AcknowledgedCommandInsight = {
    id: actionId,
    title,
    description: `${action} action acknowledged`,
    priority: 'low',
    lane,
    action,
    resolvedAt: now,
    expiresAt: now + ACK_TTL_MS,
  };

  writeAcknowledgements([acknowledged, ...active].slice(0, 12));
  return acknowledged;
};

export const filterAcknowledgedInsights = (
  insights: UnifiedCommandInsight[],
  acknowledgedInsights: AcknowledgedCommandInsight[],
): UnifiedCommandInsight[] => {
  const suppressedIds = new Set(acknowledgedInsights.map((item) => item.id));
  const suppressedActions = new Set(
    acknowledgedInsights
      .filter((item) => item.id.startsWith(ACTION_ACK_PREFIX))
      .map((item) => `${item.lane}:${item.action}`),
  );

  return insights.filter((item) => {
    if (suppressedIds.has(item.id)) return false;
    if (suppressedActions.has(`${item.lane}:${item.action}`)) return false;
    return true;
  });
};
