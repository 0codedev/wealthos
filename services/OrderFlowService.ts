import { logger } from './Logger';

export interface OrderFlowTick {
  symbol: string;
  timestamp: string;
  time_slot: string;
  option_synergy: number;
  price_aggression: number;
  composite_val: number;
  p_inst: number;
  spot_price: number;
  r_factor: number;
  apex_signal: 'NEUTRAL' | 'EXHAUSTION_APEX' | 'ACCUMULATION_APEX';
}

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

const TTL_1_MIN = 60 * 1000;
const TTL_5_MIN = 5 * 60 * 1000;

class OrderFlowService {
  private static instance: OrderFlowService;
  private readonly BASE_URL = '/api/python-nse/api/nse/orderflow';

  private constructor() {}

  static getInstance(): OrderFlowService {
    if (!OrderFlowService.instance) {
      OrderFlowService.instance = new OrderFlowService();
    }
    return OrderFlowService.instance;
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
      logger.error('[OrderFlowService] Failed to read sessionStorage cache', e);
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
      logger.error('[OrderFlowService] Failed to set sessionStorage cache', e);
    }
  }

  /**
   * Fetches the current live R-Factor, Apex signal, spot price, and Greeks.
   */
  async getLiveOrderFlow(symbol: string, forceRefresh = false): Promise<OrderFlowTick> {
    const cleanSymbol = symbol.toUpperCase().trim();
    const cacheKey = `orderflow_live_${cleanSymbol}`;
    
    if (!forceRefresh) {
      const cached = this.getCached<OrderFlowTick>(cacheKey, TTL_1_MIN);
      if (cached) return cached;
    }

    try {
      // encodeURIComponent ensures M&M → M%26M (& is URL separator without encoding)
      const response = await fetch(`${this.BASE_URL}/live?symbol=${encodeURIComponent(cleanSymbol)}`);
      if (!response.ok) {
        throw new Error(`OrderFlowService: Failed to fetch live data: ${response.statusText}`);
      }
      const data: OrderFlowTick = await response.json();
      this.setCached(cacheKey, data);
      return data;
    } catch (error) {
      logger.error(`[OrderFlowService] getLiveOrderFlow failed for ${cleanSymbol}`, error);
      throw error;
    }
  }

  /**
   * Fetches today's order flow ticks timeline for charts.
   */
  async getOrderFlowHistory(symbol: string, date?: string, forceRefresh = false): Promise<OrderFlowTick[]> {
    const cleanSymbol = symbol.toUpperCase().trim();
    const cacheKey = `orderflow_hist_${cleanSymbol}_${date || 'today'}`;

    if (!forceRefresh) {
      const cached = this.getCached<OrderFlowTick[]>(cacheKey, TTL_5_MIN);
      if (cached) return cached;
    }

    try {
      let url = `${this.BASE_URL}/history?symbol=${encodeURIComponent(cleanSymbol)}`;
      if (date) {
        url += `&date=${date}`;
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`OrderFlowService: Failed to fetch history data: ${response.statusText}`);
      }
      const data: OrderFlowTick[] = await response.json();
      this.setCached(cacheKey, data);
      return data;
    } catch (error) {
      logger.error(`[OrderFlowService] getOrderFlowHistory failed for ${cleanSymbol}`, error);
      throw error;
    }
  }

  /**
   * Updates the active order flow watchlist on the backend.
   */
  async updateWatchlist(symbols: string[]): Promise<string[]> {
    try {
      const response = await fetch(`${this.BASE_URL}/watchlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ symbols }),
      });
      if (!response.ok) {
        throw new Error(`OrderFlowService: Failed to update watchlist: ${response.statusText}`);
      }
      const result = await response.json();
      return result.watchlist || [];
    } catch (error) {
      logger.error('[OrderFlowService] updateWatchlist failed', error);
      throw error;
    }
  }

  /**
   * Fetch the latest order flow records for a list of symbols in bulk.
   */
  async getLatestOrderFlowBulk(symbols: string[]): Promise<Record<string, OrderFlowTick>> {
    if (symbols.length === 0) return {};
    try {
      const response = await fetch(`${this.BASE_URL}/latest-bulk?symbols=${symbols.join(',')}`);
      if (!response.ok) {
        throw new Error(`OrderFlowService: Failed to fetch bulk live ticks: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      logger.error('[OrderFlowService] getLatestOrderFlowBulk failed', error);
      return {};
    }
  }
}

export const orderFlowService = OrderFlowService.getInstance();
