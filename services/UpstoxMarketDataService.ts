import { logger } from './Logger';
import { upstoxCacheService } from './UpstoxCacheService';
import { useCapabilityStore, CapabilityName } from '../store/capabilityStore';

export interface UpstoxQuote {
  last_price: number;
  ohlc: {
    open: number;
    high: number;
    low: number;
    close: number;
  };
  volume: number;
  average_price: number;
  oi: number;
  net_change: number;
  total_buy_quantity: number;
  total_sell_quantity: number;
  lower_circuit_limit: number;
  upper_circuit_limit: number;
  last_trade_time: string;
  dai?: number;
  depth_pressure?: 'BUY_SIDE' | 'SELL_SIDE' | 'NEUTRAL';
}

export type UpstoxQuoteMap = Record<string, UpstoxQuote>;

export interface SourceResult<T> {
  data: T;
  source: string;
  status: string;
  freshness: 'LIVE' | 'CACHED' | 'UNAVAILABLE' | 'DEGRADED';
  fetchedAt: string;
  confidence: number;
  diagnostic?: string;
}

function createSourceResult<T>(data: any, fallback: T, capabilityKey: CapabilityName): SourceResult<T> {
  const cap = useCapabilityStore.getState().capabilities[capabilityKey];
  if (!data || data.status === 'degraded' || data.status === 'unavailable' || data.status === 'error' || data.error) {
    return {
      data: fallback,
      source: 'Upstox API',
      status: data?.status || 'degraded',
      freshness: cap?.state === 'unavailable' ? 'UNAVAILABLE' : 'DEGRADED',
      fetchedAt: new Date().toISOString(),
      confidence: 0,
      diagnostic: data?.message || data?.error || 'Unknown error or degraded status'
    };
  }

  // Check for cache meta
  const meta = data._cache_meta;
  const isCached = meta?.source && meta.source !== 'live';
  const confidence = isCached ? 0.8 : 1.0;
  
  // Strip out _cache_meta from data if it's an object to keep it clean
  let cleanData = data;
  if (data && typeof data === 'object') {
    cleanData = Array.isArray(data) ? [...data] : { ...data };
    if ('_cache_meta' in cleanData) {
      delete cleanData._cache_meta;
    }
  }
  
  return {
    data: cleanData.data !== undefined ? cleanData.data : cleanData,
    source: isCached ? `Local Cache (${meta.source})` : 'Upstox Live API',
    status: 'success',
    freshness: isCached ? 'CACHED' : 'LIVE',
    fetchedAt: meta?.fetched_at || new Date().toISOString(),
    confidence
  };
}

export const DEFAULT_MARKET_TIMINGS_FALLBACK = [
  {
    exchange: 'NSE',
    session_type: 'regular',
    start_time: '09:15:00',
    end_time: '15:30:00'
  },
  {
    exchange: 'BSE',
    session_type: 'regular',
    start_time: '09:15:00',
    end_time: '15:30:00'
  }
];

class UpstoxMarketDataService {
  /**
   * Fetches full market quotes for a list of symbols in a single call (up to 500 symbols).
   * Internally batches and deduplicates concurrent requests to avoid stampedes.
   */
  async getFullQuotes(symbols: string[]): Promise<UpstoxQuoteMap | null> {
    if (!symbols.length) return {};
    
    const cap = useCapabilityStore.getState().capabilities['quotes'];
    if (cap.state !== 'available') {
      return {};
    }

    const results: UpstoxQuoteMap = {};
    const missingSymbols: string[] = [];

    // 1. Check cache for individual symbols first
    for (const sym of symbols) {
      const clean = sym.toUpperCase().trim();
      const cached = upstoxCacheService.get<UpstoxQuote>(`upstox_quote_single_${clean}`);
      if (cached) {
        results[clean] = cached;
      } else {
        missingSymbols.push(clean);
      }
    }

    if (missingSymbols.length === 0) {
      return results;
    }

    // 2. Queue missing symbols for batch fetching
    try {
      const fetchPromises = missingSymbols.map(sym => {
        return new Promise<[string, UpstoxQuote | null]>((resolve, reject) => {
          if (!this._quotePending.has(sym)) {
            this._quotePending.set(sym, []);
          }
          this._quotePending.get(sym)!.push({ resolve, reject });

          if (!this._quoteTimer) {
            this._quoteTimer = setTimeout(() => this._flushQuoteBatch(), 0);
          }
        });
      });

      const fetchedResults = await Promise.all(fetchPromises);
      for (const [sym, quote] of fetchedResults) {
        if (quote) {
          results[sym] = quote;
        }
      }
      return results;
    } catch (err: unknown) {
      logger.error('Upstox API quote request failed:', err);
      return results; // Return what we got from cache
    }
  }

  /**
   * Fetches 20-day historical volume average for a symbol.
   */
  async getVolumeAvg20Day(symbol: string): Promise<{ avg_volume_20d: number } | null> {
    const cacheKey = `upstox_volume_avg_20d_${symbol}`;

    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch(`/api/python-nse/api/upstox/historical/volume-avg?symbol=${encodeURIComponent(symbol)}`);
          if (response.ok) {
            return await response.json();
          }
        } catch (err: unknown) {
          logger.error(`Error fetching volume average for ${symbol}:`, err);
        }
        return null;
      }
    );
  }

  /**
   * Fetches PCR metrics for a symbol.
   */
  async getPCR(symbol: string): Promise<any> {
    const cap = useCapabilityStore.getState().capabilities['pcr'];
    if (cap.state !== 'available') {
      return { status: 'degraded', data: null };
    }

    const cacheKey = `upstox_pcr_${symbol}`;

    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch(`/api/python-nse/api/upstox/pcr?symbol=${encodeURIComponent(symbol)}`);
          if (response.ok) {
            const res = await response.json();
            if (res.status === 'degraded') {
              useCapabilityStore.getState().setCapabilityState('pcr', 'degraded', 'Upstox PCR endpoint returned degraded status.');
              return { status: 'degraded', data: null };
            }
            return res.data || res;
          }
          throw new Error(response.statusText || 'Response not ok');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`Error fetching PCR for ${symbol}:`, err);
          useCapabilityStore.getState().setCapabilityState('pcr', 'degraded', message);
        }
        return { status: 'degraded', data: null };
      },
      () => ({ status: 'degraded', data: null })
    );
  }

  /**
   * Fetches PCR and assigns a market regime classification based on sentiment thresholds.
   */
  async getPCRWithRegime(symbol: string): Promise<{ pcr: number; regime: 'complacent' | 'neutral' | 'fear' | 'panic' | 'reversal_watch' }> {
    try {
      const pcrData = await this.getPCR(symbol);
      let val = 1.0;
      if (pcrData && typeof pcrData === 'object') {
        val = pcrData.pcr !== undefined ? pcrData.pcr : pcrData.value !== undefined ? pcrData.value : 1.0;
      } else if (typeof pcrData === 'number') {
        val = pcrData;
      }

      let regime: 'complacent' | 'neutral' | 'fear' | 'panic' | 'reversal_watch' = 'neutral';
      if (val < 0.7) regime = 'complacent';
      else if (val >= 0.7 && val <= 1.0) regime = 'neutral';
      else if (val > 1.0 && val <= 1.3) regime = 'fear';
      else if (val > 1.3 && val <= 1.5) regime = 'panic';
      else if (val > 1.5) regime = 'reversal_watch';
      
      return { pcr: val, regime };
    } catch (err) {
      logger.error(`Error calculating PCR regime for ${symbol}:`, err);
      return { pcr: 1.0, regime: 'neutral' };
    }
  }

  /**
   * Fetches FII net position history.
   */
  async getFiiHistory(segment: string = 'FO'): Promise<any[]> {
    const cacheKey = `upstox_fii_${segment}`;

    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch(`/api/python-nse/api/upstox/fii?segment=${segment}`);
          if (response.ok) {
            const res = await response.json();
            return res.data || [];
          }
        } catch (err: unknown) {
          logger.error('Error fetching FII history:', err);
        }
        return [];
      },
      () => []
    );
  }

  /**
   * Fetches DII cash flow position history.
   */
  async getDiiHistory(): Promise<any[]> {
    const cacheKey = 'upstox_dii';

    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch('/api/python-nse/api/upstox/dii');
          if (response.ok) {
            const res = await response.json();
            return res.data || [];
          }
        } catch (err: unknown) {
          logger.error('Error fetching DII history:', err);
        }
        return [];
      },
      () => []
    );
  }

  /**
   * Fetches consolidated FII and DII daily history.
   */
  async getFiiDiiConsolidated(limit: number = 30): Promise<any> {
    const cacheKey = `upstox_fii_dii_consolidated_${limit}`;

    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch(`/api/python-nse/api/upstox/fii-dii/consolidated?limit=${limit}`);
          if (response.ok) {
            return await response.json();
          }
        } catch (err: unknown) {
          logger.error('Error fetching consolidated FII/DII history:', err);
        }
        return null;
      }
    );
  }

  /**
   * Fetches live market status from Upstox
   */
  async getMarketStatus(segment: string = 'NSE_CM'): Promise<any> {
    const cacheKey = `upstox_market_status_${segment}`;

    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch(`/api/python-nse/api/upstox/market-status?segment=${segment}`);
          if (response.ok) {
            const res = await response.json();
            return res.data || res;
          }
        } catch (err: unknown) {
          logger.error('Error fetching market status:', err);
        }
        return null;
      }
    );
  }

  // --- Micro-batching state for resolve-bulk ---
  private _resolvePending: Map<string, { resolve: (v: any) => void; reject: (e: any) => void }[]> = new Map();
  private _resolveTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Micro-batching state for quotes ---
  private _quotePending: Map<string, { resolve: (v: [string, UpstoxQuote | null]) => void; reject: (e: any) => void }[]> = new Map();
  private _quoteTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Resolves a symbol to instrument details (ISIN, instrument_key, lot_size, exchange).
   * 
   * Internally batches all calls made within the same microtask into a single
   * /instruments/resolve-bulk request — eliminating N individual HTTP calls per sector load.
   */
  async resolveSymbol(symbol: string): Promise<{ symbol: string; isin: string; instrument_key: string; exchange: string; lot_size: number } | null> {
    const clean = symbol.toUpperCase().trim();
    const cacheKey = `upstox_resolve_symbol_${clean}`;

    // Check cache first — avoid batching for already-resolved symbols
    const cached = upstoxCacheService.get<any>(cacheKey);
    if (cached) return cached;

    // Return a promise that will be resolved when the batch fires
    return new Promise((resolve, reject) => {
      if (!this._resolvePending.has(clean)) {
        this._resolvePending.set(clean, []);
      }
      this._resolvePending.get(clean)!.push({ resolve, reject });

      // Schedule a single batch flush on the next tick (debounce)
      if (!this._resolveTimer) {
        this._resolveTimer = setTimeout(() => this._flushResolveBatch(), 0);
      }
    });
  }

  private async _flushResolveBatch(): Promise<void> {
    this._resolveTimer = null;
    if (this._resolvePending.size === 0) return;

    // Snapshot and clear pending queue
    const pending = new Map(this._resolvePending);
    this._resolvePending.clear();

    const symbols = Array.from(pending.keys());
    try {
      const response = await fetch(
        `/api/python-nse/api/upstox/instruments/resolve-bulk?symbols=${encodeURIComponent(symbols.join(','))}`
      );
      if (!response.ok) throw new Error(`resolve-bulk failed: ${response.statusText}`);
      const payload = await response.json();
      const results = payload.resolved || {};

      for (const [sym, waiters] of pending.entries()) {
        const result = results[sym] ?? null;
        if (result) {
          // Cache the individual result
          upstoxCacheService.set(`upstox_resolve_symbol_${sym}`, result);
        }
        for (const { resolve } of waiters) {
          resolve(result);
        }
      }
    } catch (err: unknown) {
      logger.error('[UpstoxMarketDataService] resolve-bulk batch failed', err);
      // Fall back to individual calls on error
      for (const [sym, waiters] of pending.entries()) {
        try {
          const res = await fetch(`/api/python-nse/api/upstox/instruments/resolve?symbol=${encodeURIComponent(sym)}`);
          const result = res.ok ? await res.json() : null;
          for (const { resolve } of waiters) resolve(result);
        } catch (fallbackErr: unknown) {
          for (const { reject } of waiters) reject(fallbackErr);
        }
      }
    }
  }


  /**
   * Fetches company fundamentals by ISIN.
   */
  async getCompanyFundamentals(
    isin: string, 
    aspect: 'profile' | 'key-ratios' | 'shareholding' | 'corporate-actions' | 'competitors' | 'balance-sheet' | 'cash-flow' | 'income-statement', 
    _symbol?: string
  ): Promise<any> {
    const cap = useCapabilityStore.getState().capabilities['fundamentals'];
    if (cap.state !== 'available') {
      return { status: 'unavailable', data: null };
    }

    // Validate ISIN format (12-char alphanumeric) before caching or fetching
    const isValIsin = /^[a-zA-Z]{2}[a-zA-Z0-9]{9}[0-9]$/.test(isin);
    if (!isValIsin) {
      useCapabilityStore.getState().setCapabilityState('fundamentals', 'unavailable', `Invalid ISIN format: ${isin}`);
      return { status: 'unavailable', data: null };
    }

    const cacheKey = `upstox_fundamentals_${isin}_${aspect}`;

    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const endpointMap = {
            'profile': 'profile',
            'key-ratios': 'key-ratios',
            'shareholding': 'shareholding',
            'corporate-actions': 'corporate-actions',
            'competitors': 'competitors',
            'balance-sheet': 'balance-sheet',
            'cash-flow': 'cash-flow',
            'income-statement': 'income-statement'
          };
          const response = await fetch(`/api/python-nse/api/upstox/fundamentals/${endpointMap[aspect]}?isin=${encodeURIComponent(isin)}`);
          if (response.ok) {
            const res = await response.json();
            return res.data || res;
          }
          throw new Error(response.statusText || 'Response not ok');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`Error fetching company fundamentals (${aspect}) for ${isin}:`, err);
          useCapabilityStore.getState().setCapabilityState('fundamentals', 'unavailable', message);
        }
        return { status: 'unavailable', data: null };
      },
      () => ({ status: 'unavailable', data: null })
    );
  }

  async getBalanceSheet(isin: string, symbol?: string): Promise<any> {
    return this.getCompanyFundamentals(isin, 'balance-sheet', symbol);
  }

  async getCashFlow(isin: string, symbol?: string): Promise<any> {
    return this.getCompanyFundamentals(isin, 'cash-flow', symbol);
  }

  async getIncomeStatement(isin: string, symbol?: string): Promise<any> {
    return this.getCompanyFundamentals(isin, 'income-statement', symbol);
  }

  /**
   * Fetches today's intraday candles for a symbol.
   */
  async getIntradayCandles(instrumentKey: string, interval: string = '5minute'): Promise<any> {
    const cacheKey = `upstox_intraday_${instrumentKey}_${interval}`;
    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch(`/api/python-nse/api/upstox/intraday-candles?instrument_key=${encodeURIComponent(instrumentKey)}&interval=${encodeURIComponent(interval)}`);
          if (response.ok) {
            const res = await response.json();
            return res.data || res;
          }
        } catch (err: unknown) {
          logger.error(`Error fetching intraday candles for ${instrumentKey}:`, err);
        }
        return null;
      }
    );
  }

  /**
   * Fetches LTP-only quotes for a list of symbols.
   */
  async getLTPQuotes(symbols: string[]): Promise<Record<string, { last_price: number }> | null> {
    if (!symbols.length) return {};
    const sortedSymbols = [...symbols].sort();
    const cacheKey = `upstox_ltp_quotes_${sortedSymbols.join(',')}`;
    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch(`/api/python-nse/api/upstox/ltp-quotes?symbols=${encodeURIComponent(symbols.join(','))}`);
          if (response.ok) {
            return await response.json();
          }
        } catch (err: unknown) {
          logger.error('Error fetching LTP quotes:', err);
        }
        return null;
      },
      () => ({})
    );
  }

  /**
   * Fetches OHLC-only quotes for a list of symbols.
   */
  async getOHLCQuotes(symbols: string[], interval: string = '1d'): Promise<Record<string, { ohlc: any; live_ohlc?: any; last_price: number; volume?: number }> | null> {
    if (!symbols.length) return {};
    const sortedSymbols = [...symbols].sort();
    const cacheKey = `upstox_ohlc_quotes_${sortedSymbols.join(',')}_${interval}`;
    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch(`/api/python-nse/api/upstox/ohlc-quotes?symbols=${encodeURIComponent(symbols.join(','))}&interval=${encodeURIComponent(interval)}`);
          if (response.ok) {
            return await response.json();
          }
        } catch (err: unknown) {
          logger.error('Error fetching OHLC quotes:', err);
        }
        return null;
      },
      () => ({}),
      true // Force refresh to get real-time price quotes instead of 3-hour stale cache entries
    );
  }

  /**
   * Fetches actively traded options smartlist.
   */
  async getOptionsSmartlist(assetType: string = 'INDEX', category: string = 'TOP_TRADED', pageNumber?: number, pageSize?: number): Promise<SourceResult<any>> {
    const cap = useCapabilityStore.getState().capabilities['smartlists'];
    if (cap.state !== 'available') {
      return createSourceResult(null, null, 'smartlists');
    }
    const cacheKey = `upstox_smartlist_options_${assetType}_${category}_${pageNumber ?? 'none'}_${pageSize ?? 'none'}`;
    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          let url = `/api/python-nse/api/upstox/smartlist/options?asset_type=${encodeURIComponent(assetType)}&category=${encodeURIComponent(category)}`;
          if (pageNumber !== undefined) url += `&page_number=${pageNumber}`;
          if (pageSize !== undefined) url += `&page_size=${pageSize}`;
          const response = await fetch(url);
          if (response.ok) {
            const res = await response.json();
            if (res.error === 'entitlement_required') {
              useCapabilityStore.getState().setCapabilityState('smartlists', 'unavailable', 'Entitlement required for Smartlists.');
              return createSourceResult(res, null, 'smartlists');
            }
            return createSourceResult(res, null, 'smartlists');
          }
          throw new Error(response.statusText || 'Response not ok');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error('Error fetching options smartlist:', err);
          useCapabilityStore.getState().setCapabilityState('smartlists', 'unavailable', message);
        }
        return createSourceResult(null, null, 'smartlists');
      },
      () => createSourceResult(null, null, 'smartlists')
    );
  }

  /**
   * Fetches actively traded futures smartlist.
   */
  async getFuturesSmartlist(assetType: string = 'INDEX', category: string = 'TOP_TRADED', pageNumber?: number, pageSize?: number): Promise<SourceResult<any>> {
    const cap = useCapabilityStore.getState().capabilities['smartlists'];
    if (cap.state !== 'available') {
      return createSourceResult(null, null, 'smartlists');
    }
    const cacheKey = `upstox_smartlist_futures_${assetType}_${category}_${pageNumber ?? 'none'}_${pageSize ?? 'none'}`;
    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          let url = `/api/python-nse/api/upstox/smartlist/futures?asset_type=${encodeURIComponent(assetType)}&category=${encodeURIComponent(category)}`;
          if (pageNumber !== undefined) url += `&page_number=${pageNumber}`;
          if (pageSize !== undefined) url += `&page_size=${pageSize}`;
          const response = await fetch(url);
          if (response.ok) {
            const res = await response.json();
            if (res.error === 'entitlement_required') {
              useCapabilityStore.getState().setCapabilityState('smartlists', 'unavailable', 'Entitlement required for Smartlists.');
              return createSourceResult(res, null, 'smartlists');
            }
            return createSourceResult(res, null, 'smartlists');
          }
          throw new Error(response.statusText || 'Response not ok');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error('Error fetching futures smartlist:', err);
          useCapabilityStore.getState().setCapabilityState('smartlists', 'unavailable', message);
        }
        return createSourceResult(null, null, 'smartlists');
      },
      () => createSourceResult(null, null, 'smartlists')
    );
  }

  /**
   * Fetches MTF smartlist.
   */
  async getMTFSmartlist(pageNumber?: number, pageSize?: number): Promise<SourceResult<any>> {
    const cap = useCapabilityStore.getState().capabilities['smartlists'];
    if (cap.state !== 'available') {
      return createSourceResult(null, null, 'smartlists');
    }
    const cacheKey = `upstox_smartlist_mtf_${pageNumber ?? 'none'}_${pageSize ?? 'none'}`;
    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          let url = '/api/python-nse/api/upstox/smartlist/mtf';
          const params: string[] = [];
          if (pageNumber !== undefined) params.push(`page_number=${pageNumber}`);
          if (pageSize !== undefined) params.push(`page_size=${pageSize}`);
          if (params.length > 0) url += `?${params.join('&')}`;
          const response = await fetch(url);
          if (response.ok) {
            const res = await response.json();
            if (res.error === 'entitlement_required') {
              useCapabilityStore.getState().setCapabilityState('smartlists', 'unavailable', 'Entitlement required for Smartlists.');
              return createSourceResult(res, null, 'smartlists');
            }
            return createSourceResult(res, null, 'smartlists');
          }
          throw new Error(response.statusText || 'Response not ok');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error('Error fetching MTF smartlist:', err);
          useCapabilityStore.getState().setCapabilityState('smartlists', 'unavailable', message);
        }
        return createSourceResult(null, null, 'smartlists');
      },
      () => createSourceResult(null, null, 'smartlists')
    );
  }

  // Alias for backward compatibility if any
  async getMtfSmartlist(pageNumber?: number, pageSize?: number): Promise<SourceResult<any>> {
    return this.getMTFSmartlist(pageNumber, pageSize);
  }

  /**
   * Fetches market session timings for a specific date (YYYY-MM-DD).
   */
  async getMarketTimings(date: string): Promise<any> {
    const cap = useCapabilityStore.getState().capabilities['market-timings'];
    if (cap.state !== 'available') {
      return DEFAULT_MARKET_TIMINGS_FALLBACK;
    }
    const cacheKey = `upstox_market_timings_${date}`;
    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch(`/api/python-nse/api/upstox/market-timings?date=${encodeURIComponent(date)}`);
          if (response.ok) {
            const res = await response.json();
            return res.data || res;
          }
          throw new Error(response.statusText || 'Response not ok');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`Error fetching market timings for ${date}:`, err);
          useCapabilityStore.getState().setCapabilityState('market-timings', 'degraded', message);
        }
        return DEFAULT_MARKET_TIMINGS_FALLBACK;
      },
      () => DEFAULT_MARKET_TIMINGS_FALLBACK
    );
  }

  /**
   * Fetches list of expiry dates for a symbol.
   */
  async getExpiries(symbol: string, segment: string = 'options'): Promise<any> {
    const cacheKey = `upstox_expiries_${symbol}_${segment}`;
    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch(`/api/python-nse/api/upstox/expired/expiries?symbol=${encodeURIComponent(symbol)}&segment=${encodeURIComponent(segment)}`);
          if (response.ok) {
            const res = await response.json();
            return res.data || res;
          }
        } catch (err: unknown) {
          logger.error(`Error fetching expiries for ${symbol}:`, err);
        }
        return null;
      }
    );
  }

  /**
   * Fetches expired option contracts list by underlying and expiry date.
   */
  async getExpiredOptionContracts(symbol: string, expiry: string): Promise<any> {
    const cacheKey = `upstox_expired_options_${symbol}_${expiry}`;
    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch(`/api/python-nse/api/upstox/expired/option-contracts?symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}`);
          if (response.ok) {
            const res = await response.json();
            return res.data || res;
          }
        } catch (err: unknown) {
          logger.error(`Error fetching expired options for ${symbol} on ${expiry}:`, err);
        }
        return null;
      }
    );
  }

  /**
   * Fetches expired future contracts list by underlying and expiry date.
   */
  async getExpiredFutureContracts(symbol: string, expiry: string): Promise<any> {
    const cacheKey = `upstox_expired_futures_${symbol}_${expiry}`;
    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch(`/api/python-nse/api/upstox/expired/future-contracts?symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}`);
          if (response.ok) {
            const res = await response.json();
            return res.data || res;
          }
        } catch (err: unknown) {
          logger.error(`Error fetching expired futures for ${symbol} on ${expiry}:`, err);
        }
        return null;
      }
    );
  }

  /**
   * Fetches expired historical candles.
   */
  async getExpiredHistoricalCandles(instrumentKey: string, interval: string, fromDate: string, toDate: string): Promise<any> {
    const cacheKey = `upstox_expired_candles_${instrumentKey}_${interval}_${fromDate}_${toDate}`;
    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch(`/api/python-nse/api/upstox/expired/historical-candles?instrument_key=${encodeURIComponent(instrumentKey)}&interval=${encodeURIComponent(interval)}&from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`);
          if (response.ok) {
            const res = await response.json();
            return res.data || res;
          }
        } catch (err: unknown) {
          logger.error(`Error fetching expired candles for ${instrumentKey}:`, err);
        }
        return null;
      }
    );
  }

  /**
   * Fetches market holidays list.
   */
  async getMarketHolidays(): Promise<any> {
    const cacheKey = 'upstox_market_holidays';

    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch('/api/python-nse/api/upstox/market-holidays');
          if (response.ok) {
            const res = await response.json();
            return res.data || res;
          }
        } catch (err: unknown) {
          logger.error('Error fetching market holidays:', err);
        }
        return null;
      }
    );
  }

  /**
   * Fetches option greeks for a list of option instrument keys.
   */
  async getOptionGreeks(symbols: string[]): Promise<any> {
    if (!symbols.length) return {};
    const cacheKey = `upstox_option_greeks_${symbols.join(',')}`;
    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch(`/api/python-nse/api/upstox/option-greek?symbols=${encodeURIComponent(symbols.join(','))}`);
          if (response.ok) {
            return await response.json();
          }
        } catch (err: unknown) {
          logger.error('Error fetching option greeks:', err);
        }
        return null;
      }
    );
  }

  /**
   * Searches NSE EQ and FO instruments matching the query.
   */
  async searchInstruments(query: string): Promise<{ symbol: string; isin: string; instrument_key: string; exchange: string; lot_size: number }[]> {
    const q = query.trim().toUpperCase();
    if (!q) return [];

    try {
      const response = await fetch(`/api/python-nse/api/upstox/instruments/search?q=${encodeURIComponent(q)}`);
      if (response.ok) {
        return await response.json();
      }
    } catch (err: unknown) {
      logger.error('Error searching instruments:', err);
    }
    return [];
  }

  private async _flushQuoteBatch(): Promise<void> {
    this._quoteTimer = null;
    if (this._quotePending.size === 0) return;

    const pending = new Map(this._quotePending);
    this._quotePending.clear();

    const symbols = Array.from(pending.keys());
    try {
      const chunkSize = 100;
      const results: Record<string, UpstoxQuote> = {};

      for (let i = 0; i < symbols.length; i += chunkSize) {
        const chunk = symbols.slice(i, i + chunkSize);
        const symString = chunk.join(',');
        const response = await fetch(`/api/python-nse/api/upstox/quotes?symbols=${encodeURIComponent(symString)}`);
        if (response.ok) {
          const payload = await response.json();
          Object.assign(results, payload || {});
        } else {
          logger.error(`Quotes batch chunk fetch failed: ${response.statusText}`);
        }
      }

      for (const [sym, waiters] of pending.entries()) {
        const quote = results[sym] ?? null;
        if (quote) {
          // Cache individual quotes with upstoxCacheService so they can be retrieved individually
          upstoxCacheService.set(`upstox_quote_single_${sym}`, quote);
        }
        for (const { resolve } of waiters) {
          resolve([sym, quote]);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[UpstoxMarketDataService] Quotes batch failed:', err);
      useCapabilityStore.getState().setCapabilityState('quotes', 'degraded', message);
      for (const [sym, waiters] of pending.entries()) {
        for (const { resolve } of waiters) {
          resolve([sym, null]);
        }
      }
    }
  }

  private _volAvgCache: { data: Record<string, any>; timestamp: number } | null = null;
  private _volAvgPromise: Promise<Record<string, any>> | null = null;

  /**
   * Fetches 20d volume averages for all symbols with a 12-hour in-memory and sessionStorage cache.
   * Prevents repeated queries across components, page navigation, and background intervals.
   */
  async getAllVolumeAverages(): Promise<Record<string, any>> {
    const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
    const now = Date.now();

    if (this._volAvgCache && (now - this._volAvgCache.timestamp) < CACHE_TTL_MS) {
      return this._volAvgCache.data;
    }

    try {
      const stored = sessionStorage.getItem('upstox_vol_avg_all');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.timestamp && (now - parsed.timestamp) < CACHE_TTL_MS && parsed.data) {
          this._volAvgCache = parsed;
          return parsed.data;
        }
      }
    } catch {
      // ignore storage access errors
    }

    if (this._volAvgPromise) {
      return this._volAvgPromise;
    }

    this._volAvgPromise = (async () => {
      try {
        const res = await fetch('/api/python-nse/api/upstox/historical/volume-avg/all');
        if (res.ok) {
          const data = await res.json();
          this._volAvgCache = { data, timestamp: Date.now() };
          try {
            sessionStorage.setItem('upstox_vol_avg_all', JSON.stringify(this._volAvgCache));
          } catch {
            // ignore quota errors
          }
          return data;
        }
        return this._volAvgCache?.data || {};
      } catch (err) {
        logger.warn('Failed to load volume averages:', err);
        return this._volAvgCache?.data || {};
      } finally {
        this._volAvgPromise = null;
      }
    })();

    return this._volAvgPromise;
  }

  private _cashSnapshotCache: { data: any; timestamp: number } | null = null;

  /**
   * Fetches the pre-computed Cash Engine 2.0 snapshot for ~660 liquid NSE Cash equities.
   * Enables instant sub-30ms hydration of live quotes, VWAP, ADV, and HOD retention.
   */
  async getCashUniverseSnapshot(forceRefresh: boolean = false): Promise<any> {
    const CACHE_TTL_MS = 10 * 1000; // 10 seconds cache
    const now = Date.now();

    if (!forceRefresh && this._cashSnapshotCache && (now - this._cashSnapshotCache.timestamp) < CACHE_TTL_MS) {
      return this._cashSnapshotCache.data;
    }

    try {
      const res = await fetch('/api/python-nse/api/alpha/cash-snapshot');
      if (res.ok) {
        const json = await res.json();
        if (json && json.status === 'success' && json.data) {
          this._cashSnapshotCache = { data: json.data, timestamp: Date.now() };
          return json.data;
        }
      }
      return this._cashSnapshotCache?.data || null;
    } catch (err) {
      logger.warn('Failed to load cash universe snapshot:', err);
      return this._cashSnapshotCache?.data || null;
    }
  }

  /**
   * Fetches intraday 5-minute candles and verifies the 5 Upstox Reality Checks
   * (Anti-Dump HOD Retention, VWAP defense, multi-candle stability).
   */
  async get5mIntradayAnalysis(symbol: string): Promise<any> {
    try {
      const cleanSym = encodeURIComponent(symbol.trim().toUpperCase());
      const res = await fetch(`/api/python-nse/api/alpha/upstox-5m-candles?symbol=${cleanSym}`);
      if (res.ok) {
        return await res.json();
      }
      return null;
    } catch (err) {
      logger.warn(`Failed to fetch 5m analysis for ${symbol}:`, err);
      return null;
    }
  }
}

export const upstoxMarketDataService = new UpstoxMarketDataService();
