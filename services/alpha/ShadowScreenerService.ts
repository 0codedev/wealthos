// ShadowScreenerService.ts

export interface CandlestickPattern {
  symbol_name: string;
  pattern_type: string;
  pattern_sentiment: 'Bullish' | 'Bearish';
  candle_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  change_percent: number;
  last_trade_price: number;
  volume: number;
}

export interface CandlestickResponse {
  status: number;
  message: string;
  data: {
    available_pattens: string[];
    [key: string]: any;
  };
}

export interface ResultsCalendarItem {
  scrip_code: string;
  symbol: string;
  long_name: string;
  meeting_date: string;
  last_trade_price: number;
  change: number;
  change_percent: number;
}

export interface ShareholdingActivityItem {
  symbol_name: string;
  period_date: string;
  fii_hold: string;
  change_in_fii_hold: string;
  promoters_hold: string;
  change_in_promoters_hold: string;
  cmp: string;
  stock_pe: string;
  market_cap: string;
  div_yield: string;
  np_qtr: string;
  qtr_profit_var: string;
  sales_qtr: string;
  qtr_sales_var: string;
  roce: string;
  last_trade_price: string;
  change: string;
  change_percent: string;
  ownership_momentum_score?: number;
  dii_hold?: string;
  change_in_dii_hold?: string;
}

export interface QualityScoreItem {
  symbol_name: string;
  company_name: string;
  cmp: string;
  market_cap: string;
  sector: string;
  total_score: string;
  rating: string;
  valuation_score: string;
  growth_score: string;
  profitability_score: string;
  cash_flow_score: string;
  financial_strength_score: string;
  management_score: string;
  moat_score: string;
  risk_score: string;
  momentum_score: string;
  selected_score: string;
  intrinsic_value: string;
  div_yield: string;
  roce: string;
  roe: string;
  stock_pe: string;
}

export interface IntradayBoosterItem {
  symbol_name: string;
  time: string;
  current_score: number;
  trend: 'Bullish' | 'Bearish';
  last_trade_price: number;
  change: number;
  change_percent: number;
}

export interface LotSizeItem {
  underlying: string;
  symbol: string;
  created_at: string;
  month_data: string; // JSON string like '{"MAY-26": "500", "JUN-26": "500"}'
  last_trade_price: number;
  change: number;
  change_percent: number;
}

export interface FiiDiiFlowsItem {
  date: string;
  fii_cash: {
    category: 'DII' | 'FII/FPI';
    net_value: number;
    created_at: string;
  }[];
  fii_oi: {
    type: string;
    net_amount: number;
    created_at: string;
  }[];
  indices: {
    symbol_name: string;
    last_trade_price: number;
    change: number;
    change_percent: number;
    created_at: string;
  }[];
}

export interface ParticipantOiItem {
  fao_id: number;
  client_type: 'Client' | 'DII' | 'FII' | 'Pro' | 'TOTAL';
  future_index_long: number;
  future_index_short: number;
  future_stock_long: number;
  future_stock_short: number;
  option_index_call_long: number;
  option_index_put_long: number;
  option_index_call_short: number;
  option_index_put_short: number;
  option_stock_call_long: number;
  option_stock_put_long: number;
  option_stock_call_short: number;
  option_stock_put_short: number;
  total_long_contracts: number;
  total_short_contracts: number;
  created_at: string;
  date: string;
  prev_fao_id?: number;
  prev_client_type?: string;
  prev_future_index_long?: number;
  prev_future_index_short?: number;
  prev_future_stock_long?: number;
  prev_future_stock_short?: number;
  prev_option_index_call_long?: number;
  prev_option_index_put_long?: number;
  prev_option_index_call_short?: number;
  prev_option_index_put_short?: number;
  prev_option_stock_call_long?: number;
  prev_option_stock_put_long?: number;
  prev_option_stock_call_short?: number;
  prev_option_stock_put_short?: number;
  prev_total_long_contracts?: number;
  prev_total_short_contracts?: number;
  prev_created_at?: string;
  prev_date?: string;
  nifty50?: number;
}

export interface DerivativeSummaryItem {
  symbol_name: string;
  expiry_date: string;
  oi: number;
  change_oi: number;
  change_oi_per: number;
  open: number;
  high: number;
  low: number;
  last_price: number;
  change_ltp: number;
  change_ltp_per: number;
  last_trade_time: string;
  built_up: 'long_build_up' | 'short_covering' | 'short_build_up' | 'long_unwinding';
}

export interface RawHistoricalData {
  symbol_name: string;
  change_percent: number | string;
  today_close: number | string;
  today_low: number | string;
  today_high: number | string;
  today_volume: number | string;
  today_open: number | string;
  prev_close: number | string;
}

export interface PrebuildScreen {
  query_id: number;
  title: string;
  description: string;
  backend_query: string;
  frontend_query: string;
}

export interface PrebuildScreensResponse {
  status: number;
  message: string;
  data: Record<string, PrebuildScreen[]>;
}

export interface CrossFilterResultItem {
  symbol_name: string;
  price: string | number;
  previous_close: string | number;
  change_amount: string | number;
  change_percent: string | number;
  signal_date: string;
  [metricKey: string]: any;
}

export interface CrossFilterResponse {
  status: number;
  message: string;
  data: {
    Indicatorslabel: string;
    condition: string;
    timeframe: string;
    isNextPageAvailable: boolean;
    total: number;
    page: number;
    limit: number;
    results: Record<string, CrossFilterResultItem[]>;
  };
}

export class ShadowScreenerService {
  private static readonly BASE_URL = '/api/stockezee/api/nse-candle-sticks';
  private static cachedBuildId: string | null = null;


  /**
   * Fetches candlestick patterns (Daily/Weekly)
   */
  static async fetchPatterns(token: string, timeframe: 'daily' | 'weekly'): Promise<CandlestickResponse> {
    const endpoint = timeframe === 'daily' ? 'per-day-patterns' : 'per-week-patterns';
    try {
      const response = await fetch(`${this.BASE_URL}/${endpoint}`, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
          'x-stockezee-token': token.trim()
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[ShadowScreenerService] Error fetching candlestick patterns:', error);
      throw error;
    }
  }

  /**
   * Fetches historical gainers or losers
   * Endpoint: https://webapi.niftytrader.in/webapi/Symbol/top-gainers-historical-data
   */
  static async fetchHistoricalPerformance(
    token: string,
    type: 'gainers' | 'loosers',
    timeframe: 'day' | 'week' | 'month' | 'year'
  ): Promise<any> {
    try {
      const url = `/api/sz-pulse/webapi/Symbol/top-gainers-historical-data?range_type=${type}&range_days=${timeframe}`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
          'x-stockezee-token': token.trim()
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[ShadowScreenerService] Error fetching historical ${type}:`, error);
      throw error;
    }
  }

  /**
   * Fetches ORB (Opening Range Breakout) data
   * Endpoint: https://api.stockezee.com/api/Analysis/orb-breakout/orb/[prb/][minutes]
   */
  static async fetchORB(
    token: string,
    minutes: 15 | 30 | 45 | 60,
    withPrb: boolean = false
  ): Promise<any> {
    try {
      const typePath = withPrb ? 'orb/prb' : 'orb';
      const url = `/api/sz-sector/api/Analysis/orb-breakout/${typePath}/${minutes}`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
          'x-stockezee-token': token.trim()
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[ShadowScreenerService] Error fetching ORB ${minutes}m:`, error);
      throw error;
    }
  }

  /**
   * Fetches Valuation (Overvalued/Undervalued) data
   * Endpoint: https://api.stockezee.com/api/stock/score/by-valuation?valuation_type=[over_valued/under_valued]
   */
  static async fetchValuation(
    token: string,
    type: 'over_valued' | 'under_valued'
  ): Promise<any> {
    try {
      // Use webapi.stockezee.com proxy (/api/stockezee) as per user request
      const url = `/api/stockezee/api/stock/score/by-valuation?valuation_type=${type}`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
          'x-stockezee-token': token.trim()
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[ShadowScreenerService] Error fetching ${type} stocks:`, error);
      throw error;
    }
  }

  /**
   * Transforms StockeZee candlestick data into internal StockData format
   */
  static transformToStockData(patterns: CandlestickPattern[]): any[] {
    return (patterns || []).map(p => {
      const changePct = Number(p.change_percent) || 0;
      const ltp = Number(p.last_trade_price) || 0;
      const low = Number(p.low) || 0;
      const high = Number(p.high) || 0;
      const volume = Number(p.volume) || 0;

      return {
        Symbol: p.symbol_name,
        LTP: ltp,
        Change: changePct,
        "Strength Factor": Math.abs(changePct) * 10,
        Volume: volume,
        Open: Number(p.open) || 0,
        High: high,
        Low: low,
        Close: Number(p.close) || 0,
        CompanyName: '',
        Sector: '',
        prevClose: (Number(p.close) || 0) - (Number(p.change) || 0),
        todayOpen: Number(p.open) || 0,
        sentiment: p.pattern_sentiment
      };
    });
  }

  /**
   * Transforms historical gainers/losers data into StockData format
   */
  static transformHistoricalToStockData(data: RawHistoricalData[]): any[] {
    return (data || []).map(p => {
      const changePct = Number(p.change_percent) || 0;
      const ltp = Number(p.today_close) || 0;
      const low = Number(p.today_low) || 0;
      const high = Number(p.today_high) || 0;
      const volume = Number(p.today_volume) || 0;

      return {
        Symbol: p.symbol_name,
        LTP: ltp,
        Change: changePct,
        "Strength Factor": Math.abs(changePct) * 10,
        Volume: volume,
        Open: Number(p.today_open) || 0,
        High: high,
        Low: low,
        Close: ltp,
        CompanyName: '',
        Sector: '',
        prevClose: Number(p.prev_close) || 0,
        todayOpen: Number(p.today_open) || 0,
        sentiment: changePct >= 0 ? 'Bullish' : 'Bearish'
      };
    });
  }

  /**
   * Transforms ORB data into StockData format with extra fields
   */
  static transformORBToStockData(data: any[]): any[] {
    return (data || []).map(p => {
      const changePct = Number(p.change_percent) || 0;
      const ltp = Number(p.last_trade_price) || 0;

      return {
        Symbol: p.symbol_name,
        LTP: ltp,
        Change: changePct,
        "Strength Factor": Math.abs(changePct) * 10,
        Volume: Number(p.volume) || 0,
        Open: Number(p.open) || 0,
        High: Number(p.high) || 0,
        Low: Number(p.low) || 0,
        Close: ltp,
        orbPrice: Number(p.orb_price) || 0,
        orbTime: p.orb_time || 'N/A',
        breakout: p.breakout || 'N/A',
        sentiment: p.breakout === 'Bullish' ? 'Bullish' : 'Bearish'
      };
    });
  }

  /**
   * Transforms Valuation data into internal format
   */
  static transformValuationToStockData(data: any[]): any[] {
    return (data || []).map(p => {
      const price = Number(p.last_trade_price) || 0;
      const intrinsic = Number(p.intrinsic_value) || 0;
      const upside = price > 0 ? ((intrinsic - price) / price) * 100 : 0;

      return {
        Symbol: p.symbol_name,
        LTP: price,
        intrinsicValue: intrinsic,
        upside: upside,
        roce: Number(p.roce_per) || 0,
        roe: Number(p.roe_per) || 0,
        eps: Number(p.eps) || 0,
        pbRatio: Number(p.pb_ann) || 0,
        marketCap: Number(p.market_cap) || 0,
        Change: upside, // Reusing Change for sorting/filtering consistency if needed
        "Strength Factor": Math.abs(upside),
        sentiment: upside >= 0 ? 'Bullish' : 'Bearish'
      };
    });
  }

  /**
   * Fetches Upcoming Results Calendar
   * Endpoint: https://api.stockezee.com/api/v1/Resource/forth-comming-result
   */
  static async fetchResultsCalendar(token: string): Promise<ResultsCalendarItem[]> {
    try {
      const url = `/api/sz-sector/api/v1/Resource/forth-comming-result`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
          'x-stockezee-token': token.trim(),
          'platform_type': '1'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const json = await response.json();
      return json.resultData || [];
    } catch (error) {
      console.error('[ShadowScreenerService] Error fetching results calendar:', error);
      throw error;
    }
  }

  /**
   * Fetches Shareholding Activity (FII/Promoter Buy/Sell)
   * Endpoint: https://webapi.stockezee.com/api/stock/shareholding?investor_type=[fii/promoter]&transaction_type=[buy/sell]
   */
  static async fetchShareholdingActivity(
    token: string,
    investorType: 'fii' | 'promoter',
    transactionType: 'buy' | 'sell'
  ): Promise<ShareholdingActivityItem[]> {
    try {
      const url = `/api/stockezee/api/stock/shareholding?investor_type=${investorType}&transaction_type=${transactionType}`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
          'x-stockezee-token': token.trim(),
          'platform_type': '1'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const json = await response.json();
      return json.data || [];
    } catch (error) {
      console.error(`[ShadowScreenerService] Error fetching ${investorType} ${transactionType} activity:`, error);
      throw error;
    }
  }

  /**
   * Fetches Stock Quality Scorecard
   * Endpoint: https://webapi.stockezee.com/api/stock/score/by-score?scoreType=[TYPE]&filter=[high/low]
   */
  static async fetchQualityScorecard(
    token: string,
    scoreType: string,
    filter: 'high' | 'low'
  ): Promise<QualityScoreItem[]> {
    try {
      const url = `/api/stockezee/api/stock/score/by-score?scoreType=${scoreType}&filter=${filter}`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
          'x-stockezee-token': token.trim(),
          'platform_type': '1'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const json = await response.json();
      return json.data?.stocks || [];
    } catch (error) {
      console.error(`[ShadowScreenerService] Error fetching ${scoreType} quality scores:`, error);
      throw error;
    }
  }

  /**
   * Fetches StockeZee Intraday Booster (Live F&O Breakout Scanner)
   * Endpoint: https://api.stockezee.com/api/Symbol/orb-range?type=marking
   */
  static async fetchIntradayBooster(token: string): Promise<IntradayBoosterItem[]> {
    try {
      const url = `/api/sz-sector/api/Symbol/orb-range?type=marking`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
          'x-stockezee-token': token.trim(),
          'platform_type': '1'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const json = await response.json();
      return json.resultData || [];
    } catch (error) {
      console.error('[ShadowScreenerService] Error fetching Intraday Booster:', error);
      throw error;
    }
  }

  /**
   * Transforms StockeZee Intraday Booster data into internal StockData format
   */
  static transformIntradayBoosterToStockData(data: any[]): any[] {
    return (data || []).map(p => {
      const changePct = Number(p.change_percent) || 0;
      const ltp = Number(p.last_trade_price) || 0;
      const change = Number(p.change) || 0;
      const score = Number(p.current_score) || 0;

      return {
        Symbol: p.symbol_name,
        LTP: ltp,
        Change: changePct,
        "Strength Factor": score,
        Volume: 0, // Not present in markings JSON
        Open: ltp - change,
        High: Math.max(ltp, ltp - change),
        Low: Math.min(ltp, ltp - change),
        Close: ltp,
        CompanyName: '',
        Sector: '',
        prevClose: ltp - change,
        todayOpen: ltp - change,
        sentiment: p.trend === 'Bullish' ? 'Bullish' : 'Bearish',
        trend: p.trend || 'Bullish',
        time: p.time || 'N/A',
        change: change
      };
    });
  }

  /**
   * Fetches F&O Lot Sizes
   * Endpoint: https://api.stockezee.com/api/v1/Resource/fno-lot-size
   */
  static async fetchLotSizes(token: string): Promise<LotSizeItem[]> {
    try {
      const url = `/api/sz-sector/api/v1/Resource/fno-lot-size`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
          'x-stockezee-token': token.trim(),
          'platform_type': '1'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const json = await response.json();
      return json.resultData?.data || [];
    } catch (error) {
      console.error('[ShadowScreenerService] Error fetching F&O lot sizes:', error);
      throw error;
    }
  }

  /**
   * Parses Near-Month Lot Size from month_data JSON string or object
   */
  static getActiveLotSize(monthData: any): number {
    try {
      if (!monthData) return 0;
      let parsed: any;
      if (typeof monthData === 'string') {
        parsed = JSON.parse(monthData);
      } else {
        parsed = monthData;
      }
      const keys = Object.keys(parsed);
      if (keys.length > 0) {
        const val = parsed[keys[0]];
        const parsedVal = parseInt(val, 10);
        return isNaN(parsedVal) ? 0 : parsedVal;
      }
    } catch (e) {
      const parsedVal = parseInt(monthData, 10);
      if (!isNaN(parsedVal)) return parsedVal;
    }
    return 0;
  }

  static async getBuildId(): Promise<string> {
    if (this.cachedBuildId) {
      return this.cachedBuildId;
    }
    try {
      const response = await fetch('/api/stockezee-web/fii-dii-data');
      if (!response.ok) throw new Error(`HTML fetch status: ${response.status}`);
      const html = await response.text();

      const match = html.match(/"buildId"\s*:\s*"([^"]+)"/);
      if (match && match[1]) {
        this.cachedBuildId = match[1];
        console.log('[ShadowScreenerService] Extracted dynamic buildId:', this.cachedBuildId);
        return this.cachedBuildId;
      }

      const scriptMatch = html.match(/_next\/static\/([^/]+)\/_buildManifest\.js/);
      if (scriptMatch && scriptMatch[1]) {
        this.cachedBuildId = scriptMatch[1];
        console.log('[ShadowScreenerService] Extracted buildId from buildManifest path:', this.cachedBuildId);
        return this.cachedBuildId;
      }
    } catch (e) {
      console.warn('[ShadowScreenerService] Failed to extract dynamic buildId, using static fallback:', e);
    }
    return 'XuR99BT9I8NXtlS6BSvXU';
  }

  /**
   * Fetches FII-DII Daily Flows & Pulse
   */
  static async fetchFiiDiiPulse(token: string): Promise<FiiDiiFlowsItem[]> {
    try {
      const buildId = await this.getBuildId();
      const url = `/api/stockezee-web/_next/data/${buildId}/fii-dii-data.json`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        }
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const json = await response.json();
      return json.pageProps?.initialData || json.pageProps?.fiiDiiPulse || [];
    } catch (error) {
      console.warn('[ShadowScreenerService] Live FII-DII fetch failed, trying local fallback:', error);
      try {
        const fallbackResponse = await fetch('/data/fii-dii.json');
        if (!fallbackResponse.ok) throw new Error(`Fallback HTTP error! status: ${fallbackResponse.status}`);
        const text = await fallbackResponse.text();
        const cleanText = text.substring(text.indexOf('{'));
        const json = JSON.parse(cleanText);
        return json.pageProps?.initialData || json.pageProps?.fiiDiiPulse || [];
      } catch (fallbackError) {
        console.error('[ShadowScreenerService] FII-DII fallback fetch also failed:', fallbackError);
        throw fallbackError;
      }
    }
  }

  /**
   * Fetches Participant Open Interest (OI) Chart Data
   */
  static async fetchParticipantOiData(token: string): Promise<ParticipantOiItem[]> {
    try {
      const url = `/api/sz-pulse/webapi/Resource/participant-oi-chart-data`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
          'x-stockezee-token': token.trim(),
          'platform_type': '1'
        }
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const json = await response.json();
      return json.resultData?.data || [];
    } catch (error) {
      console.warn('[ShadowScreenerService] Live Participant OI fetch failed, trying local fallback:', error);
      try {
        const fallbackResponse = await fetch('/data/oichartdata.json');
        if (!fallbackResponse.ok) throw new Error(`Fallback HTTP error! status: ${fallbackResponse.status}`);
        const text = await fallbackResponse.text();
        const cleanText = text.substring(text.indexOf('{'));
        const json = JSON.parse(cleanText);
        return json.resultData?.data || [];
      } catch (fallbackError) {
        console.error('[ShadowScreenerService] Participant OI fallback fetch also failed:', fallbackError);
        throw fallbackError;
      }
    }
  }

  static async fetchDerivativeSummary(token: string): Promise<DerivativeSummaryItem[]> {
    try {
      const url = `/api/sz-pulse/webapi/Resource/derivative-summary-data`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
          'x-stockezee-token': token.trim(),
          'platform_type': '1'
        }
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const json = await response.json();
      return json.resultData || [];
    } catch (error) {
      console.warn('[ShadowScreenerService] Live Derivative Summary fetch failed, trying local fallback:', error);
      try {
        const fallbackResponse = await fetch('/data/derivative_summary.json');
        if (!fallbackResponse.ok) throw new Error(`Fallback HTTP error! status: ${fallbackResponse.status}`);
        const text = await fallbackResponse.text();
        const startIdx = text.indexOf('{');
        if (startIdx === -1) {
          throw new Error('No JSON structure found in fallback response');
        }
        const cleanText = text.substring(startIdx).trim();
        const json = JSON.parse(cleanText);
        return json.resultData || [];
      } catch (fallbackError) {
        console.error('[ShadowScreenerService] Derivative Summary fallback fetch also failed:', fallbackError);
        return [];
      }
    }
  }

  /**
   * Fetches prebuilt custom screens
   */
  static async fetchPrebuildScreens(token: string): Promise<PrebuildScreensResponse> {
    try {
      const url = `/api/stockezee/ai/api/custom-screener/prebuild-screens`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
          'x-stockezee-token': token.trim(),
          'platform_type': '1'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[ShadowScreenerService] Error fetching prebuild screens:', error);
      throw error;
    }
  }

  /**
   * Fetches matching stocks from Stockezee technical indicators cross-filter API
   */
  static async fetchTechnicalIndicatorCrossFilter(
    token: string,
    indicator: string,
    condition: string,
    timeframe: string = '1D',
    limit: number = 2000
  ): Promise<CrossFilterResultItem[]> {
    if (indicator === 'price-action') {
      const signalUrl = `/api/sz-sector/api/Symbol/eq-stock-signals`;
      try {
        const payload = {
          [condition]: true
        };
        const response = await fetch(signalUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token.trim()}`,
            'x-stockezee-token': token.trim(),
            'platform_type': '1'
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();
        if (json.result !== 1 || !json.resultData) {
          return [];
        }

        return json.resultData.map((item: any) => {
          const ltp = Number(item.last_trade_price) || 0;
          const change = Number(item.change) || 0;
          const prevClose = ltp - change;
          const signalDate = item.created_at ? item.created_at.split('T')[0] : '';
          return {
            symbol_name: item.symbol_name,
            price: ltp,
            previous_close: prevClose,
            change_amount: change,
            change_percent: item.change_percent,
            signal_date: signalDate,
            open: item.open,
            high: item.high,
            low: item.low,
            volume: item.volume
          };
        });
      } catch (error) {
        console.error(`[ShadowScreenerService] Error fetching price action signals:`, error);
        throw error;
      }
    }

    const url = `/api/stockezee/api/stock/technical-indicators/cross-filter`;
    let allResults: CrossFilterResultItem[] = [];
    let page = 1;
    let nextAvailable = true;

    // Map indicator ID to case-sensitive API Indicatorslabel
    const INDICATOR_LABEL_MAP: Record<string, string> = {
      'ema': 'ema',
      'sma': 'sma',
      'wma': 'wma',
      'ohlc': 'ohlc',
      'fibonacci': 'FIBONACCI',
      'vwap': 'VWAP',
      'pivot-points': 'PIVOT_POINT',
      'volatility': 'OVERLAY',
      'trend-indicators': 'TREND',
      'volume': 'VOLUME',
      'momentum-oscillators': 'OVERBOUGHT_SOLD'
    };
    const apiIndicator = INDICATOR_LABEL_MAP[indicator] || indicator;

    try {
      while (nextAvailable) {
        const payload = {
          Indicatorslabel: apiIndicator,
          condition: condition,
          timeframe: timeframe,
          page: page,
          limit: limit
        };

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token.trim()}`,
            'x-stockezee-token': token.trim(),
            'platform_type': '1'
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json: CrossFilterResponse = await response.json();
        if (json.status !== 1 || !json.data) {
          break;
        }

        const resultsObj = json.data.results || {};
        const pageResults = resultsObj[condition] || [];
        allResults = [...allResults, ...pageResults];

        const total = json.data.total || 0;
        nextAvailable = json.data.isNextPageAvailable && allResults.length < total && pageResults.length > 0;
        if (nextAvailable) {
          page++;
        }
      }
      return allResults;
    } catch (error) {
      console.error(`[ShadowScreenerService] Error fetching cross filter for ${indicator} - ${condition}:`, error);
      throw error;
    }
  }

  /**
   * Transforms technical indicator cross filter results to generic UI StockData representation
   */
  static transformCrossFilterToStockData(results: CrossFilterResultItem[], condition: string): any[] {
    const standardKeys = new Set([
      'symbol_name',
      'price',
      'previous_close',
      'change_amount',
      'change_percent',
      'signal_date',
      'id',
      'name',
      'created_at',
      'updated_at'
    ]);

    return (results || []).map(p => {
      const price = Number(p.price) || 0;
      const prevClose = Number(p.previous_close) || 0;
      const changePct = Number(p.change_percent) || 0;
      const changeAmt = Number(p.change_amount) || 0;

      // Find all custom keys representing indicators metrics
      const customKeys = Object.keys(p).filter(k => !standardKeys.has(k));

      let metricKey = '';
      let metricValue: number | string = 'N/A';

      if (customKeys.length > 0) {
        if (customKeys.length === 1) {
          metricKey = customKeys[0];
          metricValue = p[metricKey];
        } else {
          // If multiple keys exist, check if one matches key keywords from the condition
          const condLower = condition.toLowerCase();
          const matchedKey = customKeys.find(k => {
            const kl = k.toLowerCase();
            return condLower.includes(kl) || kl.includes(condLower);
          });
          metricKey = matchedKey || customKeys[0];
          metricValue = p[metricKey];
        }
      }

      return {
        Symbol: p.symbol_name,
        LTP: price,
        Change: changePct,
        "Strength Factor": Math.abs(changePct),
        prevClose: prevClose,
        changeAmount: changeAmt,
        signalDate: p.signal_date,
        metricValue: metricValue !== null && metricValue !== undefined ? metricValue : 'N/A',
        metricKey: metricKey || 'Value',
        sentiment: changePct >= 0 ? 'Bullish' : 'Bearish'
      };
    });
  }
}

export const calculateOwnershipScore = (
  symbol: string,
  shareholdingCache: Record<string, ShareholdingActivityItem[]>
): number => {
  let fiiChange = 0;
  let promoterChange = 0;
  let diiChange = 0;

  // Search in fii_buy and fii_sell
  const fiiBuyItem = shareholdingCache['fii_buy']?.find(item => item.symbol_name === symbol);
  const fiiSellItem = shareholdingCache['fii_sell']?.find(item => item.symbol_name === symbol);
  if (fiiBuyItem) fiiChange = parseFloat(fiiBuyItem.change_in_fii_hold) || 0;
  else if (fiiSellItem) fiiChange = parseFloat(fiiSellItem.change_in_fii_hold) || 0;

  // Search in promoter_buy and promoter_sell
  const promoterBuyItem = shareholdingCache['promoter_buy']?.find(item => item.symbol_name === symbol);
  const promoterSellItem = shareholdingCache['promoter_sell']?.find(item => item.symbol_name === symbol);
  if (promoterBuyItem) promoterChange = parseFloat(promoterBuyItem.change_in_promoters_hold) || 0;
  else if (promoterSellItem) promoterChange = parseFloat(promoterSellItem.change_in_promoters_hold) || 0;

  // If dii change is ever present as a field in any of the items, check it
  const anyItem = fiiBuyItem || fiiSellItem || promoterBuyItem || promoterSellItem;
  if (anyItem && (anyItem as any).change_in_dii_hold) {
    diiChange = parseFloat((anyItem as any).change_in_dii_hold) || 0;
  }

  // Formula: (FII_change * 0.4) + (DII_change * 0.3) + (Promoter_change * 0.3)
  const score = (fiiChange * 0.4) + (diiChange * 0.3) + (promoterChange * 0.3);
  return parseFloat(score.toFixed(3));
};
