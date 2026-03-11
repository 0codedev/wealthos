/**
 * MistakeClusterer.ts
 * Unsupervised clustering of trade journal mistake logs (FOMO, Early Exit, Overleveraged, etc.)
 * using TF-IDF tokenization and KMeans to discover which mistake patterns cause the highest PnL drain.
 */

import { KMeans } from './core/KMeans';
import type { Trade } from '../../database';

export interface MistakeClusterInsight {
  clusterId: number;
  label: string;
  count: number;
  avgPnl: number;
  topTokens: string[];
}

export class MistakeClusterer {
  private kmeans: KMeans;
  private vocabulary: string[] = [];
  private k: number;

  constructor(k = 5) {
    this.k = k;
    this.kmeans = new KMeans(k);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  /**
   * Fit mistake clusters on trades containing mistake notes/tags.
   */
  public fit(trades: Trade[]): MistakeClusterInsight[] {
    const validTrades = trades.filter(t => t.mistakes && t.mistakes.length > 0);
    if (validTrades.length === 0) return [];

    // Build vocabulary
    const vocabSet = new Set<string>();
    const docTokensList = validTrades.map(t => {
      const combinedText = t.mistakes.join(' ') + ' ' + (t.notes || '');
      const tokens = this.tokenize(combinedText);
      tokens.forEach(tok => vocabSet.add(tok));
      return tokens;
    });

    this.vocabulary = Array.from(vocabSet);
    if (this.vocabulary.length === 0) return [];

    // Build TF-IDF vectors
    const numDocs = docTokensList.length;
    const tfidfMatrix: number[][] = docTokensList.map(doc => {
      const vec = new Array(this.vocabulary.length).fill(0);
      const termCounts = new Map<string, number>();
      doc.forEach(tok => termCounts.set(tok, (termCounts.get(tok) ?? 0) + 1));

      this.vocabulary.forEach((term, i) => {
        const count = termCounts.get(term) ?? 0;
        if (count > 0) {
          const tf = count / doc.length;
          const docsWithTerm = docTokensList.filter(d => d.includes(term)).length;
          const idf = Math.log((numDocs + 1) / (docsWithTerm + 1)) + 1;
          vec[i] = tf * idf;
        }
      });
      return vec;
    });

    this.kmeans.fit(tfidfMatrix, Math.min(this.k, numDocs));

    // Aggregate stats per cluster
    const clusterMap = new Map<number, { count: number; totalPnl: number; tokens: Map<string, number> }>();
    const centroids = this.kmeans.getCentroids();

    for (let i = 0; i < validTrades.length; i++) {
      const vec = tfidfMatrix[i];
      const clusterIdx = this.kmeans.predict(vec);
      const pnl = validTrades[i].pnl ?? 0;

      if (!clusterMap.has(clusterIdx)) {
        clusterMap.set(clusterIdx, { count: 0, totalPnl: 0, tokens: new Map() });
      }

      const entry = clusterMap.get(clusterIdx)!;
      entry.count++;
      entry.totalPnl += pnl;

      docTokensList[i].forEach(tok => {
        entry.tokens.set(tok, (entry.tokens.get(tok) ?? 0) + 1);
      });
    }

    const results: MistakeClusterInsight[] = [];
    for (const [clusterIdx, data] of clusterMap.entries()) {
      const sortedTokens = Array.from(data.tokens.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t]) => t);

      const label = sortedTokens.length > 0 ? sortedTokens.join(' & ') : `Cluster #${clusterIdx + 1}`;

      results.push({
        clusterId: clusterIdx,
        label,
        count: data.count,
        avgPnl: parseFloat((data.totalPnl / data.count).toFixed(2)),
        topTokens: sortedTokens,
      });
    }

    return results.sort((a, b) => a.avgPnl - b.avgPnl); // worst avg PnL first
  }
}
