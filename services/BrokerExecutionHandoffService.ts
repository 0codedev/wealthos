export interface BrokerExecutionHandoff {
  id: string;
  ticker: string;
  action: 'BUY' | 'SELL';
  orderStyle: 'quick' | 'sniper' | 'algo' | 'manual' | 'scale' | 'hedge';
  createdAt: number;
  expiresAt: number;
}

const STORAGE_KEY = 'wealth-broker-execution-handoff';
const TTL_MS = 1000 * 60 * 15;
export const BROKER_EXECUTION_HANDOFF_EVENT = 'wealth-broker-execution-handoff';

const canUseWindow = () => typeof window !== 'undefined';

const readHandoffs = (): BrokerExecutionHandoff[] => {
  if (!canUseWindow()) return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is BrokerExecutionHandoff =>
      Boolean(item?.id && item?.ticker && item?.action && item?.orderStyle && item?.createdAt && item?.expiresAt)
    );
  } catch {
    return [];
  }
};

const writeHandoffs = (items: BrokerExecutionHandoff[]) => {
  if (!canUseWindow()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(BROKER_EXECUTION_HANDOFF_EVENT));
};

export const getActiveBrokerExecutionHandoffs = (now: number = Date.now()): BrokerExecutionHandoff[] => {
  const active = readHandoffs()
    .filter((item) => item.expiresAt > now)
    .sort((left, right) => right.createdAt - left.createdAt);

  if (active.length !== readHandoffs().length) {
    writeHandoffs(active);
  }

  return active;
};

export const registerBrokerExecutionHandoff = (
  ticker: string,
  action: 'BUY' | 'SELL',
  orderStyle: 'quick' | 'sniper' | 'algo' | 'manual' | 'scale' | 'hedge',
  now: number = Date.now(),
): BrokerExecutionHandoff => {
  const id = `${ticker.toUpperCase()}:${action}:${orderStyle}`;
  const handoff: BrokerExecutionHandoff = {
    id,
    ticker: ticker.toUpperCase(),
    action,
    orderStyle,
    createdAt: now,
    expiresAt: now + TTL_MS,
  };

  const active = getActiveBrokerExecutionHandoffs(now).filter((item) => item.id !== id);
  writeHandoffs([handoff, ...active].slice(0, 8));
  return handoff;
};

export const clearBrokerExecutionHandoff = (id: string) => {
  const active = getActiveBrokerExecutionHandoffs().filter((item) => item.id !== id);
  writeHandoffs(active);
};

export const clearMatchedBrokerExecutionHandoffs = (
  matches: Array<{ ticker: string; action: 'BUY' | 'SELL' }>,
  now: number = Date.now(),
): number => {
  if (matches.length === 0) return 0;

  const matchKeys = new Set(matches.map((item) => `${item.ticker.toUpperCase()}:${item.action}`));
  const active = getActiveBrokerExecutionHandoffs(now);
  const remaining = active.filter((item) => !matchKeys.has(`${item.ticker.toUpperCase()}:${item.action}`));
  const clearedCount = active.length - remaining.length;

  if (clearedCount > 0) {
    writeHandoffs(remaining);
  }

  return clearedCount;
};

export const clearConfirmedBrokerExecutionHandoffs = (
  confirmedAt: number,
  syncHealthy: boolean = true,
  now: number = Date.now(),
): number => {
  if (!syncHealthy) return 0;

  const active = getActiveBrokerExecutionHandoffs(now);
  const remaining = active.filter((item) => item.createdAt > confirmedAt);
  const clearedCount = active.length - remaining.length;

  if (clearedCount > 0) {
    writeHandoffs(remaining);
  }

  return clearedCount;
};
