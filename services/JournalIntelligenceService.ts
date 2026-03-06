import { Trade } from '../database';
import { getBrokerReviewQueue } from './BrokerReviewWorkflowService';
import { llmPipeline } from './llm';
import { logger } from './Logger';

export interface JournalInsight {
    id: string;
    title: string;
    description: string;
    severity: 'high' | 'medium' | 'low';
    metric?: string;
}

const getTradeHour = (trade: Trade): number | null => {
    if (!trade.entryTime) return null;
    const hour = Number(trade.entryTime.split(':')[0]);
    return Number.isFinite(hour) ? hour : null;
};

/**
 * Standard rule-based analysis (Fast, Local)
 */
export const analyzeTradePatterns = (trades: Trade[]): JournalInsight[] => {
    if (trades.length === 0) return [];

    const insights: JournalInsight[] = [];
    const needsReview = getBrokerReviewQueue(trades);

    if (needsReview.length > 0) {
        insights.push({
            id: 'review-queue',
            title: 'Review Queue Open',
            description: `${needsReview.length} broker trade${needsReview.length > 1 ? 's need' : ' needs'} annotation before the learning loop is complete.`,
            severity: 'high',
            metric: `${needsReview.length}`,
        });
    }

    const lateTrades = trades.filter((trade) => {
        const hour = getTradeHour(trade);
        return hour !== null && hour >= 14;
    });
    const latePnL = lateTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
    if (lateTrades.length >= 3 && latePnL < 0) {
        insights.push({
            id: 'late-day-drag',
            title: 'Late-Day Drag',
            description: 'Trades entered after 2 PM are underperforming. Tighten your late-session rules.',
            severity: 'medium',
            metric: latePnL.toFixed(0),
        });
    }

    const emotionalTrades = trades.filter((trade) =>
        trade.moodEntry === 'Revenge' || trade.forcedTrade || (trade.fomoLevel || 0) >= 7
    );
    if (emotionalTrades.length > 0) {
        insights.push({
            id: 'emotional-drift',
            title: 'Process Drift Detected',
            description: `${emotionalTrades.length} trade${emotionalTrades.length > 1 ? 's show' : ' shows'} emotional or forced execution behavior.`,
            severity: 'high',
            metric: `${emotionalTrades.length}`,
        });
    }

    const setupMap = new Map<string, { pnl: number; count: number }>();
    trades.forEach((trade) => {
        let setup = trade.setup || 'No Setup';
        if (setup === 'Dhan Auto-Sync') setup = 'DAS';
        const current = setupMap.get(setup) || { pnl: 0, count: 0 };
        current.pnl += trade.pnl || 0;
        current.count += 1;
        setupMap.set(setup, current);
    });

    const rankedSetups = [...setupMap.entries()]
        .filter(([, value]) => value.count >= 2)
        .map(([setup, value]) => ({ setup, avgPnL: value.pnl / value.count }))
        .sort((left, right) => right.avgPnL - left.avgPnL);

    if (rankedSetups.length > 0) {
        const best = rankedSetups[0];
        insights.push({
            id: 'best-setup',
            title: 'Best Setup Edge',
            description: `${best.setup} is your strongest repeatable setup in the current sample.`,
            severity: 'low',
            metric: `${best.avgPnL.toFixed(0)} avg`,
        });
    }

    return insights.slice(0, 4);
};

/**
 * Context Compression: Condenses older trades into dense metadata.
 */
function condenseJournalHistory(trades: Trade[]): string {
    if (trades.length === 0) return "No historical data.";
    
    let totalPnl = 0;
    let winCount = 0;
    let lossCount = 0;
    let emotionalCount = 0;
    
    trades.forEach(t => {
        totalPnl += (t.pnl || 0);
        if ((t.pnl || 0) > 0) winCount++;
        else if ((t.pnl || 0) < 0) lossCount++;
        if (t.moodEntry === 'Revenge' || t.forcedTrade || (t.fomoLevel || 0) >= 7) emotionalCount++;
    });

    return `HISTORICAL CONTEXT (Compressed ${trades.length} trades): 
    Net PnL: ${totalPnl.toFixed(0)} 
    Win/Loss: ${winCount}W / ${lossCount}L 
    Emotional Trade Count: ${emotionalCount}`;
}

/**
 * AI-Powered Deep Journal Intelligence
 * Analyzes trade notes, mood, and execution for behavioral patterns.
 */
export async function getDeepJournalAnalysis(trades: Trade[]): Promise<string> {
    if (trades.length === 0) return "No trades to analyze yet. Start logging your trades to get AI insights.";

    // Split into recent vs historical for context compression
    const RECENT_LIMIT = 10;
    const recentTrades = trades.slice(-RECENT_LIMIT);
    const historicalTrades = trades.slice(0, -RECENT_LIMIT);

    const historicalSummary = historicalTrades.length > 0 
        ? condenseJournalHistory(historicalTrades) 
        : "No extended history.";

    // Sample the recent trades for deep context
    const recentSample = recentTrades.map(t => ({
        ticker: t.ticker,
        pnl: t.pnl,
        setup: t.setup,
        mood: t.moodEntry,
        fomo: t.fomoLevel,
        forced: t.forcedTrade,
        notes: t.notes?.substring(0, 100),
        time: t.entryTime
    }));

    const prompt = `ROLE: Trading Psychologist.
${historicalSummary}

RECENT (Deep Dive):
${JSON.stringify(recentSample, null, 2)}

GOAL: Identify the "Invisible Enemy" (e.g., Revenge, FOMO, Fear).

RULES:
1. Punchy, direct, skeptical.
2. Identify ONE behavioral bottleneck.
3. Suggest ONE specific "Circuit Breaker" rule.
4. Use numbers.

JSON ONLY:
{
  "enemy": "Name",
  "analysis": "Direct explanation using data",
  "rule": "Specific instruction"
}`;

    try {
        const result = await llmPipeline(prompt, {
            modelOverride: 'gemini-3.1-flash-lite-preview',
            requireHighIntelligence: false,
            jsonMode: true
        });
        
        const parsed = JSON.parse(result.text.replace(/```json|```/g, '').trim());
        return `### THE INVISIBLE ENEMY: ${parsed.enemy}\n${parsed.analysis}\n\n### CIRCUIT BREAKER\n${parsed.rule}`;
    } catch (error) {
        logger.error("JournalIntelligence: AI analysis failed", error);
        return "I'm having trouble analyzing your journal right now. Please try again later.";
    }
}


