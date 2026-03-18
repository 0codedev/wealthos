import { db, ParsedSignal, SignalProvider } from '../database';
import { logger } from './Logger';

import { IsotonicRegression } from './ml/core/IsotonicRegression';

export interface MLPrediction {
  probability: number; // 0 - 100%
  expectedPnL: number; // Est. profit/loss in Rs.
}

export interface TrainingMetrics {
  accuracy: number;
  loss: number;
  epochs: number;
  samples: number;
}

export class SignalMLEngine {
  private static instance: SignalMLEngine;
  private model: any = null;
  private isModelLoaded = false;
  private lastAccuracy = 0;
  private lastLoss = 0;
  private sampleCount = 0;
  private trainingEpochs = 20;
  private calibrator: IsotonicRegression = new IsotonicRegression();

  private constructor() {
    // Dexie hook to intercept signal status changes and trigger the RL loop
    db.parsed_signals.hook('updating', (mods: any, primKey: any, obj: any) => {
      if (mods.status && (mods.status === 'TARGET_HIT' || mods.status === 'SL_HIT')) {
        const updatedObj = { ...obj, ...mods };
        // Dynamic import to prevent circular imports
        import('./ml/OnlineRLEngine').then(({ onlineRLEngine }) => {
          onlineRLEngine.onSignalClosed(updatedObj);
        });
      }
    });
  }

  static getInstance(): SignalMLEngine {
    if (!SignalMLEngine.instance) {
      SignalMLEngine.instance = new SignalMLEngine();
    }
    return SignalMLEngine.instance;
  }

  /**
   * Lazily loads TensorFlow.js
   */
  private async getTF() {
    return await import('@tensorflow/tfjs');
  }

  /**
   * Extract feature vector for a signal with temporal decay weighting
   */
  public extractFeatures(signal: ParsedSignal, provider?: SignalProvider): number[] {
    const winRate = provider ? provider.winRate : 0.5;
    const avgRR = provider ? provider.avgRR : 1.5;
    const totalSignals = provider ? provider.totalSignals : 10;

    const signalAgeDays = signal.timestamp ? Math.max(0, (Date.now() - new Date(signal.timestamp).getTime()) / (1000 * 60 * 60 * 24)) : 0;
    const decayFactor = Math.exp(-signalAgeDays / 30);

    const riskReward = signal.riskRewardRatio || 1.5;
    const time = new Date(signal.timestamp || Date.now());
    const hour = time.getHours() / 23; // normalize
    const day = time.getDay() / 6; // normalize

    return [
      (riskReward / 10) * decayFactor, // normalized RR with temporal decay
      winRate * decayFactor,
      (avgRR / 10) * decayFactor, // normalized avg RR with temporal decay
      Math.min(1, totalSignals / 100), // normalized total signal count
      hour,
      day,
      signal.stopLoss ? 1 : 0,
      signal.target2 ? 1 : 0
    ];
  }

  /**
   * Initialize or load the model from IndexedDB
   */
  async init(): Promise<boolean> {
    if (this.isModelLoaded && this.model) return true;

    try {
      const tf = await this.getTF();
      try {
        this.model = await tf.loadLayersModel('indexeddb://signal-ml-model');
        this.isModelLoaded = true;
        logger.info('[SignalMLEngine] Loaded existing model from IndexedDB.');
        return true;
      } catch (e) {
        logger.info('[SignalMLEngine] No existing model found. Will create new one on training.');
        return false;
      }
    } catch (err) {
      logger.error('[SignalMLEngine] Failed to load TensorFlow.js', err);
      return false;
    }
  }

  /**
   * Get training samples and augment if insufficient
   */
  private async getTrainingData() {
    const signals = await db.parsed_signals
      .filter(s => s.status === 'TARGET_HIT' || s.status === 'SL_HIT')
      .toArray();

    const providers = await db.signal_providers.toArray();
    const providerMap = new Map<string, SignalProvider>();
    providers.forEach(p => providerMap.set(p.name, p));

    const X: number[][] = [];
    const y: number[] = [];

    // Add actual closed signals
    for (const sig of signals) {
      const p = providerMap.get(sig.provider);
      X.push(this.extractFeatures(sig, p));
      y.push(sig.status === 'TARGET_HIT' ? 1 : 0);
    }

    this.sampleCount = X.length;

    // SPRINT 2.E3 — HONEST DATA POLICY: the old behavior synthesized fake
    // "MOCK_ASSET" rows to force training with <15 real samples, which taught
    // the model noise and made its win-probability output meaningless. Now we
    // refuse to train below the minimum and report exactly what's needed.
    if (X.length < 15) {
      logger.info(`[SignalMLEngine] Only ${X.length} real closed signals — need 15+ to train honestly. Collect ${15 - X.length} more.`);
    }

    return { X, y };
  }

  /**
   * Train model in-browser
   */
  async train(onEpochEnd?: (epoch: number, loss: number, acc: number) => void): Promise<TrainingMetrics | null> {
    try {
      const tf = await this.getTF();
      const { X, y } = await this.getTrainingData();

      // SPRINT 2.E3 — refuse to train on insufficient REAL data
      if (X.length < 15) {
        logger.warn(`[SignalMLEngine] Training refused: ${X.length}/15 real closed signals. Log more closed signals first.`);
        return null;
      }

      // Create tensors
      const xs = tf.tensor2d(X);
      const ys = tf.tensor1d(y, 'float32');

      // Build model
      const model = tf.sequential();
      model.add(tf.layers.dense({ units: 16, activation: 'relu', inputShape: [8] }));
      model.add(tf.layers.dense({ units: 8, activation: 'relu' }));
      model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

      model.compile({
        optimizer: tf.train.adam(0.01),
        loss: 'binaryCrossentropy',
        metrics: ['accuracy']
      });

      logger.info(`[SignalMLEngine] Training starting on ${X.length} samples...`);

      const history = await model.fit(xs, ys, {
        epochs: this.trainingEpochs,
        batchSize: 4,
        shuffle: true,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            if (logs && onEpochEnd) {
              onEpochEnd(epoch + 1, logs.loss, logs.acc);
            }
          }
        }
      });

      this.model = model;
      this.isModelLoaded = true;
      
      const finalAcc = history.history.accuracy[history.history.accuracy.length - 1] as number;
      const finalLoss = history.history.loss[history.history.loss.length - 1] as number;
      
      this.lastAccuracy = finalAcc;
      this.lastLoss = finalLoss;

      // Save model
      await model.save('indexeddb://signal-ml-model');
      logger.info(`[SignalMLEngine] Model trained. Accuracy: ${(finalAcc * 100).toFixed(1)}%. Saved to IndexedDB.`);

      // Cleanup Tensors
      xs.dispose();
      ys.dispose();

      return {
        accuracy: finalAcc,
        loss: finalLoss,
        epochs: this.trainingEpochs,
        samples: X.length
      };
    } catch (e) {
      logger.error('[SignalMLEngine] Model training failed', e);
      return null;
    }
  }

  /**
   * Get P(Hit) prediction for a signal
   */
  async predict(signal: ParsedSignal): Promise<MLPrediction> {
    try {
      await this.init();
      if (!this.model) {
        // Fallback quality score conversion to probability if no model trained yet
        const baseProb = 50 + (signal.riskRewardRatio ? (signal.riskRewardRatio > 1.8 ? 15 : 5) : 0);
        const fallbackProb = Math.min(95, Math.max(25, baseProb));
        if (signal.id) {
          db.parsed_signals.update(signal.id, { mlScore: fallbackProb }).catch(() => {});
        }
        return {
          probability: fallbackProb,
          expectedPnL: this.estimatePnL(signal, fallbackProb / 100)
        };
      }

      const tf = await this.getTF();
      const provider = await db.signal_providers.where('name').equals(signal.provider).first();
      const features = this.extractFeatures(signal, provider);
      
      const inputTensor = tf.tensor2d([features]);
      const predictionTensor = this.model.predict(inputTensor) as any;
      const predictionData = await predictionTensor.data();
      
      const probability = predictionData[0]; // 0 to 1

      // Cleanup
      inputTensor.dispose();
      predictionTensor.dispose();

      const probabilityResult = Number((probability * 100).toFixed(1));
      if (signal.id) {
        db.parsed_signals.update(signal.id, { mlScore: probabilityResult }).catch((err) => {
          logger.warn(`[SignalMLEngine] Failed to save mlScore for signal ${signal.id}`, err);
        });
      }

      return {
        probability: probabilityResult,
        expectedPnL: this.estimatePnL(signal, probability)
      };
    } catch (err) {
      logger.error('[SignalMLEngine] Error making prediction', err);
      return { probability: 50, expectedPnL: 0 };
    }
  }

  /**
   * Scores and stores untraded signals below trust threshold as phantom trades
   * to benchmark ML calibration against actual executed signals.
   */
  async recordPhantomTrade(signal: ParsedSignal): Promise<void> {
    try {
      const pred = await this.predict(signal);
      if (signal.id) {
        await db.parsed_signals.update(signal.id, {
          mlScore: pred.probability,
          isPhantom: 1,
          phantomPnL: pred.expectedPnL
        });
        logger.info(`[SignalMLEngine] Recorded phantom trade ${signal.id} with score ${pred.probability}% and est PnL ₹${pred.expectedPnL}`);
      }
    } catch (err) {
      logger.warn('[SignalMLEngine] Failed to record phantom trade:', err);
    }
  }

  /**
   * Estimates PnL based on option premium lot size and entry vs target/SL
   */
  private estimatePnL(signal: ParsedSignal, probability: number): number {
    const entry = signal.entryPrice;
    const sl = signal.stopLoss || entry * 0.90;
    const t1 = signal.target1 || entry * 1.10;

    const risk = Math.abs(entry - sl);
    const reward = Math.abs(t1 - entry);

    // Fetch lot size based on symbol name
    const sym = signal.instrument.toUpperCase();
    let lotSize = 15;
    if (sym.includes('BANKNIFTY')) lotSize = 15;
    else if (sym.includes('FINNIFTY')) lotSize = 40;
    else if (sym.includes('MIDCPNIFTY')) lotSize = 75;
    else if (sym.includes('NIFTY')) lotSize = 25;

    // Expected Value: (Probability * Reward) - ((1 - Probability) * Risk)
    const expectedValuePerUnit = (probability * reward) - ((1 - probability) * risk);
    const estPnL = expectedValuePerUnit * lotSize;

    return Number(estPnL.toFixed(1));
  }

  async resetModel(): Promise<void> {
    try {
      const tf = await this.getTF();
      await tf.io.removeModel('indexeddb://signal-ml-model');
      this.model = null;
      this.isModelLoaded = false;
      this.lastAccuracy = 0;
      this.lastLoss = 0;
      logger.info('[SignalMLEngine] Model reset successfully.');
    } catch (e) {
      logger.error('[SignalMLEngine] Error deleting model', e);
    }
  }

  getLastMetrics() {
    return {
      accuracy: this.lastAccuracy,
      loss: this.lastLoss,
      isLoaded: this.isModelLoaded,
      sampleCount: this.sampleCount
    };
  }
}

export const signalMLEngine = SignalMLEngine.getInstance();
