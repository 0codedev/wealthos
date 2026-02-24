import { db } from '../database';

const BRIDGE_URL = '/api/agentic-bridge';

export interface AgenticJobStatus {
  job_id: string;
  ticker: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  current_phase?: string;
  stats: {
    llm_calls: number;
    tool_calls: number;
    tokens_in: number;
    tokens_out: number;
  };
  result?: {
    verdict: string;
    report_md: string;
    final_state: any;
  };
  error?: string;
}

export const agenticService = {
  /**
   * Starts a new AI analysis for a ticker.
   */
  async startAnalysis(ticker: string): Promise<string> {
    try {
      const response = await fetch(`${BRIDGE_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      
      if (!response.ok) throw new Error('Failed to connect to TradingAgents Bridge');
      
      const data = await response.json();
      return data.job_id;
    } catch (error) {
      console.error('Agentic Service Error:', error);
      throw error;
    }
  },

  /**
   * Checks the status of a specific job.
   */
  async checkStatus(jobId: string): Promise<AgenticJobStatus> {
    const response = await fetch(`${BRIDGE_URL}/status/${jobId}`);
    if (!response.ok) throw new Error('Job not found or Bridge offline');
    return await response.json();
  },

  /**
   * Saves the completed AI analysis to a specific trade record.
   */
  async archiveToTrade(tradeId: number, result: AgenticJobStatus['result']) {
    if (!result) return;
    
    await db.trades.update(tradeId, {
      aiVerdict: result.verdict as any,
      aiConvictionScore: this.extractConvictionScore(result.report_md),
      aiFullLog: result.report_md,
      reviewStatus: 'ANNOTATED'
    });
  },

  /**
   * Helper to parse conviction score from the report.
   */
  extractConvictionScore(markdown: string): number {
    // Simple regex to find a percentage or score if we decide to add one
    const match = markdown.match(/Conviction Score:\s*(\d+)%/);
    return match ? parseInt(match[1]) : 85; // Defaulting to high conviction if not found for now
  }
};
