/**
 * pineStrategies.ts
 *
 * Central registry that mirrors the five Python intraday strategies
 * (algo-engine/strategies/*.py) for the TradingView sub-tab in Strategy Lab.
 *
 * Each entry provides:
 *   - metadata (id, label, description, default symbol/timeframe)
 *   - tunable params (rendered as controls, feed both the Pine inputs and the
 *     in-app backtest)
 *   - generatePine(params): a TradingView Pine Script v6 `strategy(...)` source
 *     string that the user can copy / download and paste into TradingView.
 *
 * The Pine templates are faithful re-implementations of the Python strategy
 * entry/exit logic so the in-app preview (PineBacktester) and the exported
 * Pine Script stay consistent.
 */

export type PineParamType = 'int' | 'float' | 'bool';

export interface PineParam {
  key: string;
  label: string;
  type: PineParamType;
  default: number | boolean;
  min?: number;
  max?: number;
  step?: number;
  help?: string;
}

export type PineParamValues = Record<string, number | boolean>;

export interface PineStrategyDef {
  id: string;
  label: string;
  file: string;
  category: string;
  description: string;
  defaultSymbol: string;
  defaultTimeframe: '5' | '15' | '30' | '60';
  params: PineParam[];
  generatePine: (p: PineParamValues) => string;
}

// ---------------------------------------------------------------------------
// Shared lifecycle helper Pine block (session gating + square-off + day reset)
// ---------------------------------------------------------------------------
function sharedSessionBlock(): string {
  return `// ─── SESSION & SQUARE-OFF ──────────────────────────────────────────────────────
int sq_h = 15
int sq_m = 15
bool in_session   = not na(time(timeframe.period, "0915-1530"))
bool entry_window = not na(time(timeframe.period, "0915-1500"))
int  squareoff_ts = timestamp(year, month, dayofmonth, sq_h, sq_m, 0)
bool is_new_day   = ta.change(dayofmonth) != 0`;
}

function pineHeader(name: string, p: PineParamValues): string {
  const qty = (p.quantity as number) ?? 50;
  const capital = (p.capital as number) ?? 100000;
  return `//@version=6
strategy("${name} (WealthOS)", overlay = true, default_qty_type = strategy.fixed, default_qty_value = ${qty}, initial_capital = ${capital}, commission_type = strategy.commission.cash_per_order, commission_value = 20, calc_on_every_tick = false, process_orders_on_close = true)`;
}

// Common params shared by every strategy.
const COMMON_PARAMS: PineParam[] = [
  { key: 'capital', label: 'Capital (₹)', type: 'int', default: 100000, min: 10000, max: 10000000, step: 10000 },
  { key: 'quantity', label: 'Quantity', type: 'int', default: 50, min: 1, max: 10000, step: 1 },
  { key: 'max_trades_per_day', label: 'Max Trades/Day', type: 'int', default: 3, min: 1, max: 20, step: 1 },
];

// ---------------------------------------------------------------------------
// 1. ORB Enhanced
// ---------------------------------------------------------------------------
const ORB_ENHANCED: PineStrategyDef = {
  id: 'orb',
  label: 'ORB Enhanced',
  file: 'orb_enhanced.py',
  category: 'Breakout',
  description: 'Opening-range breakout with retest + volume confirmation filters. Range-sized stop/target.',
  defaultSymbol: 'RELIANCE',
  defaultTimeframe: '15',
  params: [
    { key: 'opening_range_minutes', label: 'Opening Range (min)', type: 'int', default: 15, min: 5, max: 60, step: 5 },
    { key: 'stop_multiplier', label: 'Stop Multiplier', type: 'float', default: 1.0, min: 0.2, max: 3, step: 0.1 },
    { key: 'target_multiplier', label: 'Target Multiplier', type: 'float', default: 2.0, min: 0.5, max: 5, step: 0.1 },
    { key: 'require_retest', label: 'Require Retest', type: 'bool', default: true },
    { key: 'require_volume_confirmation', label: 'Require Volume', type: 'bool', default: true },
    { key: 'vol_multiple', label: 'Volume Multiple', type: 'float', default: 1.5, min: 0.5, max: 5, step: 0.1 },
    { key: 'vol_lookback', label: 'Volume Lookback', type: 'int', default: 20, min: 5, max: 100, step: 1 },
    ...COMMON_PARAMS,
  ],
  generatePine: (p) => {
    const orMin = p.opening_range_minutes as number;
    return `${pineHeader('ORB Enhanced', p)}

// ─── INPUTS ───────────────────────────────────────────────────────────────────
int   orMinutes  = input.int(${orMin}, "Opening Range Minutes", minval = 5, maxval = 60)
float stopMult   = input.float(${(p.stop_multiplier as number).toFixed(2)}, "Stop Multiplier", minval = 0.1, step = 0.1)
float targetMult = input.float(${(p.target_multiplier as number).toFixed(2)}, "Target Multiplier", minval = 0.1, step = 0.1)
bool  reqRetest  = input.bool(${p.require_retest ? 'true' : 'false'}, "Require Retest")
bool  reqVolume  = input.bool(${p.require_volume_confirmation ? 'true' : 'false'}, "Require Volume Confirmation")
float volMult    = input.float(${(p.vol_multiple as number).toFixed(2)}, "Volume Multiple", minval = 0.5, step = 0.1)
int   volLkbk    = input.int(${p.vol_lookback as number}, "Volume Lookback", minval = 5)

${sharedSessionBlock()}

// ─── OPENING RANGE ────────────────────────────────────────────────────────────
int  rangeEnd = timestamp(year, month, dayofmonth, 9, 15 + orMinutes, 0)
bool inRange  = time >= timestamp(year, month, dayofmonth, 9, 15, 0) and time < rangeEnd
bool postRng  = time >= rangeEnd and time < squareoff_ts

var float orHigh = na
var float orLow  = na
var bool  locked = false
var int   brkDir = 0
var bool  retested = false

if is_new_day
    orHigh := na
    orLow  := na
    locked := false
    brkDir := 0
    retested := false

if inRange
    orHigh := na(orHigh) ? high : math.max(orHigh, high)
    orLow  := na(orLow)  ? low  : math.min(orLow,  low)

if not inRange and not na(orHigh) and not locked
    locked := true

// ─── FILTERS ──────────────────────────────────────────────────────────────────
float avgVol = ta.sma(volume, volLkbk)
bool  volOk  = reqVolume ? volume > volMult * avgVol : true

if locked and postRng and brkDir == 0
    if close > orHigh
        brkDir := 1
        retested := not reqRetest
    else if close < orLow
        brkDir := -1
        retested := not reqRetest

if brkDir == 1 and not retested and low <= orHigh
    retested := true
if brkDir == -1 and not retested and high >= orLow
    retested := true

bool buySig  = locked and postRng and brkDir ==  1 and retested and close > orHigh and volOk and strategy.position_size == 0
bool sellSig = locked and postRng and brkDir == -1 and retested and close < orLow  and volOk and strategy.position_size == 0

float rangeSize = (na(orHigh) or na(orLow)) ? 0.0 : orHigh - orLow

if buySig and rangeSize > 0
    strategy.entry("Long", strategy.long)
    strategy.exit("LX", "Long", stop = close - rangeSize * stopMult, limit = close + rangeSize * targetMult)
if sellSig and rangeSize > 0
    strategy.entry("Short", strategy.short)
    strategy.exit("SX", "Short", stop = close + rangeSize * stopMult, limit = close - rangeSize * targetMult)

if time >= squareoff_ts and strategy.position_size != 0
    strategy.close_all("Square Off")

plot(locked ? orHigh : na, "OR High", color = color.green, linewidth = 2)
plot(locked ? orLow  : na, "OR Low",  color = color.red,   linewidth = 2)
bgcolor(inRange ? color.new(color.yellow, 90) : na)`;
  },
};

// ---------------------------------------------------------------------------
// 2. VWAP Mean Reversion
// ---------------------------------------------------------------------------
const VWAP_MEAN_REVERSION: PineStrategyDef = {
  id: 'vwap',
  label: 'VWAP Mean Reversion',
  file: 'vwap_mean_reversion.py',
  category: 'Mean Reversion',
  description: 'Fade extreme deviations from the session VWAP; target the snap-back to VWAP.',
  defaultSymbol: 'RELIANCE',
  defaultTimeframe: '15',
  params: [
    { key: 'entry_deviation', label: 'Entry Deviation (₹)', type: 'float', default: 1.0, min: 0.1, max: 50, step: 0.1 },
    { key: 'stop_distance', label: 'Stop Distance (₹)', type: 'float', default: 2.0, min: 0.1, max: 100, step: 0.1 },
    { key: 'warmup_period', label: 'Warmup Candles', type: 'int', default: 5, min: 1, max: 50, step: 1 },
    ...COMMON_PARAMS,
  ],
  generatePine: (p) => `${pineHeader('VWAP Mean Reversion', p)}

// ─── INPUTS ───────────────────────────────────────────────────────────────────
float entryDev = input.float(${(p.entry_deviation as number).toFixed(2)}, "Entry Deviation", minval = 0.1, step = 0.1)
float stopDist = input.float(${(p.stop_distance as number).toFixed(2)}, "Stop Distance", minval = 0.1, step = 0.1)
int   warmup   = input.int(${p.warmup_period as number}, "Warmup Candles", minval = 1)

${sharedSessionBlock()}

// ─── VWAP ──────────────────────────────────────────────────────────────────────
float vwapVal = ta.vwap(hlc3)
var int dayCount = 0
if is_new_day
    dayCount := 0
dayCount += 1

float dev = close - vwapVal
bool ready = entry_window and dayCount >= warmup and strategy.position_size == 0

bool buySig  = ready and dev <= -entryDev
bool sellSig = ready and dev >=  entryDev

if buySig
    strategy.entry("Long", strategy.long)
    strategy.exit("LX", "Long", stop = close - stopDist, limit = vwapVal)
if sellSig
    strategy.entry("Short", strategy.short)
    strategy.exit("SX", "Short", stop = close + stopDist, limit = vwapVal)

if time >= squareoff_ts and strategy.position_size != 0
    strategy.close_all("Square Off")

plot(vwapVal, "VWAP", color = color.orange, linewidth = 2)`,
};

// ---------------------------------------------------------------------------
// 3. EMA Trend Pullback
// ---------------------------------------------------------------------------
const EMA_TREND_PULLBACK: PineStrategyDef = {
  id: 'ema',
  label: 'EMA Trend Pullback',
  file: 'ema_trend_pullback.py',
  category: 'Trend',
  description: 'Trade pullbacks to the fast/medium EMA in the direction of a strict EMA-stack trend.',
  defaultSymbol: 'RELIANCE',
  defaultTimeframe: '15',
  params: [
    { key: 'ema_fast_period', label: 'Fast EMA', type: 'int', default: 9, min: 2, max: 50, step: 1 },
    { key: 'ema_med_period', label: 'Medium EMA', type: 'int', default: 21, min: 3, max: 100, step: 1 },
    { key: 'ema_slow_period', label: 'Slow EMA', type: 'int', default: 50, min: 5, max: 200, step: 1 },
    { key: 'pullback_band', label: 'Pullback Band (₹)', type: 'float', default: 1.0, min: 0.1, max: 50, step: 0.1 },
    { key: 'target_rr', label: 'Target R:R', type: 'float', default: 2.0, min: 0.5, max: 10, step: 0.1 },
    ...COMMON_PARAMS,
  ],
  generatePine: (p) => `${pineHeader('EMA Trend Pullback', p)}

// ─── INPUTS ───────────────────────────────────────────────────────────────────
int   fastP  = input.int(${p.ema_fast_period as number}, "Fast EMA", minval = 2)
int   medP   = input.int(${p.ema_med_period as number}, "Medium EMA", minval = 3)
int   slowP  = input.int(${p.ema_slow_period as number}, "Slow EMA", minval = 5)
float band   = input.float(${(p.pullback_band as number).toFixed(2)}, "Pullback Band", minval = 0.1, step = 0.1)
float rr     = input.float(${(p.target_rr as number).toFixed(2)}, "Target R:R", minval = 0.5, step = 0.1)

${sharedSessionBlock()}

// ─── EMA STACK ───────────────────────────────────────────────────────────────
float emaFast = ta.ema(close, fastP)
float emaMed  = ta.ema(close, medP)
float emaSlow = ta.ema(close, slowP)

bool trendUp   = emaFast > emaMed and emaMed > emaSlow
bool trendDown = emaFast < emaMed and emaMed < emaSlow

bool pulledBackUp = low <= emaFast + band or low <= emaMed + band
bool reclaimUp    = close > emaFast or close > emaMed
bool bullBody     = close >= open

bool pulledBackDn = high >= emaFast - band or high >= emaMed - band
bool reclaimDn    = close < emaFast or close < emaMed
bool bearBody     = close <= open

bool flat = strategy.position_size == 0

bool buySig  = entry_window and flat and trendUp   and pulledBackUp and reclaimUp and bullBody
bool sellSig = entry_window and flat and trendDown and pulledBackDn and reclaimDn and bearBody

if buySig
    float sl = emaSlow - band
    if sl < close
        float risk = close - sl
        strategy.entry("Long", strategy.long)
        strategy.exit("LX", "Long", stop = sl, limit = close + rr * risk)
if sellSig
    float sl = emaSlow + band
    if sl > close
        float risk = sl - close
        strategy.entry("Short", strategy.short)
        strategy.exit("SX", "Short", stop = sl, limit = close - rr * risk)

if time >= squareoff_ts and strategy.position_size != 0
    strategy.close_all("Square Off")

plot(emaFast, "EMA Fast", color = color.aqua)
plot(emaMed,  "EMA Med",  color = color.orange)
plot(emaSlow, "EMA Slow", color = color.red)`,
};

// ---------------------------------------------------------------------------
// 4. Z-Score Reversion
// ---------------------------------------------------------------------------
const ZSCORE_REVERSION: PineStrategyDef = {
  id: 'zscore',
  label: 'Z-Score Reversion',
  file: 'zscore_reversion.py',
  category: 'Mean Reversion',
  description: 'Fade rolling z-score extremes of close; target the rolling mean.',
  defaultSymbol: 'RELIANCE',
  defaultTimeframe: '15',
  params: [
    { key: 'lookback', label: 'Lookback', type: 'int', default: 20, min: 2, max: 200, step: 1 },
    { key: 'entry_z', label: 'Entry Z', type: 'float', default: 2.0, min: 0.5, max: 5, step: 0.1 },
    { key: 'exit_z', label: 'Stop Z', type: 'float', default: 3.0, min: 0.5, max: 8, step: 0.1 },
    ...COMMON_PARAMS,
  ],
  generatePine: (p) => `${pineHeader('Z-Score Reversion', p)}

// ─── INPUTS ───────────────────────────────────────────────────────────────────
int   lookback = input.int(${p.lookback as number}, "Lookback", minval = 2)
float entryZ   = input.float(${(p.entry_z as number).toFixed(2)}, "Entry Z", minval = 0.5, step = 0.1)
float exitZ    = input.float(${(p.exit_z as number).toFixed(2)}, "Stop Z", minval = 0.5, step = 0.1)

${sharedSessionBlock()}

// ─── ROLLING STATS ──────────────────────────────────────────────────────────
float mean = ta.sma(close, lookback)
float sd   = ta.stdev(close, lookback)
float z    = sd > 0 ? (close - mean) / sd : 0.0

bool flat = strategy.position_size == 0
bool computable = sd > 0 and bar_index >= lookback

bool buySig  = entry_window and flat and computable and z <= -entryZ
bool sellSig = entry_window and flat and computable and z >=  entryZ

if buySig
    strategy.entry("Long", strategy.long)
    strategy.exit("LX", "Long", stop = close - exitZ * sd, limit = mean)
if sellSig
    strategy.entry("Short", strategy.short)
    strategy.exit("SX", "Short", stop = close + exitZ * sd, limit = mean)

if time >= squareoff_ts and strategy.position_size != 0
    strategy.close_all("Square Off")

plot(mean, "Rolling Mean", color = color.orange)`,
};

// ---------------------------------------------------------------------------
// 5. Volatility Squeeze Breakout
// ---------------------------------------------------------------------------
const VOLATILITY_SQUEEZE: PineStrategyDef = {
  id: 'squeeze',
  label: 'Volatility Squeeze',
  file: 'volatility_squeeze.py',
  category: 'Breakout',
  description: 'Bollinger-inside-Keltner squeeze, then trade the release breakout. Stop at opposite side of coil.',
  defaultSymbol: 'NIFTY',
  defaultTimeframe: '5',
  params: [
    { key: 'lookback', label: 'Lookback', type: 'int', default: 20, min: 5, max: 100, step: 1 },
    { key: 'bb_std', label: 'Bollinger Std', type: 'float', default: 2.0, min: 1, max: 3, step: 0.1 },
    { key: 'kc_multiplier', label: 'Keltner Mult', type: 'float', default: 1.5, min: 0.5, max: 3, step: 0.1 },
    { key: 'breakout_band', label: 'Breakout Band (₹)', type: 'float', default: 0.0, min: 0, max: 50, step: 0.1 },
    { key: 'target_rr', label: 'Target R:R', type: 'float', default: 2.0, min: 0.5, max: 10, step: 0.1 },
    ...COMMON_PARAMS,
  ],
  generatePine: (p) => `${pineHeader('Volatility Squeeze', p)}

// ─── INPUTS ───────────────────────────────────────────────────────────────────
int   lookback = input.int(${p.lookback as number}, "Lookback", minval = 5)
float bbStd    = input.float(${(p.bb_std as number).toFixed(2)}, "Bollinger Std", minval = 1.0, step = 0.1)
float kcMult   = input.float(${(p.kc_multiplier as number).toFixed(2)}, "Keltner Mult", minval = 0.5, step = 0.1)
float brkBand  = input.float(${(p.breakout_band as number).toFixed(2)}, "Breakout Band", minval = 0.0, step = 0.1)
float rr       = input.float(${(p.target_rr as number).toFixed(2)}, "Target R:R", minval = 0.5, step = 0.1)

${sharedSessionBlock()}

// ─── BANDS ───────────────────────────────────────────────────────────────────
float basis  = ta.sma(close, lookback)
float dev    = bbStd * ta.stdev(close, lookback)
float bbUp   = basis + dev
float bbLow  = basis - dev
float atr    = ta.atr(lookback)
float kcUp   = basis + kcMult * atr
float kcLow  = basis - kcMult * atr

bool squeezeOn = bbUp < kcUp and bbLow > kcLow

var bool  squeezeSeen = false
var float sqHigh = na
var float sqLow  = na

if is_new_day
    squeezeSeen := false
    sqHigh := na
    sqLow  := na

if squeezeOn
    squeezeSeen := true
    sqHigh := na(sqHigh) ? high : math.max(sqHigh, high)
    sqLow  := na(sqLow)  ? low  : math.min(sqLow,  low)

bool flat   = strategy.position_size == 0
bool armed  = squeezeSeen and not squeezeOn and not na(sqHigh) and not na(sqLow)

bool buySig  = entry_window and flat and armed and close > sqHigh + brkBand and close > open
bool sellSig = entry_window and flat and armed and close < sqLow  - brkBand and close < open

if buySig
    float risk = close - sqLow
    if risk > 0
        strategy.entry("Long", strategy.long)
        strategy.exit("LX", "Long", stop = sqLow, limit = close + rr * risk)
if sellSig
    float risk = sqHigh - close
    if risk > 0
        strategy.entry("Short", strategy.short)
        strategy.exit("SX", "Short", stop = sqHigh, limit = close - rr * risk)

if time >= squareoff_ts and strategy.position_size != 0
    strategy.close_all("Square Off")

plot(bbUp, "BB Upper", color = color.new(color.blue, 40))
plot(bbLow, "BB Lower", color = color.new(color.blue, 40))
plot(kcUp, "KC Upper", color = color.new(color.gray, 40))
plot(kcLow, "KC Lower", color = color.new(color.gray, 40))
bgcolor(squeezeOn ? color.new(color.purple, 85) : na)`,
};

export const PINE_STRATEGIES: PineStrategyDef[] = [
  ORB_ENHANCED,
  VWAP_MEAN_REVERSION,
  EMA_TREND_PULLBACK,
  ZSCORE_REVERSION,
  VOLATILITY_SQUEEZE,
];

export function getPineStrategy(id: string): PineStrategyDef | undefined {
  return PINE_STRATEGIES.find((s) => s.id === id);
}

export function defaultParamValues(def: PineStrategyDef): PineParamValues {
  const out: PineParamValues = {};
  for (const param of def.params) out[param.key] = param.default;
  return out;
}
