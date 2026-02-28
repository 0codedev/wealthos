import { Trade } from '../../database';

/**
 * YahooHistoricalService
 * 
 * Fetches historical market data from Yahoo Finance via the Vite proxy.
 * Primarily used for Equity backtesting in the Apex Lab.
 */
export class YahooHistoricalService {
  private static PROXY_BASE = '/api/yahoo';

  /**
   * Fetches historical OHLC data and converts it into the "Trade" format 
   * that the simulation engine expects (acting as a synthetic trade history).
   * 
   * @param symbol NSE symbol (e.g., RELIANCE)
   * @param interval Data granularity ('1m', '5m', '15m', '1d')
   * @param range Time range ('1d', '5d', '1mo', '1y', '5y', 'max')
   */
  static async getSyntheticTrades(
    symbol: string,
    interval: string = '1d',
    range: string = '1y'
  ): Promise<Trade[]> {
    try {
      // Yahoo Finance requires .NS suffix for NSE stocks, but not for index tickers starting with ^
      const yahooSymbol = (symbol.endsWith('.NS') || symbol.startsWith('^')) ? symbol : `${symbol}.NS`;
      const url = `${this.PROXY_BASE}/v8/finance/chart/${yahooSymbol}?interval=${interval}&range=${range}`;

      const response = await fetch(url);
      if (!response.ok) {
        // If a 5m query fails on a large range like 60d or 30d (often due to date limits or boundary checks), try a shorter range
        if (interval === '5m' && range === '60d') {
          console.warn(`[YahooHistoricalService] 60d 5m query failed for ${symbol}, falling back to 30d...`);
          return this.getSyntheticTrades(symbol, interval, '30d');
        }
        if (interval === '5m' && range === '30d') {
          console.warn(`[YahooHistoricalService] 30d 5m query failed for ${symbol}, falling back to 7d...`);
          return this.getSyntheticTrades(symbol, interval, '7d');
        }
        throw new Error(`Yahoo Finance API error: ${response.statusText} (${response.status})`);
      }

      const data = await response.json();
      const result = data.chart?.result?.[0];

      if (!result || !result.timestamp) {
        console.warn(`No historical data found for ${symbol} on Yahoo Finance.`);
        return [];
      }

      const timestamps = result.timestamp;
      const quotes = result.indicators.quote[0];
      const adjClose = result.indicators.adjclose?.[0]?.adjclose || quotes.close;

      // Convert OHLC candles into synthetic "Trades" for the engine
      // Each candle represents a potential trade opportunity or price action point
      return timestamps.map((ts: number, i: number) => {
        const dateObj = new Date(ts * 1000);
        const dateStr = dateObj.toISOString().split('T')[0];
        // Default to 09:30 for daily candles to ensure they fall within common strategy windows (like Momentum/ORB)
        const timeStr = interval === '1d' ? '09:30' : dateObj.toISOString().split('T')[1].substring(0, 5);

        return {
          id: `synthetic_${symbol}_${ts}`,
          date: dateStr,
          ticker: symbol,
          assetClass: 'Equity',
          action: 'BUY', 
          quantity: 1,
          entryPrice: quotes.open[i] || quotes.close[i],
          exitPrice: quotes.close[i],
          entryTime: timeStr,
          exitTime: '15:15', // Default to market close
          pnl: adjClose[i] - quotes.open[i],
          status: 'COMPLETED',
          mood: 'Excellent', // Default for synthetic testing
          mistake: 'None',    // Default for synthetic testing
          tags: ['synthetic', 'backtest'],
          // We attach the full OHLC for the backtester's rule engine to inspect
          metadata: {
            open: quotes.open[i],
            high: quotes.high[i],
            low: quotes.low[i],
            close: quotes.close[i],
            adjClose: adjClose[i],
            volume: quotes.volume[i]
          }
        } as unknown as Trade;
      }).filter((t: any) => t.entryPrice !== null && t.exitPrice !== null);

    } catch (error) {
      console.error(`Failed to fetch synthetic trades for ${symbol}:`, error);
      return [];
    }
  }
}
