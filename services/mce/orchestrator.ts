// services/mce/orchestrator.ts
// Singleton. 3-second dedupe. Last-known-snapshot fallback on error.
// Spec: docs/superpowers/specs/2026-06-17-mcs-momentum-continuation-score-design.md §5.1

import { MceFeatureVector, McsSnapshot, McsWeights, MceIntent, DEFAULT_WEIGHTS } from './types';
import { extractFeatures } from './featureExtractor';
import { scoreFeatures } from './confluenceScorer';
import { logger } from '../Logger';

const DEDUPE_MS = 3000;

class MceOrchestrator {
  private cache = new Map<string, McsSnapshot>();
  private fillMcs = new Map<string, number>();
  private inflight = new Map<string, Promise<McsSnapshot | null>>();
  private learnedWeights: McsWeights | null = null;

  setLearnedWeights(w: McsWeights | null) {
    this.learnedWeights = w;
  }

  recordFill(symbol: string, mcsTotal: number) {
    this.fillMcs.set(symbol, mcsTotal);
  }

  getFillMcs(symbol: string): number | null {
    return this.fillMcs.get(symbol) ?? null;
  }

  async score(symbol: string, intent: MceIntent): Promise<McsSnapshot | null> {
    const key = `${symbol}::${intent}`;
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && now - cached.asOf < DEDUPE_MS) return cached;

    const inFlight = this.inflight.get(key);
    if (inFlight) return inFlight;

    const promise = this.compute(symbol, intent, now)
      .catch(err => {
        logger.warn('[MCE] score failed', { symbol, intent, err });
        return cached ?? null;
      })
      .then(snap => {
        this.inflight.delete(key);
        return snap;
      });
    this.inflight.set(key, promise);
    return promise;
  }

  private async compute(symbol: string, intent: MceIntent, now: number): Promise<McsSnapshot | null> {
    let features: MceFeatureVector;
    let gexFeatures: import('./types').GexFeatureVector | null = null;
    try {
      features = await extractFeatures(symbol, intent, now);
    } catch (err) {
      logger.debug('[MCE] feature extraction failed', { symbol, err });
      return this.cache.get(`${symbol}::${intent}`) ?? null;
    }
    try {
      const { extractGexFeatures } = await import('./gexExtractor');
      gexFeatures = await extractGexFeatures(symbol, now);
    } catch (err) {
      logger.debug('[MCE] GEX extraction failed', { symbol, err });
    }

    const featuresWithGex = gexFeatures
      ? ({ ...features, gex: gexFeatures } as unknown as MceFeatureVector)
      : features;

    // Try learned weights (best-effort, async, with fallback to cached/DEFAULT)
    if (!this.learnedWeights) {
      try {
        const { lookupWeights } = await import('../ml/MlWeightsService');
        const { classifyRegime } = await import('../ml/RegimeClassifier');
        const regime = classifyRegime(featuresWithGex.regime);
        const lookup = await lookupWeights(symbol, regime);
        this.learnedWeights = lookup.weights;
        (this as any).lastCutoffs = { fire: lookup.fireCutoff, wait: lookup.waitCutoff };
        (this as any).lastWeightsSource = lookup.source;
      } catch (err) {
        logger.debug('[MCE] learned weights lookup failed', { symbol, err });
      }
    }

    const weights = this.learnedWeights ?? DEFAULT_WEIGHTS;
    const score = scoreFeatures(featuresWithGex, weights);

    // Apply Market Anomaly adjustment if active
    let anomalyScore = 0;
    try {
      const { marketAnomalyDetector } = await import('../ml/MarketAnomalyDetector');
      anomalyScore = marketAnomalyDetector.getLatestScore();
    } catch {
      /* swallow */
    }

    if (anomalyScore > 0.65 && score.verdict === 'FIRE') {
      // Demote FIRE to WAIT on anomalous crash/spike days unless conviction is extremely high (>80)
      if (score.total < 80) {
        score.verdict = 'WAIT';
        score.subScores.regime.reason += ` (Demoted to WAIT by Market Anomaly Guard, score ${(anomalyScore * 100).toFixed(0)}%)`;
      } else {
        score.subScores.regime.reason += ` (High conviction FIRE preserved despite Market Anomaly ${(anomalyScore * 100).toFixed(0)}%)`;
      }
    }

    const snapshot: McsSnapshot = { symbol, intent, asOf: now, features: featuresWithGex, score };
    this.cache.set(`${symbol}::${intent}`, snapshot);
    return snapshot;
  }
}

export const mceOrchestrator = new MceOrchestrator();
export type { MceOrchestrator };