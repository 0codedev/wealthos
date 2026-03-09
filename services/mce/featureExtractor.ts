// services/mce/featureExtractor.ts
// Pure functions that extract MCE features from existing services.
// All inputs are read-only. Every field that can be null IS allowed to be null
// (that's the contract — the scorer handles nulls as 0.5 with a reason string).
// Spec: docs/superpowers/specs/2026-06-17-mcs-momentum-continuation-score-design.md §3.1

import {
  MceFeatureVector,
  HtfFeatures,
  IndicatorFeatures,
  FlowFeatures,
  RegimeFeatures,
  MceIntent,
} from './types';
import { orderBookIntelligenceService } from '../OrderBookIntelligenceService';
import { optionChainService } from '../OptionChainService';
import { alphaEngineService } from '../AlphaEngineService';
import { logger } from '../Logger';

function safeNum(x: unknown): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  return x;
}

function pickNearestLevel(ltp: number, levels: (number | null)[]): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const lvl of levels) {
    if (lvl == null) continue;
    const d = Math.abs(ltp - lvl);
    if (d < bestDist) {
      bestDist = d;
      best = lvl;
    }
  }
  return best;
}

function findStock(symbol: string): any | null {
  try {
    const stocks = alphaEngineService.getCachedStocks?.() ?? [];
    return stocks.find((s: any) => s?.symbol === symbol) ?? null;
  } catch {
    return null;
  }
}

export async function extractHtfFeatures(symbol: string): Promise<HtfFeatures> {
  const stock = findStock(symbol);
  const ltp = safeNum(stock?.lastPrice) ?? 0;
  let priorDayHigh: number | null = null;
  let priorDayLow: number | null = null;
  let priorWeekHigh: number | null = null;
  let priorWeekLow: number | null = null;
  let vwap: number | null = null;
  let last4hSwingHigh: number | null = null;
  let last4hSwingLow: number | null = null;

  try {
    const levels = (stock as any)?.levels ?? (stock as any)?.historicalLevels ?? null;
    if (levels) {
      priorDayHigh = safeNum(levels.priorDayHigh);
      priorDayLow  = safeNum(levels.priorDayLow);
      priorWeekHigh = safeNum(levels.priorWeekHigh);
      priorWeekLow  = safeNum(levels.priorWeekLow);
      vwap = safeNum(levels.vwap);
      last4hSwingHigh = safeNum(levels.last4hSwingHigh);
      last4hSwingLow  = safeNum(levels.last4hSwingLow);
    }
  } catch (err) {
    logger.debug('[MCE][HTF] historical levels unavailable', { symbol, err });
  }

  const nearest = pickNearestLevel(ltp, [
    priorDayHigh, priorDayLow, priorWeekHigh, priorWeekLow,
    last4hSwingHigh, last4hSwingLow,
  ]);
  const nearLevelPct = nearest == null || ltp === 0 ? null : Math.abs(ltp - nearest) / ltp * 100;

  return {
    priorDayHigh, priorDayLow, priorWeekHigh, priorWeekLow,
    vwap, last4hSwingHigh, last4hSwingLow,
    ltp,
    abovePriorDayHigh: priorDayHigh == null ? null : ltp > priorDayHigh,
    aboveVwap:         vwap == null ? null : ltp > vwap,
    nearLevelPct,
  };
}

export async function extractIndicatorFeatures(symbol: string): Promise<IndicatorFeatures> {
  const stock = findStock(symbol);
  const rsi14    = safeNum((stock as any)?.rsi14);
  const macdHist = safeNum((stock as any)?.macdHist);
  const adx14    = safeNum((stock as any)?.adx14);
  const emaStackRaw = (stock as any)?.emaStack as 'BULL' | 'BEAR' | 'MIXED' | undefined;
  const emaStack: IndicatorFeatures['emaStack'] =
    emaStackRaw === 'BULL' || emaStackRaw === 'BEAR' || emaStackRaw === 'MIXED' ? emaStackRaw : null;
  return { rsi14, macdHist, emaStack, adx14 };
}

export async function extractFlowFeatures(symbol: string): Promise<FlowFeatures> {
  let sig: any = null;
  try {
    sig = orderBookIntelligenceService.getSignal(symbol);
  } catch (err) {
    logger.debug('[MCE][FLOW] orderBook signal unavailable', { symbol, err });
  }
  let chain: any = null;
  try {
    if (typeof (optionChainService as any).getSnapshot === 'function') {
      chain = (optionChainService as any).getSnapshot(symbol);
    } else if (typeof (optionChainService as any).getChain === 'function') {
      chain = (optionChainService as any).getChain(symbol);
    }
  } catch {
    chain = null;
  }

  const obi = sig ? safeNum(sig.bidAskImbalance) : null;
  const bidWall = sig?.largestBidWall && sig.largestBidWall.qty > 0
    ? { price: sig.largestBidWall.price, qty: sig.largestBidWall.qty }
    : null;
  const askWall = sig?.largestAskWall && sig.largestAskWall.qty > 0
    ? { price: sig.largestAskWall.price, qty: sig.largestAskWall.qty }
    : null;
  const absorption = sig ? safeNum(sig.absorptionRate) : null;

  const oiDeltaPct = chain ? safeNum(chain.oiDeltaPct) : null;
  const pcr = chain ? safeNum(chain.pcr) : null;

  return { obi, bidWall, askWall, absorption, oiDeltaPct, pcr };
}

export async function extractRegimeFeatures(symbol: string): Promise<RegimeFeatures> {
  const stock = findStock(symbol);
  const sectorRs = safeNum((stock as any)?.sectorStrengthRatio);

  let niftyTrend: RegimeFeatures['niftyTrend'] = null;
  let vixBucket: RegimeFeatures['vixBucket'] = null;
  try {
    const sectors = alphaEngineService.getCachedSectors?.() ?? [];
    const nifty = sectors.find((s: any) => /nifty\s*50/i.test(s.sector));
    if (nifty) {
      niftyTrend = nifty.percentChange > 0.3 ? 'UP'
                 : nifty.percentChange < -0.3 ? 'DOWN'
                 : 'SIDEWAYS';
    }
    const vix = sectors.find((s: any) => /vix/i.test(s.sector));
    if (vix) {
      vixBucket = vix.lastPrice < 14 ? 'LOW'
                : vix.lastPrice > 20 ? 'HIGH'
                : 'NORMAL';
    }
  } catch (err) {
    logger.debug('[MCE][REGIME] sector cache unavailable', { err });
  }

  return { sectorRs, niftyTrend, vixBucket };
}

export async function extractFeatures(
  symbol: string,
  intent: MceIntent,
  now: number
): Promise<MceFeatureVector> {
  const [htf, indicators, flow, regime] = await Promise.all([
    extractHtfFeatures(symbol),
    extractIndicatorFeatures(symbol),
    extractFlowFeatures(symbol),
    extractRegimeFeatures(symbol),
  ]);
  return { symbol, asOf: now, intent, htf, indicators, flow, regime };
}