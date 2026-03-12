import { db, ModelVersion } from '../../database';
import { logger } from '../Logger';

export class ModelVersioning {
  private static instance: ModelVersioning;

  private constructor() {}

  static getInstance(): ModelVersioning {
    if (!ModelVersioning.instance) {
      ModelVersioning.instance = new ModelVersioning();
    }
    return ModelVersioning.instance;
  }

  /**
   * Registers a new model version/checkpoint in IndexedDB.
   * If isCurrent is true, resets all other checkpoints' isCurrent to 0.
   */
  async registerVersion(versionInfo: Omit<ModelVersion, 'timestamp'>): Promise<void> {
    try {
      const entry: ModelVersion = {
        ...versionInfo,
        timestamp: Date.now()
      };

      if (entry.isCurrent === 1) {
        // Reset current flag on all other versions
        const currentVersions = await db.model_versions.where('isCurrent').equals(1).toArray();
        for (const v of currentVersions) {
          if (v.id) {
            await db.model_versions.update(v.id, { isCurrent: 0 });
          }
        }
      }

      await db.model_versions.add(entry);
      logger.info(`[ModelVersioning] Registered model version v${entry.version} with accuracy ${(entry.accuracy * 100).toFixed(1)}%.`);
    } catch (error) {
      logger.error('[ModelVersioning] Failed to register model version', error);
    }
  }

  /**
   * Retrieves the current active model version.
   */
  async getCurrentVersion(): Promise<ModelVersion | null> {
    try {
      const current = await db.model_versions.where('isCurrent').equals(1).first();
      return current || null;
    } catch (error) {
      logger.error('[ModelVersioning] Failed to get current model version', error);
      return null;
    }
  }

  /**
   * Gets all version checkpoints.
   */
  async getVersionHistory(): Promise<ModelVersion[]> {
    try {
      return await db.model_versions.orderBy('version').reverse().toArray();
    } catch (error) {
      logger.error('[ModelVersioning] Failed to get version history', error);
      return [];
    }
  }

  /**
   * Rolls back to a specific version by version number.
   * Sets the target version as isCurrent = 1, and others to 0.
   * Returns true if successful.
   */
  async rollbackToVersion(versionNum: number): Promise<boolean> {
    try {
      const target = await db.model_versions.where('version').equals(versionNum).first();
      if (!target || !target.id) {
        logger.warn(`[ModelVersioning] Rollback target v${versionNum} not found.`);
        return false;
      }

      // Reset current flag on all others
      const allCurrent = await db.model_versions.where('isCurrent').equals(1).toArray();
      for (const v of allCurrent) {
        if (v.id) {
          await db.model_versions.update(v.id, { isCurrent: 0 });
        }
      }

      // Set target as current
      await db.model_versions.update(target.id, { isCurrent: 1 });
      logger.info(`[ModelVersioning] Rolled back successfully to model version v${versionNum}.`);
      return true;
    } catch (error) {
      logger.error(`[ModelVersioning] Rollback to v${versionNum} failed`, error);
      return false;
    }
  }

  /**
   * Evaluates A/B testing selection: determines whether to use the active or baseline/previous model.
   * By default, returns 'current' (95% weight) or 'previous' (5% weight) for evaluation comparison.
   */
  shouldUsePreviousModel(): boolean {
    // 5% exploratory A/B test rate
    return Math.random() < 0.05;
  }
}

export const modelVersioning = ModelVersioning.getInstance();
