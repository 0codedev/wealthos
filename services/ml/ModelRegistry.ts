/**
 * ModelRegistry.ts
 * Unified multi-domain model registry on top of Dexie IndexedDB (db.ml_models).
 * Handles model registration, versioning, retrieval, and rollback for all 12 ML domains.
 */

import { db } from '../../database';
import * as MlModelService from './MlModelService';

export interface ModelRegistryRecord {
  id?: number;
  domain: string;
  version: number;
  trainedOn: number;
  isCurrent: number; // 1 = active, 0 = inactive
  weightsJson: string; // Serialized model parameters / tree state / weights
  metadataJson?: string; // Optional evaluation metrics / accuracy / loss
  parentVersion?: number | null;
}

export class ModelRegistry {
  /**
   * Register a new model version for a given domain key.
   */
  public static async register(
    domain: string,
    weights: any,
    metadata?: Record<string, any>
  ): Promise<number> {
    if (domain === 'mcs-p2') {
      // Compatibility pass for legacy MlModelService signature
      return MlModelService.registerNewVersion({
        hitProbModelJson: JSON.stringify(weights.hitProbModel ?? weights),
        mfeMaeModelJson: JSON.stringify(weights.mfeMaeModel ?? {}),
        valHitRate: metadata?.valHitRate ?? 0,
        valMfeMae: metadata?.valMfeMae ?? 0,
        trainRows: metadata?.trainRows ?? 0,
        regime: metadata?.regime ?? 'GLOBAL',
      });
    }

    const allDomain = await db.ml_models
      .filter(m => (m as any).domain === domain)
      .toArray();

    allDomain.sort((a, b) => (b.version || 0) - (a.version || 0));

    const latest = allDomain[0];
    const nextVersion = (latest?.version ?? 0) + 1;
    const currentActive = allDomain.find(m => m.isCurrent === 1);
    const parentVersion = currentActive ? currentActive.version : null;

    // Demote existing current version for this domain
    for (const record of allDomain) {
      if (record.isCurrent === 1 && record.id) {
        await db.ml_models.update(record.id, { isCurrent: 0 });
      }
    }

    // Add new model version
    await db.ml_models.add({
      version: nextVersion,
      trainedOn: Date.now(),
      hitProbModelJson: JSON.stringify(weights),
      mfeMaeModelJson: JSON.stringify(metadata ?? {}),
      valHitRate: metadata?.valHitRate ?? 0,
      valMfeMae: metadata?.valMfeMae ?? 0,
      trainRows: metadata?.trainRows ?? 0,
      regime: (metadata?.regime as any) ?? 'GLOBAL',
      isCurrent: 1,
      source: 'LEARNED',
      parentVersion: parentVersion,
      domain: domain,
    } as any);

    return nextVersion;
  }

  /**
   * Load the currently active model weights for a given domain.
   */
  public static async loadLatest(domain: string): Promise<{ weights: any; metadata: any; version: number } | null> {
    if (domain === 'mcs-p2') {
      const current = await MlModelService.getCurrent();
      if (!current) return null;
      return {
        weights: {
          hitProbModel: JSON.parse(current.hitProbModelJson),
          mfeMaeModel: JSON.parse(current.mfeMaeModelJson),
        },
        metadata: {
          valHitRate: current.valHitRate,
          valMfeMae: current.valMfeMae,
          trainRows: current.trainRows,
        },
        version: current.version,
      };
    }

    const current = await db.ml_models
      .filter(m => (m as any).domain === domain && m.isCurrent === 1)
      .first();

    if (!current) return null;

    try {
      const weights = JSON.parse(current.hitProbModelJson);
      const metadata = JSON.parse(current.mfeMaeModelJson || '{}');
      return { weights, metadata, version: current.version };
    } catch {
      return null;
    }
  }

  /**
   * Rollback a domain to a specified target version or previous parent version.
   */
  public static async rollback(domain: string, targetVersion?: number): Promise<boolean> {
    if (domain === 'mcs-p2') {
      const history = await MlModelService.getHistory();
      const target = targetVersion ?? history.find(v => v.isCurrent === 0)?.version;
      if (!target) return false;
      return MlModelService.rollback(target);
    }

    const domainModels = await db.ml_models
      .filter(m => (m as any).domain === domain)
      .toArray();

    if (domainModels.length === 0) return false;

    let targetRecord = undefined;
    if (targetVersion !== undefined) {
      targetRecord = domainModels.find(m => m.version === targetVersion);
    } else {
      const active = domainModels.find(m => m.isCurrent === 1);
      if (active && active.parentVersion != null) {
        targetRecord = domainModels.find(m => m.version === active.parentVersion);
      }
      if (!targetRecord) {
        // Fallback to second latest
        domainModels.sort((a, b) => b.version - a.version);
        targetRecord = domainModels.find(m => m.isCurrent === 0);
      }
    }

    if (!targetRecord || !targetRecord.id) return false;

    // Deactivate current active
    for (const record of domainModels) {
      if (record.isCurrent === 1 && record.id) {
        await db.ml_models.update(record.id, { isCurrent: 0 });
      }
    }

    // Activate target
    await db.ml_models.update(targetRecord.id, { isCurrent: 1 });
    return true;
  }

  /**
   * List all version records for a domain.
   */
  public static async listVersions(domain: string): Promise<any[]> {
    const domainModels = await db.ml_models
      .filter(m => (m as any).domain === (domain === 'mcs-p2' ? undefined : domain) || (domain === 'mcs-p2' && !(m as any).domain))
      .toArray();

    return domainModels.sort((a, b) => b.version - a.version);
  }
}
