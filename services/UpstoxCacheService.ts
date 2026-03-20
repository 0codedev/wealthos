import { useSettingsStore } from '../store/settingsStore';
import { logger } from './Logger';

interface CacheEntry<T> {
  data: T;
  intervalId: string;
}

class UpstoxCacheService {
  private readonly STORAGE_KEY = 'upstox_session_cache';
  private memoryCache = new Map<string, CacheEntry<any>>();

  constructor() {
    this.hydrateFromSessionStorage();
    // Clean up old localStorage cache to free space
    try {
      localStorage.removeItem('upstox_persistent_cache');
    } catch (e) {
      // ignore
    }
  }

  private hydrateFromSessionStorage() {
    try {
      const raw = sessionStorage.getItem(this.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        Object.entries(parsed).forEach(([key, entry]) => {
          this.memoryCache.set(key, entry as CacheEntry<any>);
        });
      }
    } catch (e) {
      logger.warn('Failed to hydrate Upstox cache from sessionStorage:', e);
    }
  }

  private persistToSessionStorage() {
    try {
      const obj: Record<string, CacheEntry<any>> = {};
      this.memoryCache.forEach((value, key) => {
        obj[key] = value;
      });
      sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      logger.warn('UpstoxCacheService: sessionStorage write failed, trimming cache...', e);
      try {
        sessionStorage.removeItem(this.STORAGE_KEY);
        // Keep only the last 50 entries in sessionStorage to prevent quota overflow
        const entries = Array.from(this.memoryCache.entries());
        if (entries.length > 50) {
          const trimmedObj: Record<string, CacheEntry<any>> = {};
          entries.slice(-50).forEach(([k, v]) => {
            trimmedObj[k] = v;
          });
          sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(trimmedObj));
        }
      } catch (recoveryErr) {
        logger.error('Failed to write trimmed cache to sessionStorage:', recoveryErr);
      }
    }
  }

  /**
   * Generates the interval ID based on Indian Standard Time (IST).
   * Invalidation times are 9:00 AM, 12:00 PM, and 3:00 PM (15:00) IST.
   */
  getCurrentIntervalId(): string {
    const now = new Date();
    // Convert current UTC time to IST
    const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const istDate = new Date(istString);

    const year = istDate.getFullYear();
    const month = String(istDate.getMonth() + 1).padStart(2, '0');
    const day = String(istDate.getDate()).padStart(2, '0');
    const dateKey = `${year}-${month}-${day}`;

    const hours = istDate.getHours();
    const minutes = istDate.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    // Period indices:
    // Period 0: 00:00 to 09:00 IST
    // Period 1: 09:00 to 12:00 IST
    // Period 2: 12:00 to 15:00 IST
    // Period 3: 15:00 to 24:00 IST
    let period = 0;
    if (totalMinutes >= 9 * 60 && totalMinutes < 12 * 60) {
      period = 1;
    } else if (totalMinutes >= 12 * 60 && totalMinutes < 15 * 60) {
      period = 2;
    } else if (totalMinutes >= 15 * 60) {
      period = 3;
    }

    return `${dateKey}_${period}`;
  }

  private isStaticMetadataKey(key: string): boolean {
    return key.includes('fundamentals') || key.includes('profile') || key.includes('metadata');
  }

  /**
   * Retrieves data from the cache if the interval ID matches or if it is static metadata.
   */
  get<T>(key: string): T | null {
    // 1. Check memory cache first
    const entry = this.memoryCache.get(key) as CacheEntry<T> | undefined;
    if (entry) {
      const currentInterval = this.getCurrentIntervalId();
      if (entry.intervalId === currentInterval || this.isStaticMetadataKey(key)) {
        return entry.data;
      }
    }

    // 2. Check localStorage as fallback for static metadata (TTL: 30 days)
    if (this.isStaticMetadataKey(key) && typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = localStorage.getItem(`upstox_static_${key}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Date.now() - parsed.timestamp < 30 * 24 * 60 * 60 * 1000) {
            // Populate memory cache for future instant access
            this.memoryCache.set(key, {
              data: parsed.data,
              intervalId: this.getCurrentIntervalId()
            });
            return parsed.data;
          } else {
            localStorage.removeItem(`upstox_static_${key}`);
          }
        }
      } catch (e) {
        // ignore
      }
    }
    return null;
  }

  /**
   * Retrieves data from the cache even if the interval ID is expired/stale.
   * Useful when the feed is toggled OFF and we want to show the last request's data.
   */
  getStale<T>(key: string): T | null {
    const entry = this.memoryCache.get(key) as CacheEntry<T> | undefined;
    if (entry) return entry.data;

    // Check localStorage fallback for static metadata
    if (this.isStaticMetadataKey(key) && typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = localStorage.getItem(`upstox_static_${key}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          return parsed.data;
        }
      } catch (e) {
        // ignore
      }
    }
    return null;
  }

  /**
   * Saves data in the cache with the current interval ID.
   */
  set<T>(key: string, data: T): void {
    this.memoryCache.set(key, {
      data,
      intervalId: this.getCurrentIntervalId(),
    });

    if (this.isStaticMetadataKey(key) && typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem(`upstox_static_${key}`, JSON.stringify({
          data,
          timestamp: Date.now()
        }));
      } catch (e) {
        // ignore quota limits
      }
    }

    this.persistToSessionStorage();
  }

  /**
   * Clears the entire Upstox cache.
   */
  clear(): void {
    this.memoryCache.clear();
    try {
      sessionStorage.removeItem(this.STORAGE_KEY);
      // Clean up static localStorage cache items
      if (typeof window !== 'undefined' && window.localStorage) {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith('upstox_static_')) {
            localStorage.removeItem(k);
          }
        }
      }
      logger.info('Upstox cache cleared successfully.');
    } catch (e) {
      logger.error('Failed to clear Upstox cache:', e);
    }
  }

  /**
   * Executes a fetch operation with the caching strategy.
   * If Upstox is enabled: uses current valid cache or fetches.
   * If Upstox is disabled: returns stale cache (last request) or a fallback value.
   */
  async executeWithCache<T>(
    key: string,
    fetchFn: () => Promise<T>,
    fallbackFn?: () => Promise<T> | T,
    forceRefresh = false
  ): Promise<T> {
    const isUpstoxEnabled = useSettingsStore.getState().isUpstoxEnabled;

    if (!isUpstoxEnabled) {
      // Toggle is OFF: immediately bypass network and attempt to return the stale cache.
      const staleData = this.getStale<T>(key);
      if (staleData !== null) {
        return staleData;
      }
      // If no stale data exists, execute the fallback.
      if (fallbackFn) {
        return await fallbackFn();
      }
      return null as any;
    }

    // Toggle is ON: use valid current-interval cache or fetch.
    if (forceRefresh) {
      this.memoryCache.delete(key);
      this.persistToSessionStorage();
    } else {
      const cachedData = this.get<T>(key);
      if (cachedData !== null) {
        return cachedData;
      }
    }

    try {
      const data = await fetchFn();
      if (data !== null && data !== undefined) {
        this.set(key, data);
      }
      return data;
    } catch (e) {
      logger.warn(`Failed to fetch Upstox data for key "${key}", checking fallbacks:`, e);
      // If fetch fails, try to return stale cache first, then run fallback.
      const staleData = this.getStale<T>(key);
      if (staleData !== null) {
        return staleData;
      }
      if (fallbackFn) {
        return await fallbackFn();
      }
      throw e;
    }
  }

  /**
   * Executes a fetch operation with the daily interval caching strategy,
   * but ignores the Upstox-enable setting since these are general macro APIs.
   * On failure, it falls back to stale cache.
   */
  async executeWithCacheGeneral<T>(
    key: string,
    fetchFn: () => Promise<T>,
    forceRefresh = false
  ): Promise<T> {
    if (forceRefresh) {
      this.memoryCache.delete(key);
      this.persistToSessionStorage();
    } else {
      const cachedData = this.get<T>(key);
      if (cachedData !== null) {
        return cachedData;
      }
    }

    try {
      const data = await fetchFn();
      if (data !== null && data !== undefined) {
        this.set(key, data);
      }
      return data;
    } catch (e) {
      logger.warn(`Failed to fetch general data for key "${key}", checking stale cache:`, e);
      const staleData = this.getStale<T>(key);
      if (staleData !== null) {
        return staleData;
      }
      throw e;
    }
  }
}

export const upstoxCacheService = new UpstoxCacheService();
