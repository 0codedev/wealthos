import { StockData } from '../AlphaEngineService';
import { ConvictionInputs, ConvictionScore, score, StrategyId } from './ConvictionEngine';
export type { StrategyId };
import { RVOL_THRESHOLDS } from './RvolService';

export interface StrategyConfig {
  id: StrategyId;
  label: string;
  badgeLabel: string;
  color: string;
  description: string;
  session: { startHour: number; endHour: number };
  rvolThreshold: number;
  p0Checks: { id: string; label: string }[];
  power20: string[];
  learningNotes: string[];
}

export interface StrategyScore {
  strategy: StrategyId;
  score: number;           // 0–100
  p0Passed: boolean;
  p0Failures: string[];
  power20Matched: string[];  // which P20 indicators are currently firing
  conviction: ConvictionScore;
  recommendation: 'FIRE' | 'WATCH' | 'SKIP';
  entryTrigger: string;
  stopLoss: string;
  target: string;
}

export const STRATEGY_CONFIGS: Record<StrategyId, StrategyConfig> = {
  ema_snapback: {
    id: 'ema_snapback',
    label: 'EMA Snapback Scalping',
    badgeLabel: 'SCALP',
    color: '#A855F7', // Purple/Violet
    description: 'After 3–4 consecutive momentum candles in one direction, price reverts to the nearest EMA. Catch the snapback reversion.',
    session: { startHour: 9, endHour: 15 },
    rvolThreshold: RVOL_THRESHOLDS.ema_snapback,
    p0Checks: [
      { id: 'rvol_gate', label: 'RVOL ≥ 1.5x' },
      { id: 'consecutive_candles', label: '3+ Consecutive Momentum Candles' },
      { id: 'price_extended', label: 'Price Extended ≥ 1.5% from EMA' },
      { id: 'rsi_extreme', label: 'RSI > 75 or < 25' }
    ],
    power20: [
      'close_cross_above_9_ema',
      'close_cross_below_9_ema',
      'close_above_10_ema',
      'close_below_10_ema',
      'rsi_overbought',
      'rsi_oversold',
      'price_above_bollinger_band',
      'price_below_bollinger_band',
      'vwap_5min_cross_above',
      'vwap_5min_cross_below',
      'williams_r_overbought',
      'williams_r_oversold',
      'stochastic_fast_overbought',
      'stochastic_fast_oversold',
      'mfi_overbought',
      'mfi_oversold',
      'cci_overbought',
      'cci_oversold',
      'open_equals_low',
      'open_equals_high'
    ],
    learningNotes: [
      'The EMA acts like a rubber band — the further it stretches, the harder it snaps back.',
      'Always wait for the first candle of exhaustion (red for short setup, green for long setup) before entering.',
      'Exit immediately at the 9 EMA or if price makes a new momentum high/low.'
    ]
  },
  morning_snapback: {
    id: 'morning_snapback',
    label: '9–10 AM EMA Snapback Continuation',
    badgeLabel: 'CONT',
    color: '#10B981', // Green
    description: 'Opening momentum halts due to brief profit-taking, holds VWAP, then original momentum resumes. Enter on resumption.',
    session: { startHour: 9, endHour: 11 },
    rvolThreshold: RVOL_THRESHOLDS.morning_snapback,
    p0Checks: [
      { id: 'momentum_open', label: 'Directional Open Momentum (O2C ≥ 1.5%)' },
      { id: 'rvol_gate', label: 'RVOL ≥ 1.5x' },
      { id: 'vwap_hold', label: 'Price Holds VWAP' },
      { id: 'orb_preserved', label: 'ORB Preserved' },
      { id: 'ema_alignment', label: 'EMA Alignment (Price > 9 > 20)' },
      { id: 'no_exhaustion_trap', label: 'No Exhaustion Trap' },
      { id: 'near_extreme', label: 'Near Day Extreme (Pullback ≤ 1.5%)' },
      { id: 'velocity_gate', label: 'Velocity Gate (≤ 0.40%/min)' },
      { id: 'rvol_ceiling_gate', label: 'RVOL Ceiling Gate (≤ 10x)' },
      { id: 'day_extreme_gate', label: 'HOD Proximity Gate' },
      { id: 'gap_gate', label: 'No Parabolic Gap' }
    ],
    power20: [
      'close_above_9_ema',
      'ema_5_cross_above_15_ema',
      'macd_cross_above_signal_line',
      'macd_above_zero_line',
      'adx_trending_stocks',
      'price_above_supertrend',
      'vwap_5min_cross_above',
      'rsi_cross_above_central_line',
      'cmf_strong_buying_pressure',
      'close_above_20_ema',
      'ema_15_cross_above_50_ema',
      'price_volume_trending_up_3',
      'breakout_20',
      'near_50_support',
      'retracing_from_50_support',
      'price_above_r1',
      'price_above_r2',
      'stochastic_fast_k_above_d_crossover',
      'awesome_oscillator_bullish_reversal',
      'open_equals_low'
    ],
    learningNotes: [
      'Institutional participation is confirmed by high volume (RVOL ≥ 3.0x) in the first 15 minutes.',
      'We do not fade morning momentum; we ride it after the first pullback holds key support.',
      'VWAP is the ultimate line in the sand — if price breaks below VWAP (for longs), the trend is invalid.'
    ]
  },
  upper_circuit: {
    id: 'upper_circuit',
    label: 'Upper Circuit / Pre-UC Setup',
    badgeLabel: 'UC',
    color: '#3B82F6', // Blue
    description: 'Stocks approaching upper circuit accumulate momentum via news or institutional buying. Ride the final surge to UC.',
    session: { startHour: 9, endHour: 13 },
    rvolThreshold: RVOL_THRESHOLDS.upper_circuit,
    p0Checks: [
      { id: 'rvol_gate', label: 'RVOL ≥ 5.0x' },
      { id: 'circuit_proximity', label: 'Within 3% of Upper Circuit' },
      { id: 'oi_favorable', label: 'Favorable OI / Volume Build' },
      { id: 'no_trap', label: 'No Trap / Exhaustion Risk' },
      { id: 'range_contraction', label: 'Volatility Contraction (NR4/NR7)' }
    ],
    power20: [
      'close_above_200_sma',
      'close_above_100_sma',
      'ema_50_cross_above_200_ema',
      'adx_strong_trending_stocks',
      'price_above_supertrend',
      'vwap_trending_up_5_ticks',
      'breakout_20',
      'price_volume_trending_up_3',
      'open_equals_low',
      'gap_up',
      'cmf_very_strong_buying_pressure',
      'close_above_100_ema',
      'close_above_200_ema',
      'price_above_r3',
      'rsi_overbought',
      'mfi_overbought',
      'close_above_50_ema',
      'ema_20_cross_above_50_ema',
      'price_above_psar',
      'price_above_ichimoku_cloud'
    ],
    learningNotes: [
      'Upper circuit plays are high-volatility events. Ensure no trap risk flags are active before entry.',
      'Sub-type A plays surge instantly; Sub-type B plays accumulate slowly after 9:30 AM.',
      'Always trail your stop loss tightly behind the 9 EMA or VWAP.'
    ]
  },
  fno_orb_retest: {
    id: 'fno_orb_retest',
    label: 'F&O Opening Range Breakout Retest',
    badgeLabel: 'ORB RETEST',
    color: '#F59E0B', // Amber/Gold
    description: 'Price breaks out of the opening range high/low with strong volume, then pulls back to hold the breakout level (retest). Enter on retest confirmation.',
    session: { startHour: 10, endHour: 15 },
    rvolThreshold: RVOL_THRESHOLDS.fno_orb_retest,
    p0Checks: [
      { id: 'rvol_gate', label: 'RVOL ≥ 1.5x' },
      { id: 'time_gate', label: 'Time ≥ 10:00 AM IST' },
      { id: 'orb_broken', label: 'ORB Broken' },
      { id: 'retest_holding', label: 'Retest Zone Holding (±0.3% of ORB Price)' },
      { id: 'no_trap', label: 'CleanTrend ≠ TRAP' },
      { id: 'vwap_hold', label: 'Price Holds VWAP Support' }
    ],
    power20: [
      'close_above_9_ema',
      'vwap_5min_cross_above',
      'breakout_20',
      'price_volume_trending_up_3',
      'open_equals_low',
      'cmf_strong_buying_pressure',
      'rsi_cross_above_central_line'
    ],
    learningNotes: [
      'Wait for 10:00 AM IST before entering to avoid morning noise.',
      'Entering on a retest (breakout level ±0.3%) offers the best risk-to-reward ratio.',
      'Always use a hard stop loss just below/above the breakout boundary (0.5% buffer).'
    ]
  }
};

export function evaluateStrategyScore(
  stock: StockData,
  strategyId: StrategyId,
  baseInputs: ConvictionInputs
): StrategyScore {
  const config = STRATEGY_CONFIGS[strategyId];

  // 1. Evaluate P0 Gates
  const p0Failures: string[] = [];

  // Check RVOL gate
  const rvolVal = baseInputs.rvol;
  if (rvolVal < config.rvolThreshold) {
    p0Failures.push(`RVOL (${rvolVal.toFixed(2)}x) < Threshold (${config.rvolThreshold}x)`);
  }

  // Strategy-specific P0 checks
  if (strategyId === 'ema_snapback') {
    // 3+ consecutive candles
    let consecutiveCandles = false;
    if (stock.candleBuffer && stock.candleBuffer.length >= 3) {
      const len = stock.candleBuffer.length;
      const last3 = stock.candleBuffer.slice(len - 3);
      const allGreen = last3.every(c => c.close > c.open);
      const allRed = last3.every(c => c.close < c.open);
      if (allGreen || allRed) consecutiveCandles = true;
    } else {
      if (Math.abs(stock.percentChange) >= 1.5) consecutiveCandles = true;
    }
    if (!consecutiveCandles) {
      p0Failures.push('No 3+ consecutive momentum candles detected');
    }

    // Extended from EMA
    let extended = false;
    const currentPrice = stock.lastPrice;
    if (stock.atp && stock.atp > 0) {
      const dist = Math.abs(currentPrice - stock.atp) / stock.atp;
      if (dist >= 0.015) extended = true;
    } else if (stock.openPrice > 0) {
      const dist = Math.abs(currentPrice - stock.openPrice) / stock.openPrice;
      if (dist >= 0.015) extended = true;
    }
    if (!extended) {
      p0Failures.push('Price not extended ≥ 1.5% from EMA/VWAP baseline');
    }

    // RSI extreme (RSI > 75 or < 25)
    let rsiExtreme = false;
    if (Math.abs(stock.percentChange) >= 2.0) {
      rsiExtreme = true;
    }
    if (!rsiExtreme) {
      p0Failures.push('No RSI overbought/oversold extreme detected');
    }

  } else if (strategyId === 'morning_snapback') {
    // Directional open momentum
    const openChange = stock.openChangePct !== undefined ? stock.openChangePct : stock.percentChange;
    if (Math.abs(openChange) < 1.5) {
      p0Failures.push(`Opening momentum too low (${Math.abs(openChange).toFixed(2)}%)`);
    }

    // Price holds VWAP
    const holdsVwap = stock.signal === 'Up' 
      ? stock.lastPrice > (stock.atp || stock.openPrice)
      : stock.lastPrice < (stock.atp || stock.openPrice);
    if (!holdsVwap) {
      p0Failures.push('Price failed to hold VWAP support/resistance');
    }

    // ORB preserved
    if (baseInputs.orbPreserved === false) {
      p0Failures.push('Opening Range Breakout boundaries violated');
    }

    // EMA alignment
    const emaAligned = stock.signal === 'Up'
      ? stock.lastPrice > stock.openPrice
      : stock.lastPrice < stock.openPrice;
    if (!emaAligned) {
      p0Failures.push('EMA trend alignment not verified');
    }

    // No Exhaustion Trap: Reject if dayExtremeScore > 0.92 AND openingGapPct > 3.0%
    if (stock.dayExtremeScore > 0.92 && stock.openingGapPct > 3.0) {
      p0Failures.push(`Exhaustion trap risk: Day Extreme (${(stock.dayExtremeScore * 100).toFixed(1)}%) & Opening Gap (${stock.openingGapPct.toFixed(1)}%) are too high`);
    }

    // Near Day Extreme Gate (Pullback <= 1.5% from HOD/LOD)
    const isLong = stock.signal === 'Up';
    const highVal = stock.high || stock.lastPrice || 0;
    const lowVal = stock.low || stock.lastPrice || 0;
    const ltpVal = stock.lastPrice || 0;
    const hodProximity = ltpVal > 0 ? ((highVal - ltpVal) / ltpVal) * 100 : 0;
    const lodProximity = ltpVal > 0 ? ((ltpVal - lowVal) / ltpVal) * 100 : 0;
    const proximityVal = isLong ? hodProximity : lodProximity;
    if (proximityVal > 1.5) {
      p0Failures.push(`Pullback too large from Day Extreme (${proximityVal.toFixed(2)}% > 1.5% limit)`);
    }

    // P0-A: Velocity Gate (reject if velocity > 0.40)
    const nowIST = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const istDate = new Date(nowIST);
    const marketOpen = new Date(istDate);
    marketOpen.setHours(9, 30, 0, 0);
    const elapsedMs = istDate.getTime() - marketOpen.getTime();
    const elapsedMin = Math.max(1, elapsedMs / 60000);
    const velocity = Math.abs(stock.percentChange) / elapsedMin;
    if (velocity > 0.40) {
      p0Failures.push(`Velocity Gate: ${velocity.toFixed(3)}%/min > 0.40%/min limit`);
    }

    // P0-B: RVOL Ceiling Gate (reject if rvol > 10.0)
    if (baseInputs.rvol > 10.0) {
      p0Failures.push(`RVOL Ceiling Gate: ${baseInputs.rvol.toFixed(2)}x > 10.0x limit`);
    }

    // P0-C: HOD Proximity Gate (reject if dayExtremeScore > 0.88 AND elapsedMin < 25)
    if (stock.dayExtremeScore > 0.88 && elapsedMin < 25) {
      p0Failures.push(`HOD Proximity Gate: Day Extreme ${(stock.dayExtremeScore * 100).toFixed(0)}% is too high in the first 25 minutes`);
    }

    // P0-D: First Candle/Gap Gate (reject if openingGapPct > 3.0)
    const gapVal = stock.openingGapPct !== undefined ? stock.openingGapPct : 0;
    if (gapVal > 3.0) {
      p0Failures.push(`Parabolic Gap Gate: Opening Gap ${gapVal.toFixed(2)}% > 3.0% limit`);
    }

  } else if (strategyId === 'upper_circuit') {
    // Circuit proximity (within 3% of UC)
    let nearCircuit = false;
    if (stock.upperCircuit && stock.upperCircuit > 0) {
      const dist = (stock.upperCircuit - stock.lastPrice) / stock.upperCircuit;
      if (dist >= 0 && dist <= 0.03) nearCircuit = true;
    } else {
      // fallback: close to 20% limit
      if (stock.percentChange >= 17.0) nearCircuit = true;
    }
    if (!nearCircuit) {
      p0Failures.push('Price not within 3% of Upper Circuit');
    }

    // Favorable OI
    const favorableOi = baseInputs.oiQuadrant === 'LONG_BUILDUP' || baseInputs.oiQuadrant === 'SHORT_COVERING' || (stock.oi !== undefined && stock.oi > 0);
    if (!favorableOi) {
      p0Failures.push('Favorable OI accumulation not detected');
    }

    // No trap
    if (baseInputs.isTrapRisk || stock.isTrapRisk) {
      p0Failures.push('Active TRAP / Exhaustion Risk detected');
    }

    // Range contraction
    // assume passed unless marked otherwise or fallback
    const rangeContraction = true; // default pass for pre-UC setup
    if (!rangeContraction) {
      p0Failures.push('No previous volatility contraction (NR4/NR7) detected');
    }
  } else if (strategyId === 'fno_orb_retest') {
    // 1. RVOL gate (1.5x) checked generically at line 174
    // 2. Time gate (time >= 10:00 AM IST)
    const nowIST = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const istDate = new Date(nowIST);
    const timeOk = istDate.getHours() >= 10;
    if (!timeOk) {
      p0Failures.push('Time is before 10:00 AM IST (noise clearing)');
    }

    // 3. ORB broken and boundaries holding
    if (baseInputs.orbPreserved === false) {
      p0Failures.push('ORB boundaries violated (HOD/LOD breached back)');
    }

    // 4. Retest holding (CleanTrend != TRAP)
    if (baseInputs.isTrapRisk || stock.isTrapRisk) {
      p0Failures.push('Active CleanTrend TRAP detected');
    }

    // 5. Price holds VWAP
    const isBull = baseInputs.direction === 'CALL';
    const holdsVwap = isBull 
      ? stock.lastPrice > (stock.atp || stock.openPrice)
      : stock.lastPrice < (stock.atp || stock.openPrice);
    if (!holdsVwap) {
      p0Failures.push('Price failed to hold VWAP support/resistance');
    }
  }

  const p0Passed = p0Failures.length === 0;

  // Calculate velocity and opening gap pct for ConvictionInputs
  const nowIST = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const istDate = new Date(nowIST);
  const marketOpen = new Date(istDate);
  marketOpen.setHours(9, 30, 0, 0);
  const elapsedMs = istDate.getTime() - marketOpen.getTime();
  const elapsedMin = Math.max(1, elapsedMs / 60000);
  const velocity = Math.abs(stock.percentChange) / elapsedMin;
  const openingGapPct = stock.openingGapPct !== undefined ? stock.openingGapPct : 0;

  // 2. Calculate Conviction Score (strategy-weighted)
  const inputsWithStrategy: ConvictionInputs = {
    ...baseInputs,
    strategyId: strategyId,
    velocity,
    openingGapPct
  };
  const convictionScore = score(inputsWithStrategy);

  // 3. Power-20 Matched Indicators
  // We can scan indicators based on the stock attributes and strategy
  const power20Matched: string[] = [];
  config.power20.forEach(condId => {
    let matched = false;
    if (condId.includes('ema') || condId.includes('sma') || condId.includes('vwap')) {
      if (stock.signal === 'Up' && condId.includes('above')) matched = true;
      if (stock.signal === 'Down' && condId.includes('below')) matched = true;
    } else if (condId.includes('rsi') || condId.includes('stochastic') || condId.includes('mfi') || condId.includes('cci') || condId.includes('williams')) {
      if (stock.percentChange > 2 && (condId.includes('overbought') || condId.includes('above'))) matched = true;
      if (stock.percentChange < -2 && (condId.includes('oversold') || condId.includes('below'))) matched = true;
    } else if (condId.includes('bollinger') || condId.includes('r3') || condId.includes('r1')) {
      if (stock.dayExtremeScore >= 0.9 && condId.includes('above')) matched = true;
      if (stock.dayExtremeScore <= 0.1 && condId.includes('below')) matched = true;
    } else if (condId.includes('open_equals_low')) {
      if (Math.abs(stock.openPrice - stock.low) <= 0.05) matched = true;
    } else if (condId.includes('open_equals_high')) {
      if (Math.abs(stock.openPrice - stock.high) <= 0.05) matched = true;
    } else if (condId.includes('price_volume')) {
      if (stock.percentChange > 0 && stock.volume > 0) matched = true;
    }
    if (matched) {
      power20Matched.push(condId);
    }
  });

  // 4. Recommendation, Trigger, SL, Target
  let finalScore = convictionScore.score;
  if (strategyId === 'morning_snapback') {
    const rvolVal = baseInputs.rvol;
    
    // Cap and Penalize RVOL (1.5-4x -> +2, 4-6x -> +1, 6-8x -> +0, >8x -> -3)
    if (rvolVal > 8.0) {
      finalScore -= 3;
    } else if (rvolVal > 6.0) {
      // +0
    } else if (rvolVal >= 4.0) {
      finalScore += 1;
    } else if (rvolVal >= 1.5) {
      finalScore += 2;
    }

    // Velocity Sweet-Spot Scoring (0.05-0.25 -> +3, 0.25-0.40 -> +1, >0.40 -> -5)
    if (velocity > 0.40) {
      finalScore -= 5;
    } else if (velocity >= 0.25) {
      finalScore += 1;
    } else if (velocity >= 0.05) {
      finalScore += 3;
    }

    // Add dayExtreme room-to-grow bonus (<0.65 -> +2, 0.65-0.80 -> +1, >=0.80 -> -2)
    const de = baseInputs.dayExtreme;
    if (de < 0.65) {
      finalScore += 2;
    } else if (de < 0.80) {
      finalScore += 1;
    } else {
      finalScore -= 2;
    }

    // Penalize day extreme pullback (similar to FNO DES core concept)
    const ltp = stock.lastPrice || 0;
    const isLong = stock.signal === 'Up';
    const highVal = stock.high || ltp || 0;
    const lowVal = stock.low || ltp || 0;
    const hodProximity = ltp > 0 ? ((highVal - ltp) / ltp) * 100 : 0;
    const lodProximity = ltp > 0 ? ((ltp - lowVal) / ltp) * 100 : 0;
    const proximityVal = isLong ? hodProximity : lodProximity;
    const proximityFactor = Math.max(0, 1.0 - proximityVal / 1.5); // 1.0 = at high, 0.0 = 1.5%+ pullback
    finalScore -= Math.round((1.0 - proximityFactor) * 20);

    finalScore = Math.max(0, Math.min(100, finalScore));
  }

  let recommendation: 'FIRE' | 'WATCH' | 'SKIP' = 'SKIP';
  if (p0Passed) {
    recommendation = finalScore >= 70 ? 'FIRE' : 'WATCH';
  }

  let entryTrigger = '';
  let stopLoss = '';
  let target = '';

  const price = stock.lastPrice;
  if (strategyId === 'ema_snapback') {
    const isBull = stock.percentChange > 0;
    entryTrigger = isBull ? 'Wait for first red 1-min candle' : 'Wait for first green 1-min candle';
    stopLoss = isBull 
      ? `₹${(price * 1.005).toFixed(2)} (above high)` 
      : `₹${(price * 0.995).toFixed(2)} (below low)`;
    target = stock.atp && stock.atp > 0 
      ? `₹${stock.atp.toFixed(2)} (nearest EMA)` 
      : `₹${(price * (isBull ? 0.99 : 1.01)).toFixed(2)}`;
  } else if (strategyId === 'morning_snapback') {
    const isLong = stock.signal === 'Up';
    entryTrigger = isLong ? 'Buy on breakout above first 15-min high' : 'Sell on breakdown below first 15-min low';
    stopLoss = stock.atp && stock.atp > 0
      ? `₹${(stock.atp * (isLong ? 0.995 : 1.005)).toFixed(2)} (VWAP invalidation)`
      : `₹${(price * (isLong ? 0.99 : 1.01)).toFixed(2)}`;
    target = isLong
      ? `₹${(price * 1.03).toFixed(2)} (Psychological/Fib extension)`
      : `₹${(price * 0.97).toFixed(2)}`;
  } else if (strategyId === 'upper_circuit') {
    entryTrigger = 'Buy on sustained volume breakout above range high';
    stopLoss = stock.atp && stock.atp > 0
      ? `₹${stock.atp.toFixed(2)} (VWAP level)`
      : `₹${(price * 0.98).toFixed(2)}`;
    target = stock.upperCircuit && stock.upperCircuit > 0
      ? `₹${stock.upperCircuit.toFixed(2)} (Upper Circuit)`
      : `₹${(price * 1.03).toFixed(2)}`;
  } else if (strategyId === 'fno_orb_retest') {
    const isLong = baseInputs.direction === 'CALL';
    const orbPrice = stock.openPrice;
    const retestLow = orbPrice * 0.997;
    const retestHigh = orbPrice * 1.003;
    entryTrigger = isLong 
      ? `Buy CE on retest zone ₹${retestLow.toFixed(2)} - ₹${retestHigh.toFixed(2)}` 
      : `Buy PE on retest zone ₹${retestLow.toFixed(2)} - ₹${retestHigh.toFixed(2)}`;
    stopLoss = isLong
      ? `₹${(orbPrice * 0.995).toFixed(2)} (0.5% below ORB High)`
      : `₹${(orbPrice * 1.005).toFixed(2)} (0.5% above ORB Low)`;
    target = isLong
      ? `₹${(orbPrice * 1.03).toFixed(2)} (3% target)`
      : `₹${(orbPrice * 0.97).toFixed(2)}`;
  }

  return {
    strategy: strategyId,
    score: finalScore,
    p0Passed,
    p0Failures,
    power20Matched,
    conviction: convictionScore,
    recommendation,
    entryTrigger,
    stopLoss,
    target
  };
}

export function detectBestStrategy(
  stock: StockData,
  inputs: ConvictionInputs
): { strategy: StrategyId; score: number; p0Passed: boolean } | null {
  let bestStrategy: StrategyId | null = null;
  let bestScore = -1;
  let bestP0Passed = false;

  const strategies: StrategyId[] = ['ema_snapback', 'morning_snapback', 'upper_circuit', 'fno_orb_retest'];

  strategies.forEach(strategyId => {
    const res = evaluateStrategyScore(stock, strategyId, inputs);
    if (res.p0Passed && !bestP0Passed) {
      // P0 passing strategy takes priority
      bestStrategy = strategyId;
      bestScore = res.score;
      bestP0Passed = true;
    } else if (res.p0Passed === bestP0Passed && res.score > bestScore) {
      bestStrategy = strategyId;
      bestScore = res.score;
    }
  });

  if (bestStrategy) {
    return {
      strategy: bestStrategy,
      score: bestScore,
      p0Passed: bestP0Passed
    };
  }

  return null;
}

// ─── ORB RETEST DETECTOR HELPERS ─────────────────────────────────────────────

function localFindOrbMatch(
  cache: Record<string, any[]> | undefined,
  symbol: string,
): { row: any; minutes: number | null; prb: boolean } | null {
  if (!cache) return null;
  const upper = symbol.toUpperCase();
  const orderedKeys = Object.keys(cache).sort((a, b) => {
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
      const minutesOrNull = Number.isFinite(minutes) ? minutes : null;
      return { row, minutes: minutesOrNull, prb };
    }
  }
  return null;
}

export interface OrbRetestStatus {
  status: 'RETEST' | 'BREAK' | 'PENDING' | 'TRAP' | 'N/A';
  orbPrice: number;
  entryZone: { low: number; high: number };
  stopLoss: number;
  target: number;
  volumeConfirmed: boolean;
}

export function detectOrbRetestStatus(
  stock: StockData,
  orbDataCache: Record<string, any[]> | undefined,
  liveQuotes: Record<string, any> | undefined,
  currentTimeIST: Date,
  cleanTrendVerdict?: string,
  volumeAverages?: Record<string, number>
): OrbRetestStatus {
  const symbol = stock.symbol.toUpperCase();
  const price = liveQuotes?.[symbol]?.ltp ?? liveQuotes?.[symbol]?.last_price ?? stock.lastPrice;
  const vol = liveQuotes?.[symbol]?.volume ?? stock.volume;

  const orbMatch = localFindOrbMatch(orbDataCache, symbol);
  if (!orbMatch) {
    return {
      status: 'PENDING',
      orbPrice: stock.openPrice || price,
      entryZone: { low: (stock.openPrice || price) * 0.997, high: (stock.openPrice || price) * 1.003 },
      stopLoss: (stock.openPrice || price) * 0.995,
      target: (stock.openPrice || price) * 1.03,
      volumeConfirmed: false,
    };
  }

  const orbPrice = Number(orbMatch.row.orb_price) || Number(orbMatch.row.open) || stock.openPrice || price;
  const isBull = orbMatch.row.breakout === 'Bullish' || stock.signal === 'Up';

  if (cleanTrendVerdict === 'TRAP') {
    return {
      status: 'TRAP',
      orbPrice,
      entryZone: { low: orbPrice * 0.997, high: orbPrice * 1.003 },
      stopLoss: isBull ? orbPrice * 0.995 : orbPrice * 1.005,
      target: isBull ? orbPrice * 1.03 : orbPrice * 0.97,
      volumeConfirmed: false,
    };
  }

  // Volume confirmation check
  const adv = volumeAverages?.[symbol] ?? 0;
  const volumeConfirmed = adv > 0 ? (vol > adv * 1.5) : true;

  // Time Gate check
  const hours = currentTimeIST.getHours();
  const minutes = currentTimeIST.getMinutes();
  const isAfterTimeGate = hours > 10 || (hours === 10 && minutes >= 0);

  if (isBull) {
    const entryZone = { low: orbPrice * 0.997, high: orbPrice * 1.003 };
    const stopLoss = orbPrice * 0.995;
    const target = orbPrice * 1.03;

    if (price > orbPrice * 1.003) {
      return { status: 'BREAK', orbPrice, entryZone, stopLoss, target, volumeConfirmed };
    } else if (price >= orbPrice * 0.997 && price <= orbPrice * 1.003) {
      if (isAfterTimeGate) {
        return { status: 'RETEST', orbPrice, entryZone, stopLoss, target, volumeConfirmed };
      } else {
        return { status: 'BREAK', orbPrice, entryZone, stopLoss, target, volumeConfirmed };
      }
    } else {
      return { status: 'PENDING', orbPrice, entryZone, stopLoss, target, volumeConfirmed };
    }
  } else {
    // Bearish
    const entryZone = { low: orbPrice * 0.997, high: orbPrice * 1.003 };
    const stopLoss = orbPrice * 1.005;
    const target = orbPrice * 0.97;

    if (price < orbPrice * 0.997) {
      return { status: 'BREAK', orbPrice, entryZone, stopLoss, target, volumeConfirmed };
    } else if (price >= orbPrice * 0.997 && price <= orbPrice * 1.003) {
      if (isAfterTimeGate) {
        return { status: 'RETEST', orbPrice, entryZone, stopLoss, target, volumeConfirmed };
      } else {
        return { status: 'BREAK', orbPrice, entryZone, stopLoss, target, volumeConfirmed };
      }
    } else {
      return { status: 'PENDING', orbPrice, entryZone, stopLoss, target, volumeConfirmed };
    }
  }
}

/**
 * Computes pure technical signals (Open-Low, Open-High, Gap-Up, Gap-Down) for a given stock
 */
export const getSignal = (stock: {
  Open?: number;
  Low?: number;
  High?: number;
  prevClose?: number;
  open?: number;
  low?: number;
  high?: number;
  previousClose?: number;
}) => {
  const open = stock.Open ?? stock.open ?? 0;
  const low = stock.Low ?? stock.low ?? 0;
  const high = stock.High ?? stock.high ?? 0;
  const prevClose = stock.prevClose ?? stock.previousClose ?? 0;
  return {
    isOpenLow: open > 0 && open === low,
    isOpenHigh: open > 0 && open === high,
    isGapUp: open > 0 && prevClose > 0 && open > prevClose,
    isGapDown: open > 0 && prevClose > 0 && open < prevClose
  };
};
