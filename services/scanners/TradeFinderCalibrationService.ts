/**
 * TradeFinder Scanner Calibration & Mathematical Convergence Service
 *
 * Implements Work Package 16 & DOMAIN 03/04:
 * 1. Time-of-Day Expected Volume Curve E[V(t) | tau] matching Indian market intraday U-curve
 * 2. ATR-Standardized High/Low Diff% eliminating market-cap & volatility distortion
 * 3. SqueezeFactor NR7 reinforced with Carter TTM Bollinger Bands inside Keltner Channel
 * 4. Institutional Commitment Flow (ICF) 4-Quadrant derivative classification & conviction model
 */

export interface StandardizedDiffResult {
  ltp: number;
  dayHigh: number;
  dayLow: number;
  diffHighPct: number;      // ((DayHigh - LTP) / DayHigh) * 100
  diffLowPct: number;       // ((LTP - DayLow) / DayLow) * 100
  diffHighATR: number;      // (DayHigh - LTP) / ATR14
  diffLowATR: number;       // (LTP - DayLow) / ATR14
  proximityScore: number;   // 0 - 100 (100 = testing extremes <= 0.1 ATR)
  extremeSide: 'HIGH' | 'LOW' | 'EQUILIBRIUM';
}

export interface SqueezeFactorResult {
  isNR7: boolean;
  isBBInsideKC: boolean;
  bbWidth: number;
  kcWidth: number;
  compressionRatio: number; // BB_width / KC_width (< 1.0 means squeeze active)
  squeezeScore: number;     // 0 - 100 composite compression intensity
  squeezePhase: 'IN_SQUEEZE' | 'FIRING_BULL' | 'FIRING_BEAR' | 'NO_SQUEEZE';
  momentumDelta: number;    // Momentum of close vs middle band
}

export type ICFQuadrant = 
  | 'LONG_BUILDUP'     // Price UP, OI UP
  | 'SHORT_BUILDUP'    // Price DOWN, OI UP
  | 'SHORT_COVERING'   // Price UP, OI DOWN
  | 'LONG_UNWINDING';  // Price DOWN, OI DOWN

export interface ICFResult {
  quadrant: ICFQuadrant;
  direction: 'BULL' | 'BEAR';
  commitmentScore: number;   // 0 - 100
  convictionGrade: 'A' | 'B' | 'C' | 'TRAP';
  priceChangePct: number;
  oiChangePct: number;
  volumeMultiplier: number;
  institutionalBias: string;
}

export interface TimeOfDayRVOLResult {
  currentVolume: number;
  avgDailyVolume: number;
  expectedVolume: number;
  expectedFraction: number;
  rvol: number;
  volumeSurgeFactor: number;
  phase: string;
}

export class TradeFinderCalibrationService {
  private static instance: TradeFinderCalibrationService;

  private constructor() {}

  public static getInstance(): TradeFinderCalibrationService {
    if (!TradeFinderCalibrationService.instance) {
      TradeFinderCalibrationService.instance = new TradeFinderCalibrationService();
    }
    return TradeFinderCalibrationService.instance;
  }

  /**
   * 1. Time-of-Day Expected Volume Fraction E[V(t) | tau]
   * Models the empirical Indian equity & F&O intraday U-curve across 375 trading minutes (09:15 to 15:30 IST)
   */
  public getExpectedCumulativeVolumeFraction(currentTime?: Date | string): { fraction: number; phase: string } {
    const now = currentTime ? new Date(currentTime) : new Date();
    
    // Convert to IST (UTC + 5:30)
    const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istMs = utcMs + (5.5 * 60 * 60 * 1000);
    const ist = new Date(istMs);

    const hours = ist.getHours();
    const minutes = ist.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    const openMinutes = 9 * 60 + 15;   // 09:15 IST
    const closeMinutes = 15 * 60 + 30; // 15:30 IST

    if (totalMinutes < openMinutes) {
      return { fraction: 0.02, phase: 'PRE_MARKET' };
    }
    if (totalMinutes >= closeMinutes) {
      return { fraction: 1.0, phase: 'POST_MARKET' };
    }

    const elapsed = totalMinutes - openMinutes; // 0 to 375 minutes

    // Spline knot points representing cumulative volume distribution in Indian markets
    // [elapsedMinutes, cumulativeFraction, phaseName]
    const knots: [number, number, string][] = [
      [0,   0.00, 'OPEN_DISCOVERY'],
      [15,  0.10, 'OPEN_SURGE'],      // 09:30
      [45,  0.22, 'MORNING_RUSH'],    // 10:00
      [75,  0.34, 'GOLDEN_EXPANSION'],// 10:30
      [135, 0.48, 'MIDDAY_STABILITY'],// 11:30
      [255, 0.65, 'LUNCH_LULL'],      // 13:30
      [315, 0.80, 'EURO_OPEN_FLOW'],  // 14:30
      [360, 0.94, 'THETA_SQUAREOFF'], // 15:15
      [375, 1.00, 'CLOSING_AUCTION']  // 15:30
    ];

    // Linear piecewise interpolation between knots
    for (let i = 0; i < knots.length - 1; i++) {
      const [t0, f0] = knots[i];
      const [t1, f1, nextPhase] = knots[i + 1];

      if (elapsed >= t0 && elapsed <= t1) {
        const progress = (elapsed - t0) / (t1 - t0);
        const interpolated = f0 + progress * (f1 - f0);
        return {
          fraction: parseFloat(interpolated.toFixed(4)),
          phase: nextPhase
        };
      }
    }

    return { fraction: 1.0, phase: 'POST_MARKET' };
  }

  /**
   * Expected volume for a stock at the current time of day based on 20-day ADV
   */
  public expectedTimeOfDayVolume(avgDailyVolume: number, currentTime?: Date | string): number {
    const { fraction } = this.getExpectedCumulativeVolumeFraction(currentTime);
    return Math.max(1, Math.round(avgDailyVolume * fraction));
  }

  /**
   * Computes true intraday RVOL normalized for the Indian market U-shaped volume curve
   */
  public computeTimeOfDayRVOL(
    currentCumulativeVolume: number,
    avgDailyVolume: number,
    currentTime?: Date | string
  ): TimeOfDayRVOLResult {
    const { fraction, phase } = this.getExpectedCumulativeVolumeFraction(currentTime);
    const expectedVolume = Math.max(1, Math.round(avgDailyVolume * fraction));
    const rvol = expectedVolume > 0 ? parseFloat((currentCumulativeVolume / expectedVolume).toFixed(2)) : 1.0;
    const volumeSurgeFactor = parseFloat(Math.min(10.0, Math.max(0.1, rvol)).toFixed(2));

    return {
      currentVolume: currentCumulativeVolume,
      avgDailyVolume,
      expectedVolume,
      expectedFraction: fraction,
      rvol,
      volumeSurgeFactor,
      phase
    };
  }

  /**
   * 2. ATR-Standardized High/Low Diff%
   * Standardizes price proximity against 14-period ATR so high-beta and large-cap stocks are comparable
   */
  public computeStandardizedDiffPct(
    ltp: number,
    high: number,
    low: number,
    atr14?: number
  ): StandardizedDiffResult {
    const safeLtp = Math.max(0.05, ltp);
    const safeHigh = Math.max(safeLtp, high);
    const safeLow = Math.min(safeLtp, low > 0 ? low : safeLtp);
    
    // Default ATR to 1.5% of price if ATR not supplied or invalid
    const effectiveAtr = (atr14 && atr14 > 0) ? atr14 : safeLtp * 0.015;

    // Traditional Diff%
    const diffHighPct = safeHigh > 0 ? ((safeHigh - safeLtp) / safeHigh) * 100 : 0;
    const diffLowPct = safeLow > 0 ? ((safeLtp - safeLow) / safeLow) * 100 : 0;

    // ATR-Standardized Diff (units of 14-ATR)
    const diffHighATR = parseFloat(((safeHigh - safeLtp) / effectiveAtr).toFixed(3));
    const diffLowATR = parseFloat(((safeLtp - safeLow) / effectiveAtr).toFixed(3));

    // Determine proximity score (0 to 100)
    // 0.0 ATR distance = 100 score, 1.0 ATR distance = 50 score, >= 2.0 ATR = 0 score
    const minDistanceATR = Math.min(diffHighATR, diffLowATR);
    const proximityScore = parseFloat(Math.max(0, Math.min(100, (1 - minDistanceATR / 2.0) * 100)).toFixed(1));

    let extremeSide: 'HIGH' | 'LOW' | 'EQUILIBRIUM' = 'EQUILIBRIUM';
    if (diffHighATR <= 0.25) {
      extremeSide = 'HIGH';
    } else if (diffLowATR <= 0.25) {
      extremeSide = 'LOW';
    }

    return {
      ltp: safeLtp,
      dayHigh: safeHigh,
      dayLow: safeLow,
      diffHighPct: parseFloat(diffHighPct.toFixed(2)),
      diffLowPct: parseFloat(diffLowPct.toFixed(2)),
      diffHighATR,
      diffLowATR,
      proximityScore,
      extremeSide
    };
  }

  /**
   * 3. SqueezeFactor NR7 Reinforced with Carter TTM Bollinger Bands inside Keltner Channel
   */
  public evaluateSqueezeFactor(
    candles: { high: number; low: number; close: number; open?: number; volume?: number }[]
  ): SqueezeFactorResult {
    if (!candles || candles.length < 7) {
      return {
        isNR7: false,
        isBBInsideKC: false,
        bbWidth: 0,
        kcWidth: 0,
        compressionRatio: 1.0,
        squeezeScore: 0,
        squeezePhase: 'NO_SQUEEZE',
        momentumDelta: 0
      };
    }

    // Step A: NR7 Calculation
    const subset7 = candles.slice(-7);
    const ranges = subset7.map(c => Math.max(0.01, c.high - c.low));
    const todayRange = ranges[ranges.length - 1];
    const prior6Ranges = ranges.slice(0, 6);
    const minPriorRange = Math.min(...prior6Ranges);
    const isNR7 = todayRange < minPriorRange;

    // Step B: Carter TTM Squeeze (BB inside KC) over 20 periods
    const period = Math.min(20, candles.length);
    const subset20 = candles.slice(-period);
    const closes = subset20.map(c => c.close);

    // SMA20
    const sma20 = closes.reduce((sum, c) => sum + c, 0) / closes.length;

    // Standard deviation
    const variance = closes.reduce((sum, c) => sum + Math.pow(c - sma20, 2), 0) / closes.length;
    const stdDev = Math.sqrt(variance);

    // Bollinger Bands (2.0 std dev)
    const bbUpper = sma20 + 2.0 * stdDev;
    const bbLower = sma20 - 2.0 * stdDev;
    const bbWidth = Math.max(0.01, bbUpper - bbLower);

    // True Range & ATR calculation
    let trSum = 0;
    for (let i = 1; i < subset20.length; i++) {
      const prevClose = subset20[i - 1].close;
      const c = subset20[i];
      const tr = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
      trSum += tr;
    }
    const atr = (subset20.length > 1) ? trSum / (subset20.length - 1) : (subset20[0].high - subset20[0].low);

    // 20 EMA for Keltner Channel
    const k = 2 / (period + 1);
    let ema20 = closes[0];
    for (let i = 1; i < closes.length; i++) {
      ema20 = closes[i] * k + ema20 * (1 - k);
    }

    // Keltner Channels (1.5 ATR multiplier)
    const kcUpper = ema20 + 1.5 * atr;
    const kcLower = ema20 - 1.5 * atr;
    const kcWidth = Math.max(0.01, kcUpper - kcLower);

    // Squeeze condition: BB completely enveloped inside KC
    const isBBInsideKC = (bbUpper <= kcUpper) && (bbLower >= kcLower);
    const compressionRatio = parseFloat((bbWidth / kcWidth).toFixed(3));

    // Momentum Delta (relative to midpoint)
    const lastClose = closes[closes.length - 1];
    const momentumDelta = parseFloat((((lastClose - sma20) / sma20) * 100).toFixed(2));

    // Composite Squeeze Score (0 - 100)
    let score = 0;
    if (compressionRatio < 1.0) {
      // In Squeeze: higher score the tighter the squeeze (e.g. ratio 0.6 => score 80)
      score = Math.min(80, Math.round((1.0 - compressionRatio) * 150) + 30);
    }
    if (isNR7) {
      score += 20; // +20 points bonus for NR7 confirmation
    }
    score = Math.min(100, Math.max(0, score));

    // Determine Phase
    let squeezePhase: 'IN_SQUEEZE' | 'FIRING_BULL' | 'FIRING_BEAR' | 'NO_SQUEEZE' = 'NO_SQUEEZE';
    if (compressionRatio < 1.0 || isBBInsideKC) {
      squeezePhase = 'IN_SQUEEZE';
    } else if (compressionRatio >= 1.0 && compressionRatio < 1.15) {
      // Just exiting squeeze
      squeezePhase = momentumDelta >= 0 ? 'FIRING_BULL' : 'FIRING_BEAR';
    }

    return {
      isNR7,
      isBBInsideKC,
      bbWidth: parseFloat(bbWidth.toFixed(2)),
      kcWidth: parseFloat(kcWidth.toFixed(2)),
      compressionRatio,
      squeezeScore: score,
      squeezePhase,
      momentumDelta
    };
  }

  /**
   * 4. Institutional Commitment Flow (ICF) 4-Quadrant Derivative Model
   * Cross-references Price Action with Open Interest shifts and volume acceleration
   */
  public evaluateICF(
    priceChangePct: number,
    oiChangePct: number,
    volume: number,
    avgVolume: number = 1
  ): ICFResult {
    const volMultiplier = avgVolume > 0 ? Math.min(3.0, Math.max(0.3, volume / avgVolume)) : 1.0;

    let quadrant: ICFQuadrant;
    let direction: 'BULL' | 'BEAR';
    let bias: string;

    if (priceChangePct >= 0 && oiChangePct >= 0) {
      quadrant = 'LONG_BUILDUP';
      direction = 'BULL';
      bias = 'Institutional Long Accumulation - Smart Money entering fresh longs';
    } else if (priceChangePct < 0 && oiChangePct >= 0) {
      quadrant = 'SHORT_BUILDUP';
      direction = 'BEAR';
      bias = 'Institutional Short Aggression - Heavy put/future selling pressure';
    } else if (priceChangePct >= 0 && oiChangePct < 0) {
      quadrant = 'SHORT_COVERING';
      direction = 'BULL';
      bias = 'Bear Squeeze Covering - Shorts capitulating; watch for exhaustion';
    } else {
      quadrant = 'LONG_UNWINDING';
      direction = 'BEAR';
      bias = 'Long Liquidation - Bulls abandoning positions; structural drift';
    }

    // Magnitude calculation: geometric mean of price change and OI change
    const geometricMagnitude = Math.sqrt(Math.abs(priceChangePct) * Math.abs(oiChangePct));
    const rawScore = geometricMagnitude * 12 * volMultiplier;
    const commitmentScore = parseFloat(Math.min(100, Math.max(10, rawScore)).toFixed(1));

    // Conviction Grade
    let convictionGrade: 'A' | 'B' | 'C' | 'TRAP' = 'C';
    if (Math.abs(oiChangePct) >= 5.0 && Math.abs(priceChangePct) >= 1.0 && volMultiplier >= 1.2) {
      convictionGrade = 'A';
    } else if (Math.abs(oiChangePct) >= 2.5 && Math.abs(priceChangePct) >= 0.5) {
      convictionGrade = 'B';
    } else if (Math.abs(priceChangePct) >= 1.5 && Math.abs(oiChangePct) < 0.5 && volMultiplier < 0.8) {
      convictionGrade = 'TRAP'; // Price surge without OI or volume support
    }

    return {
      quadrant,
      direction,
      commitmentScore,
      convictionGrade,
      priceChangePct: parseFloat(priceChangePct.toFixed(2)),
      oiChangePct: parseFloat(oiChangePct.toFixed(2)),
      volumeMultiplier: parseFloat(volMultiplier.toFixed(2)),
      institutionalBias: bias
    };
  }
}

export const tradeFinderCalibrationService = TradeFinderCalibrationService.getInstance();
