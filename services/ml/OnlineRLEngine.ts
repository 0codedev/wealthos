import { db, ParsedSignal } from '../../database';
import { logger } from '../Logger';
import { signalMLEngine } from '../SignalMLEngine';
import { experienceReplayBuffer } from './ExperienceReplayBuffer';
import { modelVersioning } from './ModelVersioning';
import { useMLModelStore } from '../../store/mlModelStore';

export class OnlineRLEngine {
  private static instance: OnlineRLEngine;
  private isTraining = false;

  private constructor() {}

  static getInstance(): OnlineRLEngine {
    if (!OnlineRLEngine.instance) {
      OnlineRLEngine.instance = new OnlineRLEngine();
    }
    return OnlineRLEngine.instance;
  }

  private async getTF() {
    return await import('@tensorflow/tfjs');
  }

  /**
   * Automatically triggered when a parsed signal's status changes to TARGET_HIT or SL_HIT.
   * Feeds the experience into the replay buffer and runs incremental training.
   */
  async onSignalClosed(signal: ParsedSignal): Promise<void> {
    if (this.isTraining) return;
    this.isTraining = true;
    useMLModelStore.getState().updateMetrics({ isTraining: true });

    try {
      const provider = await db.signal_providers.where('name').equals(signal.provider).first();
      const state = signalMLEngine.extractFeatures(signal, provider);
      const reward = signal.status === 'TARGET_HIT' ? 1.0 : 0.0;

      // Update provider winRate and totals dynamically in database
      if (provider && provider.id) {
        const totalS = (provider.totalSignals || 0) + 1;
        const wins = (provider.wins || 0) + (reward > 0 ? 1 : 0);
        const losses = (provider.losses || 0) + (reward > 0 ? 0 : 1);
        const winRate = totalS > 0 ? wins / totalS : 0.0;

        await db.signal_providers.update(provider.id, {
          totalSignals: totalS,
          wins,
          losses,
          winRate,
          lastActive: new Date().toISOString()
        });
        logger.info(`[OnlineRLEngine] Updated stats for provider "${provider.name}": WinRate=${(winRate * 100).toFixed(1)}%`);
      }

      // 1. Add experience to replay buffer
      await experienceReplayBuffer.addExperience({
        signalId: signal.id,
        reward,
        state,
        action: signal.action === 'BUY' ? 1 : 0
      });

      const bufferSize = await experienceReplayBuffer.getSize();
      logger.info(`[OnlineRLEngine] Added experience. Current RL buffer size: ${bufferSize}.`);

      // 2. Enforce minimum training size threshold of 15
      if (bufferSize >= 15) {
        logger.info('[OnlineRLEngine] Buffer threshold reached. Starting incremental model update...');
        
        const tf = await this.getTF();
        
        // Ensure model is initialized in SignalMLEngine
        await signalMLEngine.init();
        
        // Retrieve batch sample
        const samples = await experienceReplayBuffer.sample(32);
        
        const X = samples.map(s => s.state);
        const y = samples.map(s => s.reward);

        const xs = tf.tensor2d(X);
        const ys = tf.tensor1d(y, 'float32');

        // Compile/build model if it doesn't exist yet in signalMLEngine
        let model = (signalMLEngine as any).model;
        if (!model) {
          model = tf.sequential();
          model.add(tf.layers.dense({ units: 16, activation: 'relu', inputShape: [8] }));
          model.add(tf.layers.dense({ units: 8, activation: 'relu' }));
          model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
          model.compile({
            optimizer: tf.train.adam(0.01),
            loss: 'binaryCrossentropy',
            metrics: ['accuracy']
          });
          (signalMLEngine as any).model = model;
        }

        // Fit model incrementally (5 epochs)
        const history = await model.fit(xs, ys, {
          epochs: 5,
          batchSize: 4,
          shuffle: true
        });

        const loss = history.history.loss[history.history.loss.length - 1] as number;
        const accuracy = history.history.accuracy[history.history.accuracy.length - 1] as number;

        // Save model
        await model.save('indexeddb://signal-ml-model');

        // Retrieve current version number to increment it
        const currentVer = await modelVersioning.getCurrentVersion();
        const nextVerNum = currentVer ? currentVer.version + 1 : 1;

        // Register new checkpoint
        await modelVersioning.registerVersion({
          version: nextVerNum,
          accuracy,
          loss,
          sampleCount: bufferSize,
          isCurrent: 1
        });

        // Cleanup Tensors
        xs.dispose();
        ys.dispose();

        logger.info(`[OnlineRLEngine] Incremental model update complete. New Version: v${nextVerNum}, Accuracy: ${(accuracy * 105).toFixed(1)}%`);
      }
    } catch (err) {
      logger.error('[OnlineRLEngine] Incremental training loop failed', err);
    } finally {
      this.isTraining = false;
      useMLModelStore.getState().updateMetrics({ isTraining: false });
      await useMLModelStore.getState().fetchHistory();
    }
  }
}

export const onlineRLEngine = OnlineRLEngine.getInstance();
export default onlineRLEngine;
