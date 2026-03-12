/**
 * PoolCandleGate.ts
 * Fast ML gate classifier to eliminate 65-80% of redundant LLM calls on quiet 5-min candles.
 * Uses a 10-feature GradientBooster model trained on historical verdict alert outcomes.
 */

import { trainBooster, predictBooster, type TrainedBooster } from './GradientBooster';
import { ModelRegistry } from './ModelRegistry';

export interface CandleFeatures {
  rsi: number;
  adx: number;
  priceVsVwap: number;      // % distance from VWAP
  volumeRatio: number;      // current volume vs 5-candle avg
  bidAskSpread: number;     // bps
  emaAlignment: number;     // +1 bullish stack, -1 bearish stack, 0 mixed
  sectorRs: number;         // sector relative strength
  candleBodyPct: number;    // Math.abs(close - open) / (high - low)
  upperShadowPct: number;   // (high - Math.max(open, close)) / (high - low)
  lowerShadowPct: number;   // (Math.min(open, close) - low) / (high - low)
}

export const POOL_CANDLE_FEATURE_KEYS: (keyof CandleFeatures)[] = [
  'rsi',
  'adx',
  'priceVsVwap',
  'volumeRatio',
  'bidAskSpread',
  'emaAlignment',
  'sectorRs',
  'candleBodyPct',
  'upperShadowPct',
  'lowerShadowPct',
];

export function encodeCandleFeatures(features: CandleFeatures): number[] {
  return [
    features.rsi ?? 50,
    features.adx ?? 20,
    features.priceVsVwap ?? 0,
    features.volumeRatio ?? 1.0,
    features.bidAskSpread ?? 0,
    features.emaAlignment ?? 0,
    features.sectorRs ?? 1.0,
    features.candleBodyPct ?? 0.5,
    features.upperShadowPct ?? 0.25,
    features.lowerShadowPct ?? 0.25,
  ];
}

export class PoolCandleGate {
  private static instance: PoolCandleGate;
  private booster: TrainedBooster | null = null;
  private threshold: number = 0.55;

  private constructor() {}

  public static getInstance(): PoolCandleGate {
    if (!PoolCandleGate.instance) {
      PoolCandleGate.instance = new PoolCandleGate();
    }
    return PoolCandleGate.instance;
  }

  /**
   * Load gate model from ModelRegistry.
   */
  public async init(): Promise<void> {
    try {
      const stored = await ModelRegistry.loadLatest('pool-candle-gate');
      if (stored && stored.weights) {
        this.booster = stored.weights as TrainedBooster;
        if (stored.metadata?.threshold) {
          this.threshold = stored.metadata.threshold;
        }
      }
    } catch (e) {
      console.warn('[PoolCandleGate] Failed to load model from registry, using heuristic fallback.', e);
    }
  }

  /**
   * Score a 5-min candle feature vector. Returns 0.0 (quiet/boring) to 1.0 (high interest).
   */
  public score(features: CandleFeatures): number {
    const rawVector = encodeCandleFeatures(features);

    if (this.booster) {
      const rawPrediction = predictBooster(this.booster, rawVector);
      // Sigmoidal squeeze to 0..1 range
      return 1.0 / (1.0 + Math.exp(-rawPrediction));
    }

    // Heuristic fallback when ML booster is not yet trained
    return this.heuristicScore(features);
  }

  /**
   * Rule-based fallback estimator before first ML retrain.
   */
  private heuristicScore(f: CandleFeatures): number {
    let score = 0.3; // baseline quiet candle

    if (f.volumeRatio > 2.0) score += 0.25;
    if (f.adx > 25) score += 0.15;
    if (Math.abs(f.priceVsVwap) > 0.005) score += 0.15; // >0.5% away from VWAP
    if (f.candleBodyPct > 0.7) score += 0.15;

    return Math.min(1.0, Math.max(0.0, score));
  }

  /**
   * Decide whether to trigger the expensive LLM analysis.
   */
  public shouldCallLLM(features: CandleFeatures, customThreshold?: number): boolean {
    const cutoff = customThreshold ?? this.threshold;
    const candleScore = this.score(features);
    return candleScore >= cutoff;
  }

  /**
   * Train the gate model using historical candle feature rows and target binary alerts.
   */
  public async train(
    dataset: { features: CandleFeatures; didAlert: number }[]
  ): Promise<boolean> {
    if (!dataset || dataset.length < 30) {
      return false;
    }

    const X = dataset.map(d => encodeCandleFeatures(d.features));
    const y = dataset.map(d => d.didAlert);

    // Split 80/20 train/val
    const splitIdx = Math.floor(X.length * 0.8);
    const trainX = X.slice(0, splitIdx);
    const trainY = y.slice(0, splitIdx);
    const valX = X.slice(splitIdx);
    const valY = y.slice(splitIdx);

    const booster = trainBooster({
      X: trainX,
      y: trainY,
      valX,
      valY,
      config: { numRounds: 50, learningRate: 0.05, maxDepth: 3 },
    });

    if (!booster) return false;

    this.booster = booster;
    await ModelRegistry.register('pool-candle-gate', booster, {
      trainRows: dataset.length,
      threshold: this.threshold,
      valLoss: booster.valLoss,
    });

    return true;
  }
}

export const poolCandleGate = PoolCandleGate.getInstance();
