import { db } from '../database';

export interface AlphaSnapshot {
  id?: number;
  key: string;
  data: any;
  cachedAt: number;
  ttlHours: number;
}

const MINUTE_MS = 60 * 1000;

export const alphaCache = {
  /**
   * Retrieves data from the cache. Returns null if not found.
   * Also returns isStale indicating if the cache TTL has expired.
   */
  async get(key: string): Promise<{ data: any; isStale: boolean; cachedAt?: number; ttlMs?: number } | null> {
    try {
      const record = await db.cache.where('key').equals(key).first();
      if (!record) return null;

      const now = Date.now();
      const ttlMs = record.ttl || (4 * 60 * 60 * 1000); // default 4 hours if missing
      const isStale = now > (record.timestamp + ttlMs);

      return {
        data: record.data,
        isStale,
        cachedAt: record.timestamp,
        ttlMs
      };
    } catch (error) {
      console.error('[alphaCache] Error getting cached data:', error);
      return null;
    }
  },

  /**
   * Saves data into the cache with a specific Time-To-Live (in hours).
   * Pass ttlMinutes as an alternative to ttlHours for short-lived caches
   * (the 15-minute Z-Factor / X-Factor refresh window is the canonical use case).
   */
  async set(
    key: string,
    data: any,
    ttlHours: number = 4,
    options?: { ttlMinutes?: number; ttlMs?: number }
  ): Promise<void> {
    try {
      const existing = await db.cache.where('key').equals(key).first();
      const ttl = options?.ttlMs
        ?? (options?.ttlMinutes !== undefined
            ? options.ttlMinutes * MINUTE_MS
            : ttlHours * 60 * 60 * 1000);

      if (existing && existing.id !== undefined) {
        await db.cache.put({
          id: existing.id,
          key,
          data,
          timestamp: Date.now(),
          ttl
        });
      } else {
        await db.cache.add({
          key,
          data,
          timestamp: Date.now(),
          ttl
        });
      }
    } catch (error) {
      console.error('[alphaCache] Error setting cached data:', error);
    }
  },

  /**
   * Convenience helper for short-lived caches (15-minute default).
   * Aligns with the Alpha Engine 2.0 refresh window for Z-Factor and
   * X-Factor scoring.
   */
  async setFifteenMinute(key: string, data: any): Promise<void> {
    return this.set(key, data, undefined, { ttlMinutes: 15 });
  },

  /**
   * Deletes a specific key from the cache.
   */
  async delete(key: string): Promise<void> {
    try {
      await db.cache.where('key').equals(key).delete();
    } catch (error) {
      console.error('[alphaCache] Error deleting cached key:', error);
    }
  },

  /**
   * Clears the entire cache (Only clears alpha cache items to prevent nuking other system caches)
   */
  async clear(): Promise<void> {
    try {
      const keys = await db.cache.where('key').startsWith('alpha_').primaryKeys();
      await db.cache.bulkDelete(keys as number[]);
    } catch (error) {
      console.error('[alphaCache] Error clearing cache:', error);
    }
  }
};
