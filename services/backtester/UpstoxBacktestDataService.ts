import { db, HistoricalPoint, Trade } from '../../database';
import { StrategyDefinition, FetchProgress } from '../../types/backtester.types';
import { upstoxMarketDataService } from '../UpstoxMarketDataService';
import { DataVaultService } from './DataVaultService';
import { OptionsSimulator } from './OptionsSimulator';

/**
 * UpstoxBacktestDataService
 * 
 * Orchestrates fetching historical market data from Upstox API
 * and caching it in the Local Data Vault (IndexedDB).
 */
export class UpstoxBacktestDataService {

  /**
   * Helper to extract target symbol from strategy definition.
   */
  static getStrategySymbol(strategy: StrategyDefinition): string {
    if (strategy.ticker) {
      return strategy.ticker.toUpperCase().trim();
    }
    const tickerRule = strategy.entryRules?.find(r => r.leftIndicator === 'ticker' && r.operator === 'EQUALS');
    if (tickerRule && typeof tickerRule.rightValue === 'string') {
      return tickerRule.rightValue.toUpperCase().trim();
    }
    // Fallback default symbols
    return strategy.assetClass === 'Options' ? 'NIFTY' : 'RELIANCE';
  }

  /**
   * Transforms HistoricalPoint records into engine-compatible Trade objects.
   */
  private static pointsToTrades(points: HistoricalPoint[]): Trade[] {
    return points.map(p => ({
      id: p.id ? p.id : Math.floor(Math.random() * 1000000),
      date: p.date,
      ticker: p.symbol,
      assetClass: p.assetClass === 'Commodity' ? 'Equity' : p.assetClass,
      action: 'BUY',
      direction: p.close >= p.open ? 'Long' : 'Short',
      quantity: 1,
      entryPrice: p.open,
      exitPrice: p.close,
      high: p.high,
      low: p.low,
      entryTime: '09:30', // Default market open time
      exitTime: '15:15',  // Default market close time
      moodEntry: 'Focused',
      moodExit: 'Satisfied',
      pnl: p.close - p.open,
      mistakes: [],
      tags: ['upstox_live', 'backtest'],
      metadata: {
        open: p.open,
        high: p.high,
        low: p.low,
        close: p.close,
        volume: p.volume,
        oi: p.oi
      }
    } as unknown as Trade));
  }

  /**
   * Main entry point for the backtesting adapter.
   * Checks vault first; falls back to live fetch if data is missing.
   */
  static async getOrFetchTrades(
    strategy: StrategyDefinition,
    from: Date,
    to: Date
  ): Promise<Trade[]> {
    const symbol = this.getStrategySymbol(strategy);
    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];
    const segment = strategy.assetClass === 'Equity' ? 'equity' : (strategy.assetClass === 'Options' ? 'options' : 'futures');

    console.log(`[UpstoxBacktestDataService] Querying vault for ${symbol} (${strategy.assetClass}) between ${fromStr} and ${toStr}`);

    let points: HistoricalPoint[] = [];

    if (segment === 'equity') {
      points = await db.historical_data
        .where('symbol')
        .equals(symbol)
        .and(p => p.date >= fromStr && p.date <= toStr)
        .toArray();
        
      if (points.length < 10) {
        // Priority 0: Try Parquet archive endpoint
        try {
          console.log(`[UpstoxBacktestDataService] [Priority 0] Checking Parquet Archive for ${symbol}...`);
          const response = await fetch(`/api/python-nse/api/backtest/candles?symbol=${encodeURIComponent(symbol)}&interval=day&from_date=${fromStr}&to_date=${toStr}`);
          if (response.ok) {
            const res = await response.json();
            if ((res.status === 'success' || res.status === 'partial') && res.candles && res.candles.length > 0) {
              if (res.status === 'partial' || res.warning) {
                console.warn(`[UpstoxBacktestDataService] Partial data warning: ${res.warning || 'shorter than expected dataset returned'}`);
              }
              console.log(`[UpstoxBacktestDataService] Parquet hit! Importing ${res.candles.length} points.`);
              const pts = res.candles.map((candle: any[]) => {
                const dateObj = new Date(candle[0]);
                return {
                  date: dateObj.toISOString().split('T')[0],
                  symbol: symbol,
                  assetClass: 'Equity',
                  open: Number(candle[1]),
                  high: Number(candle[2]),
                  low: Number(candle[3]),
                  close: Number(candle[4]),
                  volume: Number(candle[5] || 0),
                  oi: Number(candle[6] || 0),
                  timestamp: dateObj.getTime()
                } as HistoricalPoint;
              });
              await DataVaultService.importToVault(pts);
              points = pts;
            }
          }
        } catch (e) {
          console.warn('[UpstoxBacktestDataService] Error querying Parquet API for equity:', e);
        }
      }
    } else if (segment === 'options') {
      // 1. Fetch underlying index candles (e.g., NIFTY daily candles)
      points = await db.historical_data
        .where('symbol')
        .equals(symbol)
        .and(p => p.date >= fromStr && p.date <= toStr)
        .toArray();
        
      if (points.length < 10) {
        // Priority 0: Try Parquet archive endpoint for underlying index
        try {
          console.log(`[UpstoxBacktestDataService] [Priority 0] Checking Parquet Archive for underlying ${symbol}...`);
          const response = await fetch(`/api/python-nse/api/backtest/candles?symbol=${encodeURIComponent(symbol)}&interval=day&from_date=${fromStr}&to_date=${toStr}`);
          if (response.ok) {
            const res = await response.json();
            if ((res.status === 'success' || res.status === 'partial') && res.candles && res.candles.length > 0) {
              if (res.status === 'partial' || res.warning) {
                console.warn(`[UpstoxBacktestDataService] Partial data warning: ${res.warning || 'shorter than expected dataset returned'}`);
              }
              console.log(`[UpstoxBacktestDataService] Parquet hit for underlying! Importing ${res.candles.length} points.`);
              const pts = res.candles.map((candle: any[]) => {
                const dateObj = new Date(candle[0]);
                return {
                  date: dateObj.toISOString().split('T')[0],
                  symbol: symbol,
                  assetClass: 'Equity',
                  open: Number(candle[1]),
                  high: Number(candle[2]),
                  low: Number(candle[3]),
                  close: Number(candle[4]),
                  volume: Number(candle[5] || 0),
                  oi: Number(candle[6] || 0),
                  timestamp: dateObj.getTime()
                } as HistoricalPoint;
              });
              await DataVaultService.importToVault(pts);
              points = pts;
            }
          }
        } catch (e) {
          console.warn('[UpstoxBacktestDataService] Error querying Parquet API for options underlying:', e);
        }
      }
    } else {
      // For F&O futures, symbol in vault starts with the underlying symbol name (e.g. NIFTY24JAN...)
      points = await db.historical_data
        .where('date')
        .between(fromStr, toStr, true, true)
        .and(p => p.assetClass === strategy.assetClass && p.symbol.toUpperCase().startsWith(symbol))
        .toArray();
    }

    if (points.length >= 10) {
      console.log(`[UpstoxBacktestDataService] Vault hit! Found ${points.length} records.`);
      const trades = this.pointsToTrades(points);
      
      if (segment === 'options') {
        try {
          // 2. Fetch all option contract candles for this index and date range to build in-memory map
          const allOptionPoints = await db.historical_data
            .where('date')
            .between(fromStr, toStr, true, true)
            .and(p => p.assetClass === 'Options' && p.symbol.toUpperCase().startsWith(symbol))
            .toArray();

          if (allOptionPoints.length > 0) {
            // Build key -> point map
            const optMap = new Map<string, HistoricalPoint>();
            const expiriesSet = new Set<string>();
            for (const p of allOptionPoints) {
              const key = `${p.date}_${p.expiry}_${p.strike}_${p.optionType?.toUpperCase()}`;
              optMap.set(key, p);
              if (p.expiry) expiriesSet.add(p.expiry);
            }
            
            const expiries = Array.from(expiriesSet).sort();
            
            // Enrich trades with option leg prices and calculated IVs
            for (const trade of trades) {
              const activeExpiry = expiries.find(exp => exp >= trade.date) || null;
              if (activeExpiry && strategy.legs) {
                const expiryDate = new Date(activeExpiry);
                const tradeDate = new Date(trade.date);
                const dte = Math.max(1, Math.round((expiryDate.getTime() - tradeDate.getTime()) / (1000 * 60 * 60 * 24)));
                
                const T_ENTRY = dte / 365.0;
                const T_EXIT = Math.max(0.0001, dte - 0.2) / 365.0;
                
                (trade as any).metadata.optionLegs = [];
                
                for (const leg of strategy.legs) {
                  const strike = Math.round((trade.entryPrice + leg.strikeOffset) / 50) * 50;
                  const key = `${trade.date}_${activeExpiry}_${strike}_${leg.type.toUpperCase()}`;
                  const optPoint = optMap.get(key);
                  
                  if (optPoint) {
                    const priceEntry = optPoint.open;
                    const priceExit = optPoint.close;
                    const ivEntry = OptionsSimulator.calculateIV(trade.entryPrice, priceEntry, strike, T_ENTRY, 0.07, leg.type);
                    const ivExit = OptionsSimulator.calculateIV(trade.exitPrice, priceExit, strike, T_EXIT, 0.07, leg.type);
                    
                    (trade as any).metadata.optionLegs.push({
                      ivEntry,
                      ivExit,
                      priceEntry,
                      priceExit,
                      strike,
                      expiry: activeExpiry,
                      type: leg.type,
                      dte
                    });
                  } else {
                    // Fallback
                    (trade as any).metadata.optionLegs.push({
                      ivEntry: 0.18,
                      ivExit: 0.18,
                      priceEntry: null,
                      priceExit: null,
                      strike,
                      expiry: activeExpiry,
                      type: leg.type,
                      dte
                    });
                  }
                }
              }
            }
            console.log(`[UpstoxBacktestDataService] Successfully enriched ${trades.length} trades with options Greeks & dynamic IV.`);
          } else {
            console.warn('[UpstoxBacktestDataService] No option contract points found in Dexie for enrichment.');
          }
        } catch (enrichErr) {
          console.error('[UpstoxBacktestDataService] Error during options enrichment:', enrichErr);
        }
      }
      
      return trades;
    }

    console.log(`[UpstoxBacktestDataService] Vault miss. Initiating background fetch for ${symbol}...`);
    try {
      // Default to daily interval, 6 cycles, last 180 days for auto-fetching
      await this.fetchAndStore(symbol, segment as any, 'day', 6, () => {});
      
      // Re-query vault after fetch
      if (segment === 'equity') {
        points = await db.historical_data
          .where('symbol')
          .equals(symbol)
          .and(p => p.date >= fromStr && p.date <= toStr)
          .toArray();
      } else {
        points = await db.historical_data
          .where('date')
          .between(fromStr, toStr, true, true)
          .and(p => p.assetClass === strategy.assetClass && p.symbol.toUpperCase().startsWith(symbol))
          .toArray();
      }
      return this.pointsToTrades(points);
    } catch (err) {
      console.error(`[UpstoxBacktestDataService] Failed auto-fetching live data:`, err);
      return [];
    }
  }

  /**
   * Orchestrates the 4-step data fetching and ingestion pipeline.
   */
  static async fetchAndStore(
    symbol: string,
    segment: 'options' | 'futures' | 'equity',
    interval: string,
    maxCycles: number,
    onProgress: (p: FetchProgress) => void
  ): Promise<Trade[]> {
    const symbolClean = symbol.toUpperCase().trim();
    const toDateStr = new Date().toISOString().split('T')[0];
    // Default to last 180 days of historical data
    const fromDateObj = new Date();
    fromDateObj.setDate(fromDateObj.getDate() - 180);
    const fromDateStr = fromDateObj.toISOString().split('T')[0];

    const historicalPoints: HistoricalPoint[] = [];

    // --- STEP 1: EXPIRES ---
    onProgress({ step: 1, stepName: 'Expiries', current: 0, total: 1, symbol: symbolClean });
    
    let expiries: string[] = [];
    if (segment !== 'equity') {
      try {
        const expRes = await upstoxMarketDataService.getExpiries(symbolClean, segment);
        const rawExpiries = expRes?.data || expRes || [];
        if (Array.isArray(rawExpiries)) {
          // Sort and slice to limit cycles
          expiries = rawExpiries
            .filter((d: string) => typeof d === 'string')
            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime()) // Newest first
            .slice(0, maxCycles);
        }
      } catch (err) {
        console.error(`[UpstoxBacktestDataService] Error fetching expiries:`, err);
      }
    }
    onProgress({ step: 1, stepName: 'Expiries', current: 1, total: 1, symbol: symbolClean });

    // --- STEP 2: CONTRACTS ---
    onProgress({ step: 2, stepName: 'Contracts', current: 0, total: segment === 'equity' ? 1 : expiries.length, symbol: symbolClean });
    
    interface ContractItem {
      instrument_key: string;
      trading_symbol: string;
      strike_price?: number;
      option_type?: string;
      expiry?: string;
    }
    let contractsToFetch: ContractItem[] = [];

    if (segment === 'equity') {
      // Resolve equity instrument key
      const resolved = await upstoxMarketDataService.resolveSymbol(symbolClean);
      if (resolved && resolved.instrument_key) {
        contractsToFetch.push({
          instrument_key: resolved.instrument_key,
          trading_symbol: resolved.symbol || symbolClean
        });
      }
      onProgress({ step: 2, stepName: 'Contracts', current: 1, total: 1, symbol: symbolClean });
    } else {
      for (let i = 0; i < expiries.length; i++) {
        const expiry = expiries[i];
        try {
          let rawContracts: any[] = [];
          if (segment === 'options') {
            const optRes = await upstoxMarketDataService.getExpiredOptionContracts(symbolClean, expiry);
            rawContracts = optRes?.data || optRes || [];
          } else {
            const futRes = await upstoxMarketDataService.getExpiredFutureContracts(symbolClean, expiry);
            rawContracts = futRes?.data || futRes || [];
          }

          if (Array.isArray(rawContracts)) {
            let filtered = rawContracts;
            
            // Heuristic filtering for Options to avoid fetching hundreds of strikes
            if (segment === 'options' && rawContracts.length > 20) {
              const strikes = Array.from(new Set(rawContracts.map(c => Number(c.strike_price))))
                .sort((a, b) => a - b);
              
              if (strikes.length > 0) {
                const medianStrike = strikes[Math.floor(strikes.length / 2)];
                const medianIdx = strikes.indexOf(medianStrike);
                
                // Keep ATM +/- 5 strikes
                const minIdx = Math.max(0, medianIdx - 5);
                const maxIdx = Math.min(strikes.length - 1, medianIdx + 5);
                const activeStrikes = strikes.slice(minIdx, maxIdx + 1);
                
                filtered = rawContracts.filter(c => activeStrikes.includes(Number(c.strike_price)));
              }
            }

            contractsToFetch.push(...filtered.map(c => ({
              instrument_key: c.instrument_key,
              trading_symbol: c.trading_symbol || c.symbol,
              strike_price: c.strike_price,
              option_type: c.option_type,
              expiry: c.expiry || expiry
            })));
          }
        } catch (err) {
          console.error(`[UpstoxBacktestDataService] Error fetching contracts for expiry ${expiry}:`, err);
        }
        onProgress({ step: 2, stepName: 'Contracts', current: i + 1, total: expiries.length, symbol: symbolClean });
      }
    }

    // --- STEP 3: CANDLES ---
    onProgress({ step: 3, stepName: 'Candles', current: 0, total: contractsToFetch.length, symbol: symbolClean });
    
    for (let i = 0; i < contractsToFetch.length; i++) {
      const contract = contractsToFetch[i];
      try {
        const candleRes = await upstoxMarketDataService.getExpiredHistoricalCandles(
          contract.instrument_key,
          interval,
          fromDateStr,
          toDateStr
        );
        const candles = candleRes?.data?.candles || candleRes?.candles || [];
        
        if (Array.isArray(candles)) {
          for (const candle of candles) {
            if (!Array.isArray(candle) || candle.length < 5) continue;
            
            // candle format: [timestamp/date, open, high, low, close, volume, open_interest]
            const rawTs = candle[0];
            let dateObj: Date;
            if (typeof rawTs === 'number') {
              dateObj = new Date(rawTs < 9999999999 ? rawTs * 1000 : rawTs);
            } else {
              dateObj = new Date(String(rawTs));
            }

            const dateStr = dateObj.toISOString().split('T')[0];
            
            historicalPoints.push({
              date: dateStr,
              symbol: contract.trading_symbol,
              assetClass: segment === 'equity' ? 'Equity' : (segment === 'options' ? 'Options' : 'Futures'),
              open: Number(candle[1]),
              high: Number(candle[2]),
              low: Number(candle[3]),
              close: Number(candle[4]),
              volume: Number(candle[5] || 0),
              oi: Number(candle[6] || 0),
              timestamp: dateObj.getTime(),
              optionType: contract.option_type,
              strike: contract.strike_price,
              expiry: contract.expiry
            });
          }
        }
        // Small throttling delay to be gentle on python rate-limiter
        await new Promise(r => setTimeout(r, 50));
      } catch (err) {
        console.error(`[UpstoxBacktestDataService] Error fetching candles for ${contract.trading_symbol}:`, err);
      }
      onProgress({ step: 3, stepName: 'Candles', current: i + 1, total: contractsToFetch.length, symbol: symbolClean });
    }

    // --- STEP 4: IMPORT TO VAULT ---
    onProgress({ step: 4, stepName: 'Importing', current: 0, total: 1, symbol: symbolClean });
    
    if (historicalPoints.length > 0) {
      await DataVaultService.importToVault(historicalPoints);
      console.log(`[UpstoxBacktestDataService] Successfully imported ${historicalPoints.length} points to local Dexie vault.`);
    }
    
    onProgress({ step: 4, stepName: 'Importing', current: 1, total: 1, symbol: symbolClean });

    return this.pointsToTrades(historicalPoints);
  }
}
