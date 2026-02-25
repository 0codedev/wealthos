import { sanitizeInput } from '../utils/security';
import { Investment, AIContextPolicy } from '../types';
import { computePortfolioView, getAllocationSummary } from '../lib/domain/portfolio';
import { db, Trade, Mistake, Goal, IPOApplication } from '../database';

export const DEFAULT_AI_CONTEXT_POLICY: AIContextPolicy = {
    includeAbsoluteValues: false,
    includeHoldings: true,
    includeAllocationBreakdown: true,
    includeSensitiveBrokerFields: false,
};

const round2 = (value: number) => Number(value.toFixed(2));

export const buildPortfolioAIContext = (
    investments: Investment[],
    totalNetWorth: string,
    policy: Partial<AIContextPolicy> = {}
) => {
    const mergedPolicy = { ...DEFAULT_AI_CONTEXT_POLICY, ...policy };
    const totalNetWorthNumber = Number(totalNetWorth.replace(/[^0-9.-]+/g, '')) || 0;
    const computed = computePortfolioView(investments);
    const allocationSummary = getAllocationSummary(investments).slice(0, 6);

    const holdings = mergedPolicy.includeHoldings
        ? computed.normalizedInvestments
            .filter((investment) => investment.status !== 'ARCHIVED')
            .slice(0, 20)
            .map((investment) => ({
                name: sanitizeInput(investment.name, 80),
                ticker: sanitizeInput(investment.ticker || '', 24) || undefined,
                type: investment.type,
                platform: mergedPolicy.includeSensitiveBrokerFields ? investment.platform : undefined,
                allocationPercent: computed.stats.totalAssets > 0
                    ? round2(((investment.currentValue || 0) / computed.stats.totalAssets) * 100)
                    : 0,
                currentValue: mergedPolicy.includeAbsoluteValues ? investment.currentValue : undefined,
                investedAmount: mergedPolicy.includeAbsoluteValues ? investment.investedAmount : undefined,
            }))
        : [];

    const contextObject = {
        policy: mergedPolicy,
        netWorth: mergedPolicy.includeAbsoluteValues ? totalNetWorthNumber : undefined,
        stats: {
            totalAssets: mergedPolicy.includeAbsoluteValues ? computed.stats.totalAssets : undefined,
            totalInvested: mergedPolicy.includeAbsoluteValues ? computed.stats.totalInvested : undefined,
            totalGainPercent: computed.stats.totalGainPercent,
            diversityScore: computed.stats.diversityScore,
            topAsset: computed.stats.topAsset,
        },
        allocation: mergedPolicy.includeAllocationBreakdown ? allocationSummary : [],
        holdings,
    };

    const summaryLines = [
        `CONF: abs=${mergedPolicy.includeAbsoluteValues}, hld=${mergedPolicy.includeHoldings}, alc=${mergedPolicy.includeAllocationBreakdown}, brk=${mergedPolicy.includeSensitiveBrokerFields}`,
        `STAT: gain=${computed.stats.totalGainPercent}%, div=${computed.stats.diversityScore}, top=${computed.stats.topAsset.name}(${computed.stats.topAsset.percent.toFixed(1)}%)`,
    ];

    if (mergedPolicy.includeAllocationBreakdown && allocationSummary.length > 0) {
        summaryLines.push(
            `ALC: ${allocationSummary
                .map((entry) => `${entry.name} ${entry.weight}%`)
                .join(', ')}`
        );
    }

    if (mergedPolicy.includeHoldings && holdings.length > 0) {
        summaryLines.push(
            `HLD: ${holdings
                .map((holding) => `${holding.ticker || holding.name} ${holding.allocationPercent}%`)
                .join('; ')}`
        );
    }

    if (mergedPolicy.includeAbsoluteValues) {
        summaryLines.push(`Absolute Net Worth (explicit opt-in): ${totalNetWorth}`);
    }

    return {
        policy: mergedPolicy,
        contextObject,
        contextText: summaryLines.join('\n'),
    };
};

export const safeParseJsonBlock = <T>(rawResponse: string): T | null => {
    const cleaned = rawResponse.replace(/```json|```/g, '').trim();
    const objectStart = cleaned.indexOf('{');
    const objectEnd = cleaned.lastIndexOf('}');

    if (objectStart === -1 || objectEnd === -1 || objectEnd <= objectStart) {
        return null;
    }

    try {
        return JSON.parse(cleaned.slice(objectStart, objectEnd + 1)) as T;
    } catch {
        return null;
    }
};

/**
 * Summarizes trading history for AI context
 */
export const summarizeTrades = (trades: Trade[]) => {
    if (trades.length === 0) return "No trade history available yet.";
    
    const recentTrades = trades.slice(-15).reverse();
    const winRate = (trades.filter(t => (t.pnl || 0) > 0).length / trades.length) * 100;
    const avgPnl = trades.reduce((acc, t) => acc + (t.pnl || 0), 0) / trades.length;
    
    const pnlBySetup: Record<string, number> = {};
    trades.forEach(t => {
        const setup = t.setup || 'Unknown';
        pnlBySetup[setup] = (pnlBySetup[setup] || 0) + (t.pnl || 0);
    });

    const bestSetup = Object.entries(pnlBySetup).sort((a, b) => b[1] - a[1])[0];

    return [
        `Historical Win Rate: ${winRate.toFixed(1)}%`,
        `Average PnL per Trade: ₹${avgPnl.toFixed(2)}`,
        `Best Setup by PnL: ${bestSetup ? `${bestSetup[0]} (₹${bestSetup[1].toFixed(0)})` : 'None'}`,
        `Recent 5 Trades: ${recentTrades.slice(0, 5).map(t => `${t.ticker} (${t.direction}) ${t.pnl && t.pnl > 0 ? 'WON' : 'LOST'} ₹${Math.abs(t.pnl || 0).toFixed(0)}`).join('; ')}`
    ].join('\n');
};

/**
 * Summarizes behavioral mistakes for AI context
 */
export const summarizeMistakes = (mistakes: Mistake[]) => {
    if (mistakes.length === 0) return "No behavioral mistakes logged. User appears disciplined.";
    
    const categoryCount: Record<string, number> = {};
    mistakes.forEach(m => {
        categoryCount[m.title] = (categoryCount[m.title] || 0) + 1;
    });

    const topMistake = Object.entries(categoryCount).sort((a, b) => b[1] - a[1])[0];
    const totalCost = mistakes.reduce((acc, m) => acc + m.cost, 0);

    return [
        `Total Behavioral Leaks: ${mistakes.length}`,
        `Total Cost of Mistakes: ₹${totalCost.toLocaleString()}`,
        `Most Frequent Issue: ${topMistake ? `${topMistake[0]} (${topMistake[1]} instances)` : 'None'}`,
        `Recent Lessons: ${mistakes.slice(-3).map(m => m.lesson).join('; ')}`
    ].join('\n');
};

/**
 * Summarizes financial goals for AI context
 */
export const summarizeGoals = (goals: Goal[]) => {
    if (goals.length === 0) return "No specific financial goals defined.";
    
    return goals.map(g => {
        const progress = (g.currentAmount / g.targetAmount) * 100;
        return `- Goal: ${g.name}, Target: ₹${g.targetAmount.toLocaleString()}, Progress: ${progress.toFixed(1)}%, ETA: ${g.targetDate}`;
    }).join('\n');
};

/**
 * Builds a unified context for Ambient AI Coach
 * Note: Strictly enforces PII masking by default.
 */
export const buildAmbientAIContext = async (investments: Investment[], totalNetWorth: string) => {
    // Memory Limit: Only fetch recent items to prevent token bloat
    const trades = await db.trades.orderBy('date').reverse().limit(100).toArray();
    const mistakes = await db.mistakes.orderBy('date').reverse().limit(30).toArray();
    const goals = await db.goals.limit(10).toArray(); // Only top 10 goals
    const ipos = await db.ipo_applications.limit(20).toArray();
    
    // Masked Context: Never send absolute currency values to the AI
    const portfolioContext = buildPortfolioAIContext(investments, totalNetWorth, { includeAbsoluteValues: false });
    
    // Trade Summary with masking
    const winRate = trades.length > 0 ? (trades.filter(t => (t.pnl || 0) > 0).length / trades.length) * 100 : 0;
    const tradeSummary = `Recent Activity: ${trades.length} trades recorded (capped at 100). Success Ratio: ${winRate.toFixed(1)}%. Average ROI: [MASKED]%`;

    // Mistake Summary with masking
    const totalMistakes = mistakes.length;
    const mistakeSummary = `Behavioral Health: ${totalMistakes} recent mistakes tracked. Primary trigger: ${Object.entries(mistakes.reduce((acc, m) => ({ ...acc, [m.category]: (acc[m.category] || 0) + 1 }), {} as Record<string, number>)).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown'}.`;

    // Goal Summary with masking
    const goalSummary = goals.length > 0 
        ? goals.map(g => `- ${g.name}: ${((g.currentAmount / g.targetAmount) * 100).toFixed(1)}% complete (Target Date: ${g.targetDate})`).join('\n')
        : "No active goals.";
    
    const activeIpos = ipos.filter(i => i.status === 'BLOCKED');
    const ipoCapital = activeIpos.reduce((acc, i) => acc + i.amount, 0);
    const ipoContext = `IPO Radar: ${activeIpos.length} active applications. Capital Allocation: [MASKED]%.`;

    const ambientText = [
        "### PORTFOLIO STATE",
        portfolioContext.contextText,
        "",
        "### TRADING BEHAVIOR & PATTERNS",
        tradeSummary,
        "",
        "### BEHAVIORAL LEAKS & LESSONS",
        mistakeSummary,
        "",
        "### FINANCIAL GOALS",
        goalSummary,
        "",
        "### IPO EXPOSURE",
        `Active Applications: ${activeIpos.length}`,
        `Capital Blocked: [MASKED]`,
        `Recent IPOs: ${ipos.slice(0, 3).map(i => i.ipoName).join(', ')}` // Take from the start since we didn't reverse ipos
    ].join('\n');

    return {
        text: ambientText,
        investments,
        trades,
        mistakes,
        goals,
        ipoCapital
    };
};
