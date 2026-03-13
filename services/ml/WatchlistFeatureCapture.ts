/**
 * WatchlistFeatureCapture.ts
 * Captures hourly feature snapshots of watchlist symbols into IndexedDB (db.watchlist_snapshots)
 * to train the WatchlistRankModel on buy-zone crossing probabilities.
 */

import { db } from '../../database';
import { type WatchlistSymbolFeatures, encodeWatchlistFeatures } from './WatchlistRankModel';

export class WatchlistFeatureCapture {
  /**
   * Snapshot a watchlist symbol feature vector.
   */
  public static async captureSnapshot(
    symbol: string,
    features: WatchlistSymbolFeatures,
    crossedBuyZone = false
  ): Promise<void> {
    const now = Date.now();
    const vec = encodeWatchlistFeatures(features);

    await db.watchlist_snapshots.add({
      symbol,
      asOf: now,
      featuresJson: JSON.stringify(features),
      crossedBuyZone,
    });
  }

  /**
   * Fetch historical snapshot dataset for training WatchlistRankModel.
   */
  public static async getHistoricalDataset(): Promise<{ features: WatchlistSymbolFeatures; crossed: number }[]> {
    try {
      const records = await db.watchlist_snapshots.toArray();
      return records.map(r => ({
        features: JSON.parse(r.featuresJson),
        crossed: r.crossedBuyZone ? 1 : 0,
      }));
    } catch {
      return [];
    }
  }
}
