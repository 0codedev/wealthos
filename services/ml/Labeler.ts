// services/ml/Labeler.ts
// Trade + MceFeatureVector → TrainingRow[]
// Also: TradeLeg[] → TrainingRow[] (Phase B leg splitter).

import type { TrainingRow, MceFeatureVector, RegimeBucket } from '../mce/types';
import type { Trade, TradeLeg } from '../../database';
import { classifyRegime } from './RegimeClassifier';
import { groupLegsIntoRoundTrips, legsToSyntheticTrade, type RoundTripGroup } from './TradeLegsIngest';

const MIN_DATE = '2025-01-01';
const MAX_HOLDING_MIN = 390;

function parseMinutes(entryTime?: string, exitTime?: string): number | null {
  if (!entryTime || !exitTime) return null;
  const [eh, em] = entryTime.split(':').map(Number);
  const [xh, xm] = exitTime.split(':').map(Number);
  if ([eh, em, xh, xm].some(Number.isNaN)) return null;
  let mins = (xh * 60 + xm) - (eh * 60 + em);
  if (mins < 0) mins += 24 * 60;
  return mins;
}

export function buildTrainingRows(
  trades: Trade[],
  getFeaturesForTrade: (trade: Trade) => MceFeatureVector | null,
): TrainingRow[] {
  const rows: TrainingRow[] = [];
  for (const trade of trades) {
    if (!trade.date || trade.date < MIN_DATE) continue;
    const holdingMinutes = parseMinutes((trade as any).entryTime, (trade as any).exitTime);
    if (holdingMinutes == null || holdingMinutes >= MAX_HOLDING_MIN) continue;
    if (!(trade.entryPrice > 0) || !(trade.exitPrice > 0)) continue;

    const pnl = trade.pnl ?? (trade.exitPrice - trade.entryPrice) * trade.quantity;
    const favorable = Math.abs(trade.mfe ?? pnl);
    const adverse   = Math.max(1, Math.abs(trade.mae ?? -pnl * 0.5));
    const mfeMaeRatio = favorable / adverse;
    if (mfeMaeRatio > 10) continue;

    const hitProb = pnl > 0 ? 1.0 : 0.0;
    const features = getFeaturesForTrade(trade) ?? minimalFeatureVector(trade);
    const regime: RegimeBucket = classifyRegime(features.regime);

    rows.push({
      symbol: trade.ticker,
      asOf: new Date(trade.date).getTime(),
      features,
      hitProb,
      mfeMaeRatio,
      regime,
      pnl,
      holdingMinutes,
    });
  }
  return rows;
}

function minimalFeatureVector(trade: Trade): MceFeatureVector {
  return {
    symbol: trade.ticker,
    asOf: new Date(trade.date).getTime(),
    intent: 'PRE_ENTRY',
    htf: {
      priorDayHigh: null, priorDayLow: null, priorWeekHigh: null, priorWeekLow: null,
      vwap: null, last4hSwingHigh: null, last4hSwingLow: null,
      ltp: trade.entryPrice, abovePriorDayHigh: null, aboveVwap: null, nearLevelPct: null,
    },
    indicators: { rsi14: null, macdHist: null, emaStack: null, adx14: null },
    flow: { obi: null, bidWall: null, askWall: null, absorption: null, oiDeltaPct: null, pcr: null },
    regime: { sectorRs: null, niftyTrend: null, vixBucket: null },
  };
}

/**
 * Phase B: build TrainingRow[] from per-leg TradeLeg rows (the Dhan backfill).
 * Wraps the existing buildTrainingRows by converting legs → synthetic Trades
 * via legsToSyntheticTrade. This is how the Labeler can be fed 2-4x more
 * training rows than the combined Trade table alone.
 */
export function buildTrainingRowsFromLegs(
  legs: TradeLeg[],
  getFeaturesForTrade: (trade: Trade) => MceFeatureVector | null,
): TrainingRow[] {
  const groups: RoundTripGroup[] = groupLegsIntoRoundTrips(legs);
  const syntheticTrades = groups.map(legsToSyntheticTrade);
  return buildTrainingRows(syntheticTrades, getFeaturesForTrade);
}
