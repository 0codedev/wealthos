import { ScreenerConfig, ScreenerResult } from '../../types/backtester.types';

/**
 * ScreenerService
 * 
 * Communicates with the Python NSE Bridge to run multi-symbol screening
 * and retrieve the F&O stock list.
 */
export class ScreenerService {
  
  /**
   * Runs the server-side multi-symbol backtest/screener.
   */
  static async runScreener(config: ScreenerConfig): Promise<ScreenerResult> {
    try {
      const response = await fetch('/api/python-nse/api/backtest/screener', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Screener execution failed on the backend.');
      }

      return await response.json();
    } catch (error: unknown) {
      console.error('[ScreenerService] Error running screener:', error);
      throw error;
    }
  }

  /**
   * Fetches the full list of F&O stocks and their sectors.
   */
  static async fetchFnOList(): Promise<{ symbol: string; sector: string }[]> {
    try {
      const response = await fetch('/api/python-nse/api/upstox/instruments/fno-list');
      if (!response.ok) {
        throw new Error('Failed to retrieve F&O stocks universe.');
      }
      return await response.json();
    } catch (error: unknown) {
      console.error('[ScreenerService] Error fetching F&O list:', error);
      throw error;
    }
  }
}
