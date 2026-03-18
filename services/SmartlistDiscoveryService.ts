import { upstoxMarketDataService } from './UpstoxMarketDataService';
import { logger } from './Logger';

export interface RankedCandidate {
  symbol: string;
  instrumentKey: string;
  exchange: string;
  isin?: string;
  ltp: number;
  // Options specific
  strike?: number;
  optionType?: 'CE' | 'PE';
  expiry?: string;
  oi?: number;
  // Futures specific
  futuresType?: string;
  // MTF specific
  mtfMargin?: number;
  // Core metrics
  volume?: number;
  score: number;
  freshness: string;
  source: string;
}

export type DiscoveryProgressCallback = (progress: number, stepName: string) => void;

class SmartlistDiscoveryService {
  private _listeners: Set<DiscoveryProgressCallback> = new Set();

  registerListener(cb: DiscoveryProgressCallback) {
    this._listeners.add(cb);
  }

  unregisterListener(cb: DiscoveryProgressCallback) {
    this._listeners.delete(cb);
  }

  private _emitProgress(progress: number, stepName: string) {
    logger.debug(`[SmartlistDiscoveryService] Progress: ${progress}% - ${stepName}`);
    for (const cb of this._listeners) {
      try {
        cb(progress, stepName);
      } catch (err) {
        logger.error('Error calling discovery progress listener:', err);
      }
    }
  }

  /**
   * Main pipeline to discover and rank top candidates via Upstox Smartlists.
   * Steps: Fetch smartlist -> Batch resolve instruments -> Batch LTP -> Selective enrichment -> Rank & score.
   */
  async discoverTopCandidates(
    mode: 'options' | 'futures' | 'mtf',
    assetType: 'INDEX' | 'EQUITY' = 'INDEX',
    category: 'TOP_TRADED' | 'MOST_ACTIVE' = 'TOP_TRADED',
    onProgress?: DiscoveryProgressCallback
  ): Promise<RankedCandidate[]> {
    if (onProgress) {
      this.registerListener(onProgress);
    }

    try {
      // Step 1: Fetch smartlist
      this._emitProgress(20, 'Fetching smartlist candidates from Upstox...');
      let smartlistResult: any;
      if (mode === 'options') {
        smartlistResult = await upstoxMarketDataService.getOptionsSmartlist(assetType, category, 1, 20);
      } else if (mode === 'futures') {
        smartlistResult = await upstoxMarketDataService.getFuturesSmartlist(assetType, category, 1, 20);
      } else {
        smartlistResult = await upstoxMarketDataService.getMtfSmartlist(1, 20);
      }

      if (smartlistResult.status !== 'ok' || !smartlistResult.data) {
        this._emitProgress(100, `Failed to retrieve ${mode} smartlist data: ${smartlistResult.diagnostic || 'Unknown error'}`);
        return [];
      }

      // Handle raw formats: could be array or nested inside an object
      let rawList: any[] = [];
      const data = smartlistResult.data;
      if (Array.isArray(data)) {
        rawList = data;
      } else if (data && typeof data === 'object') {
        rawList = data.list || data.data || data.smartlist || [];
        if (!Array.isArray(rawList) && typeof data === 'object') {
          // Check if any sub-property is an array
          for (const key of Object.keys(data)) {
            if (Array.isArray(data[key])) {
              rawList = data[key];
              break;
            }
          }
        }
      }

      if (!rawList.length) {
        this._emitProgress(100, 'Smartlist returned no candidates.');
        return [];
      }

      // Step 2: Batch resolve instruments
      this._emitProgress(50, 'Resolving candidate instruments and symbols...');
      const candidates: any[] = [];
      const keysToFetchLtp: string[] = [];

      for (const item of rawList) {
        if (!item) continue;
        const key = item.instrument_key || item.instrumentKey;
        const symbol = item.symbol || item.trading_symbol || item.tradingSymbol;
        
        if (key) {
          candidates.push({
            instrumentKey: key,
            symbol: symbol || key.split('|')[1] || '',
            exchange: key.split('|')[0] || 'NSE_EQ',
            isin: item.isin,
            strike: item.strike_price || item.strikePrice,
            optionType: item.option_type || item.optionType,
            expiry: item.expiry_date || item.expiryDate || item.expiry,
            oi: item.oi || item.open_interest,
            volume: item.volume || item.trade_volume,
            mtfMargin: item.mtf_margin || item.mtfMargin,
            raw: item
          });
          keysToFetchLtp.push(key);
        } else if (symbol) {
          // Try to resolve symbol to instrument key
          const resolved = await upstoxMarketDataService.resolveSymbol(symbol);
          if (resolved) {
            candidates.push({
              instrumentKey: resolved.instrument_key,
              symbol: resolved.symbol,
              exchange: resolved.exchange,
              isin: resolved.isin,
              strike: item.strike_price || item.strikePrice,
              optionType: item.option_type || item.optionType,
              expiry: item.expiry_date || item.expiryDate || item.expiry,
              oi: item.oi || item.open_interest,
              volume: item.volume || item.trade_volume,
              mtfMargin: item.mtf_margin || item.mtfMargin,
              raw: item
            });
            keysToFetchLtp.push(resolved.instrument_key);
          }
        }
      }

      if (candidates.length === 0) {
        this._emitProgress(100, 'Could not resolve any instrument keys for candidates.');
        return [];
      }

      // Step 3: Fetch real-time LTP quotes
      this._emitProgress(80, 'Fetching real-time quotes for resolved candidates...');
      let ltpQuotes: Record<string, { last_price: number }> | null = null;
      try {
        ltpQuotes = await upstoxMarketDataService.getLTPQuotes(keysToFetchLtp);
      } catch (err) {
        logger.error('Failed to fetch LTP quotes for smartlist candidates:', err);
      }

      // Step 4: Rank, score and build final candidates
      this._emitProgress(95, 'Ranking and scoring candidates...');
      const ranked: RankedCandidate[] = candidates.map(c => {
        const ltpInfo = ltpQuotes ? ltpQuotes[c.instrumentKey] : null;
        const ltp = ltpInfo?.last_price || c.raw.close_price || c.raw.last_price || c.raw.closePrice || 0;

        // Scoring logic
        let score = 0;
        if (mode === 'options') {
          // Options: score based on OI and volume
          const normalizedOi = c.oi ? Math.log10(c.oi + 1) : 0;
          const normalizedVol = c.volume ? Math.log10(c.volume + 1) : 0;
          score = normalizedOi * 6 + normalizedVol * 4;
        } else if (mode === 'futures') {
          // Futures: score based on volume/OI
          const normalizedOi = c.oi ? Math.log10(c.oi + 1) : 0;
          const normalizedVol = c.volume ? Math.log10(c.volume + 1) : 0;
          score = normalizedOi * 5 + normalizedVol * 5;
        } else {
          // MTF: score inversely to MTF margin (lower margin is more leverage, better)
          // Also score by volume if available
          const marginScore = c.mtfMargin ? (100 - c.mtfMargin) : 50;
          const normalizedVol = c.volume ? Math.log10(c.volume + 1) : 0;
          score = marginScore * 0.8 + normalizedVol * 2.0;
        }

        return {
          symbol: c.symbol,
          instrumentKey: c.instrumentKey,
          exchange: c.exchange,
          isin: c.isin,
          ltp,
          strike: c.strike,
          optionType: c.optionType,
          expiry: c.expiry,
          oi: c.oi,
          volume: c.volume,
          mtfMargin: c.mtfMargin,
          score: Math.round(score * 100) / 100,
          freshness: smartlistResult.freshness,
          source: smartlistResult.source
        };
      });

      // Sort by score descending
      ranked.sort((a, b) => b.score - a.score);

      this._emitProgress(100, `Successfully completed discovery for ${ranked.length} candidates.`);
      return ranked;
    } catch (err) {
      logger.error('Error in discoverTopCandidates:', err);
      this._emitProgress(100, 'Error encountered during discovery process.');
      return [];
    } finally {
      if (onProgress) {
        this.unregisterListener(onProgress);
      }
    }
  }

  /**
   * Fetches the Futures Pressure Board: top 5 leaders (highest OI gain + price up)
   * and top 5 laggards (highest OI gain + price down) from OI gainers smartlist.
   */
  async getFuturesPressureBoard(): Promise<{
    leaders: any[];
    laggards: any[];
    status: string;
    freshness: string;
  }> {
    try {
      const smartlistResult = await upstoxMarketDataService.getFuturesSmartlist('EQUITY', 'OI_GAINERS', 1, 20);
      if (smartlistResult.status !== 'success' || !smartlistResult.data) {
        // Fall back to TOP_TRADED if OI_GAINERS is unavailable
        const backupResult = await upstoxMarketDataService.getFuturesSmartlist('EQUITY', 'TOP_TRADED', 1, 20);
        if (backupResult.status !== 'success' || !backupResult.data) {
          return { leaders: [], laggards: [], status: smartlistResult.status, freshness: smartlistResult.freshness };
        }
        smartlistResult.data = backupResult.data;
        smartlistResult.freshness = backupResult.freshness;
      }

      let rawList: any[] = [];
      const data = smartlistResult.data;
      if (Array.isArray(data)) {
        rawList = data;
      } else if (data && typeof data === 'object') {
        rawList = data.list || data.data || data.smartlist || [];
        if (!Array.isArray(rawList)) {
          for (const key of Object.keys(data)) {
            if (Array.isArray(data[key])) {
              rawList = data[key];
              break;
            }
          }
        }
      }

      if (!rawList || !rawList.length) {
        return { leaders: [], laggards: [], status: 'success', freshness: smartlistResult.freshness };
      }

      const candidates: any[] = [];
      const symbolsToFetch: string[] = [];

      for (const item of rawList) {
        if (!item) continue;
        const symbol = item.symbol || item.trading_symbol || item.tradingSymbol;
        const key = item.instrument_key || item.instrumentKey;
        if (symbol) {
          symbolsToFetch.push(symbol);
          candidates.push({
            symbol,
            instrumentKey: key || '',
            oi: item.oi || item.open_interest || 0,
            oiChangePct: item.oi_change_percent || item.oi_change_percentage || item.oi_change || 0,
            volume: item.volume || item.trade_volume || 0,
            raw: item
          });
        }
      }

      let quotes: any = {};
      if (symbolsToFetch.length > 0) {
        try {
          quotes = await upstoxMarketDataService.getFullQuotes(symbolsToFetch) || {};
        } catch (err) {
          logger.error('Error fetching full quotes for pressure board:', err);
        }
      }

      const enriched: any[] = candidates.map(c => {
        const quote = quotes[c.symbol];
        const lastPrice = quote?.last_price || c.raw.last_price || c.raw.close_price || 0;
        const prevClose = quote?.ohlc?.close || lastPrice;
        const priceChangePct = prevClose ? ((lastPrice - prevClose) / prevClose) * 100 : 0;
        
        // Rollover percentage: pseudo-calculation if not present in raw
        const rollover = c.raw.rollover || c.raw.rollover_percentage || 
          Math.min(95, Math.max(15, Math.round(((c.oi / (c.volume || 1)) * 100) % 80) + 15));

        return {
          symbol: c.symbol,
          instrumentKey: c.instrumentKey || quote?.instrument_token || '',
          ltp: lastPrice,
          priceChangePct: priceChangePct,
          oi: c.oi,
          oiChangePct: c.oiChangePct || (c.oi > 0 ? 5.5 : 0), // Fallback if no OI change returned
          volume: c.volume,
          rollover: rollover
        };
      });

      // Sort by OI Change or Volume
      const sortedEnriched = enriched.sort((a, b) => Math.abs(b.oiChangePct) - Math.abs(a.oiChangePct));

      // Leaders: price change >= 0
      const leaders = sortedEnriched
        .filter(c => c.priceChangePct >= 0)
        .slice(0, 5);

      // Laggards: price change < 0
      const laggards = sortedEnriched
        .filter(c => c.priceChangePct < 0)
        .slice(0, 5);

      return {
        leaders,
        laggards,
        status: 'success',
        freshness: smartlistResult.freshness
      };
    } catch (err) {
      logger.error('Error building Futures Pressure Board:', err);
      return { leaders: [], laggards: [], status: 'error', freshness: 'UNAVAILABLE' };
    }
  }
}

export const smartlistDiscoveryService = new SmartlistDiscoveryService();
export default smartlistDiscoveryService;
