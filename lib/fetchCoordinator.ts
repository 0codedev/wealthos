import { useState, useEffect } from 'react';
import { showToast } from '../components/shared/ToastProvider';
import { db } from '../database';
import { isOffline, OfflineNoCacheError } from './offline';
import { circuitBreaker, CircuitBreakerOpenError } from './circuitBreaker';

interface CacheEntry<T> {
  data: T;
  asOf: string; // ISO String timestamp
  expiry: number; // Wall-clock timestamp (ms) when this becomes stale
}

class FetchCoordinator {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private inFlight: Map<string, Promise<any>> = new Map();
  private lastToastTime: number = 0;

  private getTtlForKey(key: string, defaultTtl: number): number {
    if (key.includes('capabilities')) {
      return 60 * 60 * 1000; // 1 hour for capability registry
    }
    if (key.includes('health')) {
      return 10 * 1000; // 10 seconds for API health
    }
    if (key.includes('market') || key.includes('snapshot') || key.includes('ticker') || key.includes('context')) {
      return 24 * 60 * 60 * 1000; // 24 hours for market snapshots
    }
    return defaultTtl;
  }

  private async persistToDb(key: string, data: any, ttl: number): Promise<void> {
    try {
      const existing = await db.cache.where('key').equals(key).first();
      const entry = {
        key,
        data,
        timestamp: Date.now(),
        ttl
      };
      if (existing?.id) {
        await db.cache.update(existing.id, entry);
      } else {
        await db.cache.add(entry);
      }
    } catch (err) {
      console.warn(`[FetchCoordinator] Dexie write failed for key "${key}":`, err);
    }
  }

  /**
   * Performs a request-collapsing, cached fetch with background revalidation.
   * 
   * @param key Unique key for caching / deduplication
   * @param fetcher Async function returning the promise
   * @param ttl Time-to-live in milliseconds
   */
  public async dedupedFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 60000 // 1 minute default
  ): Promise<T> {
    const now = Date.now();
    const resolvedTtl = this.getTtlForKey(key, ttl);

    // Top-10 #4 — offline short-circuit. Return cached data without
    // trying the network. If no cache exists, throw OfflineNoCacheError
    // so the caller can render a calm empty state instead of timing out.
    if (isOffline()) {
      const memCached = this.cache.get(key);
      if (memCached) return memCached.data;
      try {
        const dbEntry = await db.cache.where('key').equals(key).first();
        if (dbEntry) {
          this.cache.set(key, {
            data: dbEntry.data,
            asOf: new Date(dbEntry.timestamp).toISOString(),
            expiry: dbEntry.timestamp + (dbEntry.ttl || resolvedTtl),
          });
          return dbEntry.data as T;
        }
      } catch {
        // fall through to throw
      }
      throw new OfflineNoCacheError(key);
    }

    // Circuit breaker short-circuit: if circuit is open, serve cached without network attempt
    if (circuitBreaker.isOpen(key)) {
      const memCached = this.cache.get(key);
      if (memCached) return memCached.data;
      try {
        const dbEntry = await db.cache.where('key').equals(key).first();
        if (dbEntry) {
          return dbEntry.data as T;
        }
      } catch {
        // fall through
      }
      throw new CircuitBreakerOpenError(key, circuitBreaker.getRemainingCooldown(key));
    }

    const cached = this.cache.get(key);

    // 1. If valid cache exists in memory, return it immediately
    if (cached && cached.expiry > now) {
      return cached.data;
    }

    // 2. Try loading from Dexie if not in memory
    if (!cached) {
      try {
        const dbEntry = await db.cache.where('key').equals(key).first();
        if (dbEntry) {
          const dbExpiry = dbEntry.timestamp + (dbEntry.ttl || resolvedTtl);
          const isDbValid = dbExpiry > now;
          
          // Populate memory cache
          const loadedEntry = {
            data: dbEntry.data,
            asOf: new Date(dbEntry.timestamp).toISOString(),
            expiry: dbExpiry
          };
          this.cache.set(key, loadedEntry);

          if (isDbValid) {
            return dbEntry.data as T;
          } else {
            // Stale: trigger background revalidation and return stale data
            this.revalidateInBackground(key, fetcher, resolvedTtl);
            return dbEntry.data as T;
          }
        }
      } catch (dbErr) {
        console.warn(`[FetchCoordinator] IndexedDB cache read failed for key "${key}":`, dbErr);
      }
    }

    // 3. If cached is stale in memory, trigger background revalidation and return stale
    if (cached) {
      // Run background fetch without awaiting, updating the cache when ready
      this.revalidateInBackground(key, fetcher, resolvedTtl);
      return cached.data;
    }

    // 4. If a request is already in-flight, return the existing promise
    let promise = this.inFlight.get(key);
    if (!promise) {
      promise = fetcher()
        .then((data) => {
          circuitBreaker.recordSuccess(key);
          this.cache.set(key, {
            data,
            asOf: new Date().toISOString(),
            expiry: Date.now() + resolvedTtl,
          });
          this.inFlight.delete(key);
          this.persistToDb(key, data, resolvedTtl);
          return data;
        })
        .catch((error) => {
          circuitBreaker.recordFailure(key);
          this.inFlight.delete(key);
          this.triggerNetworkToast();
          throw error;
        });

      this.inFlight.set(key, promise);
    }

    return promise;
  }

  /**
   * Prefetch a key to warm up the cache.
   */
  public prefetch<T>(key: string, fetcher: () => Promise<T>, ttl: number = 60000): void {
    if (this.cache.has(key) || this.inFlight.has(key)) return;
    this.dedupedFetch(key, fetcher, ttl).catch(() => {});
  }

  /**
   * Force invalidate a cache key.
   */
  public invalidate(key: string): void {
    this.cache.delete(key);
    db.cache.where('key').equals(key).delete().catch(() => {});
  }

  /**
   * Clear all caches.
   */
  public clearAll(): void {
    this.cache.clear();
    this.inFlight.clear();
    db.cache.clear().catch(() => {});
  }

  private evictionTimer: any = null;

  /**
   * Starts periodic cache eviction (default: every 30 minutes)
   */
  public startPeriodicEviction(intervalMs: number = 30 * 60 * 1000): void {
    if (this.evictionTimer) return;
    this.runCacheEviction();
    this.evictionTimer = setInterval(() => {
      this.runCacheEviction();
    }, intervalMs);
  }

  /**
   * Stops periodic cache eviction
   */
  public stopPeriodicEviction(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
  }

  /**
   * Evicts expired cache entries from Dexie.
   */
  public async runCacheEviction(): Promise<void> {
    try {
      const now = Date.now();
      const expiredEntries = await db.cache.filter(entry => {
        const ttl = entry.ttl || (24 * 60 * 60 * 1000); // 24h default
        return entry.timestamp + ttl < now;
      }).toArray();
      
      if (expiredEntries.length > 0) {
        const ids = expiredEntries.map(e => e.id).filter((id): id is number => id !== undefined);
        await db.cache.bulkDelete(ids);
        console.log(`[FetchCoordinator] Evicted ${ids.length} expired cache entries.`);
      }
    } catch (err) {
      console.warn('[FetchCoordinator] Cache eviction failed:', err);
    }
  }

  private async revalidateInBackground<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number
  ): Promise<void> {
    if (this.inFlight.has(key) || circuitBreaker.isOpen(key)) return;

    const promise = fetcher()
      .then((data) => {
        circuitBreaker.recordSuccess(key);
        this.cache.set(key, {
          data,
          asOf: new Date().toISOString(),
          expiry: Date.now() + ttl,
        });
        this.inFlight.delete(key);
        this.persistToDb(key, data, ttl);
        // Trigger a custom event to notify useFetch hooks of fresh data
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(`fetch-refreshed:${key}`, { detail: data }));
        }
      })
      .catch((error) => {
        circuitBreaker.recordFailure(key);
        this.inFlight.delete(key);
        console.warn(`[FetchCoordinator] Background revalidation failed for key "${key}":`, error);
        this.triggerNetworkToast();
      });

    this.inFlight.set(key, promise);
  }

  private triggerNetworkToast(): void {
    const now = Date.now();
    // Throttle toasts to once every 10 seconds to avoid notification storms
    if (now - this.lastToastTime > 10000) {
      this.lastToastTime = now;
      showToast(
        'Background sync: Network connection issue. Displaying cached data.',
        'warning',
        { duration: 5000 }
      );
    }
  }
}

export const fetchCoordinator = new FetchCoordinator();

// Intercept window.fetch to capture stale warning headers from FastAPI bridge
if (typeof window !== 'undefined') {
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch(...args);
    try {
      const status = response.headers.get('X-Data-Status');
      const warning = response.headers.get('X-Data-Warning');
      if (status === 'stale' && warning) {
        window.dispatchEvent(new CustomEvent('app-stale-data', {
          detail: {
            url: response.url,
            message: warning
          }
        }));
      }
    } catch (e) {
      console.warn('[Fetch Interceptor] Error reading response headers:', e);
    }
    return response;
  };

  window.addEventListener('app-stale-data', (e: any) => {
    const { url, message } = e.detail;
    // Map URL to a user-friendly component label
    let componentLabel = 'Market Data';
    if (url.includes('/api/nse/option-chain')) componentLabel = 'Option Chain';
    else if (url.includes('/api/nse/delivery-history')) componentLabel = 'Delivery Radar';
    else if (url.includes('/api/nse/insider-trading')) componentLabel = 'Insider Trading';
    else if (url.includes('/api/nse/pledged-shares')) componentLabel = 'Pledged Shares';
    else if (url.includes('/api/nse/mf-insider')) componentLabel = 'MF Insider';
    else if (url.includes('/api/context/')) componentLabel = 'Market Context';

    showToast(
      `${componentLabel}: ${message}`,
      'warning',
      {
        duration: 8000,
        action: {
          label: 'Refresh Now',
          onClick: () => {
            window.dispatchEvent(new CustomEvent('stale-refresh-request', {
              detail: { url }
            }));
          }
        }
      }
    );
  });
}

interface UseFetchOptions {
  ttl?: number;
  enabled?: boolean;
}

/**
 * React hook using the FetchCoordinator to fetch data with caching and revalidation.
 */
export function useFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  deps: any[] = [],
  options: UseFetchOptions = {}
) {
  const { ttl = 60000, enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);

  const loadData = async (forceInvalidate = false) => {
    if (!enabled) return;
    if (forceInvalidate) {
      fetchCoordinator.invalidate(key);
    }
    
    setIsLoading(true);
    try {
      const result = await fetchCoordinator.dedupedFetch(key, fetcher, ttl);
      setData(result);
      // Retrieve metadata from coordinator cache
      const cached = (fetchCoordinator as any).cache.get(key);
      if (cached) {
        setAsOf(cached.asOf);
      }
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    
    // Subscribe to background revalidation updates
    const handleRefresh = (e: Event) => {
      const customEvent = e as CustomEvent<T>;
      setData(customEvent.detail);
      setAsOf(new Date().toISOString());
    };

    // Listen for manual reload signals triggered by warning notification clicks
    const handleToastRefresh = (e: Event) => {
      const customEvent = e as CustomEvent<{ url: string }>;
      const urlPath = customEvent.detail.url;
      // Resolve matches: key matches the urlPath or if the urlPath/key overlaps
      // Ex: key is "/api/nse/option-chain?symbol=SBIN", urlPath is "http://localhost:3000/api/nse/option-chain?symbol=SBIN"
      if (key === urlPath || urlPath.includes(key) || key.includes(urlPath) ||
          (key.startsWith('option_chain_') && urlPath.includes('/option-chain')) ||
          (key.startsWith('market_context_') && urlPath.includes('/api/context'))) {
        loadData(true); // Force refetch!
      }
    };
    
    window.addEventListener(`fetch-refreshed:${key}`, handleRefresh);
    window.addEventListener('stale-refresh-request', handleToastRefresh);
    return () => {
      window.removeEventListener(`fetch-refreshed:${key}`, handleRefresh);
      window.removeEventListener('stale-refresh-request', handleToastRefresh);
    };
  }, [key, enabled, ...deps]);

  return {
    data,
    isLoading,
    error,
    asOf,
    refetch: () => loadData(true),
  };
}
