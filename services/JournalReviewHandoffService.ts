import { Trade } from '../database';

export interface JournalReviewHandoff {
  id: string;
  ticker: string;
  reviewStatus?: Trade['reviewStatus'];
  broker: 'dhan';
  createdAt: number;
  expiresAt: number;
}

const STORAGE_KEY = 'wealth-journal-review-handoff';
const TTL_MS = 1000 * 60 * 20;
export const JOURNAL_REVIEW_HANDOFF_EVENT = 'wealth-journal-review-handoff';

const canUseWindow = () => typeof window !== 'undefined';

const readHandoffs = (): JournalReviewHandoff[] => {
  if (!canUseWindow()) return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is JournalReviewHandoff =>
      Boolean(item?.id && item?.ticker && item?.broker && item?.createdAt && item?.expiresAt)
    );
  } catch {
    return [];
  }
};

const writeHandoffs = (items: JournalReviewHandoff[]) => {
  if (!canUseWindow()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(JOURNAL_REVIEW_HANDOFF_EVENT));
};

export const getActiveJournalReviewHandoffs = (now: number = Date.now()): JournalReviewHandoff[] => {
  const active = readHandoffs()
    .filter((item) => item.expiresAt > now)
    .sort((left, right) => right.createdAt - left.createdAt);

  if (active.length !== readHandoffs().length) {
    writeHandoffs(active);
  }

  return active;
};

export const registerJournalReviewHandoff = (
  ticker: string,
  reviewStatus?: Trade['reviewStatus'],
  now: number = Date.now(),
): JournalReviewHandoff => {
  const handoff: JournalReviewHandoff = {
    id: `${ticker.toUpperCase()}:${reviewStatus || 'PENDING'}`,
    ticker: ticker.toUpperCase(),
    reviewStatus,
    broker: 'dhan',
    createdAt: now,
    expiresAt: now + TTL_MS,
  };

  const active = getActiveJournalReviewHandoffs(now).filter((item) => item.id !== handoff.id);
  writeHandoffs([handoff, ...active].slice(0, 8));
  return handoff;
};
