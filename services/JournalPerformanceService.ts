import { Trade } from '../database';

export interface SetupPerformance {
    setup: string;
    count: number;
    winRate: number;
    avgPnL: number;
    expectancy: number;
    processScore: number;
}

export interface JournalCoachingSummary {
    tradeCount: number;
    expectancy: number;
    averageRMultiple: number;
    processScore: number;
    averageMae: number;
    averageMfe: number;
    efficiencyScore: number;
    bestSetup?: SetupPerformance;
    weakestSetup?: SetupPerformance;
    coachingNotes: string[];
}

const safeNumber = (value?: number) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const inferRMultiple = (trade: Trade): number => {
    if (typeof trade.riskRewardRatio === 'number' && Number.isFinite(trade.riskRewardRatio)) {
        return trade.riskRewardRatio;
    }

    if (trade.stopLoss === undefined || trade.stopLoss === trade.entryPrice || trade.exitPrice === undefined) {
        return 0;
    }

    if (trade.direction === 'Long') {
        const risk = trade.entryPrice - trade.stopLoss;
        const reward = trade.exitPrice - trade.entryPrice;
        return risk !== 0 ? reward / risk : 0;
    }

    const risk = trade.stopLoss - trade.entryPrice;
    const reward = trade.entryPrice - trade.exitPrice;
    return risk !== 0 ? reward / risk : 0;
};

const inferProcessScore = (trade: Trade): number => {
    let score = safeNumber(trade.complianceScore) || 70;

    if (trade.reviewStatus === 'ANNOTATED') score += 10;
    else if (trade.reviewStatus === 'READY_FOR_LESSON') score += 6;
    else if (trade.reviewStatus === 'NEEDS_SCREENSHOTS') score -= 4;
    else if (trade.reviewStatus === 'NEEDS_ANNOTATION') score -= 8;

    if ((trade.mistakes || []).length > 0) score -= Math.min(20, trade.mistakes!.length * 5);
    if (trade.forcedTrade) score -= 12;
    if ((trade.fomoLevel || 0) >= 7) score -= 8;
    if (trade.checklist?.completed) score += 8;
    if (trade.wouldTakeAgain) score += 4;
    if (trade.isTextbook) score += 6;
    if (trade.coreLesson?.trim()) score += 4;

    return Math.max(0, Math.min(100, score));
};

const getTradeMae = (trade: Trade): number => {
    if (typeof trade.mae === 'number') return trade.mae;
    const pnl = safeNumber(trade.pnl);
    return pnl < 0 ? pnl : 0;
};

const getTradeMfe = (trade: Trade): number => {
    if (typeof trade.mfe === 'number') return trade.mfe;
    const pnl = safeNumber(trade.pnl);
    return pnl > 0 ? pnl : 0;
};

export const rankSetups = (trades: Trade[]): SetupPerformance[] => {
    const setupMap = new Map<string, Trade[]>();

    for (const trade of trades) {
        let setup = trade.setup || 'No Setup';
        if (setup === 'Dhan Auto-Sync') setup = 'DAS';
        const current = setupMap.get(setup) || [];
        current.push(trade);
        setupMap.set(setup, current);
    }

    return [...setupMap.entries()]
        .map(([setup, setupTrades]) => {
            const count = setupTrades.length;
            const wins = setupTrades.filter((trade) => safeNumber(trade.pnl) > 0).length;
            const totalPnL = setupTrades.reduce((sum, trade) => sum + safeNumber(trade.pnl), 0);
            const totalR = setupTrades.reduce((sum, trade) => sum + inferRMultiple(trade), 0);
            const totalProcess = setupTrades.reduce((sum, trade) => sum + inferProcessScore(trade), 0);

            return {
                setup,
                count,
                winRate: count > 0 ? (wins / count) * 100 : 0,
                avgPnL: count > 0 ? totalPnL / count : 0,
                expectancy: count > 0 ? totalR / count : 0,
                processScore: count > 0 ? totalProcess / count : 0,
            };
        })
        .filter((item) => item.count > 0)
        .sort((left, right) => right.expectancy - left.expectancy);
};

export const summarizeJournalPerformance = (trades: Trade[]): JournalCoachingSummary => {
    const closedTrades = trades.filter((trade) => trade.exitPrice !== undefined);
    if (closedTrades.length === 0) {
        return {
            tradeCount: 0,
            expectancy: 0,
            averageRMultiple: 0,
            processScore: 0,
            averageMae: 0,
            averageMfe: 0,
            efficiencyScore: 0,
            coachingNotes: ['Log and close more trades to unlock the coaching engine.'],
        };
    }

    const totalR = closedTrades.reduce((sum, trade) => sum + inferRMultiple(trade), 0);
    const processScore = closedTrades.reduce((sum, trade) => sum + inferProcessScore(trade), 0) / closedTrades.length;
    const averageMae = closedTrades.reduce((sum, trade) => sum + Math.abs(getTradeMae(trade)), 0) / closedTrades.length;
    const averageMfe = closedTrades.reduce((sum, trade) => sum + Math.abs(getTradeMfe(trade)), 0) / closedTrades.length;
    const efficiencyScore = averageMfe > 0
        ? Math.max(0, Math.min(100, 100 - (averageMae / averageMfe) * 50))
        : 50;

    const rankedSetups = rankSetups(closedTrades).filter((setup) => setup.count >= 2);
    const bestSetup = rankedSetups[0];
    const weakestSetup = [...rankedSetups].sort((left, right) => left.expectancy - right.expectancy)[0];

    const coachingNotes: string[] = [];
    const expectancy = totalR / closedTrades.length;
    if (expectancy <= 0) coachingNotes.push('Expectancy is flat or negative. Tighten entries or reduce weak setups.');
    else coachingNotes.push(`Expectancy is positive at ${expectancy.toFixed(2)}R per trade. Protect that edge.`);

    if (processScore < 65) coachingNotes.push('Process score is slipping. Review mistakes, checklist use, and annotation discipline.');
    else if (processScore > 80) coachingNotes.push('Process quality is strong. Keep the review loop tight and consistent.');

    if (efficiencyScore < 55) coachingNotes.push('Trades are taking too much pain relative to their upside. Refine stops or entry timing.');
    else if (efficiencyScore > 75) coachingNotes.push('MAE/MFE efficiency is healthy. Your entries are capturing upside with controlled drawdown.');

    if (bestSetup) coachingNotes.push(`${bestSetup.setup} is leading your setup leaderboard right now.`);
    if (weakestSetup && weakestSetup.setup !== bestSetup?.setup) coachingNotes.push(`${weakestSetup.setup} is lagging and may need tighter rules or lower size.`);

    return {
        tradeCount: closedTrades.length,
        expectancy,
        averageRMultiple: expectancy,
        processScore,
        averageMae,
        averageMfe,
        efficiencyScore,
        bestSetup,
        weakestSetup,
        coachingNotes,
    };
};

/**
 * Syncs trade records to local Ghostfolio instance.
 */
export async function syncTradesToGhostfolio(trades: Trade[]): Promise<boolean> {
    try {
        const GHOSTFOLIO_API_URL = 'http://localhost:3333/api/v1/order';
        const token = 'ghostfolio_mcp_api_key_2026';
        
        for (const trade of trades) {
            const payload = {
                symbol: `${trade.ticker}.NS`,
                dataSource: 'YAHOO',
                date: new Date(trade.date).toISOString(),
                quantity: trade.quantity || 1,
                unitPrice: trade.entryPrice,
                type: trade.direction === 'Long' ? 'BUY' : 'SELL',
                currency: 'INR'
            };
            
            const res = await fetch(GHOSTFOLIO_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                console.warn(`[Ghostfolio Sync] Failed to sync trade ${trade.id}`, await res.text().catch(() => ''));
            }
        }
        return true;
    } catch (err) {
        console.error('[Ghostfolio Sync] Error:', err);
        return false;
    }
}

/**
 * Syncs expense/transaction records to local Firefly III instance.
 */
export async function syncExpenseToFirefly(
    description: string,
    amount: number,
    category: string,
    date: string
): Promise<boolean> {
    try {
        const FIREFLY_API_URL = 'http://localhost:8080/api/v1/transactions';
        const token = 'firefly_iii_mcp_api_key_2026';
        
        const payload = {
            transactions: [{
                type: 'withdrawal',
                description,
                amount: amount.toFixed(2),
                date: new Date(date).toISOString(),
                category_name: category,
                source_name: 'Main Wallet',
                destination_name: 'External Expense'
            }]
        };
        
        const res = await fetch(FIREFLY_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        return res.ok;
    } catch (err) {
        console.error('[Firefly III Sync] Error:', err);
        return false;
    }
}


