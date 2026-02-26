// services/alpha/UnifiedAlphaInputs.ts
// CC68.28 — Single funnel that all 3 engines (VerdictEngine, ConvictionEngine,
// MCS) read from. Replaces 4 separate "wired-through but unused" gaps
// (qualityDataCache, valuationDataCache, derivativeSummaryData, patternMap)
// + the 5 "fetched-orphan" cards (Earnings, Lot Size, Delivery, Insider, MF).
//
// This is the Phase 2 deliverable. The bundle exists; the engines don't read
// it yet. Phase 3 (VerdictEngine) and Phase 4 (ConvictionEngine) will migrate
// onto it. Until then, behavior is unchanged.
//
// Design principles:
//   • No I/O. Pure function. ~0.1 ms per call.
//   • No new dependencies.
//   • Missing data is null (engines treat null as "data unavailable" → 0.5).
//   • One place to look when debugging "why did this score X?".

import type { McsSnapshot } from '../mce/types';
import type {
  ShareholdingActivityItem,
  QualityScoreItem,
  LotSizeItem,
  FiiDiiFlowsItem,
  ParticipantOiItem,
  DerivativeSummaryItem,
  ResultsCalendarItem,
  CandlestickResponse,
} from './ShadowScreenerService';

// ──────────────────────────────────────────────────────────────────────────
// Input shape — the cache interface the bundle reads from
// ──────────────────────────────────────────────────────────────────────────

/**
 * Minimal interface the bundle needs from the React hook. Decoupling lets
 * us call `buildAlphaInputs` from a worker, a test, or a non-React context.
 * Every field is optional — the bundle treats absent fields as "data unavailable".
 */
export interface AlphaStateSources {
  // Caches populated by ShadowScreenerService
  shareholdingDataCache?: Record<string, ShareholdingActivityItem[]>;
  valuationDataCache?: Record<string, any[]>;
  qualityDataCache?: Record<string, QualityScoreItem[]>;
  orbDataCache?: Record<string, any[]>;
  dailyCandleData?: CandlestickResponse | null;
  weeklyCandleData?: CandlestickResponse | null;
  fiiDiiPulseData?: FiiDiiFlowsItem[];
  participantOiData?: ParticipantOiItem[];
  derivativeSummaryData?: DerivativeSummaryItem[];
  lotSizesData?: LotSizeItem[];
  resultsCalendarData?: ResultsCalendarItem[];
  historicalDataCache?: Record<string, any[]>;
  boosterStocksList?: any[];

  // Derived maps (populated in useAlphaEngineState)
  shareholdingMap?: Record<string, {
    fii_velocity?: number | null;
    dii_velocity?: number | null;
    promoter_velocity?: number | null;
    accumulation_flag?: 'ACCUMULATING' | 'EXITING' | 'NEUTRAL' | null;
    ownership_momentum_score?: number | null;
  }>;
  patternMap?: Record<string, {
    pattern_type?: string;
    pattern_sentiment?: 'Bullish' | 'Bearish';
    timeframe?: 'daily' | 'weekly';
  }>;
  oiSignalMap?: Record<string, 'LONG_BUILDUP' | 'SHORT_COVERING' | 'SHORT_BUILDUP' | 'LONG_UNWIND' | 'NEUTRAL'>;
  oreMap?: Record<string, { score?: number; direction?: 'BULLISH' | 'BEARISH' | 'NEUTRAL' } | undefined>;
  cvdMap?: Record<string, number>;
  rsMap?: Record<string, { rank?: number; category?: 'LEADER' | 'LAGGARD' | 'NEUTRAL' } | undefined>;
  volumeAverages?: Record<string, number>;

  // From live Upstox (optional — usually a per-row Quote)
  liveQuotes?: Record<string, {
    ltp?: number;
    last_price?: number;
    volume?: number;
    ohlc?: { open?: number; high?: number; low?: number; close?: number };
    change?: number;
    change_pct?: number;
    depth_pressure?: 'BUY_SIDE' | 'SELL_SIDE' | 'NEUTRAL';
    vwap?: number;
    avg_trade_price?: number;
  }>;

  // Per-symbol Delivery% (from Institutional Delivery Radar card #12)
  deliveryBySymbol?: Record<string, { pct: number; is_institutional: boolean }>;

  // Per-symbol MF net flow (from MF Smart Money Flow card #14)
  mfFlowBySymbol?: Record<string, { net_qty: number; amc_count: number; pct_change: number }>;

  // Per-symbol Insider net (from Insider Governance Tracker card #13)
  insiderBySymbol?: Record<string, { net_value: number; buy_count: number; sell_count: number }>;

  // MCS snapshot from mceOrchestrator
  mcsBySymbol?: Record<string, McsSnapshot | null>;
}

// ──────────────────────────────────────────────────────────────────────────
// Bundle shape — what the engines consume
// ──────────────────────────────────────────────────────────────────────────

export type Segment = 'cash' | 'fno';
export type Direction = 'CALL' | 'PUT';

export interface AlphaInputsBundle {
  symbol: string;
  segment: Segment;
  direction: Direction;

  // Card #6 — Institutional Radar
  shareholding: {
    fii_buy_match: ShareholdingActivityItem | null;
    fii_sell_match: ShareholdingActivityItem | null;
    promoter_buy_match: ShareholdingActivityItem | null;
    promoter_sell_match: ShareholdingActivityItem | null;
    ownership_momentum_score: number | null;          // 0.4·FII + 0.3·DII + 0.3·Promoter
    fii_velocity: number | null;
    dii_velocity: number | null;
    promoter_velocity: number | null;
    accumulation_flag: 'ACCUMULATING' | 'EXITING' | 'NEUTRAL' | null;
    qtr_roce: number | null;
    qtr_profit_var: number | null;
    qtr_sales_var: number | null;
    div_yield: number | null;
    pe: number | null;
    market_cap_cr: number | null;
  } | null;

  // Card #4 — Intrinsic Value Audit
  valuation: {
    upside_pct: number | null;                       // ((intrinsic − LTP) / LTP) × 100
    intrinsic: number | null;
    ltp: number | null;
    roce: number | null;
    roe: number | null;
    eps: number | null;
    pb: number | null;
    market_cap_cr: number | null;
    sector: string | null;
    rating: string | null;
    type: 'under_valued' | 'over_valued' | null;
  } | null;

  // Card #7 — Quality Scorecard
  quality: {
    total_score: number | null;                       // 0..100
    rating: 'BUY' | 'HOLD' | 'SELL' | null;
    profitability: number | null;
    growth: number | null;
    valuation_sub: number | null;
    cash_flow: number | null;
    financial_strength: number | null;
    management: number | null;
    moat: number | null;
    risk: number | null;
    momentum: number | null;
    intrinsic: number | null;
    div_yield: number | null;
    roce: number | null;
    roe: number | null;
  } | null;

  // Card #3 — Opening Range Breakout
  orb: {
    breakout: 'Bullish' | 'Bearish' | null;
    orb_price: number | null;
    orb_time: string | null;
    ltp: number | null;
    minutes: number | null;
    prb_mode: boolean;
  } | null;

  // Card #1 — CandleSticks Screener
  candle: {
    daily: { pattern_type: string | null; pattern_sentiment: 'Bullish' | 'Bearish' | null } | null;
    weekly: { pattern_type: string | null; pattern_sentiment: 'Bullish' | 'Bearish' | null } | null;
  };

  // Card #11 — FII/DII Sentiment & Radar (composite)
  fiiDii: {
    fii_cash_net_cr: number | null;
    dii_cash_net_cr: number | null;
    fii_index_fut_net: number | null;
    fii_total_oi_net: number | null;
    composite_sentiment: number | null;               // -6..+6
    latest_date: string | null;
    nifty_ltp: number | null;
    nifty_change_pct: number | null;
    vix: number | null;
  } | null;

  // Card #11 — derivative quadrant (per-stock)
  derivativeQuadrant: {
    built_up: 'long_build_up' | 'short_covering' | 'short_build_up' | 'long_unwinding' | null;
    oi_change_pct: number | null;
    price_change_pct: number | null;
  } | null;

  // Card #11 — participant OI summary
  participantOi: {
    fii_net_oi: number | null;
    dii_net_oi: number | null;
    client_net_oi: number | null;
    pro_net_oi: number | null;
  } | null;

  // Card #10 — F&O Lot Sizes
  lotSize: number | null;

  // Card #5 — Earnings Calendar
  earnings: {
    meeting_date: string | null;
    days_until: number | null;                        // negative = already happened
    imminent: boolean;                                // < 2 days
    today: boolean;
  } | null;

  // Card #12 — Institutional Delivery Radar
  delivery: {
    pct: number | null;
    is_institutional: boolean;
  } | null;

  // Card #13 — Insider Governance Tracker
  insider: {
    net_value_cr: number | null;                      // positive = net buying
    buy_count: number | null;
    sell_count: number | null;
    significant_exit: boolean;                        // > 5 Cr net selling
  } | null;

  // Card #14 — MF Smart Money Flow
  mfFlow: {
    net_qty: number | null;                           // positive = net buying
    amc_count: number | null;
    pct_change: number | null;
    significant_exit: boolean;                        // < -5% across top 5
  } | null;

  // Card #15 — Order Flow Analytics (Upstox TBT)
  orderFlow: {
    cvd: number | null;
    obi: number | null;
    bid_wall_qty: number | null;
    ask_wall_qty: number | null;
    absorption: number | null;
    ore_score: number | null;
    ore_direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | null;
  } | null;

  // Card #16 — OI / PCR Command Center
  optionChain: {
    spot: number | null;
    max_pain: number | null;
    pcr: number | null;
    iv_skew_atm: number | null;
    magnet_strike: number | null;
    gex: { net_cr: number | null; dataQuality: 'THIN' | 'NORMAL' | 'DEEP' | null } | null;
    expiry: string | null;
  } | null;

  // Card #2 / #9 — historical gainers / losers / FnO Movements
  historical: {
    is_weekly_gainer: boolean;
    is_monthly_gainer: boolean;
    is_yearly_gainer: boolean;
    is_weekly_loser: boolean;
    is_monthly_loser: boolean;
    is_fno_pulse: boolean;
  };

  // Card #8 — Momentum Hub (news / telegram signal)
  momentumHub: {
    has_news_catalyst: boolean;
    news_sentiment: 'Bullish' | 'Bearish' | 'Neutral' | null;
  } | null;

  // Live quote summary
  live: {
    ltp: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    prev_close: number | null;
    change_pct: number | null;
    volume: number | null;
    volume_average: number | null;                    // 20-day avg
    rvol: number | null;                              // volume / volume_average
    vwap: number | null;
    depth_pressure: 'BUY_SIDE' | 'SELL_SIDE' | 'NEUTRAL' | null;
    o2c_pct: number | null;                           // (open − ltp) / ltp × 100
  };

  // MCS — populated by mceOrchestrator.score() (the 5-lens continuation)
  mcs: McsSnapshot | null;

  // Provenance — which sources contributed (for UI transparency)
  provenance: {
    shareholding_sources: string[];
    valuation_sources: string[];
    quality_sources: string[];
    orb_sources: string[];
    candle_sources: string[];
    fii_dii_sources: string[];
    earnings_sources: string[];
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Helper finders
// ──────────────────────────────────────────────────────────────────────────

function findShareholdingMatch(
  list: ShareholdingActivityItem[] | undefined,
  symbol: string,
): ShareholdingActivityItem | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const upper = symbol.toUpperCase();
  return list.find((it) => (it.symbol_name || '').toUpperCase() === upper) ?? null;
}

function findValuationMatch(
  cache: Record<string, any[]> | undefined,
  symbol: string,
): { row: any; type: 'under_valued' | 'over_valued' } | null {
  if (!cache) return null;
  const upper = symbol.toUpperCase();
  for (const type of ['under_valued', 'over_valued'] as const) {
    const list = cache[type];
    if (!Array.isArray(list)) continue;
    const row = list.find((it) => (it.symbol_name || it.Symbol || '').toUpperCase() === upper);
    if (row) return { row, type };
  }
  return null;
}

function findQualityMatch(
  cache: Record<string, QualityScoreItem[]> | undefined,
  symbol: string,
): QualityScoreItem | null {
  if (!cache) return null;
  const upper = symbol.toUpperCase();
  for (const key of Object.keys(cache)) {
    const list = cache[key];
    if (!Array.isArray(list)) continue;
    const row = list.find((it) => (it.symbol_name || '').toUpperCase() === upper);
    if (row) return row;
  }
  return null;
}

function findOrbMatch(
  cache: Record<string, any[]> | undefined,
  symbol: string,
): { row: any; minutes: number | null; prb: boolean } | null {
  if (!cache) return null;
  const upper = symbol.toUpperCase();
  // Prefer non-PRB rows; fall back to PRB.
  const orderedKeys = Object.keys(cache).sort((a, b) => {
    // Non-PRB first
    const aPrb = a.endsWith('_true') ? 1 : 0;
    const bPrb = b.endsWith('_true') ? 1 : 0;
    return aPrb - bPrb;
  });
  for (const key of orderedKeys) {
    const list = cache[key];
    if (!Array.isArray(list)) continue;
    const row = list.find((it) => (it.symbol_name || it.Symbol || '').toUpperCase() === upper);
    if (row) {
      const parts = key.split('_');
      const minutes = parseInt(parts[0], 10);
      const prb = key.endsWith('_true') || key.includes('prb');
      const minutesOrNull: number | null = Number.isFinite(minutes) ? minutes : null;
      return { row, minutes: minutesOrNull, prb };
    }
  }
  return null;
}

function findDerivativeMatch(
  list: DerivativeSummaryItem[] | undefined,
  symbol: string,
): DerivativeSummaryItem | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const upper = symbol.toUpperCase();
  return list.find((it) => (it.symbol_name || '').toUpperCase() === upper) ?? null;
}

function findLotSize(
  list: LotSizeItem[] | undefined,
  symbol: string,
): number | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const upper = symbol.toUpperCase();
  const row = list.find((it) => (it.symbol || it.underlying || '').toUpperCase() === upper);
  if (!row) return null;
  const monthData = row.month_data;
  if (!monthData) return null;
  let parsed: any;
  if (typeof monthData === 'string') {
    try { parsed = JSON.parse(monthData); } catch { return null; }
  } else {
    parsed = monthData;
  }
  const keys = Object.keys(parsed || {});
  if (keys.length === 0) return null;
  const val = parseInt(parsed[keys[0]], 10);
  return Number.isFinite(val) && val > 0 ? val : null;
}

function findEarningsMatch(
  list: ResultsCalendarItem[] | undefined,
  symbol: string,
): ResultsCalendarItem | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const upper = symbol.toUpperCase();
  return list.find((it) => (it.symbol || '').toUpperCase() === upper) ?? null;
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const diff = (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  return Math.round(diff);
}

function computeOwnershipScoreLocal(
  fiiChange: number,
  diiChange: number,
  promoterChange: number,
): number {
  // 0.4·FII + 0.3·DII + 0.3·Promoter — matches ShadowScreenerService.calculateOwnershipScore()
  return parseFloat(((fiiChange * 0.4) + (diiChange * 0.3) + (promoterChange * 0.3)).toFixed(3));
}

// ──────────────────────────────────────────────────────────────────────────
// Main builder
// ──────────────────────────────────────────────────────────────────────────

export function buildAlphaInputs(
  symbol: string,
  segment: Segment,
  direction: Direction,
  state: AlphaStateSources,
): AlphaInputsBundle {
  const upper = symbol.toUpperCase();

  // ── Shareholding (Card #6) ──────────────────────────────────────
  const fii_buy_match = findShareholdingMatch(state.shareholdingDataCache?.['fii_buy'], upper);
  const fii_sell_match = findShareholdingMatch(state.shareholdingDataCache?.['fii_sell'], upper);
  const promoter_buy_match = findShareholdingMatch(state.shareholdingDataCache?.['promoter_buy'], upper);
  const promoter_sell_match = findShareholdingMatch(state.shareholdingDataCache?.['promoter_sell'], upper);

  const anyMatch = fii_buy_match || fii_sell_match || promoter_buy_match || promoter_sell_match;
  const fiiChangeRaw = (fii_buy_match || fii_sell_match)?.change_in_fii_hold ?? '0';
  const promoterChangeRaw = (promoter_buy_match || promoter_sell_match)?.change_in_promoters_hold ?? '0';
  const diiChangeRaw = (anyMatch as any)?.change_in_dii_hold ?? '0';
  const fiiChange = parseFloat(fiiChangeRaw) || 0;
  const promoterChange = parseFloat(promoterChangeRaw) || 0;
  const diiChange = parseFloat(diiChangeRaw) || 0;
  const ownership_momentum_score = anyMatch
    ? computeOwnershipScoreLocal(fiiChange, diiChange, promoterChange)
    : null;

  const shareholdingMapRow = state.shareholdingMap?.[upper];
  const shareholding = anyMatch || shareholdingMapRow
    ? {
        fii_buy_match,
        fii_sell_match,
        promoter_buy_match,
        promoter_sell_match,
        ownership_momentum_score,
        fii_velocity: shareholdingMapRow?.fii_velocity ?? null,
        dii_velocity: shareholdingMapRow?.dii_velocity ?? null,
        promoter_velocity: shareholdingMapRow?.promoter_velocity ?? null,
        accumulation_flag: shareholdingMapRow?.accumulation_flag ?? null,
        qtr_roce: anyMatch?.roce ? (parseFloat(anyMatch.roce) || null) : null,
        qtr_profit_var: anyMatch?.qtr_profit_var ? (parseFloat(anyMatch.qtr_profit_var) || null) : null,
        qtr_sales_var: anyMatch?.qtr_sales_var ? (parseFloat(anyMatch.qtr_sales_var) || null) : null,
        div_yield: anyMatch?.div_yield ? (parseFloat(anyMatch.div_yield) || null) : null,
        pe: anyMatch?.stock_pe ? (parseFloat(anyMatch.stock_pe) || null) : null,
        market_cap_cr: anyMatch?.market_cap ? (parseFloat(anyMatch.market_cap) || null) : null,
      }
    : null;

  // ── Valuation (Card #4) ────────────────────────────────────────
  const valMatch = findValuationMatch(state.valuationDataCache, upper);
  const valuation = valMatch
    ? {
        upside_pct: typeof valMatch.row.upside === 'number'
          ? valMatch.row.upside
          : (valMatch.row.last_trade_price > 0
              ? ((valMatch.row.intrinsic_value - valMatch.row.last_trade_price) / valMatch.row.last_trade_price) * 100
              : null),
        intrinsic: valMatch.row.intrinsic_value ?? null,
        ltp: valMatch.row.last_trade_price ?? valMatch.row.LTP ?? null,
        roce: valMatch.row.roce_per ?? valMatch.row.roce ?? null,
        roe: valMatch.row.roe_per ?? valMatch.row.roe ?? null,
        eps: valMatch.row.eps ?? null,
        pb: valMatch.row.pb_ann ?? valMatch.row.pbRatio ?? null,
        market_cap_cr: valMatch.row.market_cap ?? valMatch.row.marketCap ?? null,
        sector: valMatch.row.sector ?? null,
        rating: valMatch.row.rating ?? null,
        type: valMatch.type,
      }
    : null;

  // ── Quality (Card #7) ──────────────────────────────────────────
  const qMatch = findQualityMatch(state.qualityDataCache, upper);
  const quality = qMatch
    ? {
        total_score: qMatch.total_score ? (parseFloat(qMatch.total_score) || null) : null,
        rating: (qMatch.rating as 'BUY' | 'HOLD' | 'SELL' | undefined) ?? null,
        profitability: qMatch.profitability_score ? (parseFloat(qMatch.profitability_score) || null) : null,
        growth: qMatch.growth_score ? (parseFloat(qMatch.growth_score) || null) : null,
        valuation_sub: qMatch.valuation_score ? (parseFloat(qMatch.valuation_score) || null) : null,
        cash_flow: qMatch.cash_flow_score ? (parseFloat(qMatch.cash_flow_score) || null) : null,
        financial_strength: qMatch.financial_strength_score ? (parseFloat(qMatch.financial_strength_score) || null) : null,
        management: qMatch.management_score ? (parseFloat(qMatch.management_score) || null) : null,
        moat: qMatch.moat_score ? (parseFloat(qMatch.moat_score) || null) : null,
        risk: qMatch.risk_score ? (parseFloat(qMatch.risk_score) || null) : null,
        momentum: qMatch.momentum_score ? (parseFloat(qMatch.momentum_score) || null) : null,
        intrinsic: qMatch.intrinsic_value ? (parseFloat(qMatch.intrinsic_value) || null) : null,
        div_yield: qMatch.div_yield ? (parseFloat(qMatch.div_yield) || null) : null,
        roce: qMatch.roce ? (parseFloat(qMatch.roce) || null) : null,
        roe: qMatch.roe ? (parseFloat(qMatch.roe) || null) : null,
      }
    : null;

  // ── ORB (Card #3) ──────────────────────────────────────────────
  const orbMatch = findOrbMatch(state.orbDataCache, upper);
  const orb = orbMatch
    ? {
        breakout: (orbMatch.row.breakout as 'Bullish' | 'Bearish') ?? null,
        orb_price: orbMatch.row.orb_price ?? null,
        orb_time: orbMatch.row.orb_time ?? null,
        ltp: orbMatch.row.last_trade_price ?? null,
        minutes: orbMatch.minutes,
        prb_mode: orbMatch.prb,
      }
    : null;

  // ── Candle (Card #1) ──────────────────────────────────────────
  const dailyRow = state.patternMap?.[upper];
  const daily = dailyRow?.timeframe === 'daily' && (dailyRow.pattern_type || dailyRow.pattern_sentiment)
    ? {
        pattern_type: dailyRow.pattern_type ?? null,
        pattern_sentiment: (dailyRow.pattern_sentiment ?? null) as 'Bullish' | 'Bearish' | null,
      }
    : null;
  const weekly = dailyRow?.timeframe === 'weekly' && (dailyRow.pattern_type || dailyRow.pattern_sentiment)
    ? {
        pattern_type: dailyRow.pattern_type ?? null,
        pattern_sentiment: (dailyRow.pattern_sentiment ?? null) as 'Bullish' | 'Bearish' | null,
      }
    : null;
  const candle = { daily, weekly };

  // ── FII/DII (Card #11) ────────────────────────────────────────
  const fiiDiiLatest = state.fiiDiiPulseData?.[0] ?? null;
  const fiiDii = fiiDiiLatest
    ? {
        fii_cash_net_cr: (() => {
          const row = fiiDiiLatest.fii_cash?.find((c) => c.category === 'FII/FPI');
          return row ? row.net_value : null;
        })(),
        dii_cash_net_cr: (() => {
          const row = fiiDiiLatest.fii_cash?.find((c) => c.category === 'DII');
          return row ? row.net_value : null;
        })(),
        fii_index_fut_net: fiiDiiLatest.fii_oi?.find((o) => o.type === 'INDEX FUTURES')?.net_amount ?? null,
        fii_total_oi_net: fiiDiiLatest.fii_oi?.reduce((s, o) => s + (o.net_amount || 0), 0) ?? null,
        composite_sentiment: null,    // Computed in Phase 5 (MCS extensions)
        latest_date: fiiDiiLatest.date ?? null,
        nifty_ltp: fiiDiiLatest.indices?.find((i) => (i.symbol_name || '').toUpperCase().includes('NIFTY'))?.last_trade_price ?? null,
        nifty_change_pct: fiiDiiLatest.indices?.find((i) => (i.symbol_name || '').toUpperCase().includes('NIFTY'))?.change_percent ?? null,
        vix: fiiDiiLatest.indices?.find((i) => (i.symbol_name || '').toUpperCase().includes('VIX'))?.last_trade_price ?? null,
      }
    : null;

  // ── Derivative quadrant (Card #11 panel 4) ────────────────────
  const derivMatch = findDerivativeMatch(state.derivativeSummaryData, upper);
  const derivativeQuadrant = derivMatch
    ? {
        built_up: derivMatch.built_up ?? null,
        oi_change_pct: derivMatch.change_oi_per ?? null,
        price_change_pct: derivMatch.change_ltp_per ?? null,
      }
    : null;

  // ── Participant OI (Card #11 panel 3) ─────────────────────────
  const participantOi = state.participantOiData && state.participantOiData.length > 0
    ? (() => {
        const latest = state.participantOiData[0];
        const find = (ct: string) => state.participantOiData?.find((p) => p.client_type === ct && p.date === latest.date);
        const fiiRow = find('FII');
        const diiRow = find('DII');
        const clientRow = find('Client');
        const proRow = find('Pro');
        const sumLong = (...rows: any[]) => rows.reduce((s, r) => s + (r?.total_long_contracts || 0), 0);
        const sumShort = (...rows: any[]) => rows.reduce((s, r) => s + (r?.total_short_contracts || 0), 0);
        return {
          fii_net_oi: fiiRow ? sumLong(fiiRow) - sumShort(fiiRow) : null,
          dii_net_oi: diiRow ? sumLong(diiRow) - sumShort(diiRow) : null,
          client_net_oi: clientRow ? sumLong(clientRow) - sumShort(clientRow) : null,
          pro_net_oi: proRow ? sumLong(proRow) - sumShort(proRow) : null,
        };
      })()
    : null;

  // ── Lot size (Card #10) ───────────────────────────────────────
  const lotSize = findLotSize(state.lotSizesData, upper);

  // ── Earnings (Card #5) ────────────────────────────────────────
  const earnMatch = findEarningsMatch(state.resultsCalendarData, upper);
  const dUntil = daysUntil(earnMatch?.meeting_date);
  const earnings = earnMatch
    ? {
        meeting_date: earnMatch.meeting_date,
        days_until: dUntil,
        imminent: dUntil != null && dUntil >= 0 && dUntil <= 2,
        today: dUntil === 0,
      }
    : null;

  // ── Delivery (Card #12) ───────────────────────────────────────
  const deliveryRow = state.deliveryBySymbol?.[upper];
  const delivery = deliveryRow
    ? { pct: deliveryRow.pct, is_institutional: deliveryRow.is_institutional }
    : null;

  // ── Insider (Card #13) ────────────────────────────────────────
  const insiderRow = state.insiderBySymbol?.[upper];
  const insider = insiderRow
    ? {
        net_value_cr: insiderRow.net_value,
        buy_count: insiderRow.buy_count,
        sell_count: insiderRow.sell_count,
        significant_exit: insiderRow.net_value < -5,
      }
    : null;

  // ── MF flow (Card #14) ────────────────────────────────────────
  const mfRow = state.mfFlowBySymbol?.[upper];
  const mfFlow = mfRow
    ? {
        net_qty: mfRow.net_qty,
        amc_count: mfRow.amc_count,
        pct_change: mfRow.pct_change,
        significant_exit: mfRow.pct_change < -5,
      }
    : null;

  // ── Order flow (Card #15) ─────────────────────────────────────
  const oreRow = state.oreMap?.[upper];
  const orderFlow = (oreRow || state.cvdMap?.[upper] != null)
    ? {
        cvd: state.cvdMap?.[upper] ?? null,
        obi: oreRow?.score != null ? (oreRow.score - 0.5) * 2 : null,
        bid_wall_qty: null,
        ask_wall_qty: null,
        absorption: null,
        ore_score: oreRow?.score ?? null,
        ore_direction: oreRow?.direction ?? null,
      }
    : null;

  // ── Live quote ────────────────────────────────────────────────
  const live = state.liveQuotes?.[upper];
  const liveLtp = live?.ltp ?? live?.last_price ?? null;
  const volumeAvg = state.volumeAverages?.[upper] ?? null;
  const rvol = (live?.volume != null && volumeAvg && volumeAvg > 0)
    ? live.volume / volumeAvg
    : null;
  const o2c_pct = (live?.ohlc?.open != null && liveLtp != null && liveLtp > 0)
    ? ((live.ohlc.open - liveLtp) / liveLtp) * 100
    : null;
  const liveBlock = {
    ltp: liveLtp,
    open: live?.ohlc?.open ?? null,
    high: live?.ohlc?.high ?? null,
    low: live?.ohlc?.low ?? null,
    close: live?.ohlc?.close ?? null,
    prev_close: null,
    change_pct: live?.change_pct ?? live?.change ?? null,
    volume: live?.volume ?? null,
    volume_average: volumeAvg,
    rvol,
    vwap: live?.vwap ?? live?.avg_trade_price ?? null,
    depth_pressure: live?.depth_pressure ?? null,
    o2c_pct,
  };

  // ── Historical gainers/losers / FnO Movements (Cards #2, #9) ─
  const historical = {
    is_weekly_gainer: !!state.historicalDataCache?.['gainers_week']?.some((it: any) => (it.symbol_name || '').toUpperCase() === upper),
    is_monthly_gainer: !!state.historicalDataCache?.['gainers_month']?.some((it: any) => (it.symbol_name || '').toUpperCase() === upper),
    is_yearly_gainer: !!state.historicalDataCache?.['gainers_year']?.some((it: any) => (it.symbol_name || '').toUpperCase() === upper),
    is_weekly_loser: !!state.historicalDataCache?.['loosers_week']?.some((it: any) => (it.symbol_name || '').toUpperCase() === upper),
    is_monthly_loser: !!state.historicalDataCache?.['loosers_month']?.some((it: any) => (it.symbol_name || '').toUpperCase() === upper),
    is_fno_pulse: !!state.boosterStocksList?.some((it: any) => (it.Symbol || it.symbol_name || '').toUpperCase() === upper),
  };

  // ── MCS ──────────────────────────────────────────────────────
  const mcs = state.mcsBySymbol?.[upper] ?? null;

  // ── Provenance ────────────────────────────────────────────────
  const provenance = {
    shareholding_sources: anyMatch ? [fii_buy_match ? 'fii_buy' : '', fii_sell_match ? 'fii_sell' : '', promoter_buy_match ? 'promoter_buy' : '', promoter_sell_match ? 'promoter_sell' : ''].filter(Boolean) : [],
    valuation_sources: valMatch ? [valMatch.type] : [],
    quality_sources: qMatch ? Object.keys(state.qualityDataCache || {}).filter((k) => Array.isArray(state.qualityDataCache?.[k]) && state.qualityDataCache![k].some((it: any) => (it.symbol_name || '').toUpperCase() === upper)) : [],
    orb_sources: orbMatch ? [`${orbMatch.minutes}m_${orbMatch.prb ? 'prb' : ''}`] : [],
    candle_sources: [daily ? 'daily' : '', weekly ? 'weekly' : ''].filter(Boolean),
    fii_dii_sources: fiiDii ? ['fii-dii-pulse', participantOi ? 'participant-oi' : '', derivativeQuadrant ? 'derivative-summary' : ''].filter(Boolean) : [],
    earnings_sources: earnMatch ? ['results-calendar'] : [],
  };

  return {
    symbol: upper,
    segment,
    direction,
    shareholding,
    valuation,
    quality,
    orb,
    candle,
    fiiDii,
    derivativeQuadrant,
    participantOi,
    lotSize,
    earnings,
    delivery,
    insider,
    mfFlow,
    orderFlow,
    optionChain: null,    // Populated in Phase 7 (per-stock GEX)
    historical,
    momentumHub: null,    // Not in stockeZee — telegram/AI feed (separate)
    live: liveBlock,
    mcs,
    provenance,
  };
}

/**
 * Compute the FII/DII composite sentiment score in the -6..+6 range from
 * the bundle's FII/DII fields. Mirrors the formula in
 * `components/alpha/ShadowTerminal/FiiDiiPulseDashboard.tsx`.
 *
 * Lives in this module so all 3 engines can call it without re-implementing.
 */
export function computeFiiDiiCompositeSentiment(bundle: AlphaInputsBundle): number | null {
  const f = bundle.fiiDii;
  if (!f) return null;
  if (f.fii_cash_net_cr == null && f.fii_index_fut_net == null) return null;
  let score = 0;
  if (f.fii_cash_net_cr != null) score += f.fii_cash_net_cr > 0 ? 1 : f.fii_cash_net_cr < 0 ? -1 : 0;
  if (f.fii_index_fut_net != null) score += f.fii_index_fut_net > 0 ? 1 : f.fii_index_fut_net < 0 ? -1 : 0;
  // Clamp to -2..+2 for the 2-quadrant cash + futures. Real FiiDiiPulseDashboard
  // extends with breadth/divergence (Phase 5 will replace this with the full -6..+6).
  return Math.max(-6, Math.min(6, score * 3));
}
