/**
 * VibeTradingService.ts
 * WealthOS React Frontend API Service for Vibe-Trading AI Research Engine
 *
 * Auth strategy: The browser automatically sends the `wealthos_session` cookie
 * (set on domain `.wealthos-sudhanshu.xyz` at login) on every cross-subdomain
 * request. No API key is stored in frontend code.
 */

const VIBE_TRADING_BASE_URL = import.meta.env.VITE_VIBE_TRADING_URL || 'https://vibe.wealthos-sudhanshu.xyz';

export interface VibeSession {
  id: string;
  created_at: string;
  message_count: number;
}

export interface VibeBacktestMetrics {
  total_return: number;
  annual_return: number;
  max_drawdown: number;
  sharpe: number;
  sortino: number;
  win_rate: number;
  profit_factor: number;
  trade_count: number;
  excess_return: number;
}

export class VibeTradingService {
  /** Headers for JSON API calls — no API key; the shared SSO cookie handles auth */
  private static getJsonHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json' };
  }

  /** Check API health */
  static async checkHealth(): Promise<boolean> {
    try {
      const resp = await fetch(`${VIBE_TRADING_BASE_URL}/health`, {
        credentials: 'include', // ← send wealthos_session cookie
        headers: this.getJsonHeaders(),
      });
      return resp.ok;
    } catch (e) {
      console.warn('Vibe-Trading API health check failed:', e);
      return false;
    }
  }

  /** Run a research or backtest prompt */
  static async runPrompt(prompt: string): Promise<{ run_id?: string; output?: string; status: string }> {
    const resp = await fetch(`${VIBE_TRADING_BASE_URL}/api/runs`, {
      method: 'POST',
      credentials: 'include', // ← send wealthos_session cookie
      headers: this.getJsonHeaders(),
      body: JSON.stringify({ prompt }),
    });
    if (!resp.ok) {
      throw new Error(`Vibe-Trading API error (${resp.status}): ${await resp.text()}`);
    }
    return await resp.json();
  }

  /** Fetch active scheduled research jobs */
  static async getScheduledResearchJobs(): Promise<any[]> {
    const resp = await fetch(`${VIBE_TRADING_BASE_URL}/api/scheduled-jobs`, {
      credentials: 'include', // ← send wealthos_session cookie
      headers: this.getJsonHeaders(),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.jobs || [];
  }

  /** Upload Dhan trade journal CSV for Shadow Account analysis */
  static async uploadTradeJournal(file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);

    const resp = await fetch(`${VIBE_TRADING_BASE_URL}/api/upload`, {
      method: 'POST',
      credentials: 'include', // ← send wealthos_session cookie
      body: formData,
    });

    if (!resp.ok) {
      throw new Error(`Failed to upload trade journal: ${await resp.text()}`);
    }
    return await resp.json();
  }
}
