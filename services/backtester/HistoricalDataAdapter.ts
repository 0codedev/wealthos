import { db, Trade, HistoricalPoint } from '../../database';
import { StrategyDefinition } from '../../types/backtester.types';
import { TradeHistoryAdapter } from './TradeHistoryAdapter';
import { YahooHistoricalService } from './YahooHistoricalService';
import { UpstoxBacktestDataService } from './UpstoxBacktestDataService';

/**
 * HistoricalDataAdapter
 * 
 * Orchestrates data fetching for the Apex Engine.
 * Automatically switches between real trade history and synthetic market data
 * based on availability and strategy requirements.
 */
export class HistoricalDataAdapter {
  
  /**
   * Main entry point for fetching simulation data.
   */
  static async getData(
    strategy: StrategyDefinition,
    fromDate: Date,
    toDate: Date
  ): Promise<Trade[]> {
    console.log(`[HistoricalDataAdapter] Fetching data for: ${strategy.name} (${strategy.assetClass})`);

    // 1. Try Upstox Live F&O / Equity data first (and auto-fetch if missing)
    const upstoxTrades = await UpstoxBacktestDataService.getOrFetchTrades(strategy, fromDate, toDate);
    if (upstoxTrades.length >= 10) {
      console.log(`[HistoricalDataAdapter] Found ${upstoxTrades.length} Upstox live records. Running in high-fidelity mode.`);
      return upstoxTrades;
    }

    // 2. Try fetching real trade history
    const realTrades = await TradeHistoryAdapter.getHistoricalTrades(fromDate, toDate, strategy.assetClass);
    
    if (realTrades.length >= 5) {
      console.log(`[HistoricalDataAdapter] Found ${realTrades.length} real trades. Running in behavioral mode.`);
      return realTrades;
    }

    // 2. Try the Local Data Vault (High Fidelity)
    const vaultTrades = await this.getVaultData(strategy, fromDate, toDate);
    if (vaultTrades.length > 0) {
      console.log(`[HistoricalDataAdapter] Found ${vaultTrades.length} local records in Vault. Running in high-fidelity mode.`);
      return vaultTrades;
    }

    // 3. Special Case: Intraday Duel strategy (60-day 5m historical charts)
    if (strategy.name.toLowerCase().includes('duel') || strategy.name.toLowerCase().includes('breakout')) {
      console.log('[HistoricalDataAdapter] Loading 60-day intraday breakout data from Yahoo Finance...');
      const symbols = ['RELIANCE', 'TCS', 'COFORGE', 'INFY', 'HDFCBANK'];
      const syntheticTrades: Trade[] = [];

      for (const symbol of symbols) {
        // Fetch 60 days of 5-minute candles
        const rawCandles = await YahooHistoricalService.getSyntheticTrades(symbol, '5m', '60d');
        if (!rawCandles || rawCandles.length === 0) continue;

        // Group by date
        const byDate: Record<string, typeof rawCandles> = {};
        for (const c of rawCandles) {
          if (!byDate[c.date]) byDate[c.date] = [];
          byDate[c.date].push(c);
        }

        for (const date in byDate) {
          const dayCandles = byDate[date].sort((a, b) => (a.entryTime || '').localeCompare(b.entryTime || ''));
          // Find candle near 09:50
          const entryIdx = dayCandles.findIndex(c => (c.entryTime || '') >= '09:45' && (c.entryTime || '') <= '09:55');
          if (entryIdx === -1) continue;

          const entryCandle = dayCandles[entryIdx];
          const entryPrice = entryCandle.entryPrice;

          const postEntryCandles = dayCandles.slice(entryIdx);
          let high = entryPrice;
          let low = entryPrice;
          for (const c of postEntryCandles) {
            const h = (c as any).metadata?.high || c.entryPrice;
            const l = (c as any).metadata?.low || c.entryPrice;
            if (h > high) high = h;
            if (l < low) low = l;
          }

          const exitCandle = dayCandles[dayCandles.length - 1];
          const exitPrice = exitCandle.exitPrice;

          syntheticTrades.push({
            id: `duel_${symbol}_${date}`,
            date: date,
            ticker: symbol,
            assetClass: 'Equity',
            action: 'BUY',
            direction: 'Long',
            quantity: 1,
            entryPrice: entryPrice,
            exitPrice: exitPrice,
            high: high,
            low: low,
            entryTime: '09:50',
            exitTime: '15:15',
            pnl: exitPrice - entryPrice,
            status: 'COMPLETED',
            mood: 'Excellent',
            mistake: 'None',
            tags: ['duel', 'backtest']
          } as unknown as Trade);
        }
      }

      return syntheticTrades.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }

    // 4. Fallback to Yahoo Finance (Synthetic - Equity Only - Daily data)
    if (strategy.assetClass === 'Equity') {
      console.log('[HistoricalDataAdapter] No local data found. Falling back to Yahoo Finance proxy...');
      
      const symbol = strategy.ticker || UpstoxBacktestDataService.getStrategySymbol(strategy);
      const trades = await YahooHistoricalService.getSyntheticTrades(symbol, '1d', '5y');

      return trades.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }

    if (strategy.assetClass === 'Options') {
      console.warn('[HistoricalDataAdapter] No local Options data found. Please import F&O Bhavcopy into the Vault.');
      return [];
    }

    return [];
  }

  /**
   * Helper to fetch and convert Data Vault points to engine-compatible Trades.
   */
  private static async getVaultData(strategy: StrategyDefinition, from: Date, to: Date): Promise<Trade[]> {
    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];
    const symbol = strategy.ticker || UpstoxBacktestDataService.getStrategySymbol(strategy);

    // Query vault and filter by symbol startsWith (to catch option contract strikes or exact stock symbol)
    const points = await db.historical_data
      .where('date')
      .between(fromStr, toStr, true, true)
      .and((p: HistoricalPoint) => p.assetClass === strategy.assetClass && p.symbol.toUpperCase().startsWith(symbol))
      .toArray();

    if (points.length === 0) return [];

    return points.map((p: HistoricalPoint) => ({
      id: `vault_${p.id}` as any,
      date: p.date,
      ticker: p.symbol,
      assetClass: (p.assetClass === 'Commodity' ? 'Equity' : p.assetClass) as any,
      action: 'BUY',
      direction: 'Long',
      quantity: 1,
      entryPrice: p.open,
      exitPrice: p.close,
      entryTime: '09:30',
      exitTime: '15:15',
      moodEntry: 'Focused',
      moodExit: 'Satisfied',
      pnl: p.close - p.open,
      mistakes: []
    }));
  }
}
