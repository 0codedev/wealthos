/**
 * seedDemoPortfolio — first-run demo dataset for new local-first users.
 *
 * The 2026-06-19 UX audit (docs/UX-Audit-2026-06-19.md, gap G1) flagged that
 * a brand-new user opens an empty dashboard. This seeder writes a small
 * deterministic, watermarked dataset (5 holdings, 8 trades, 3 daily reviews,
 * 1 mistake, 1 goal, 1 SIP-via-recurring) so the dashboard is never empty.
 *
 * Watermarking strategy
 * ---------------------
 *  - Investment rows:    tags includes '__demo__'
 *  - Trade rows:         source = 'demo-seed-v1'  (Trade has no `tags`)
 *  - DailyReview rows:   notes starts with '[demo] '
 *  - Mistake rows:       title prefix '[demo] '
 *  - Goal rows:          notes = '__demo__ seed'
 *
 * Idempotency
 * -----------
 * Demo rows use stable string IDs (Investment) or stable date-based keys
 * (DailyReview: date). Re-running this function is a no-op — existence
 * check first, skip inserts that already exist.
 *
 * Clearing
 * --------
 * clearDemoPortfolio() soft-deletes only the demo-tagged rows. Real user
 * data is untouched. The existing soft-delete lane (`utils/storeHelpers`)
 * excludes them from `active()` views automatically. Pruning after 30d
 * is handled by the existing background prune lane.
 */

import { db, Trade, DailyReview, Mistake, Goal } from '../database';
import type { Investment } from '../types';
import { logger } from '../utils/logger';

// Stable IDs. Changing any of these is a migration; new demo data must
// use a new suffix (e.g. demo-inv-reliance-v2).
export const DEMO_TAG = '__demo__';
export const DEMO_SOURCE = 'demo-seed-v1';
export const DEMO_BANNER = '[demo]';

const TODAY = (): string => new Date().toISOString().slice(0, 10);
const DAYS_AGO = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

// ---------- Holdings (5) ----------

const DEMO_HOLDINGS: Investment[] = [
  {
    id: 'demo-inv-reliance',
    name: 'Reliance Industries',
    ticker: 'RELIANCE',
    type: 'Stocks' as any,
    platform: 'Zerodha',
    quantity: 50,
    investedAmount: 122500,
    currentValue: 126000,
    lastUpdated: new Date().toISOString(),
    sector: 'Energy',
    country: 'India',
    tags: [DEMO_TAG],
    broker: 'manual',
    source: 'system',
    syncStatus: 'SYNCED',
    status: 'ACTIVE',
    costBasisMethod: 'AVERAGE',
    cashflowType: 'LUMPSUM',
  },
  {
    id: 'demo-inv-tcs',
    name: 'Tata Consultancy Services',
    ticker: 'TCS',
    type: 'Stocks' as any,
    platform: 'Zerodha',
    quantity: 20,
    investedAmount: 76000,
    currentValue: 82000,
    lastUpdated: new Date().toISOString(),
    sector: 'IT',
    country: 'India',
    tags: [DEMO_TAG],
    broker: 'manual',
    source: 'system',
    syncStatus: 'SYNCED',
    status: 'ACTIVE',
    costBasisMethod: 'AVERAGE',
    cashflowType: 'SIP',
    // Monthly SIP demo: ₹5,000/mo, next 2026-07-01
    recurring: {
      amount: 5000,
      frequency: 'Monthly' as any,
      startDate: '2025-08-01',
      nextDate: '2026-07-01',
      active: true,
    } as any,
  },
  {
    id: 'demo-inv-hdfcbank',
    name: 'HDFC Bank',
    ticker: 'HDFCBANK',
    type: 'Stocks' as any,
    platform: 'Zerodha',
    quantity: 80,
    investedAmount: 121600,
    currentValue: 128800,
    lastUpdated: new Date().toISOString(),
    sector: 'Bank',
    country: 'India',
    tags: [DEMO_TAG],
    broker: 'manual',
    source: 'system',
    syncStatus: 'SYNCED',
    status: 'ACTIVE',
    costBasisMethod: 'AVERAGE',
    cashflowType: 'LUMPSUM',
  },
  {
    id: 'demo-inv-infy',
    name: 'Infosys',
    ticker: 'INFY',
    type: 'Stocks' as any,
    platform: 'Groww',
    quantity: 60,
    investedAmount: 87600,
    currentValue: 91200,
    lastUpdated: new Date().toISOString(),
    sector: 'IT',
    country: 'India',
    tags: [DEMO_TAG],
    broker: 'manual',
    source: 'system',
    syncStatus: 'SYNCED',
    status: 'ACTIVE',
    costBasisMethod: 'AVERAGE',
    cashflowType: 'LUMPSUM',
  },
  {
    id: 'demo-inv-itc',
    name: 'ITC',
    ticker: 'ITC',
    type: 'Stocks' as any,
    platform: 'Zerodha',
    quantity: 200,
    investedAmount: 82000,
    currentValue: 89000,
    lastUpdated: new Date().toISOString(),
    sector: 'FMCG',
    country: 'India',
    tags: [DEMO_TAG],
    broker: 'manual',
    source: 'system',
    syncStatus: 'SYNCED',
    status: 'ACTIVE',
    costBasisMethod: 'AVERAGE',
    cashflowType: 'LUMPSUM',
  },
];

// ---------- Trades (8) — 4 wins, 2 losses, 2 breakeven ----------

const DEMO_TRADES: Array<Omit<Trade, 'id'> & { _stableKey: string }> = [
  {
    _stableKey: 'demo-trade-001',
    ticker: 'RELIANCE',
    direction: 'Long',
    entryPrice: 2420,
    exitPrice: 2480,
    quantity: 10,
    date: DAYS_AGO(48),
    entryTime: '09:35',
    moodEntry: 'Focused',
    moodExit: 'Satisfied',
    mistakes: [],
    setup: 'A+',
    grade: 'A+',
    pnl: 600,
    fees: 12,
    riskRewardRatio: 3.0,
    assetClass: 'Equity',
    productType: 'INTRADAY',
    orderType: 'MARKET',
    source: DEMO_SOURCE,
    notes: 'Clean breakout above ₹2420 resistance on above-average volume.',
  },
  {
    _stableKey: 'demo-trade-002',
    ticker: 'TCS',
    direction: 'Long',
    entryPrice: 3780,
    exitPrice: 3860,
    quantity: 5,
    date: DAYS_AGO(40),
    entryTime: '10:15',
    moodEntry: 'Focused',
    moodExit: 'Satisfied',
    mistakes: [],
    setup: 'A',
    grade: 'A',
    pnl: 400,
    fees: 9,
    riskRewardRatio: 2.5,
    assetClass: 'Equity',
    productType: 'INTRADAY',
    orderType: 'MARKET',
    source: DEMO_SOURCE,
    notes: 'Bought pullback to 20-EMA. Held for target.',
  },
  {
    _stableKey: 'demo-trade-003',
    ticker: 'HDFCBANK',
    direction: 'Long',
    entryPrice: 1525,
    exitPrice: 1505,
    quantity: 20,
    date: DAYS_AGO(32),
    entryTime: '14:20',
    moodEntry: 'Anxious',
    moodExit: 'Regret',
    mistakes: ['No Stop Loss'],
    setup: 'C',
    grade: 'C',
    pnl: -400,
    fees: 8,
    riskRewardRatio: 0,
    assetClass: 'Equity',
    productType: 'INTRADAY',
    orderType: 'MARKET',
    source: DEMO_SOURCE,
    notes: 'Averaged down without a stop. Should have honoured the line.',
  },
  {
    _stableKey: 'demo-trade-004',
    ticker: 'INFY',
    direction: 'Long',
    entryPrice: 1455,
    exitPrice: 1485,
    quantity: 15,
    date: DAYS_AGO(25),
    entryTime: '11:05',
    moodEntry: 'Focused',
    moodExit: 'Satisfied',
    mistakes: [],
    setup: 'A',
    grade: 'A',
    pnl: 450,
    fees: 7,
    riskRewardRatio: 2.0,
    assetClass: 'Equity',
    productType: 'INTRADAY',
    orderType: 'MARKET',
    source: DEMO_SOURCE,
    notes: 'Reversal at support with bullish divergence on RSI.',
  },
  {
    _stableKey: 'demo-trade-005',
    ticker: 'ITC',
    direction: 'Long',
    entryPrice: 408,
    exitPrice: 422,
    quantity: 100,
    date: DAYS_AGO(20),
    entryTime: '09:45',
    moodEntry: 'Focused',
    moodExit: 'Satisfied',
    mistakes: [],
    setup: 'B',
    grade: 'B',
    pnl: 1400,
    fees: 15,
    riskRewardRatio: 2.33,
    assetClass: 'Equity',
    productType: 'INTRADAY',
    orderType: 'MARKET',
    source: DEMO_SOURCE,
    notes: 'Range breakout with volume confirmation.',
  },
  {
    _stableKey: 'demo-trade-006',
    ticker: 'RELIANCE',
    direction: 'Short',
    entryPrice: 2510,
    exitPrice: 2495,
    quantity: 10,
    date: DAYS_AGO(14),
    entryTime: '13:10',
    moodEntry: 'Focused',
    moodExit: 'Satisfied',
    mistakes: [],
    setup: 'B',
    grade: 'B',
    pnl: 150,
    fees: 12,
    riskRewardRatio: 1.0,
    assetClass: 'Equity',
    productType: 'INTRADAY',
    orderType: 'MARKET',
    source: DEMO_SOURCE,
    notes: 'Failed breakout short, hit target.',
  },
  {
    _stableKey: 'demo-trade-007',
    ticker: 'TCS',
    direction: 'Long',
    entryPrice: 3920,
    exitPrice: 3915,
    quantity: 5,
    date: DAYS_AGO(7),
    entryTime: '10:50',
    moodEntry: 'Bored',
    moodExit: 'Satisfied',
    mistakes: ['Early Exit'],
    setup: 'D',
    grade: 'D',
    pnl: -25,
    fees: 9,
    riskRewardRatio: 0,
    assetClass: 'Equity',
    productType: 'INTRADAY',
    orderType: 'MARKET',
    source: DEMO_SOURCE,
    notes: 'Exited too early on noise. Lesson: trust the HTF level.',
  },
  {
    _stableKey: 'demo-trade-008',
    ticker: 'HDFCBANK',
    direction: 'Long',
    entryPrice: 1598,
    exitPrice: 1612,
    quantity: 20,
    date: DAYS_AGO(2),
    entryTime: '11:30',
    moodEntry: 'Focused',
    moodExit: 'Satisfied',
    mistakes: [],
    setup: 'A',
    grade: 'A',
    pnl: 280,
    fees: 8,
    riskRewardRatio: 2.0,
    assetClass: 'Equity',
    productType: 'INTRADAY',
    orderType: 'MARKET',
    source: DEMO_SOURCE,
    notes: 'Bull flag breakout. Clean R:R, full target.',
  },
];

// ---------- Daily Reviews (3) ----------

const DEMO_REVIEWS: DailyReview[] = [
  {
    date: DAYS_AGO(35),
    rating: 4,
    marketCondition: 'Trending',
    notes: `${DEMO_BANNER} Patience paid — sat on hands until A+ setup formed.`,
    didWell: 'Waited for the pullback instead of chasing the breakout.',
    didPoorly: 'Overtraded the first 30 minutes once.',
  },
  {
    date: DAYS_AGO(20),
    rating: 3,
    marketCondition: 'Choppy',
    notes: `${DEMO_BANNER} Mixed day — one clean win, one chop loss. Size discipline held.`,
    didWell: 'Cut the HDFCBANK trade at -0.5R before plan said -1R.',
    didPoorly: 'Took a C-grade setup out of boredom.',
  },
  {
    date: DAYS_AGO(5),
    rating: 5,
    marketCondition: 'Trending',
    notes: `${DEMO_BANNER} Textbook session. Two A-setups, both worked.`,
    didWell: 'Sized correctly, honoured stops, journaled in real-time.',
    didPoorly: 'Nothing meaningful.',
  },
];

// ---------- Mistake (1) ----------

const DEMO_MISTAKE: Mistake = {
  id: 'demo-mistake-001',
  date: DAYS_AGO(32),
  title: `${DEMO_BANNER} Averaged down without a stop (HDFCBANK)`,
  cost: 400,
  category: 'TRADING',
} as Mistake;

// ---------- Goal (1) ----------

const DEMO_GOAL: Goal = {
  id: undefined, // autoincrement
  name: 'Retirement corpus',
  targetAmount: 50000000,
  targetDate: '2047-01-01',
  currentAmount: 2500000,
  priority: 'Critical',
  category: 'Retirement',
  color: '#6366f1',
  inflationRate: 6,
  createdAt: new Date().toISOString(),
  notes: '__demo__ seed',
} as Goal;

// ---------- Public API ----------

export interface DemoSeedResult {
  inserted: { holdings: number; trades: number; reviews: number; mistakes: number; goals: number };
  skipped: { holdings: number; trades: number; reviews: number; mistakes: number; goals: number };
}

/**
 * Idempotent — safe to call on every boot. Inserts only rows that don't
 * already exist (keyed by the stable ID/date columns above).
 */
export async function seedDemoPortfolio(): Promise<DemoSeedResult> {
  const result: DemoSeedResult = {
    inserted: { holdings: 0, trades: 0, reviews: 0, mistakes: 0, goals: 0 },
    skipped: { holdings: 0, trades: 0, reviews: 0, mistakes: 0, goals: 0 },
  };

  // Holdings
  for (const inv of DEMO_HOLDINGS) {
    const existing = await db.investments.get(inv.id!);
    if (existing) {
      result.skipped.holdings++;
      continue;
    }
    await db.investments.put(inv);
    result.inserted.holdings++;
  }

  // Trades — keyed by (ticker, date, entryTime, direction)
  for (const t of DEMO_TRADES) {
    const found = await db.trades
      .where('ticker').equals(t.ticker)
      .and((row) => row.date === t.date && row.entryTime === t.entryTime && row.direction === t.direction)
      .first();
    if (found) {
      result.skipped.trades++;
      continue;
    }
    const { _stableKey, ...trade } = t as any;
    await db.trades.add(trade as Trade);
    result.inserted.trades++;
  }

  // DailyReviews — keyed by date (Primary Key on the table)
  for (const r of DEMO_REVIEWS) {
    const existing = await db.daily_reviews.get(r.date);
    if (existing) {
      result.skipped.reviews++;
      continue;
    }
    await db.daily_reviews.add(r);
    result.inserted.reviews++;
  }

  // Mistake — keyed by id
  const existingMistake = await db.mistakes.get(DEMO_MISTAKE.id);
  if (existingMistake) {
    result.skipped.mistakes++;
  } else {
    await db.mistakes.put(DEMO_MISTAKE);
    result.inserted.mistakes++;
  }

  // Goal — only one demo goal, idempotent via the unique notes marker
  const existingGoals = await db.goals.toArray();
  const existingDemoGoal = existingGoals.find((g) => g.notes === '__demo__ seed');
  if (existingDemoGoal) {
    result.skipped.goals++;
  } else {
    await db.goals.add(DEMO_GOAL);
    result.inserted.goals++;
  }

  logger.log('seedDemoPortfolio', `seed complete`, result);
  return result;
}

/**
 * Soft-deletes every demo-tagged row across the affected tables.
 * Real user data is untouched. The existing soft-delete lane
 * (`utils/storeHelpers.withSoftDelete`) excludes `isDeleted` rows
 * from `active()` views automatically.
 *
 * Returns the count of rows soft-deleted per table.
 */
export async function clearDemoPortfolio(): Promise<DemoSeedResult['inserted']> {
  const counts = { holdings: 0, trades: 0, reviews: 0, mistakes: 0, goals: 0 };

  // Holdings: tags includes __demo__
  const holdings = await db.investments.toArray();
  for (const h of holdings) {
    const tags = (h as any).tags as string[] | undefined;
    if (tags?.includes(DEMO_TAG) && h.id) {
      await db.investments.update(h.id, { isDeleted: true, deletedAt: Date.now() } as any);
      counts.holdings++;
    }
  }

  // Trades: source === 'demo-seed-v1'
  const trades = await db.trades.toArray();
  for (const t of trades) {
    if ((t as any).source === DEMO_SOURCE && t.id !== undefined) {
      await db.trades.update(t.id, { isDeleted: true, deletedAt: Date.now() } as any);
      counts.trades++;
    }
  }

  // DailyReviews: notes starts with [demo]
  const reviews = await db.daily_reviews.toArray();
  for (const r of reviews) {
    if ((r as any).notes?.startsWith(DEMO_BANNER)) {
      await db.daily_reviews.update((r as any).date, { isDeleted: true, deletedAt: Date.now() } as any);
      counts.reviews++;
    }
  }

  // Mistakes: id starts with demo-mistake-
  const mistakes = await db.mistakes.toArray();
  for (const m of mistakes) {
    if (m.id?.startsWith('demo-mistake-')) {
      await db.mistakes.update(m.id, { isDeleted: true, deletedAt: Date.now() } as any);
      counts.mistakes++;
    }
  }

  // Goals: notes === '__demo__ seed'
  const goals = await db.goals.toArray();
  for (const g of goals) {
    if ((g as any).notes === '__demo__ seed' && g.id !== undefined) {
      await db.goals.update(g.id, { isDeleted: true, deletedAt: Date.now() } as any);
      counts.goals++;
    }
  }

  logger.log('clearDemoPortfolio', `cleared demo rows`, counts);
  return counts;
}

/**
 * Returns true if any demo row exists in any of the demo-eligible tables.
 * Cheap enough to call on every Dashboard mount.
 */
export async function hasDemoRows(): Promise<boolean> {
  const inv = await db.investments
    .filter((h: Investment) => h.tags?.includes(DEMO_TAG) === true)
    .first();
  if (inv) return true;
  const trd = await db.trades.filter((t: Trade) => t.source === DEMO_SOURCE).first();
  if (trd) return true;
  const rev = await db.daily_reviews
    .filter((r: DailyReview) => r.notes?.startsWith(DEMO_BANNER) === true)
    .first();
  if (rev) return true;
  const mst = await db.mistakes
    .filter((m: Mistake) => m.id?.startsWith('demo-mistake-') === true)
    .first();
  if (mst) return true;
  const gl = await db.goals
    .filter((g: Goal) => g.notes === '__demo__ seed')
    .first();
  return Boolean(gl);
}

/**
 * Returns a fast count of demo rows across tables. Used by the
 * DemoModePill label.
 */
export async function countDemoRows(): Promise<number> {
  const invCount = await db.investments
    .filter((h: Investment) => h.tags?.includes(DEMO_TAG) === true)
    .count();
  const trdCount = await db.trades
    .filter((t: Trade) => t.source === DEMO_SOURCE)
    .count();
  const revCount = await db.daily_reviews
    .filter((r: DailyReview) => r.notes?.startsWith(DEMO_BANNER) === true)
    .count();
  const mstCount = await db.mistakes
    .filter((m: Mistake) => m.id?.startsWith('demo-mistake-') === true)
    .count();
  const glCount = await db.goals
    .filter((g: Goal) => g.notes === '__demo__ seed')
    .count();
  return invCount + trdCount + revCount + mstCount + glCount;
}

/**
 * Restores demo rows that were soft-deleted by clearDemoPortfolio.
 * Used by the undo affordance (lib/undoStack.ts) so the user can
 * recover within the 30s toast window without re-seeding.
 */
export async function restoreDemoPortfolio(): Promise<DemoSeedResult['inserted']> {
  const counts = { holdings: 0, trades: 0, reviews: 0, mistakes: 0, goals: 0 };

  const holdings = await db.investments.toArray();
  for (const h of holdings) {
    const tags = (h as any).tags as string[] | undefined;
    if (tags?.includes(DEMO_TAG) && (h as any).isDeleted && h.id) {
      await db.investments.update(h.id, { isDeleted: false, deletedAt: undefined } as any);
      counts.holdings++;
    }
  }

  const trades = await db.trades.toArray();
  for (const t of trades) {
    if ((t as any).source === DEMO_SOURCE && (t as any).isDeleted && t.id !== undefined) {
      await db.trades.update(t.id, { isDeleted: false, deletedAt: undefined } as any);
      counts.trades++;
    }
  }

  const reviews = await db.daily_reviews.toArray();
  for (const r of reviews) {
    if ((r as any).notes?.startsWith(DEMO_BANNER) && (r as any).isDeleted) {
      await db.daily_reviews.update((r as any).date, { isDeleted: false, deletedAt: undefined } as any);
      counts.reviews++;
    }
  }

  const mistakes = await db.mistakes.toArray();
  for (const m of mistakes) {
    if (m.id?.startsWith('demo-mistake-') && (m as any).isDeleted) {
      await db.mistakes.update(m.id, { isDeleted: false, deletedAt: undefined } as any);
      counts.mistakes++;
    }
  }

  const goals = await db.goals.toArray();
  for (const g of goals) {
    if ((g as any).notes === '__demo__ seed' && (g as any).isDeleted && g.id !== undefined) {
      await db.goals.update(g.id, { isDeleted: false, deletedAt: undefined } as any);
      counts.goals++;
    }
  }

  logger.log('restoreDemoPortfolio', `restored demo rows`, counts);
  return counts;
}

// Dev-only convenience: expose to window for manual idempotency testing.
// Only attaches in DEV mode (vite import.meta.env.DEV).
if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
  (globalThis as any).__wa = (globalThis as any).__wa ?? {};
  (globalThis as any).__wa.seedDemoPortfolio = seedDemoPortfolio;
  (globalThis as any).__wa.clearDemoPortfolio = clearDemoPortfolio;
  (globalThis as any).__wa.hasDemoRows = hasDemoRows;
  (globalThis as any).__wa.countDemoRows = countDemoRows;
  (globalThis as any).__wa.restoreDemoPortfolio = restoreDemoPortfolio;
}
