/**
 * WatchlistRankModel.ts
 * Ranks watchlist symbols by probability of crossing into buy zone in next 30 minutes.
 * Powered by GradientBooster with 7 technical distance features.
 */

import { trainBooster, predictBooster, type TrainedBooster } from './GradientBooster';
import { ModelRegistry } from './ModelRegistry';

export interface WatchlistSymbolFeatures {
  symbol: string;
  distToSupportPct: number;   // % distance to nearest support
  distToVwapPct: number;      // % distance to VWAP
  rsi14: number;
  adx14: number;
  volumeRatio: number;
  near200SmaPct: number;
  relativeStrength: number;
}

export function encodeWatchlistFeatures(f: WatchlistSymbolFeatures): number[] {
  return [
    f.distToSupportPct ?? 0,
    f.distToVwapPct ?? 0,
    f.rsi14 ?? 50,
    f.adx14 ?? 20,
    f.volumeRatio ?? 1.0,
    f.near200SmaPct ?? 0,
    f.relativeStrength ?? 1.0,
  ];
}

export interface RankedWatchlistItem extends WatchlistSymbolFeatures {
  crossingProb: number; // 0.0 to 1.0
  rank: number;
}

export class WatchlistRankModel {
  private static instance: WatchlistRankModel;
  private booster: TrainedBooster | null = null;

  private constructor() {}

  public static getInstance(): WatchlistRankModel {
    if (!WatchlistRankModel.instance) {
      WatchlistRankModel.instance = new WatchlistRankModel();
    }
    return WatchlistRankModel.instance;
  }

  public async init(): Promise<void> {
    try {
      const stored = await ModelRegistry.loadLatest('watchlist-rank');
      if (stored && stored.weights) {
        this.booster = stored.weights as TrainedBooster;
      }
    } catch {
      /* swallow */
    }
  }

  /**
   * Predict probability of crossing buy zone for a single symbol.
   */
  public predictProb(f: WatchlistSymbolFeatures): number {
    const vec = encodeWatchlistFeatures(f);

    if (this.booster) {
      const raw = predictBooster(this.booster, vec);
      return 1.0 / (1.0 + Math.exp(-raw));
    }

    // Heuristic fallback
    let score = 0.2;
    if (f.distToSupportPct < 0.01) score += 0.35;
    if (f.volumeRatio > 1.8) score += 0.25;
    if (f.rsi14 > 45 && f.rsi14 < 65) score += 0.2;

    return Math.min(1.0, Math.max(0.0, score));
  }

  /**
   * Rank a list of watchlist symbols descending by crossing probability.
   */
  public rank(items: WatchlistSymbolFeatures[]): RankedWatchlistItem[] {
    const scored = items.map(item => ({
      ...item,
      crossingProb: parseFloat(this.predictProb(item).toFixed(2)),
      rank: 0,
    }));

    scored.sort((a, b) => b.crossingProb - a.crossingProb);
    scored.forEach((item, idx) => {
      item.rank = idx + 1;
    });

    return scored;
  }

  /**
   * Train model on historical snapshots.
   */
  public async train(dataset: { features: WatchlistSymbolFeatures; crossed: number }[]): Promise<boolean> {
    if (!dataset || dataset.length < 20) return false;

    const X = dataset.map(d => encodeWatchlistFeatures(d.features));
    const y = dataset.map(d => d.crossed);

    const booster = trainBooster({
      X,
      y,
      config: { numRounds: 40, learningRate: 0.05, maxDepth: 3 },
    });

    if (!booster) return false;

    this.booster = booster;
    await ModelRegistry.register('watchlist-rank', booster);
    return true;
  }
}

export const watchlistRankModel = WatchlistRankModel.getInstance();
