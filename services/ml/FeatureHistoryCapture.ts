/**
 * FeatureHistoryCapture.ts
 * Captures 60-second snapshots of MceFeatureVectors into Dexie (db.mce_feature_history)
 * while the Alpha Engine tab is active to eliminate forward-looking bias in ML training.
 */

import { db } from '../../database';
import type { MceFeatureVector } from '../mce/types';
import { extractFeatures } from '../mce/featureExtractor';

export class FeatureHistoryCapture {
  private static instance: FeatureHistoryCapture;
  private intervalId: any = null;
  private activeSymbols: Set<string> = new Set(['NIFTY', 'BANKNIFTY', 'RELIANCE', 'SBIN', 'HDFCBANK']);

  private constructor() {}

  public static getInstance(): FeatureHistoryCapture {
    if (!FeatureHistoryCapture.instance) {
      FeatureHistoryCapture.instance = new FeatureHistoryCapture();
    }
    return FeatureHistoryCapture.instance;
  }

  public setSubscribedSymbols(symbols: string[]): void {
    this.activeSymbols = new Set(symbols);
  }

  /**
   * Start 60-second feature snapshot loop.
   */
  public start(): void {
    if (this.intervalId) return;

    // Run snapshot once immediately, then on 60s interval
    void this.captureSnapshot();
    this.intervalId = setInterval(() => {
      void this.captureSnapshot();
    }, 60000);
  }

  /**
   * Stop snapshot loop.
   */
  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Capture features for active symbols and save to db.mce_feature_history.
   */
  public async captureSnapshot(): Promise<void> {
    const now = Date.now();
    for (const symbol of this.activeSymbols) {
      try {
        const vec: MceFeatureVector = await extractFeatures(symbol, 'PRE_ENTRY', now);
        await db.mce_feature_history.add({
          symbol,
          asOf: now,
          featuresJson: JSON.stringify(vec),
        });
      } catch {
        /* ignore single symbol snapshot failures */
      }
    }

    // Prune entries older than 90 days
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
    try {
      await db.mce_feature_history.where('asOf').below(ninetyDaysAgo).delete();
    } catch {
      /* ignore prune failure */
    }
  }

  /**
   * Find closest feature snapshot at or prior to trade entry timestamp.
   */
  public static async findClosestSnapshot(symbol: string, entryTimestamp: number): Promise<MceFeatureVector | null> {
    try {
      const records = await db.mce_feature_history
        .where('[symbol+asOf]')
        .between([symbol, Dexie.minKey], [symbol, entryTimestamp])
        .reverse()
        .limit(1)
        .toArray();

      if (records.length > 0 && records[0].featuresJson) {
        return JSON.parse(records[0].featuresJson);
      }
    } catch {
      /* fallback */
    }
    return null;
  }
}

// Dexie global fallback import for minKey
import Dexie from 'dexie';

export const featureHistoryCapture = FeatureHistoryCapture.getInstance();
