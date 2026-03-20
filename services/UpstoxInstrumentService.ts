import { FNO_STOCKS } from '../data/fno_stocks';
import { UPSTOX_INSTRUMENT_MAP_FALLBACK } from '../data/upstox_instrument_map';
import { logger } from './Logger';
import { useSettingsStore } from '../store/settingsStore';

class UpstoxInstrumentService {
  private memoryCache: Record<string, string> = {};

  constructor() {
    // Prime cache with fallbacks
    this.memoryCache = { ...UPSTOX_INSTRUMENT_MAP_FALLBACK };
  }

  private getPersistedKey(cacheKey: string): string | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
      const itemStr = window.localStorage.getItem(`upstox_key_${cacheKey}`);
      if (!itemStr) return null;
      const parsed = JSON.parse(itemStr);
      // Check 24 hour TTL (86400000 ms)
      if (Date.now() - parsed.timestamp > 24 * 60 * 60 * 1000) {
        window.localStorage.removeItem(`upstox_key_${cacheKey}`);
        return null;
      }
      return parsed.key;
    } catch (e) {
      return null;
    }
  }

  private setPersistedKey(cacheKey: string, keyVal: string): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(`upstox_key_${cacheKey}`, JSON.stringify({
        key: keyVal,
        timestamp: Date.now()
      }));
    } catch (e) {
      // ignore quota or other storage errors
    }
  }

  /**
   * Translates a symbol to its corresponding Upstox instrument key.
   * Fetches from Python bridge SQLite cache or falls back to memory/static map.
   */
  async getInstrumentKey(symbol: string, exchange?: string): Promise<string> {
    const sym = symbol.toUpperCase().trim();

    // Direct check for hardcoded fallbacks (e.g. indices) to avoid network/storage latency or cache corruption
    if (UPSTOX_INSTRUMENT_MAP_FALLBACK[sym]) {
      return UPSTOX_INSTRUMENT_MAP_FALLBACK[sym];
    }

    const cacheKey = exchange ? `${sym}_${exchange.toUpperCase()}` : sym;

    // 1. Memory cache check
    if (this.memoryCache[cacheKey]) {
      return this.memoryCache[cacheKey];
    }

    // 2. localStorage check (24h TTL)
    const persisted = this.getPersistedKey(cacheKey);
    if (persisted) {
      this.memoryCache[cacheKey] = persisted;
      return persisted;
    }

    const isUpstoxEnabled = useSettingsStore.getState().isUpstoxEnabled;
    if (!isUpstoxEnabled) {
      return UPSTOX_INSTRUMENT_MAP_FALLBACK[sym] || '';
    }

    try {
      const url = exchange 
        ? `/api/python-nse/api/upstox/instruments/key?symbol=${encodeURIComponent(sym)}&exchange=${encodeURIComponent(exchange)}`
        : `/api/python-nse/api/upstox/instruments/key?symbol=${encodeURIComponent(sym)}`;
        
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data.instrument_key) {
          this.memoryCache[cacheKey] = data.instrument_key;
          this.setPersistedKey(cacheKey, data.instrument_key);
          return data.instrument_key;
        }
      }
    } catch (err) {
      logger.warn(`Failed to resolve instrument key for ${symbol} from bridge. Using fallback.`, err);
    }

    // Secondary fallback to static mappings
    return UPSTOX_INSTRUMENT_MAP_FALLBACK[sym] || '';
  }

  /**
   * Batch looks up instrument keys for a list of symbols
   */
  async getInstrumentKeys(symbols: string[], exchange?: string): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    const missingSymbols: string[] = [];

    // 1. Check cache first (memory + localStorage)
    for (const symbol of symbols) {
      const sym = symbol.toUpperCase().trim();

      // Direct check for hardcoded fallbacks
      if (UPSTOX_INSTRUMENT_MAP_FALLBACK[sym]) {
        results[symbol] = UPSTOX_INSTRUMENT_MAP_FALLBACK[sym];
        continue;
      }

      const cacheKey = exchange ? `${sym}_${exchange.toUpperCase()}` : sym;
      
      if (this.memoryCache[cacheKey]) {
        results[symbol] = this.memoryCache[cacheKey];
      } else {
        const persisted = this.getPersistedKey(cacheKey);
        if (persisted) {
          this.memoryCache[cacheKey] = persisted;
          results[symbol] = persisted;
        } else {
          missingSymbols.push(sym);
        }
      }
    }

    if (missingSymbols.length === 0) {
      return results;
    }

    const isUpstoxEnabled = useSettingsStore.getState().isUpstoxEnabled;
    if (!isUpstoxEnabled) {
      // Use fallback map directly
      for (const sym of missingSymbols) {
        const key = UPSTOX_INSTRUMENT_MAP_FALLBACK[sym] || '';
        if (key) {
          results[sym] = key;
          const cacheKey = exchange ? `${sym}_${exchange.toUpperCase()}` : sym;
          this.memoryCache[cacheKey] = key;
          this.setPersistedKey(cacheKey, key);
        }
      }
      return results;
    }

    // 2. Query in bulk from python bridge
    try {
      // Chunk requests if there are too many (e.g. 100 at a time)
      const chunkSize = 100;
      for (let i = 0; i < missingSymbols.length; i += chunkSize) {
        const chunk = missingSymbols.slice(i, i + chunkSize);
        const url = `/api/python-nse/api/upstox/instruments/resolve-bulk?symbols=${chunk.map(encodeURIComponent).join(',')}`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          if (data.status === 'success' && data.resolved) {
            for (const sym of chunk) {
              const info = data.resolved[sym];
              if (info && info.instrument_key) {
                const cacheKey = exchange ? `${sym}_${exchange.toUpperCase()}` : sym;
                this.memoryCache[cacheKey] = info.instrument_key;
                this.setPersistedKey(cacheKey, info.instrument_key);
                results[sym] = info.instrument_key;
              } else {
                // If not found in bulk, use static mapping fallback
                const fallbackKey = UPSTOX_INSTRUMENT_MAP_FALLBACK[sym] || '';
                if (fallbackKey) {
                  const cacheKey = exchange ? `${sym}_${exchange.toUpperCase()}` : sym;
                  this.memoryCache[cacheKey] = fallbackKey;
                  this.setPersistedKey(cacheKey, fallbackKey);
                  results[sym] = fallbackKey;
                }
              }
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`Failed to resolve bulk instrument keys from bridge. Using fallbacks.`, err);
      // Fallback
      for (const sym of missingSymbols) {
        const fallbackKey = UPSTOX_INSTRUMENT_MAP_FALLBACK[sym] || '';
        if (fallbackKey) {
          const cacheKey = exchange ? `${sym}_${exchange.toUpperCase()}` : sym;
          this.memoryCache[cacheKey] = fallbackKey;
          this.setPersistedKey(cacheKey, fallbackKey);
          results[sym] = fallbackKey;
        }
      }
    }

    return results;
  }

  /**
   * Returns keys for all FNO stocks defined in fno_stocks.ts
   */
  async getFnoInstrumentKeys(): Promise<string[]> {
    const symbols = FNO_STOCKS.map(s => s.symbol);
    const resolvedMap = await this.getInstrumentKeys(symbols, "NSE_EQ");
    return Object.values(resolvedMap);
  }

  /**
   * Triggers a daily background database sync of all instruments on the python bridge
   */
  async syncInstruments(): Promise<boolean> {
    const isUpstoxEnabled = useSettingsStore.getState().isUpstoxEnabled;
    if (!isUpstoxEnabled) {
      return false;
    }
    try {
      const response = await fetch('/api/python-nse/api/upstox/instruments/sync');
      return response.ok;
    } catch (err) {
      logger.error('Failed to trigger instrument sync:', err);
      return false;
    }
  }
}

export const upstoxInstrumentService = new UpstoxInstrumentService();
