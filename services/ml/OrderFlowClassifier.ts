/**
 * OrderFlowClassifier.ts
 * Real-time Order Flow ML classifier powered by OnlineLogisticRegression (Passive-Aggressive).
 * Operates on 100ms Level-2 tick stream to predict P(price up 10bps in 30s).
 */

import { OnlineLogisticRegression } from './core/OnlineLogisticRegression';
import { ModelRegistry } from './ModelRegistry';

export interface OrderFlowFeatures {
  spreadBps: number;              // Bid-ask spread in basis points
  top5BidRatio: number;           // Top 5 bid depth / total bid depth
  top5AskRatio: number;           // Top 5 ask depth / total ask depth
  spoofingScore: number;          // 0..1 order appearance/cancellation frequency
  absorptionRatio: number;        // 0..1 market order absorption of liquidity
  tradeDirectionImbalance: number;// -1 to +1 buy vs sell trade ratio
  vwmpDeviation: number;          // Volume-weighted midprice deviation %
}

export function encodeOrderFlowFeatures(f: OrderFlowFeatures): number[] {
  return [
    f.spreadBps ?? 0,
    f.top5BidRatio ?? 0.5,
    f.top5AskRatio ?? 0.5,
    f.spoofingScore ?? 0,
    f.absorptionRatio ?? 0.5,
    f.tradeDirectionImbalance ?? 0,
    f.vwmpDeviation ?? 0,
  ];
}

export class OrderFlowClassifier {
  private static instance: OrderFlowClassifier;
  private model: OnlineLogisticRegression;
  private updateCount: number = 0;

  private constructor() {
    this.model = new OnlineLogisticRegression({ numFeatures: 7, C: 1.0 });
  }

  public static getInstance(): OrderFlowClassifier {
    if (!OrderFlowClassifier.instance) {
      OrderFlowClassifier.instance = new OrderFlowClassifier();
    }
    return OrderFlowClassifier.instance;
  }

  public async init(): Promise<void> {
    try {
      const stored = await ModelRegistry.loadLatest('order-flow');
      if (stored && stored.weights) {
        this.model.setWeights(stored.weights.weights, stored.weights.bias);
      }
    } catch (e) {
      console.warn('[OrderFlowClassifier] Failed to load saved weights.', e);
    }
  }

  /**
   * Predict probability of price moving up 10bps in the next 30 seconds (0.0 to 1.0).
   */
  public predict(features: OrderFlowFeatures): number {
    const rawVector = encodeOrderFlowFeatures(features);
    return this.model.predict(rawVector);
  }

  /**
   * Online update called as tick outcomes resolve (+1 for up 10bps, -1 for down/flat).
   */
  public async update(features: OrderFlowFeatures, outcome: 1 | -1): Promise<void> {
    const rawVector = encodeOrderFlowFeatures(features);
    this.model.update(rawVector, outcome);
    this.updateCount++;

    // Auto-persist every 100 updates
    if (this.updateCount % 100 === 0) {
      const weights = this.model.getWeights();
      await ModelRegistry.register('order-flow', weights, { updatesCount: this.updateCount });
    }
  }

  public getWeights() {
    return this.model.getWeights();
  }
}

export const orderFlowClassifier = OrderFlowClassifier.getInstance();
