/**
 * NaiveBayes.ts
 * Pure TypeScript implementation of Multinomial Naive Bayes with Laplace smoothing
 * for fast text classification and intent prediction (<1ms latency).
 */

export interface ClassificationResult {
  label: string;
  confidence: number; // Normalized probability 0..1
}

export class NaiveBayes {
  private alpha: number;
  private classCounts: Map<string, number> = new Map();
  private classWordCounts: Map<string, Map<string, number>> = new Map();
  private classTotalWords: Map<string, number> = new Map();
  private vocabulary: Set<string> = new Set();
  private totalDocs: number = 0;

  constructor(alpha = 1.0) {
    this.alpha = alpha;
  }

  /**
   * Train the Naive Bayes model on a set of tokenized documents and corresponding labels.
   */
  public train(documents: string[][], labels: string[]): void {
    if (documents.length !== labels.length) {
      throw new Error('Documents and labels length mismatch.');
    }

    this.classCounts.clear();
    this.classWordCounts.clear();
    this.classTotalWords.clear();
    this.vocabulary.clear();
    this.totalDocs = documents.length;

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const label = labels[i];

      this.classCounts.set(label, (this.classCounts.get(label) ?? 0) + 1);

      if (!this.classWordCounts.has(label)) {
        this.classWordCounts.set(label, new Map());
      }
      const wordMap = this.classWordCounts.get(label)!;

      let currentTotalWords = this.classTotalWords.get(label) ?? 0;
      for (const word of doc) {
        this.vocabulary.add(word);
        wordMap.set(word, (wordMap.get(word) ?? 0) + 1);
        currentTotalWords++;
      }
      this.classTotalWords.set(label, currentTotalWords);
    }
  }

  /**
   * Classify a tokenized document and return the predicted label and normalized confidence score.
   */
  public classify(doc: string[]): ClassificationResult {
    if (this.totalDocs === 0 || this.classCounts.size === 0) {
      return { label: 'UNKNOWN', confidence: 0 };
    }

    const vocabSize = Math.max(1, this.vocabulary.size);
    const logPosteriors: { label: string; logProb: number }[] = [];

    for (const [label, count] of this.classCounts.entries()) {
      // Prior log probability: log P(c)
      let logProb = Math.log(count / this.totalDocs);
      const wordMap = this.classWordCounts.get(label);
      const totalWordsInClass = this.classTotalWords.get(label) ?? 0;
      const denominator = totalWordsInClass + this.alpha * vocabSize;

      for (const word of doc) {
        const wordFreq = wordMap?.get(word) ?? 0;
        // Likelihood with Laplace smoothing: log P(w|c)
        logProb += Math.log((wordFreq + this.alpha) / denominator);
      }

      logPosteriors.push({ label, logProb });
    }

    // Sort descending by log probability
    logPosteriors.sort((a, b) => b.logProb - a.logProb);

    const best = logPosteriors[0];

    // Compute Softmax across log probabilities to get normalized confidence score (0..1)
    const maxLogProb = best.logProb;
    let sumExp = 0;
    for (const item of logPosteriors) {
      sumExp += Math.exp(item.logProb - maxLogProb);
    }
    const confidence = 1.0 / sumExp;

    return {
      label: best.label,
      confidence,
    };
  }

  /**
   * Export internal state for persistence.
   */
  public exportState(): any {
    return {
      alpha: this.alpha,
      totalDocs: this.totalDocs,
      vocabulary: Array.from(this.vocabulary),
      classCounts: Object.fromEntries(this.classCounts),
      classTotalWords: Object.fromEntries(this.classTotalWords),
      classWordCounts: Object.fromEntries(
        Array.from(this.classWordCounts.entries()).map(([k, v]) => [k, Object.fromEntries(v)])
      ),
    };
  }

  /**
   * Import serialized state.
   */
  public importState(state: any): void {
    if (!state) return;
    this.alpha = state.alpha ?? 1.0;
    this.totalDocs = state.totalDocs ?? 0;
    this.vocabulary = new Set(state.vocabulary ?? []);

    this.classCounts = new Map(Object.entries(state.classCounts ?? {}));
    this.classTotalWords = new Map(Object.entries(state.classTotalWords ?? {}));

    this.classWordCounts = new Map();
    if (state.classWordCounts) {
      for (const [k, v] of Object.entries<Record<string, number>>(state.classWordCounts)) {
        this.classWordCounts.set(k, new Map(Object.entries(v)));
      }
    }
  }
}
