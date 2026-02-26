/**
 * Computes the stock-type feature vector (docs/algo/strategy_brief.md) from a live
 * stock object + today's 5-minute candle buffer. Mirrors the causal columns built by
 * algo-engine/backtester/build_screener.py so the TS classifier and the Python
 * backtest see the same numbers. Any feature that cannot be computed is left NaN
 * and the classifier treats it as "rule fails" — same policy as Python.
 */

import { StockTypeFeatures } from './StockTypeClassifier';

export interface LiveCandle {
  ts?: string;
  timestamp?: number;
  o: number; h: number; l: number; c: number; v: number;
}

const nan = Number.NaN;

function sessionMinutes(ts?: string | number): number {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return (ist.getHours() * 60 + ist.getMinutes()) - (9 * 60 + 15);
}

export function computeStockTypeFeatures(
  stock: {
    ltp: number; openPrice: number; high: number; low: number;
    openingGapPct: number; atr?: number | null;
    volumeAverages20?: number; // avg DAILY volume (adv20), optional
  },
  candles: LiveCandle[] | undefined,
): StockTypeFeatures {
  const { ltp, openPrice, high, low, openingGapPct } = stock;
  const o = candles?.map(c => c.o) ?? [];
  const h = candles?.map(c => c.h) ?? [];
  const l = candles?.map(c => c.l) ?? [];
  const c = candles?.map(c => c.c) ?? [];
  const v = candles?.map(c => c.v) ?? [];
  const n = c.length;

  const dAtr = stock.atr && stock.atr > 0 ? stock.atr : nan;
  const dayRange = high - low;
  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : nan);
  const last9 = (a: number[]) => a.slice(-9);
  const last6 = (a: number[]) => a.slice(-6);
  const last3 = (a: number[]) => a.slice(-3);

  // --- from live quote (always available) ---
  const feats: StockTypeFeatures = {
    minutes_since_open: sessionMinutes(),
    gap_pct: openingGapPct,
    low_vs_open: openPrice > 0 ? low / openPrice : nan,
    day_range_pos: dayRange > 0 ? (ltp - low) / dayRange : nan,
    chg_from_open_pct: openPrice > 0 ? ((ltp - openPrice) / openPrice) * 100 : nan,
    fc_range_pct: nan,
    fc15_vol_ratio: nan,
    vol_pace_45: nan,
    vol_stab_45: nan,
    body_open30: nan,
    d_atr14: dAtr,
    candle_body_fade: nan,
    em_coverage: dayRange > 0 && Number.isFinite(dAtr) ? dayRange / dAtr : nan,
    freeze_streak: 0,
    push_from_open_pct: openPrice > 0 ? ((high - openPrice) / openPrice) * 100 : nan,
    low6_vs_open_pct: nan,
    pb_vol_ratio: nan,
    dist_vwap_pct: nan,
    vwap_z: nan,
    close: ltp,
    atr_14: nan,
  };
  if (n === 0) return feats;

  // --- first-candle anatomy ---
  const prevClose = openPrice > 0 && openingGapPct !== 0
    ? openPrice / (1 + openingGapPct / 100)
    : (o[0] || nan);
  if (prevClose > 0) feats.fc_range_pct = ((h[0] - l[0]) / prevClose) * 100;

  // --- first-15m volume vs expected 15-min slice of avg daily volume ---
  if (n >= 3 && stock.volumeAverages20 && stock.volumeAverages20 > 0) {
    const vol15 = v.slice(0, 3).reduce((s, x) => s + x, 0);
    const expected15 = stock.volumeAverages20 * (15 / 375);
    feats.fc15_vol_ratio = vol15 / expected15;
  }

  // --- volume pace / stability (last 45 min vs session-so-far pace) ---
  if (n >= 2) {
    const paceSoFar = mean(v);
    const m9 = mean(last9(v));
    feats.vol_pace_45 = paceSoFar > 0 ? m9 / paceSoFar : nan;
    const s9 = last9(v);
    if (s9.length >= 2) {
      const mu = mean(s9);
      feats.vol_stab_45 = mu > 0 ? Math.sqrt(mean(s9.map(x => (x - mu) ** 2))) / mu : nan;
    }
  }

  // --- candle anatomy ---
  const bodies = c.map((ci, i) => Math.abs(ci - o[i]));
  feats.body_open30 = mean(bodies.slice(0, 6));
  const bodyRecent = mean(last3(bodies));
  feats.candle_body_fade = feats.body_open30 > 0 ? bodyRecent / feats.body_open30 : nan;

  // --- freeze streak (consecutive tiny candles, per docs "freezes completely") ---
  const barAtr = Number.isFinite(dAtr) ? dAtr / 75 : nan; // 5m ATR proxy from daily ATR
  let streak = 0;
  for (let i = n - 1; i >= 1; i--) {
    const tiny = barAtr > 0 && (h[i] - l[i]) < 0.25 * barAtr;
    const flat = c[i - 1] > 0 && Math.abs(c[i] - c[i - 1]) / c[i - 1] < 0.001;
    if (tiny && flat) streak++; else break;
  }
  feats.freeze_streak = streak;

  // --- pullback character ---
  feats.low6_vs_open_pct = openPrice > 0 ? ((Math.min(...last6(l.length ? last6(l) : [low])) - openPrice) / openPrice) * 100 : nan;
  if (n >= 4) {
    // mean volume of bars that made a new running day-high after the first 15 min
    let runHigh = h[0];
    const pushVols: number[] = [];
    for (let i = 3; i < n; i++) {
      if (h[i] >= runHigh) { pushVols.push(v[i]); runHigh = h[i]; }
    }
    if (pushVols.length >= 2) {
      const pv = mean(pushVols);
      feats.pb_vol_ratio = pv > 0 ? mean(last3(v)) / pv : nan;
    }
  }

  // --- VWAP features (session cumulative) ---
  let cumPv = 0, cumV = 0;
  for (let i = 0; i < n; i++) {
    const tp = (h[i] + l[i] + c[i]) / 3;
    cumPv += tp * v[i]; cumV += v[i];
  }
  if (cumV > 0) {
    const vwap = cumPv / cumV;
    feats.dist_vwap_pct = vwap > 0 ? ((ltp - vwap) / vwap) * 100 : nan;
    const closes = last9(c).length >= 2 ? c.slice(-20) : c;
    const mu = mean(closes);
    const sd = mu > 0 ? Math.sqrt(mean(closes.map(x => (x - mu) ** 2))) : 0;
    feats.vwap_z = sd > 0 ? (ltp - vwap) / sd : nan;
  }

  // --- 5m ATR(14) proxy for trade sizing ---
  if (n >= 15) {
    const trs: number[] = [];
    for (let i = 1; i <= 14; i++) {
      const pc = c[n - 1 - i] || c[n - i - 1];
      trs.push(Math.max(h[n - i] - l[n - i], Math.abs(h[n - i] - pc), Math.abs(l[n - i] - pc)));
    }
    feats.atr_14 = mean(trs);
  }

  return feats;
}
