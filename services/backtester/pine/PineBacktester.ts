/**
 * PineBacktester.ts
 *
 * Lightweight, candle-level backtest engine that mirrors the entry/exit logic of
 * each Pine strategy in pineStrategies.ts. It powers the in-app TradingView-style
 * preview so the user can eyeball performance before pasting the generated Pine
 * Script into the real TradingView.
 *
 * It intentionally re-implements (rather than reuses) the rule engine because the
 * five intraday strategies are candle-stateful (opening ranges, EMA stacks,
 * rolling z-scores, squeeze coils) and must replay candle-by-candle, grouped by
 * trading day, with intrabar stop/target fills approximated from the bar's
 * high/low.
 */

import { PineParamValues } from './pineStrategies';

export interface Candle {
  time: number;        // epoch ms
  date: string;        // YYYY-MM-DD
  minutes: number;     // minutes since midnight (IST)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TVTrade {
  entryTime: number;
  exitTime: number;
  date: string;
  direction: 'Long' | 'Short';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnL: number;
  costs: number;
  pnl: number;            // net
  barsHeld: number;
  reason: 'TARGET' | 'STOP' | 'SQUARE_OFF';
  runUp: number;          // max favorable excursion (₹, position)
  drawdown: number;       // max adverse excursion (₹, position)
}

export interface TVMetrics {
  netPnL: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgPnL: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  avgBarsInTrades: number;
  payoffRatio: number;
  expectancy: number;
  maxDrawdown: number;      // ₹ (equity)
  maxDrawdownPct: number;
  maxRunUp: number;         // ₹ (equity)
  maxRunUpPct: number;
  sharpe: number;
  cagr: number;
  roc: number;              // return on initial capital %
  initialCapital: number;
  finalCapital: number;
  accountSizeRequired: number;
  longTrades: number;
  shortTrades: number;
  buyHoldReturnPct: number;
  avgRunUpDuration: number;     // bars
  avgDrawdownDuration: number;  // bars
  openPnL: number;
}

export interface EquityPoint {
  index: number;
  time: number;
  equity: number;
  drawdown: number;       // ₹ below peak
  runup: number;          // ₹ above trough
  tradePnL: number;       // pnl of the trade that closed at this point (0 otherwise)
}

export interface TVBacktestResult {
  trades: TVTrade[];
  equityCurve: EquityPoint[];
  metrics: TVMetrics;
  buyHoldCurve: number[];
}

interface OpenPosition {
  direction: 'Long' | 'Short';
  entryPrice: number;
  stop: number;
  target: number;
  quantity: number;
  entryTime: number;
  entryIndex: number;
  maxFav: number;   // best price reached in our favour
  maxAdv: number;   // worst price reached against us
}

const ROUND_TRIP_COST = 40; // ₹ flat brokerage approximation (Rs 20/leg)
const SLIPPAGE_PCT = 0.0002;

// Indicator helpers ----------------------------------------------------------
function sma(values: number[], period: number, idx: number): number | null {
  if (idx + 1 < period) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) sum += values[i];
  return sum / period;
}

function stdev(values: number[], period: number, idx: number, mean: number): number | null {
  if (idx + 1 < period) return null;
  let acc = 0;
  for (let i = idx - period + 1; i <= idx; i++) acc += (values[i] - mean) ** 2;
  return Math.sqrt(acc / period);
}

function emaSeries(values: number[], period: number): number[] {
  const out: number[] = [];
  const alpha = 2 / (period + 1);
  for (let i = 0; i < values.length; i++) {
    out.push(i === 0 ? values[0] : alpha * values[i] + (1 - alpha) * out[i - 1]);
  }
  return out;
}

function atrSeries(candles: Candle[], period: number): number[] {
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) tr.push(candles[i].high - candles[i].low);
    else {
      const pc = candles[i - 1].close;
      tr.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - pc), Math.abs(candles[i].low - pc)));
    }
  }
  // Wilder-free simple mean ATR over period
  const out: number[] = [];
  for (let i = 0; i < tr.length; i++) {
    if (i + 1 < period) { out.push(NaN); continue; }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += tr[j];
    out.push(s / period);
  }
  return out;
}

// Day grouping ---------------------------------------------------------------
function groupByDay(candles: Candle[]): Candle[][] {
  const map = new Map<string, Candle[]>();
  for (const c of candles) {
    if (!map.has(c.date)) map.set(c.date, []);
    map.get(c.date)!.push(c);
  }
  return Array.from(map.values());
}

const ENTRY_CUTOFF_MIN = 15 * 60; // 15:00
const SQUAREOFF_MIN = 15 * 60 + 15; // 15:15

// ---------------------------------------------------------------------------
// Per-strategy signal generators. Each returns {dir, stop, target} or null
// given the candle context for the current day.
// ---------------------------------------------------------------------------
type Signal = { dir: 'Long' | 'Short'; stop: number; target: number } | null;

function runStrategy(id: string, day: Candle[], p: PineParamValues): {
  signals: (Signal | null)[];
} {
  const n = day.length;
  const signals: (Signal | null)[] = new Array(n).fill(null);
  const closes = day.map((c) => c.close);

  if (id === 'orb') {
    const orMin = p.opening_range_minutes as number;
    const stopMult = p.stop_multiplier as number;
    const targetMult = p.target_multiplier as number;
    const reqRetest = p.require_retest as boolean;
    const reqVol = p.require_volume_confirmation as boolean;
    const volMult = p.vol_multiple as number;
    const volLkbk = p.vol_lookback as number;
    const startMin = day[0]?.minutes ?? 555;
    const rangeEndMin = startMin + orMin;
    let orHigh = -Infinity, orLow = Infinity, locked = false, brkDir = 0, retested = false;
    const vols = day.map((c) => c.volume);
    for (let i = 0; i < n; i++) {
      const c = day[i];
      if (c.minutes < rangeEndMin) {
        orHigh = Math.max(orHigh, c.high);
        orLow = Math.min(orLow, c.low);
        continue;
      }
      if (!locked && isFinite(orHigh)) locked = true;
      if (!locked) continue;
      if (brkDir === 0) {
        if (c.close > orHigh) { brkDir = 1; retested = !reqRetest; }
        else if (c.close < orLow) { brkDir = -1; retested = !reqRetest; }
      }
      if (brkDir === 1 && !retested && c.low <= orHigh) retested = true;
      if (brkDir === -1 && !retested && c.high >= orLow) retested = true;
      const avgVol = sma(vols, volLkbk, i) ?? 0;
      // Degraded mode (mirrors Python Req 2.5): when volume data is absent/zero,
      // disable the volume filter rather than rejecting every breakout.
      const hasVolume = c.volume > 0 && avgVol > 0;
      const volOk = (reqVol && hasVolume) ? c.volume > volMult * avgVol : true;
      const rangeSize = orHigh - orLow;
      if (rangeSize <= 0 || c.minutes >= ENTRY_CUTOFF_MIN) continue;
      if (brkDir === 1 && retested && c.close > orHigh && volOk) {
        signals[i] = { dir: 'Long', stop: c.close - rangeSize * stopMult, target: c.close + rangeSize * targetMult };
      } else if (brkDir === -1 && retested && c.close < orLow && volOk) {
        signals[i] = { dir: 'Short', stop: c.close + rangeSize * stopMult, target: c.close - rangeSize * targetMult };
      }
    }
  } else if (id === 'vwap') {
    const entryDev = p.entry_deviation as number;
    const stopDist = p.stop_distance as number;
    const warmup = p.warmup_period as number;
    let cumPV = 0, cumVol = 0;
    for (let i = 0; i < n; i++) {
      const c = day[i];
      const tp = (c.high + c.low + c.close) / 3;
      cumPV += tp * (c.volume || 1);
      cumVol += c.volume || 1;
      const vwap = cumVol > 0 ? cumPV / cumVol : tp;
      if (i + 1 < warmup || c.minutes >= ENTRY_CUTOFF_MIN) continue;
      const dev = c.close - vwap;
      if (dev <= -entryDev) signals[i] = { dir: 'Long', stop: c.close - stopDist, target: vwap };
      else if (dev >= entryDev) signals[i] = { dir: 'Short', stop: c.close + stopDist, target: vwap };
    }
  } else if (id === 'ema') {
    const fastP = p.ema_fast_period as number;
    const medP = p.ema_med_period as number;
    const slowP = p.ema_slow_period as number;
    const band = p.pullback_band as number;
    const rr = p.target_rr as number;
    const ef = emaSeries(closes, fastP);
    const em = emaSeries(closes, medP);
    const es = emaSeries(closes, slowP);
    for (let i = 0; i < n; i++) {
      const c = day[i];
      if (c.minutes >= ENTRY_CUTOFF_MIN) continue;
      const trendUp = ef[i] > em[i] && em[i] > es[i];
      const trendDown = ef[i] < em[i] && em[i] < es[i];
      if (trendUp) {
        const pulled = c.low <= ef[i] + band || c.low <= em[i] + band;
        const reclaim = c.close > ef[i] || c.close > em[i];
        if (pulled && reclaim && c.close >= c.open) {
          const sl = es[i] - band;
          if (sl < c.close) {
            const risk = c.close - sl;
            signals[i] = { dir: 'Long', stop: sl, target: c.close + rr * risk };
          }
        }
      } else if (trendDown) {
        const pulled = c.high >= ef[i] - band || c.high >= em[i] - band;
        const reclaim = c.close < ef[i] || c.close < em[i];
        if (pulled && reclaim && c.close <= c.open) {
          const sl = es[i] + band;
          if (sl > c.close) {
            const risk = sl - c.close;
            signals[i] = { dir: 'Short', stop: sl, target: c.close - rr * risk };
          }
        }
      }
    }
  } else if (id === 'zscore') {
    const lookback = p.lookback as number;
    const entryZ = p.entry_z as number;
    const exitZ = p.exit_z as number;
    for (let i = 0; i < n; i++) {
      const c = day[i];
      if (c.minutes >= ENTRY_CUTOFF_MIN) continue;
      const mean = sma(closes, lookback, i);
      if (mean == null) continue;
      const sd = stdev(closes, lookback, i, mean);
      if (sd == null || sd === 0) continue;
      const z = (c.close - mean) / sd;
      if (z <= -entryZ) signals[i] = { dir: 'Long', stop: c.close - exitZ * sd, target: mean };
      else if (z >= entryZ) signals[i] = { dir: 'Short', stop: c.close + exitZ * sd, target: mean };
    }
  } else if (id === 'squeeze') {
    const lookback = p.lookback as number;
    const bbStd = p.bb_std as number;
    const kcMult = p.kc_multiplier as number;
    const brkBand = p.breakout_band as number;
    const rr = p.target_rr as number;
    const atr = atrSeries(day, lookback);
    let squeezeSeen = false, sqHigh = -Infinity, sqLow = Infinity;
    for (let i = 0; i < n; i++) {
      const c = day[i];
      const basis = sma(closes, lookback, i);
      if (basis == null) continue;
      const sd = stdev(closes, lookback, i, basis);
      if (sd == null || isNaN(atr[i])) continue;
      const bbUp = basis + bbStd * sd, bbLow = basis - bbStd * sd;
      const kcUp = basis + kcMult * atr[i], kcLow = basis - kcMult * atr[i];
      const squeezeOn = bbUp < kcUp && bbLow > kcLow;
      if (squeezeOn) {
        squeezeSeen = true;
        sqHigh = Math.max(sqHigh, c.high);
        sqLow = Math.min(sqLow, c.low);
      }
      if (c.minutes >= ENTRY_CUTOFF_MIN) continue;
      const armed = squeezeSeen && !squeezeOn && isFinite(sqHigh) && isFinite(sqLow);
      if (!armed) continue;
      if (c.close > sqHigh + brkBand && c.close > c.open) {
        const risk = c.close - sqLow;
        if (risk > 0) signals[i] = { dir: 'Long', stop: sqLow, target: c.close + rr * risk };
      } else if (c.close < sqLow - brkBand && c.close < c.open) {
        const risk = sqHigh - c.close;
        if (risk > 0) signals[i] = { dir: 'Short', stop: sqHigh, target: c.close - rr * risk };
      }
    }
  }
  return { signals };
}

// ---------------------------------------------------------------------------
// Main simulation loop
// ---------------------------------------------------------------------------
export function runPineBacktest(
  id: string,
  candles: Candle[],
  p: PineParamValues,
): TVBacktestResult {
  const initialCapital = (p.capital as number) ?? 100000;
  const quantity = (p.quantity as number) ?? 50;
  const maxTrades = (p.max_trades_per_day as number) ?? 3;

  const days = groupByDay(candles);
  const trades: TVTrade[] = [];

  for (const day of days) {
    if (day.length < 2) continue;
    const { signals } = runStrategy(id, day, p);
    let pos: OpenPosition | null = null;
    let tradesToday = 0;

    for (let i = 0; i < day.length; i++) {
      const c = day[i];

      // Manage open position: check intrabar stop/target, then square-off.
      if (pos) {
        pos.maxFav = pos.direction === 'Long' ? Math.max(pos.maxFav, c.high) : Math.min(pos.maxFav, c.low);
        pos.maxAdv = pos.direction === 'Long' ? Math.min(pos.maxAdv, c.low) : Math.max(pos.maxAdv, c.high);
        let exitPrice: number | null = null;
        let reason: TVTrade['reason'] = 'SQUARE_OFF';
        if (pos.direction === 'Long') {
          const hitStop = c.low <= pos.stop;
          const hitTgt = c.high >= pos.target;
          if (hitStop && hitTgt) { exitPrice = pos.stop; reason = 'STOP'; } // conservative
          else if (hitStop) { exitPrice = pos.stop; reason = 'STOP'; }
          else if (hitTgt) { exitPrice = pos.target; reason = 'TARGET'; }
        } else {
          const hitStop = c.high >= pos.stop;
          const hitTgt = c.low <= pos.target;
          if (hitStop && hitTgt) { exitPrice = pos.stop; reason = 'STOP'; }
          else if (hitStop) { exitPrice = pos.stop; reason = 'STOP'; }
          else if (hitTgt) { exitPrice = pos.target; reason = 'TARGET'; }
        }
        if (exitPrice == null && c.minutes >= SQUAREOFF_MIN) { exitPrice = c.close; reason = 'SQUARE_OFF'; }
        if (exitPrice != null) {
          trades.push(closeTrade(pos, exitPrice, c.time, i, reason));
          pos = null;
        }
      }

      // New entry
      if (!pos && tradesToday < maxTrades) {
        const sig = signals[i];
        if (sig && c.minutes < SQUAREOFF_MIN) {
          const entry = sig.dir === 'Long' ? c.close * (1 + SLIPPAGE_PCT) : c.close * (1 - SLIPPAGE_PCT);
          pos = {
            direction: sig.dir,
            entryPrice: entry,
            stop: sig.stop,
            target: sig.target,
            quantity,
            entryTime: c.time,
            entryIndex: i,
            maxFav: entry,
            maxAdv: entry,
          };
          tradesToday++;
        }
      }
    }

    // Force close any position dangling at end of day
    if (pos) {
      const last = day[day.length - 1];
      trades.push(closeTrade(pos, last.close, last.time, day.length - 1, 'SQUARE_OFF'));
      pos = null;
    }
  }

  return assemble(trades, candles, initialCapital);
}

function closeTrade(pos: OpenPosition, exitPriceRaw: number, exitTime: number, exitIndex: number, reason: TVTrade['reason']): TVTrade {
  const exitPrice = pos.direction === 'Long' ? exitPriceRaw * (1 - SLIPPAGE_PCT) : exitPriceRaw * (1 + SLIPPAGE_PCT);
  const sign = pos.direction === 'Long' ? 1 : -1;
  const gross = (exitPrice - pos.entryPrice) * pos.quantity * sign;
  const costs = ROUND_TRIP_COST;
  const runUp = Math.max(0, (pos.maxFav - pos.entryPrice) * pos.quantity * sign);
  const drawdown = Math.max(0, (pos.entryPrice - pos.maxAdv) * pos.quantity * sign);
  return {
    entryTime: pos.entryTime,
    exitTime,
    date: new Date(pos.entryTime).toISOString().slice(0, 10),
    direction: pos.direction,
    entryPrice: pos.entryPrice,
    exitPrice,
    quantity: pos.quantity,
    grossPnL: gross,
    costs,
    pnl: gross - costs,
    barsHeld: exitIndex - pos.entryIndex,
    reason,
    runUp,
    drawdown,
  };
}

function assemble(trades: TVTrade[], candles: Candle[], initialCapital: number): TVBacktestResult {
  const equityCurve: EquityPoint[] = [];
  let equity = initialCapital;
  let peak = initialCapital;
  let trough = initialCapital;
  let maxDD = 0, maxRunUp = 0;
  let minEquity = initialCapital;

  equityCurve.push({ index: 0, time: trades[0]?.entryTime ?? Date.now(), equity, drawdown: 0, runup: 0, tradePnL: 0 });

  trades.forEach((t, i) => {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    trough = Math.min(trough, equity);
    minEquity = Math.min(minEquity, equity);
    const dd = peak - equity;
    const ru = equity - trough;
    maxDD = Math.max(maxDD, dd);
    maxRunUp = Math.max(maxRunUp, peak - initialCapital);
    equityCurve.push({ index: i + 1, time: t.exitTime, equity, drawdown: dd, runup: ru, tradePnL: t.pnl });
  });

  const wins = trades.filter((t) => (t.grossPnL !== undefined ? t.grossPnL : t.pnl) > 0);
  const losses = trades.filter((t) => (t.grossPnL !== undefined ? t.grossPnL : t.pnl) <= 0);
  const grossProfit = wins.reduce((s, t) => s + (t.grossPnL !== undefined ? t.grossPnL : t.pnl), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.grossPnL !== undefined ? t.grossPnL : t.pnl), 0));
  const netPnL = trades.reduce((s, t) => s + t.pnl, 0);
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;

  // Sharpe from per-trade returns
  const rets = trades.map((t) => t.pnl / initialCapital);
  const meanRet = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - meanRet) ** 2, 0) / (rets.length - 1)) : 0;
  const sharpe = sd > 0 ? (meanRet / sd) * Math.sqrt(252) : 0;

  const firstT = trades[0]?.entryTime;
  const lastT = trades[trades.length - 1]?.exitTime;
  const years = firstT && lastT ? Math.max(1 / 365, (lastT - firstT) / (365.25 * 24 * 3600 * 1000)) : 1;
  const finalCapital = initialCapital + netPnL;
  const cagr = finalCapital > 0 ? (Math.pow(finalCapital / initialCapital, 1 / years) - 1) * 100 : -100;
  const roc = (netPnL / initialCapital) * 100;
  const maxDDPct = peak > 0 ? (maxDD / peak) * 100 : 0;

  // Buy & hold benchmark on the candle series
  const buyHoldCurve: number[] = [];
  if (candles.length > 1) {
    const base = candles[0].close;
    for (const c of candles) buyHoldCurve.push(((c.close - base) / base) * 100);
  }
  const buyHoldReturnPct = buyHoldCurve.length ? buyHoldCurve[buyHoldCurve.length - 1] : 0;

  // Run-up / drawdown durations (in trades)
  let ddDurations: number[] = [], ruDurations: number[] = [];
  let curDD = 0, curRU = 0;
  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i].drawdown > 0) { curDD++; } else { if (curDD) ddDurations.push(curDD); curDD = 0; }
    if (equityCurve[i].equity > equityCurve[i - 1].equity) { curRU++; } else { if (curRU) ruDurations.push(curRU); curRU = 0; }
  }
  if (curDD) ddDurations.push(curDD);
  if (curRU) ruDurations.push(curRU);
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  const accountSizeRequired = initialCapital * (maxDDPct / 100) + (trades[0] ? trades[0].entryPrice * trades[0].quantity * 0.2 : 0);

  const metrics: TVMetrics = {
    netPnL,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate,
    avgPnL: trades.length ? netPnL / trades.length : 0,
    avgWin,
    avgLoss,
    largestWin: trades.length ? Math.max(...trades.map((t) => t.pnl)) : 0,
    largestLoss: trades.length ? Math.min(...trades.map((t) => t.pnl)) : 0,
    avgBarsInTrades: trades.length ? trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length : 0,
    payoffRatio: avgLoss > 0 ? avgWin / avgLoss : 0,
    expectancy: (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss,
    maxDrawdown: maxDD,
    maxDrawdownPct: maxDDPct,
    maxRunUp,
    maxRunUpPct: initialCapital > 0 ? (maxRunUp / initialCapital) * 100 : 0,
    sharpe,
    cagr,
    roc,
    initialCapital,
    finalCapital,
    accountSizeRequired,
    longTrades: trades.filter((t) => t.direction === 'Long').length,
    shortTrades: trades.filter((t) => t.direction === 'Short').length,
    buyHoldReturnPct,
    avgRunUpDuration: avg(ruDurations),
    avgDrawdownDuration: avg(ddDurations),
    openPnL: 0,
  };

  return { trades, equityCurve, metrics, buyHoldCurve };
}

// ---------------------------------------------------------------------------
// Candle fetch + normalization from the python-bridge parquet endpoint
// ---------------------------------------------------------------------------
const TF_TO_INTERVAL: Record<string, string> = {
  '5': '5minute',
  '15': '15minute',
  '30': '30minute',
  '60': '60minute',
};

export async function fetchCandles(
  symbol: string,
  timeframe: string,
  fromDate: string,
  toDate: string,
): Promise<Candle[]> {
  const interval = TF_TO_INTERVAL[timeframe] ?? '15minute';
  const url = `/api/python-nse/api/backtest/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&from_date=${fromDate}&to_date=${toDate}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Candle fetch failed (${res.status}). Is the python-bridge running?`);
  const json = await res.json();
  if (json.status === 'unavailable' || !Array.isArray(json.candles) || json.candles.length === 0) {
    throw new Error(json.warning || `No candle data found for ${symbol} in the local archive.`);
  }
  return normalizeCandles(json.candles);
}

function normalizeCandles(raw: any[]): Candle[] {
  const out: Candle[] = [];
  for (const r of raw) {
    // The python-bridge parquet endpoint returns positional arrays:
    //   [timestamp, open, high, low, close, volume, open_interest]
    // but we also tolerate object form { timestamp/open/high/... } for safety.
    let tsStr: string;
    let o: number, h: number, l: number, c: number, v: number;
    if (Array.isArray(r)) {
      tsStr = String(r[0] ?? '');
      o = Number(r[1]);
      h = Number(r[2]);
      l = Number(r[3]);
      c = Number(r[4]);
      v = Number(r[5] ?? 0);
    } else {
      tsStr = String(r.timestamp ?? r.time ?? r.datetime ?? '');
      o = Number(r.open ?? r.o ?? r.close);
      h = Number(r.high ?? r.h);
      l = Number(r.low ?? r.l);
      c = Number(r.close ?? r.c);
      v = Number(r.volume ?? r.v ?? 0);
    }
    if (!tsStr) continue;
    // Parse "2025-12-03T09:15:00+05:30" / "2025-12-03 09:15:00" using the wall-clock
    // hour/minute directly so session gating is timezone-independent.
    const m = tsStr.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) continue;
    const [, yy, mo, dd, hh, mm] = m;
    const dt = new Date(Number(yy), Number(mo) - 1, Number(dd), Number(hh), Number(mm), 0);
    if (isNaN(dt.getTime()) || isNaN(c)) continue;
    out.push({
      time: dt.getTime(),
      date: `${yy}-${mo}-${dd}`,
      minutes: Number(hh) * 60 + Number(mm),
      open: isNaN(o) ? c : o,
      high: isNaN(h) ? c : h,
      low: isNaN(l) ? c : l,
      close: c,
      volume: isNaN(v) ? 0 : v,
    });
  }
  return out.sort((a, b) => a.time - b.time);
}
