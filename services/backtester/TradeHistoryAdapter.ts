import { db, Trade } from '../../database';

/**
 * TradeHistoryAdapter
 * 
 * Fetches the user's real trade history from IndexedDB (synced from Dhan or manual entry).
 * This forms the "Market Data" layer when the backtester is running in "Real Trade History" mode.
 */
export class TradeHistoryAdapter {
  
  /**
   * Fetches all trades from the database within the specified date range.
   * Sorted chronologically.
   * 
   * @param fromDate Start date
   * @param toDate End date
   * @param assetClass Optional asset class filter
   */
  static async getHistoricalTrades(
    fromDate: Date, 
    toDate: Date, 
    assetClass?: string
  ): Promise<Trade[]> {
    try {
      let trades = await db.trades.toArray();
      
      // Filter by date range
      trades = trades.filter(t => {
        const tDate = new Date(t.date);
        return tDate >= fromDate && tDate <= toDate;
      });

      // Filter by asset class if provided
      if (assetClass) {
        trades = trades.filter(t => t.assetClass === assetClass);
      }

      // Sort chronologically (oldest first) to simulate time forward
      trades.sort((a, b) => {
        const timeA = new Date(`${a.date}T${a.entryTime || '09:15:00'}`).getTime();
        const timeB = new Date(`${b.date}T${b.entryTime || '09:15:00'}`).getTime();
        return timeA - timeB;
      });

      return trades;
    } catch (error) {
      console.error('Error fetching historical trades for backtest:', error);
      return [];
    }
  }

  /**
   * Extracts unique tickers from the user's history
   */
  static async getTradedTickers(): Promise<string[]> {
    const trades = await db.trades.toArray();
    const tickers = new Set<string>();
    trades.forEach(t => {
      if (t.ticker) tickers.add(t.ticker);
    });
    return Array.from(tickers);
  }
}
