// PnseaService.ts
import { logger } from './Logger';
import { upstoxCacheService } from './UpstoxCacheService';

export interface DeliveryData {
  Date: string; // YYYY-MM-DD
  Close: number;
  Delivery_Pct: number;
  Deliverable_Qty: number;
  Volume: number;
  Trades: number;
}

export interface InsiderTransaction {
  symbol: string;
  acquirer_name: string;
  sec_type: string;
  sec_val: number;
  action: 'Buy' | 'Sell' | string;
  trans_type: string;
  date: string; // YYYY-MM-DD
  qty: number;
  post_share: number;
  post_pct: number;
  created_at?: string;
}

export interface PledgedData {
  symbol: string;
  company_name: string;
  total_shares: number;
  promoter_shares: number;
  pledged_shares: number;
  pledged_pct: number;
  updated_at: string; // YYYY-MM-DD
}

export interface MfInsiderTransaction {
  id?: number;
  symbol: string;
  scheme_name: string;
  buy_sell: 'Buy' | 'Sell' | string;
  qty: number;
  value: number;
  date: string; // YYYY-MM-DD
  isin: string;
}

export interface DeliveryRadarItem {
  symbol: string;
  latest_date: string;
  close: number;
  delivery_pct: number;
  volume: number;
  avg_delivery_pct: number;
  avg_volume: number;
  is_rising: boolean;
  deviation: number;
}

export interface ScanProgress {
  is_scanning: boolean;
  total: number;
  current: number;
  current_symbol: string;
  error_count: number;
  last_completed: string | null;
}

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

const TTL_3_MIN = 3 * 60 * 1000;
const TTL_15_MIN = 15 * 60 * 1000;
const TTL_5_MIN = 5 * 60 * 1000;

class PnseaService {
  private static instance: PnseaService;
  private readonly BASE_URL = '/api/python-nse/api/nse';

  private constructor() {}

  static getInstance(): PnseaService {
    if (!PnseaService.instance) {
      PnseaService.instance = new PnseaService();
    }
    return PnseaService.instance;
  }

  private getCached<T>(key: string, ttl: number): T | null {
    try {
      const data = sessionStorage.getItem(key);
      if (!data) return null;
      const entry: CacheEntry<T> = JSON.parse(data);
      if (Date.now() - entry.timestamp < ttl) {
        return entry.value;
      }
      sessionStorage.removeItem(key);
    } catch (e) {
      logger.error('[PnseaService] Failed to read sessionStorage cache', e);
    }
    return null;
  }

  private setCached<T>(key: string, value: T): void {
    try {
      const entry: CacheEntry<T> = {
        value,
        timestamp: Date.now(),
      };
      sessionStorage.setItem(key, JSON.stringify(entry));
    } catch (e) {
      logger.error('[PnseaService] Failed to set sessionStorage cache', e);
    }
  }

  /**
   * Fetches raw option chain via stealth bridge.
   * Matches raw NSE output structure.
   */
  async fetchOptionChain(symbol: string, force = false): Promise<any> {
    const cacheKey = `pnsea_option_${symbol}`;

    return upstoxCacheService.executeWithCache(
      cacheKey,
      async () => {
        try {
          const response = await fetch(`${this.BASE_URL}/option-chain?symbol=${encodeURIComponent(symbol)}`);
          if (!response.ok) {
            throw new Error(`Python Bridge option chain returned status ${response.status}`);
          }
          return await response.json();
        } catch (error) {
          logger.error(`[PnseaService] Failed to fetch option chain for ${symbol}`, error);
          throw error;
        }
      }
    );
  }

  /**
   * Fetches historical delivery percentage data.
   */
  async fetchDeliveryHistory(
    symbol: string,
    fromDate?: string,
    toDate?: string,
    force = false
  ): Promise<DeliveryData[]> {
    const cacheKey = `pnsea_delivery_${symbol}_${fromDate || 'default'}_${toDate || 'default'}`;
    if (!force) {
      const cached = this.getCached<DeliveryData[]>(cacheKey, TTL_15_MIN);
      if (cached) return cached;
    }

    try {
      let url = `${this.BASE_URL}/delivery-history?symbol=${symbol}`;
      if (fromDate) url += `&from_date=${fromDate}`;
      if (toDate) url += `&to_date=${toDate}`;
      if (force) url += `&force=true`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Python Bridge delivery history returned status ${response.status}`);
      }
      const data = await response.json();
      this.setCached(cacheKey, data);
      return data;
    } catch (error) {
      logger.error(`[PnseaService] Failed to fetch delivery history for ${symbol}`, error);
      return [];
    }
  }

  /**
   * Fetches insider trading deals (Promoter buys/sells).
   */
  async fetchInsiderTrading(
    symbol?: string,
    fromDate?: string,
    toDate?: string,
    force = false
  ): Promise<InsiderTransaction[]> {
    const cacheKey = `pnsea_insider_${symbol || 'all'}_${fromDate || 'default'}_${toDate || 'default'}`;
    if (!force) {
      const cached = this.getCached<InsiderTransaction[]>(cacheKey, TTL_15_MIN);
      if (cached) return cached;
    }

    try {
      let url = `${this.BASE_URL}/insider-trading`;
      const params: string[] = [];
      if (symbol) params.push(`symbol=${symbol}`);
      if (fromDate) params.push(`from_date=${fromDate}`);
      if (toDate) params.push(`to_date=${toDate}`);
      if (force) params.push(`force=true`);

      if (params.length > 0) {
        url += `?${params.join('&')}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Python Bridge insider trading returned status ${response.status}`);
      }
      const data = await response.json();
      this.setCached(cacheKey, data);
      return data;
    } catch (error) {
      logger.error(`[PnseaService] Failed to fetch insider trading data`, error);
      return [];
    }
  }

  /**
   * Fetches promoter pledged shares.
   */
  async fetchPledgedShares(symbol: string, force = false): Promise<PledgedData | null> {
    const cacheKey = `pnsea_pledged_${symbol}`;
    if (!force) {
      const cached = this.getCached<PledgedData>(cacheKey, TTL_15_MIN);
      if (cached) return cached;
    }

    try {
      let url = `${this.BASE_URL}/pledged-shares?symbol=${symbol}`;
      if (force) url += `&force=true`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Python Bridge pledged shares returned status ${response.status}`);
      }
      const data = await response.json();
      this.setCached(cacheKey, data);
      return data;
    } catch (error) {
      logger.error(`[PnseaService] Failed to fetch pledged shares for ${symbol}`, error);
      return null;
    }
  }

  /**
   * Fetches Mutual Fund insider flows.
   */
  async fetchMfInsider(symbol?: string, isin?: string, force = false): Promise<MfInsiderTransaction[]> {
    const cacheKey = `pnsea_mf_${symbol || 'all'}_${isin || 'default'}`;
    if (!force) {
      const cached = this.getCached<MfInsiderTransaction[]>(cacheKey, TTL_15_MIN);
      if (cached) return cached;
    }

    try {
      let url = `${this.BASE_URL}/mf-insider`;
      const params: string[] = [];
      if (symbol) params.push(`symbol=${symbol}`);
      if (isin) params.push(`isin=${isin}`);
      if (force) params.push(`force=true`);

      if (params.length > 0) {
        url += `?${params.join('&')}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Python Bridge MF insider returned status ${response.status}`);
      }
      const data = await response.json();
      this.setCached(cacheKey, data);
      return data;
    } catch (error) {
      logger.error(`[PnseaService] Failed to fetch MF insider flows`, error);
      return [];
    }
  }

  /**
   * Fetches the compiled delivery radar data from cache.
   */
  async fetchDeliveryRadar(force = false): Promise<DeliveryRadarItem[]> {
    const cacheKey = 'pnsea_delivery_radar';
    if (!force) {
      const cached = this.getCached<DeliveryRadarItem[]>(cacheKey, TTL_5_MIN);
      if (cached) return cached;
    }

    try {
      const response = await fetch(`${this.BASE_URL}/delivery-radar`);
      if (!response.ok) {
        throw new Error(`Python Bridge delivery radar returned status ${response.status}`);
      }
      const data = await response.json();
      this.setCached(cacheKey, data);
      return data;
    } catch (error) {
      logger.error(`[PnseaService] Failed to fetch delivery radar`, error);
      return [];
    }
  }

  /**
   * Fetches scanning progress details.
   */
  async fetchScanProgress(): Promise<ScanProgress> {
    try {
      const response = await fetch(`${this.BASE_URL}/delivery-radar/scan-progress`);
      if (!response.ok) {
        throw new Error(`Python Bridge scan progress returned status ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      logger.error(`[PnseaService] Failed to fetch scan progress`, error);
      throw error;
    }
  }

  /**
   * Triggers the delivery history scan task on the background.
   */
  async triggerRadarScan(symbols?: string[]): Promise<any> {
    try {
      const url = `${this.BASE_URL}/delivery-radar/scan`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: symbols ? JSON.stringify(symbols) : undefined,
      });

      if (!response.ok) {
        throw new Error(`Python Bridge trigger scan returned status ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      logger.error(`[PnseaService] Failed to trigger radar scan`, error);
      throw error;
    }
  }

  /**
   * Cancels the currently running background scan.
   */
  async cancelRadarScan(): Promise<any> {
    try {
      const response = await fetch(`${this.BASE_URL}/delivery-radar/cancel`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(`Python Bridge cancel scan returned status ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      logger.error(`[PnseaService] Failed to cancel radar scan`, error);
      throw error;
    }
  }
}

export const pnseaService = PnseaService.getInstance();
