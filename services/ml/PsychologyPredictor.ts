/**
 * PsychologyPredictor.ts
 * Real-time psychological fatigue and revenge trading risk predictor.
 * Uses OnlineLogisticRegression over 9 behavioral features to output 0..1 revenge trade risk.
 */

import { OnlineLogisticRegression } from './core/OnlineLogisticRegression';
import { ModelRegistry } from './ModelRegistry';

export interface PsychologyFeatures {
  recentLossStreak: number;         // count of consecutive losses
  fomoLevel: number;                // 1-10 self-reported or computed
  stressLevel: number;              // 1-10
  tiltScore: number;                // 0-100
  timeSinceLastTradeMin: number;    // minutes since exit
  sessionPnlPct: number;            // session return %
  winRate7d: number;                // 7-day win rate (0..1)
  sleepHours: number;               // sleep hours last night
  forcedTrade: number;              // 1 if trade felt forced, 0 otherwise
}

export function encodePsychologyFeatures(f: PsychologyFeatures): number[] {
  return [
    f.recentLossStreak ?? 0,
    f.fomoLevel ?? 5,
    f.stressLevel ?? 5,
    f.tiltScore ?? 0,
    f.timeSinceLastTradeMin ?? 60,
    f.sessionPnlPct ?? 0,
    f.winRate7d ?? 0.5,
    f.sleepHours ?? 7,
    f.forcedTrade ?? 0,
  ];
}

export interface PsychologyPrediction {
  revengeRisk: number; // 0.0 to 1.0
  recommendation: 'CLEAR' | 'CAUTION' | 'STOP_TRADING';
  reasons: string[];
}

export class PsychologyPredictor {
  private static instance: PsychologyPredictor;
  private model: OnlineLogisticRegression;

  private constructor() {
    this.model = new OnlineLogisticRegression({ numFeatures: 9, C: 1.0 });
  }

  public static getInstance(): PsychologyPredictor {
    if (!PsychologyPredictor.instance) {
      PsychologyPredictor.instance = new PsychologyPredictor();
    }
    return PsychologyPredictor.instance;
  }

  public async init(): Promise<void> {
    try {
      const stored = await ModelRegistry.loadLatest('psychology-predictor');
      if (stored && stored.weights) {
        this.model.setWeights(stored.weights.weights, stored.weights.bias);
      }
    } catch {
      /* swallow */
    }
  }

  private latestPrediction: PsychologyPrediction = { revengeRisk: 0.1, recommendation: 'CLEAR', reasons: [] };

  public getLatestPrediction(): PsychologyPrediction {
    return this.latestPrediction;
  }

  /**
   * Predict revenge trading risk (0.0 to 1.0) and action recommendation.
   */
  public predict(f: PsychologyFeatures): PsychologyPrediction {
    const rawVector = encodePsychologyFeatures(f);
    const risk = this.model.predict(rawVector);
    const reasons: string[] = [];

    if (f.recentLossStreak >= 3) {
      reasons.push(`${f.recentLossStreak} consecutive losses increase tilt likelihood`);
    }
    if (f.fomoLevel >= 7) {
      reasons.push(`High FOMO level (${f.fomoLevel}/10) detected`);
    }
    if (f.tiltScore > 60) {
      reasons.push(`Elevated tilt score (${f.tiltScore}/100)`);
    }
    if (f.sleepHours < 5) {
      reasons.push(`Sleep deprivation (${f.sleepHours}h) impairs execution discipline`);
    }

    let recommendation: 'CLEAR' | 'CAUTION' | 'STOP_TRADING' = 'CLEAR';
    if (risk >= 0.70 || f.recentLossStreak >= 4) {
      recommendation = 'STOP_TRADING';
    } else if (risk >= 0.58 || f.recentLossStreak >= 2) {
      recommendation = 'CAUTION';
    }

    const result: PsychologyPrediction = {
      revengeRisk: parseFloat(risk.toFixed(2)),
      recommendation,
      reasons,
    };
    this.latestPrediction = result;
    return result;
  }

  /**
   * Update online model weights after a trade finishes (+1 if revenge/tilted trade, -1 if disciplined).
   */
  public async update(f: PsychologyFeatures, outcome: 1 | -1): Promise<void> {
    const rawVector = encodePsychologyFeatures(f);
    this.model.update(rawVector, outcome);
    await ModelRegistry.register('psychology-predictor', this.model.getWeights());
  }
}

export const psychologyPredictor = PsychologyPredictor.getInstance();
