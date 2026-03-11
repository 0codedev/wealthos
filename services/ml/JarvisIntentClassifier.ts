/**
 * JarvisIntentClassifier.ts
 * Sub-15ms local intent classifier powered by NaiveBayes.
 * Classifies trading voice/text prompts into actionable UI intents without LLM latency.
 */

import { NaiveBayes, type ClassificationResult } from './core/NaiveBayes';
import { ModelRegistry } from './ModelRegistry';

export type JarvisIntentType =
  | 'OPEN_CHART'
  | 'PLACE_ORDER'
  | 'CANCEL_ORDER'
  | 'SHOW_PORTFOLIO'
  | 'SHOW_MISTAKES'
  | 'RUN_BACKTEST'
  | 'EXPLAIN_REGIME'
  | 'UNKNOWN';

const SEED_DATA: { tokens: string[]; label: JarvisIntentType }[] = [
  { tokens: ['chart', 'show', 'nifty', 'timeframe', 'view', 'graph'], label: 'OPEN_CHART' },
  { tokens: ['buy', 'order', 'place', 'shares', 'call', 'entry'], label: 'PLACE_ORDER' },
  { tokens: ['sell', 'exit', 'close', 'cancel', 'abort', 'position'], label: 'CANCEL_ORDER' },
  { tokens: ['portfolio', 'pnl', 'holdings', 'balance', 'wealth', 'account'], label: 'SHOW_PORTFOLIO' },
  { tokens: ['mistake', 'fomo', 'journal', 'lessons', 'review', 'errors'], label: 'SHOW_MISTAKES' },
  { tokens: ['backtest', 'run', 'strategy', 'simulation', 'sharpe', 'test'], label: 'RUN_BACKTEST' },
  { tokens: ['regime', 'vix', 'market', 'macro', 'nifty', 'trend'], label: 'EXPLAIN_REGIME' },
];

export class JarvisIntentClassifier {
  private static instance: JarvisIntentClassifier;
  private nb: NaiveBayes;
  private isTrained = false;

  private constructor() {
    this.nb = new NaiveBayes();
  }

  public static getInstance(): JarvisIntentClassifier {
    if (!JarvisIntentClassifier.instance) {
      JarvisIntentClassifier.instance = new JarvisIntentClassifier();
    }
    return JarvisIntentClassifier.instance;
  }

  public async init(): Promise<void> {
    try {
      const stored = await ModelRegistry.loadLatest('jarvis-intent');
      if (stored && stored.weights) {
        this.nb.importState(stored.weights);
        this.isTrained = true;
        return;
      }
    } catch {
      /* swallow */
    }

    // Default bootstrap training from seeds
    this.trainSeeds();
  }

  private trainSeeds(): void {
    const docs = SEED_DATA.map(s => s.tokens);
    const labels = SEED_DATA.map(s => s.label);
    this.nb.train(docs, labels);
    this.isTrained = true;
  }

  public tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1);
  }

  /**
   * Classify raw user text prompt into JarvisIntentType in <15ms.
   */
  public classify(text: string): { intent: JarvisIntentType; confidence: number } {
    if (!this.isTrained) this.trainSeeds();

    const tokens = this.tokenize(text);
    if (tokens.length === 0) {
      return { intent: 'UNKNOWN', confidence: 0 };
    }

    const res: ClassificationResult = this.nb.classify(tokens);
    return {
      intent: res.label as JarvisIntentType,
      confidence: parseFloat(res.confidence.toFixed(2)),
    };
  }

  /**
   * Online feedback training when user confirms or corrects an intent.
   */
  public async addTrainingExample(text: string, correctIntent: JarvisIntentType): Promise<void> {
    const tokens = this.tokenize(text);
    SEED_DATA.push({ tokens, label: correctIntent });
    this.trainSeeds();
    await ModelRegistry.register('jarvis-intent', this.nb.exportState());
  }
}

export const jarvisIntentClassifier = JarvisIntentClassifier.getInstance();
