/**
 * MarketAnomalyDetector.ts
 * Data-driven market regime anomaly detector using IsolationForest.
 * Suppresses or raises FIRE score thresholds during extreme volatility/crash/news days.
 */

import { IsolationForest } from './core/IsolationForest';
import { ModelRegistry } from './ModelRegistry';
import { db } from '../../database';

export interface MarketDayFeatures {
  date: string;              // YYYY-MM-DD
  nifty1dReturn: number;     // e.g. -0.025 (-2.5%)
  vixLevel: number;          // e.g. 24.5
  vix5dChange: number;       // e.g. +4.2
  fiiFlowDelta: number;      // e.g. -3500 (Cr)
  adRatio: number;           // e.g. 0.35 (advance/decline ratio)
  realizedVol10d: number;    // e.g. 0.18
}

export function encodeMarketDayFeatures(f: MarketDayFeatures): number[] {
  return [
    f.nifty1dReturn ?? 0,
    f.vixLevel ?? 15.0,
    f.vix5dChange ?? 0,
    f.fiiFlowDelta ?? 0,
    f.adRatio ?? 1.0,
    f.realizedVol10d ?? 0.12,
  ];
}

export class MarketAnomalyDetector {
  private static instance: MarketAnomalyDetector;
  private forest: IsolationForest | null = null;
  private latestScore: number = 0.2; // default normal

  private constructor() {}

  public static getInstance(): MarketAnomalyDetector {
    if (!MarketAnomalyDetector.instance) {
      MarketAnomalyDetector.instance = new MarketAnomalyDetector();
    }
    return MarketAnomalyDetector.instance;
  }

  public async init(): Promise<void> {
    try {
      const stored = await ModelRegistry.loadLatest('market-anomaly-detector');
      if (stored && stored.weights) {
        this.forest = new IsolationForest({ numTrees: 50 });
        // Restore serialized forest tree data if available
        if (stored.weights.trees) {
          (this.forest as any).trees = stored.weights.trees;
          (this.forest as any).cSubsample = stored.weights.cSubsample ?? 1.0;
        }
      }
    } catch (e) {
      console.warn('[MarketAnomalyDetector] Failed to load model state from registry.', e);
    }
  }

  /**
   * Score today's market day feature vector for anomalies (0.0 to 1.0).
   * Scores > 0.65 represent anomalous market conditions.
   */
  public score(today: MarketDayFeatures): number {
    const rawVector = encodeMarketDayFeatures(today);

    if (this.forest) {
      this.latestScore = this.forest.score(rawVector);
      return this.latestScore;
    }

    // Heuristic fallback
    let score = 0.2;
    if (today.vixLevel > 22.0) score += 0.25;
    if (Math.abs(today.nifty1dReturn) > 0.02) score += 0.25;
    if (today.fiiFlowDelta < -3000) score += 0.15;
    if (today.adRatio < 0.4 || today.adRatio > 2.5) score += 0.15;

    this.latestScore = Math.min(1.0, Math.max(0.0, score));
    return this.latestScore;
  }

  public getLatestScore(): number {
    return this.latestScore;
  }

  /**
   * Train the IsolationForest on historical market days data.
   */
  public async train(history: MarketDayFeatures[]): Promise<boolean> {
    if (!history || history.length < 20) {
      return false;
    }

    const data = history.map(encodeMarketDayFeatures);

    const forest = new IsolationForest({ numTrees: 50, subsampleSize: 128 });
    forest.fit(data);
    this.forest = forest;

    // Persist scores back to db.market_day_features
    for (const item of history) {
      const vec = encodeMarketDayFeatures(item);
      const s = forest.score(vec);

      const existing = await db.market_day_features.where('date').equals(item.date).first();
      if (existing && existing.id) {
        await db.market_day_features.update(existing.id, { anomalyScore: s });
      } else {
        await db.market_day_features.add({ ...item, anomalyScore: s });
      }
    }

    await ModelRegistry.register('market-anomaly-detector', {
      trees: (forest as any).trees,
      cSubsample: (forest as any).cSubsample,
    }, {
      trainRows: history.length,
    });

    return true;
  }
}

export const marketAnomalyDetector = MarketAnomalyDetector.getInstance();
