import { askGemini } from '../aiService';
import { BacktestResult } from '../../types/backtester.types';
import { db } from '../../database';
import { MonteCarloResult } from './MonteCarloSimulator';
import { WalkForwardResult } from './WalkForwardOptimizer';

export interface AIStrategyVerdict {
  verdict: 'ADOPT' | 'REFINE' | 'REJECT';
  reasoning: string;
  identifiedEdge: string;
  riskWarnings: string[];
  suggestions: string[];
  psychologicalFitScore: number; // 0-100
}

export class AIStrategyAdvisorService {
  
  static async analyzeStrategy(
    result: BacktestResult,
    mcResult: MonteCarloResult | null,
    wfResult: WalkForwardResult | null
  ): Promise<AIStrategyVerdict> {
    
    // 1. Fetch user context for psychological fit
    const context = await this.getUserContext();
    
    // 2. Build the prompt
    const prompt = this.buildPrompt(result, mcResult, wfResult, context);
    
    // 3. Call Gemini
    const fullResponse = await askGemini(prompt, true); // true for Pro model

    // 4. Parse the response (assuming JSON structure from Gemini)
    try {
      // Find JSON block if Gemini adds conversational text
      const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
      const cleanedJson = jsonMatch ? jsonMatch[0] : fullResponse;
      return JSON.parse(cleanedJson);
    } catch (error) {
      console.error('Failed to parse AI Verdict', error, fullResponse);
      return {
        verdict: 'REFINE',
        reasoning: 'The AI analysis was generated but failed to parse into the dashboard format. Please review the raw output.',
        identifiedEdge: 'Inconclusive',
        riskWarnings: ['AI Parsing Error'],
        suggestions: ['Review the raw response for insights'],
        psychologicalFitScore: 50
      };
    }
  }

  private static async getUserContext(): Promise<string> {
    const trades = await db.trades.orderBy('date').reverse().limit(50).toArray();
    
    const topMistakes = new Map<string, number>();
    const commonMoods = new Map<string, number>();
    
    trades.forEach(t => {
      t.mistakes?.forEach(m => topMistakes.set(m, (topMistakes.get(m) || 0) + 1));
      if (t.moodEntry) commonMoods.set(t.moodEntry, (commonMoods.get(t.moodEntry) || 0) + 1);
    });

    const sortedMistakes = Array.from(topMistakes.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
    const sortedMoods = Array.from(commonMoods.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);

    return `
      User's Top Mistakes: ${sortedMistakes.join(', ') || 'None reported'}
      User's Dominant Moods: ${sortedMoods.join(', ') || 'None reported'}
      Recent Performance: ${trades.length} trades analyzed for context.
    `;
  }

  private static buildPrompt(
    result: BacktestResult,
    mcResult: MonteCarloResult | null,
    wfResult: WalkForwardResult | null,
    userContext: string
  ): string {
    const { config, metrics } = result;
    const { strategy } = config;

    return `
      You are a world-class Quantitative Strategy Analyst at a top-tier hedge fund. 
      Analyze the following backtest results and provide a structured verdict.

      ### STRATEGY DEFINITION
      Name: ${strategy.name}
      Rules: ${JSON.stringify(strategy.entryRules)}
      Exit Rules: ${JSON.stringify(strategy.exitRules)}
      Position Sizing: ${JSON.stringify(strategy.positionSizing)}

      ### PERFORMANCE METRICS
      CAGR: ${metrics.cagr.toFixed(2)}%
      Max Drawdown: ${metrics.maxDrawdownPercent.toFixed(2)}%
      Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}
      Profit Factor: ${metrics.profitFactor.toFixed(2)}
      Win Rate: ${(metrics.winRate * 100).toFixed(2)}%
      Expectancy: ${metrics.expectancy.toFixed(2)}

      ### ROBUSTNESS TESTS
      Monte Carlo Risk of Ruin: ${mcResult?.riskOfRuin.toFixed(2) || 'N/A'}%
      Walk-Forward Robustness Score: ${wfResult?.robustnessScore.toFixed(2) || 'N/A'}%
      Median Monte Carlo Equity: ${mcResult?.medianFinalEquity.toFixed(2) || 'N/A'}

      ### USER PSYCHOLOGICAL CONTEXT
      ${userContext}

      ### TASK
      Evaluate if this strategy is ready for live trading. 
      Consider the "Psychological Fit Score" based on whether the strategy's drawdown/volatility matches the user's documented moods (e.g., if user is often 'Anxious', high drawdown is a bad fit).

      Return your response in STRICT JSON format with this structure:
      {
        "verdict": "ADOPT" | "REFINE" | "REJECT",
        "reasoning": "A concise overview of why this verdict was chosen.",
        "identifiedEdge": "What specifically gives this strategy a statistical advantage.",
        "riskWarnings": ["List of 2-3 specific risks"],
        "suggestions": ["List of 2-3 concrete ways to improve the strategy"],
        "psychologicalFitScore": number (0-100)
      }
    `;
  }
}
