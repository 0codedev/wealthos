/**
 * OnlineLogisticRegression.ts
 * Pure TypeScript implementation of Passive-Aggressive Online Classifier
 * designed for real-time tick-by-tick learning with low latency (<1ms).
 */

export interface OnlineLogisticRegressionOptions {
  numFeatures: number;
  C?: number; // Regularization parameter
  initialWeights?: number[];
  initialBias?: number;
}

export class OnlineLogisticRegression {
  private weights: Float64Array;
  private bias: number;
  private C: number;

  constructor(options: OnlineLogisticRegressionOptions) {
    this.C = options.C ?? 1.0;
    this.bias = options.initialBias ?? 0.0;
    this.weights = new Float64Array(options.numFeatures);
    if (options.initialWeights && options.initialWeights.length === options.numFeatures) {
      for (let i = 0; i < options.numFeatures; i++) {
        this.weights[i] = options.initialWeights[i];
      }
    }
  }

  private dot(features: number[]): number {
    let sum = this.bias;
    const len = Math.min(features.length, this.weights.length);
    for (let i = 0; i < len; i++) {
      sum += this.weights[i] * features[i];
    }
    return sum;
  }

  private normSq(features: number[]): number {
    let sumSq = 1.0; // including bias term weight squared (1^2)
    const len = Math.min(features.length, this.weights.length);
    for (let i = 0; i < len; i++) {
      sumSq += features[i] * features[i];
    }
    return sumSq;
  }

  /**
   * Update weights online using Passive-Aggressive updates.
   * @param features Numeric feature vector
   * @param label Binary outcome: +1 for positive/win, -1 for negative/loss
   */
  public update(features: number[], label: 1 | -1): void {
    const rawScore = this.dot(features);
    const margin = label * rawScore;
    const loss = Math.max(0, 1.0 - margin);

    if (loss > 0) {
      const sqNorm = this.normSq(features);
      // PA-I formulation step size constraint
      const tau = Math.min(this.C, loss / sqNorm);
      const step = tau * label;

      const len = Math.min(features.length, this.weights.length);
      for (let i = 0; i < len; i++) {
        this.weights[i] += step * features[i];
      }
      this.bias += step;
    }
  }

  /**
   * Predict probability of positive class (+1) using Sigmoid transform.
   * Returns a value between 0.0 and 1.0.
   */
  public predict(features: number[]): number {
    const rawScore = this.dot(features);
    // Sigmoid function
    return 1.0 / (1.0 + Math.exp(-rawScore));
  }

  /**
   * Get internal model weights vector and bias for persistence.
   */
  public getWeights(): { weights: number[]; bias: number } {
    return {
      weights: Array.from(this.weights),
      bias: this.bias,
    };
  }

  /**
   * Restore model weights vector and bias.
   */
  public setWeights(weights: number[], bias: number): void {
    const len = Math.min(weights.length, this.weights.length);
    for (let i = 0; i < len; i++) {
      this.weights[i] = weights[i];
    }
    this.bias = bias;
  }
}
