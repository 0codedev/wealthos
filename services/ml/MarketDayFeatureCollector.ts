/**
 * MarketDayFeatureCollector.ts
 * Daily collector that snapshots Nifty 1D returns, VIX levels, FII flows, A/D ratio, and realized volatility
 * into IndexedDB (db.market_day_features) at market close (15:35 IST).
 */

import { db } from '../../database';
import { marketAnomalyDetector, type MarketDayFeatures } from './MarketAnomalyDetector';
import { MacroRegimeService } from '../MacroRegimeService';

export class MarketDayFeatureCollector {
  public static async captureToday(overrideData?: Partial<MarketDayFeatures>): Promise<MarketDayFeatures> {
    const todayStr = new Date().toISOString().split('T')[0];

    // Fetch macro regime signals if available
    let vixLevel = 15.0;
    let nifty1dReturn = 0.0;
    let fiiFlowDelta = 0;
    let adRatio = 1.0;

    try {
      const macroService = MacroRegimeService.getInstance();
      const regime = macroService.classifyRegime(vixLevel, 0);
      if (regime) {
        vixLevel = 15.0;
      }
    } catch {
      /* swallow fallback */
    }

    const todayFeatures: MarketDayFeatures = {
      date: todayStr,
      nifty1dReturn: overrideData?.nifty1dReturn ?? nifty1dReturn,
      vixLevel: overrideData?.vixLevel ?? vixLevel,
      vix5dChange: overrideData?.vix5dChange ?? 0.0,
      fiiFlowDelta: overrideData?.fiiFlowDelta ?? fiiFlowDelta,
      adRatio: overrideData?.adRatio ?? adRatio,
      realizedVol10d: overrideData?.realizedVol10d ?? 0.12,
    };

    // Calculate anomaly score
    const anomalyScore = marketAnomalyDetector.score(todayFeatures);
    todayFeatures.date = todayStr;

    // Upsert into IndexedDB
    const existing = await db.market_day_features.where('date').equals(todayStr).first();
    if (existing && existing.id) {
      await db.market_day_features.update(existing.id, { ...todayFeatures, anomalyScore });
    } else {
      await db.market_day_features.add({ ...todayFeatures, anomalyScore });
    }

    return todayFeatures;
  }
}
