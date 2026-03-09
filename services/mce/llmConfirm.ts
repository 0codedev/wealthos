// services/mce/llmConfirm.ts
// Institutional AI Second Opinion layer for the Momentum Continuation Card.
// Routes to Ant Group's Ling-3.0-flash-Fin (via OpenRouter) with Agnostic Intelligent Routing fallback.

import { llmPipeline } from '../llm';
import { logger } from '../Logger';
import type { McsSubScore, GexFeatureVector } from './types';

export interface LlmConfirmRequest {
  symbol: string;
  totalScore: number;
  verdict: 'FIRE' | 'WAIT' | 'ABORT';
  confidence: number;
  subScores: {
    htf: McsSubScore;
    indicators: McsSubScore;
    flow: McsSubScore;
    regime: McsSubScore;
    gex: McsSubScore;
  };
  gexSnapshot?: GexFeatureVector | null;
}

export interface LlmConfirmResponse {
  verdictSummary: string;
  bulletPoints: string[];
  recommendedAction: string;
  modelUsed: string;
  rawText: string;
}

export async function consultFinanceAi(req: LlmConfirmRequest): Promise<LlmConfirmResponse> {
  const { symbol, totalScore, verdict, confidence, subScores, gexSnapshot } = req;

  const prompt = `You are the Chief Quantitative Strategist for an institutional proprietary trading desk.
Analyze the following multi-lens Momentum Continuation Snapshot for Indian Equities (NSE F&O).

--- SYMBOL TELEMETRY ---
Symbol: ${symbol}
Total Confluence Score: ${totalScore} / 100
Mathematical Engine Verdict: ${verdict} (Confidence: ${Math.round(confidence * 100)}%)

--- 5 LENS INPUT BREAKDOWN ---
1. Higher Timeframe Context (${Math.round(subScores.htf.value * 100)}%):
   Reasons: ${subScores.htf.reason || 'Normal range'}

2. Technical Indicators (${Math.round(subScores.indicators.value * 100)}%):
   Reasons: ${subScores.indicators.reason || 'Normal momentum'}

3. Order Flow & Derivatives (${Math.round(subScores.flow.value * 100)}%):
   Reasons: ${subScores.flow.reason || 'Balanced books'}

4. Market Regime Context (${Math.round(subScores.regime.value * 100)}%):
   Reasons: ${subScores.regime.reason || 'Neutral market'}

5. Dealer Gamma / GEX (${Math.round(subScores.gex.value * 100)}%):
   Reasons: ${subScores.gex.reason || 'Standard chain'}
   ${gexSnapshot?.netGexCrores != null ? `Net GEX: ₹${gexSnapshot.netGexCrores.toFixed(1)} Cr` : ''}
   ${gexSnapshot?.magnetStrike != null ? `Magnet Strike: ${gexSnapshot.magnetStrike}` : ''}

--- TASK ---
Provide a concise, institutional, 3-part qualitative second opinion:
1. One-sentence strategic verdict (confirm or counter the ${verdict} math).
2. Exactly 2-3 bullet points highlighting key microstructure risks or catalysts (e.g. gamma wall absorption, VWAP distance, sector divergence).
3. Recommended execution tactic (e.g., "Full Size at Market", "Scale in with 50% size", "Wait for pullback to VWAP", "Avoid trade").

Keep it punchy, professional, and directly actionable. Avoid generic textbook disclaimers.`;

  try {
    const res = await llmPipeline(prompt, {
      modelOverride: 'inclusionai/ling-3.0-flash-fin',
      requireHighIntelligence: true,
      temperature: 0.2,
      maxTokens: 500,
    });

    const text = res.text || '';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    const bulletPoints = lines
      .filter(l => l.startsWith('-') || l.startsWith('*') || l.startsWith('•') || /^\d+\./.test(l))
      .map(l => l.replace(/^[-*•\d.]\s*/, '').trim())
      .slice(0, 3);

    const verdictSummary = lines[0]?.replace(/^#+\s*/, '') || `${verdict} confirmed by Finance AI`;
    const recommendedAction = lines.find(l => /recommend|action|tactic/i.test(l)) || lines[lines.length - 1] || 'Monitor price action';

    return {
      verdictSummary,
      bulletPoints: bulletPoints.length > 0 ? bulletPoints : [text.slice(0, 150)],
      recommendedAction,
      modelUsed: res.provider || 'Ling-3.0-Fin / Gemini',
      rawText: text,
    };
  } catch (err: any) {
    logger.error('[llmConfirm] Finance AI consultation error', { error: err?.message });
    throw err;
  }
}
