import { db, JarvisBrief } from '../../database';
import { logger } from '../Logger';

export class MemoryVault {
  private static instance: MemoryVault;

  private constructor() {}

  static getInstance(): MemoryVault {
    if (!MemoryVault.instance) {
      MemoryVault.instance = new MemoryVault();
    }
    return MemoryVault.instance;
  }

  /**
   * Saves a new brief to IndexedDB.
   */
  async saveBrief(briefText: string, sentinelData: JarvisBrief['sentinelData'], paperTradeId?: number): Promise<number | null> {
    try {
      const entry: JarvisBrief = {
        timestamp: Date.now(),
        briefText,
        sentinelData,
        paperTradeId
      };

      const id = await db.jarvis_briefs.add(entry);
      logger.info(`[MemoryVault] Saved market brief with ID ${id} to IndexedDB.`);
      return typeof id === 'number' ? id : null;
    } catch (err) {
      logger.error('[MemoryVault] Failed to save brief to IndexedDB', err);
      return null;
    }
  }

  /**
   * Links a paper trade ID to an existing brief.
   */
  async linkPaperTrade(briefId: number, paperTradeId: number): Promise<void> {
    try {
      await db.jarvis_briefs.update(briefId, { paperTradeId });
      logger.info(`[MemoryVault] Linked paper trade ${paperTradeId} to brief ${briefId}.`);
    } catch (err) {
      logger.error(`[MemoryVault] Failed to link paper trade ${paperTradeId} to brief ${briefId}`, err);
    }
  }

  /**
   * Retrieves the most recent market briefs.
   */
  async getRecentBriefs(limit = 10): Promise<JarvisBrief[]> {
    try {
      return await db.jarvis_briefs.orderBy('timestamp').reverse().limit(limit).toArray();
    } catch (err) {
      logger.error('[MemoryVault] Failed to load recent briefs', err);
      return [];
    }
  }

  /**
   * Clears all briefs from IndexedDB.
   */
  async clearAll(): Promise<void> {
    try {
      await db.jarvis_briefs.clear();
      logger.info('[MemoryVault] Cleared all briefs from memory vault.');
    } catch (err) {
      logger.error('[MemoryVault] Failed to clear memory vault', err);
    }
  }
}

export const memoryVault = MemoryVault.getInstance();
