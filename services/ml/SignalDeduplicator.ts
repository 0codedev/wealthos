/**
 * SignalDeduplicator.ts
 * Signal deduplication using Cosine Similarity on entry price, target levels, and time proximity.
 * Clusters duplicate signals from multiple Telegram channels to prevent double-counting in trust scores.
 */

import type { ParsedSignal } from '../../database';

export interface DeduplicatedCluster {
  clusterId: string;
  signals: ParsedSignal[];
  primarySignal: ParsedSignal;
  sourceCount: number;
}

export class SignalDeduplicator {
  /**
   * Compute cosine similarity between two parsed trading signals (0.0 to 1.0).
   */
  public static computeSimilarity(a: ParsedSignal, b: ParsedSignal): number {
    const instA = (a.instrument || '').toUpperCase();
    const instB = (b.instrument || '').toUpperCase();
    if (instA !== instB) return 0.0;

    if (a.action !== b.action) return 0.0;

    const priceA = a.entryPrice || 1.0;
    const priceB = b.entryPrice || 1.0;
    const priceDiffPct = Math.abs(priceA - priceB) / priceA;
    if (priceDiffPct > 0.02) return 0.0; // >2% price difference = not duplicate

    const targetA = a.target1 || priceA * 1.05;
    const targetB = b.target1 || priceB * 1.05;

    // Vector [entryPrice, target1]
    const vecA = [priceA, targetA];
    const vecB = [priceB, targetB];

    const dot = vecA[0] * vecB[0] + vecA[1] * vecB[1];
    const normA = Math.sqrt(vecA[0] * vecA[0] + vecA[1] * vecA[1]);
    const normB = Math.sqrt(vecB[0] * vecB[0] + vecB[1] * vecB[1]);

    if (normA === 0 || normB === 0) return 0.0;
    return dot / (normA * normB);
  }

  /**
   * Deduplicate a set of signals into clusters if within 4 hours of each other.
   */
  public static deduplicate(signals: ParsedSignal[], timeWindowMs = 4 * 60 * 60 * 1000): DeduplicatedCluster[] {
    if (!signals || signals.length === 0) return [];

    const clusters: DeduplicatedCluster[] = [];
    const assigned = new Set<string>();

    for (let i = 0; i < signals.length; i++) {
      const sigA = signals[i];
      const timeA = new Date(sigA.timestamp || Date.now()).getTime();
      const sigKeyA = `${sigA.instrument}_${timeA}_${i}`;
      if (assigned.has(sigKeyA)) continue;

      const currentCluster: ParsedSignal[] = [sigA];
      assigned.add(sigKeyA);

      for (let j = i + 1; j < signals.length; j++) {
        const sigB = signals[j];
        const timeB = new Date(sigB.timestamp || Date.now()).getTime();
        const sigKeyB = `${sigB.instrument}_${timeB}_${j}`;
        if (assigned.has(sigKeyB)) continue;

        const timeDiff = Math.abs(timeA - timeB);
        if (timeDiff <= timeWindowMs) {
          const sim = this.computeSimilarity(sigA, sigB);
          if (sim >= 0.85) {
            currentCluster.push(sigB);
            assigned.add(sigKeyB);
          }
        }
      }

      const clusterId = `cluster_${sigA.instrument}_${timeA}`;
      clusters.push({
        clusterId,
        signals: currentCluster,
        primarySignal: sigA,
        sourceCount: currentCluster.length,
      });
    }

    return clusters;
  }
}
