// services/ml/TradeLegsIngest.ts
// Pure functions to convert per-day JSON dumps (from
// python-bridge/scripts/backfill_trade_legs.py) into round-trip Trade-like
// objects suitable for the existing ML Labeler.
//
// Why not just feed db.trades? Because the journal collapses multi-leg
// round-trips into one PnL row, losing training signal. Per-leg data
// preserves the buy/sell timing, partial fills, and any per-leg charges.
//
// The Dexie ingest itself is trivial (db.trade_legs.bulkPut) and is wired up
// in services/ml/retrain.ts. This file is the pure transformation layer
// and is exhaustively unit-tested.

import type { TradeLeg, Trade, TradeDirection } from '../../database';

export interface DayFile {
  date: string;
  fetched_at?: string;
  leg_count: number;
  legs: TradeLeg[];
}

export interface RoundTripGroup {
  ticker: string;
  securityId: string;
  productType: string;
  date: string;
  buyLegs:  TradeLeg[];
  sellLegs: TradeLeg[];
}

export function parseDayFile(json: string): DayFile {
  const obj = JSON.parse(json);
  if (typeof obj !== 'object' || obj === null) {
    throw new Error('parseDayFile: top-level must be an object');
  }
  if (typeof obj.date !== 'string') {
    throw new Error('parseDayFile: missing "date" field');
  }
  if (!Array.isArray(obj.legs)) {
    throw new Error('parseDayFile: "legs" must be an array');
  }
  return {
    date: obj.date,
    fetched_at: obj.fetched_at,
    leg_count: obj.leg_count ?? obj.legs.length,
    legs: obj.legs as TradeLeg[],
  };
}

/**
 * Group legs into round-trips. Key = securityId + productType (same convention
 * the SyncTradesButton uses, minus the date so cross-date holdings still group).
 */
export function groupLegsIntoRoundTrips(legs: TradeLeg[]): RoundTripGroup[] {
  const buckets = new Map<string, RoundTripGroup>();
  for (const leg of legs) {
    const key = `${leg.securityId}::${leg.productType}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        ticker: leg.ticker,
        securityId: leg.securityId,
        productType: leg.productType,
        date: leg.date,
        buyLegs: [],
        sellLegs: [],
      });
    }
    const g = buckets.get(key)!;
    if (leg.transactionType === 'BUY') g.buyLegs.push(leg);
    else if (leg.transactionType === 'SELL') g.sellLegs.push(leg);
  }
  // Sort each bucket chronologically
  for (const g of buckets.values()) {
    const byTime = (a: TradeLeg, b: TradeLeg) =>
      new Date(a.exchangeTime.replace(' ', 'T')).getTime() -
      new Date(b.exchangeTime.replace(' ', 'T')).getTime();
    g.buyLegs.sort(byTime);
    g.sellLegs.sort(byTime);
  }
  return Array.from(buckets.values());
}

function weightedAvg(legs: TradeLeg[]): { avg: number; qty: number } {
  let totalVal = 0;
  let totalQty = 0;
  for (const l of legs) {
    totalVal += l.tradedPrice * l.tradedQuantity;
    totalQty += l.tradedQuantity;
  }
  return { avg: totalQty > 0 ? totalVal / totalQty : 0, qty: totalQty };
}

function firstTime(legs: TradeLeg[], fallback: string): string {
  if (legs.length === 0) return fallback;
  const sorted = [...legs].sort((a, b) =>
    new Date(a.exchangeTime.replace(' ', 'T')).getTime() -
    new Date(b.exchangeTime.replace(' ', 'T')).getTime()
  );
  const t = sorted[0].exchangeTime.split(' ')[1] || fallback;
  return t.slice(0, 5);   // HH:MM
}

function lastTime(legs: TradeLeg[], fallback: string): string {
  if (legs.length === 0) return fallback;
  const sorted = [...legs].sort((a, b) =>
    new Date(b.exchangeTime.replace(' ', 'T')).getTime() -
    new Date(a.exchangeTime.replace(' ', 'T')).getTime()
  );
  const t = sorted[0].exchangeTime.split(' ')[1] || fallback;
  return t.slice(0, 5);   // HH:MM
}

function sumFees(legs: TradeLeg[]): number {
  let s = 0;
  for (const l of legs) {
    s += (l.stt ?? 0) + (l.sebiTax ?? 0) + (l.brokerageCharges ?? 0)
       + (l.serviceTax ?? 0) + (l.exchangeTransactionCharges ?? 0)
       + (l.stampDuty ?? 0);
  }
  return Number(s.toFixed(2));
}

/**
 * Convert a single round-trip group into a Trade-like object that the
 * existing ML Labeler can consume (via buildTrainingRows). Charges and
 * mae/mfe default to 0 because the legs alone don't capture the MFE/MAE
 * curve — that needs the intraday candle series and is left to a future
 * enrichment step. We compute pnl here so hitProb is correct.
 */
export function legsToSyntheticTrade(group: RoundTripGroup): Trade {
  const buy  = weightedAvg(group.buyLegs);
  const sell = weightedAvg(group.sellLegs);

  // If open (only one side), entryPrice/exitPrice fall back to the avg we have.
  const entryPrice = buy.avg;
  const exitPrice  = sell.qty > 0 ? sell.avg : buy.avg;
  const closedQty  = Math.min(buy.qty, sell.qty);
  const pnl        = (sell.avg - buy.avg) * closedQty;

  // Direction: SELL first → short; otherwise long.
  const direction: TradeDirection = (
    group.sellLegs.length > 0 &&
    group.buyLegs.length > 0 &&
    new Date(group.sellLegs[0].exchangeTime.replace(' ', 'T')).getTime() <
        new Date(group.buyLegs[0].exchangeTime.replace(' ', 'T')).getTime()
  ) ? 'Short' : 'Long';

  return {
    ticker: group.ticker,
    direction,
    quantity: closedQty > 0 ? closedQty : Math.max(buy.qty, sell.qty),
    entryPrice: Number(entryPrice.toFixed(2)),
    exitPrice:  Number(exitPrice.toFixed(2)),
    date: group.date,
    entryTime: firstTime(group.buyLegs, '09:15'),
    exitTime:  lastTime(group.sellLegs, firstTime(group.buyLegs, '15:30')),
    moodEntry: 'Focused', moodExit: 'Satisfied', mistakes: [],
    pnl: Number(pnl.toFixed(2)),
    fees: sumFees([...group.buyLegs, ...group.sellLegs]),
    mae: 0,
    mfe: 0,
    notes: `productType=${group.productType} | legs=${group.buyLegs.length + group.sellLegs.length}`,
    productType: group.productType,
  } as Trade;
}
