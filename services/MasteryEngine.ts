
import { db, Trade, Mistake, Goal, IPOApplication } from '../database';
import { Investment, Holding } from '../types';
import { logger } from './Logger';
import { llmPipeline } from './llm';
import { alphaCache } from '../lib/alphaCache';

export type MasteryLevel = 'Novice' | 'Apprentice' | 'Expert' | 'Master' | 'Legend';

export interface SkillTree {
    id: string;
    name: string;
    level: MasteryLevel;
    xp: number;
    nextLevelXp: number;
    progress: number; // 0-100
    description: string;
    icon: string;
}

export interface Achievement {
    id: string;
    title: string;
    description: string;
    category: 'TRADING' | 'PORTFOLIO' | 'ALPHA' | 'RISK' | 'KNOWLEDGE' | 'ORACLE' | 'SOCIAL' | 'DISCIPLINE';
    rarity: 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
    isUnlocked: boolean;
    unlockedAt?: string;
    claimedAt?: string;
    progress?: number;
    target?: number;
    xpReward: number;
    emoji?: string;
    unlockedStats?: Record<string, string | number>;
}

export interface DailyMission {
    id: string;
    title: string;
    description: string;
    rewardXp: number;
    isCompleted: boolean;
    expiresAt: string;
    isLive?: boolean;
    liveCheck?: 'RISK_SENTINEL' | 'STOP_LOSS_DISCIPLINE' | 'DIVERSIFICATION' | null;
    liveProgress?: number;
}

/**
 * Skill Node (for the 4-branch interactive Skill Tree)
 * Linear DAG with prereq references.
 */
export interface SkillNode {
    id: string;
    branch: SkillBranchId;
    title: string;
    description: string;
    level: number; // 1..7
    prerequisites: string[]; // node ids
    xpCost: number;          // XP required to allocate
    xpBenefit: number;       // XP rewarded when allocated
    questHint: string;       // UI-facing quest description
    questType?: 'RISK_SENTINEL' | 'STOP_LOSS_DISCIPLINE' | 'DIVERSIFICATION' | 'TRADE_COUNT' | 'WIN_RATE' | 'ALPHA' | 'STREAK';
    icon: string;
}

export type SkillBranchId = 'FUNDAMENTAL' | 'TECHNICAL' | 'QUANT' | 'RISK';

export interface SkillBranch {
    id: SkillBranchId;
    name: string;
    description: string;
    color: string;          // tailwind-ish hex used for SVG strokes
    nodes: SkillNode[];
}

export interface SkillGraph {
    branches: SkillBranch[];
}

/**
 * Real-time context for XP multiplier and live quest evaluation.
 */
export interface MasteryContext {
    vix?: number | null;             // India VIX value
    tradeLoggingStreak?: number;     // consecutive days of trade logs
    isFirstAchievement?: boolean;    // true when no achievements unlocked yet
    portfolio?: Holding[] | Investment[];
    trades?: Trade[];
    holdings?: Investment[];
}

const MASTERY_CACHE_KEY = 'mastery_engine_state';

class MasteryEngine {
    private static instance: MasteryEngine;

    private constructor() {}

    public static getInstance(): MasteryEngine {
        if (!MasteryEngine.instance) {
            MasteryEngine.instance = new MasteryEngine();
        }
        return MasteryEngine.instance;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Real-time Quest Evaluators (CC31 Phase 1)
    // ──────────────────────────────────────────────────────────────────────

    /**
     * Risk Sentinel Quest
     * True if average correlation of portfolio holdings is below 0.3.
     * Falls back to sector concentration heuristic when no per-asset correlation
     * matrix is available (a common case for retail data).
     */
    public evaluateRiskSentinelQuest(portfolio: Holding[] | Investment[] | undefined): boolean {
        if (!portfolio || portfolio.length < 2) return false;

        // Preferred: average pairwise correlation from a `correlation` field on holdings
        const withCorr = (portfolio as any[]).filter(p => typeof p.correlation === 'number');
        if (withCorr.length >= 2) {
            const sum = withCorr.reduce((acc, p) => acc + (p.correlation as number), 0);
            const avg = sum / withCorr.length;
            return avg < 0.3;
        }

        // Heuristic: count unique sectors and apply an inverse-diversity assumption.
        // More distinct sectors → lower implicit average correlation.
        const sectors = new Set(
            (portfolio as Investment[]).map(p => p.sector).filter(Boolean) as string[]
        );
        if (sectors.size >= 6) return true;             // very well diversified
        if (sectors.size >= 4) return true;             // meets the 4+ sector rule
        return false;
    }

    /**
     * Stop Loss Discipline Quest
     * True if ≥85% of closed trades have a stop-loss set.
     * "Closed trades" are trades with an exitPrice present.
     */
    public evaluateStopLossDisciplineQuest(trades: Trade[] | undefined): boolean {
        if (!trades || trades.length === 0) return false;
        const closed = trades.filter(t => typeof t.exitPrice === 'number' && t.exitPrice > 0);
        if (closed.length === 0) return false;
        const withSL = closed.filter(t => typeof t.stopLoss === 'number' && (t.stopLoss as number) > 0);
        return (withSL.length / closed.length) >= 0.85;
    }

    /**
     * Diversification Quest
     * True if 4+ sectors AND entropy > 0.6.
     * Entropy computed over sector distribution (Shannon entropy, normalised).
     */
    public evaluateDiversificationQuest(holdings: Investment[] | Holding[] | undefined): boolean {
        if (!holdings || holdings.length === 0) return false;
        const sectorMap: Record<string, number> = {};
        for (const h of holdings) {
            const sector = (h as Investment).sector || 'Unknown';
            sectorMap[sector] = (sectorMap[sector] || 0) + 1;
        }
        const sectorCount = Object.keys(sectorMap).length;
        if (sectorCount < 4) return false;

        const total = holdings.length;
        let entropy = 0;
        for (const k of Object.keys(sectorMap)) {
            const p = sectorMap[k]! / total;
            entropy -= p * Math.log2(p);
        }
        // Normalise by max possible entropy (log2 of sector count)
        const maxEntropy = Math.log2(sectorCount);
        const normalised = maxEntropy > 0 ? entropy / maxEntropy : 0;
        return normalised > 0.6;
    }

    /**
     * XP Multiplier System
     * Stack: 1.5x during high-VIX (>18) sessions
     *        1.25x for 3+ day trade-logging streak
     *        2.0x for first-time achievement unlock
     */
    public getCurrentMultiplier(context: MasteryContext | undefined): number {
        if (!context) return 1.0;
        let multiplier = 1.0;
        if (typeof context.vix === 'number' && context.vix > 18) multiplier = Math.max(multiplier, 1.5);
        if (typeof context.tradeLoggingStreak === 'number' && context.tradeLoggingStreak >= 3) {
            multiplier = Math.max(multiplier, 1.25);
        }
        if (context.isFirstAchievement === true) {
            multiplier = Math.max(multiplier, 2.0);
        }
        return multiplier;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Skill Graph (CC31 Phase 1)
    // ──────────────────────────────────────────────────────────────────────

    /**
     * 4 skill branches radiating from a central "Wealth Master" node.
     * Each branch has 5-7 nodes in a linear DAG (each node requires the previous).
     */
    public getSkillGraph(): SkillGraph {
        const branches: SkillBranch[] = [
            {
                id: 'FUNDAMENTAL',
                name: 'Fundamental Analyst',
                description: 'Decode the story behind every ticker.',
                color: '#22d3ee',
                nodes: [
                    { id: 'fa-1', branch: 'FUNDAMENTAL', level: 1, title: 'Earnings Decoder', description: 'Read quarterly results like a pro.', prerequisites: ['root'], xpCost: 100, xpBenefit: 50, questHint: 'Log 5 trades tagged with earnings thesis', questType: 'TRADE_COUNT', icon: 'BookOpen' },
                    { id: 'fa-2', branch: 'FUNDAMENTAL', level: 2, title: 'Sector Cartographer', description: 'Map sector rotation cycles.', prerequisites: ['fa-1'], xpCost: 250, xpBenefit: 120, questHint: 'Hold investments across 4+ sectors', questType: 'DIVERSIFICATION', icon: 'Map' },
                    { id: 'fa-3', branch: 'FUNDAMENTAL', level: 3, title: 'Valuation Sage', description: 'Apply DCF, P/E, EV/EBITDA with confidence.', prerequisites: ['fa-2'], xpCost: 500, xpBenefit: 200, questHint: 'Log 10 trades with thesis notes', questType: 'TRADE_COUNT', icon: 'Calculator' },
                    { id: 'fa-4', branch: 'FUNDAMENTAL', level: 4, title: 'Moat Architect', description: 'Identify durable competitive advantages.', prerequisites: ['fa-3'], xpCost: 800, xpBenefit: 350, questHint: 'Maintain 60%+ win rate across 30 trades', questType: 'WIN_RATE', icon: 'Castle' },
                    { id: 'fa-5', branch: 'FUNDAMENTAL', level: 5, title: 'Capital Allocator', description: 'Judge management quality and buybacks.', prerequisites: ['fa-4'], xpCost: 1200, xpBenefit: 500, questHint: 'Generate ₹10k+ alpha', questType: 'ALPHA', icon: 'Coins' },
                    { id: 'fa-6', branch: 'FUNDAMENTAL', level: 6, title: 'Wealth Master', description: 'Master of intrinsic value.', prerequisites: ['fa-5'], xpCost: 2000, xpBenefit: 1000, questHint: 'Reach 75%+ win rate with 50+ trades', questType: 'WIN_RATE', icon: 'Crown' },
                ]
            },
            {
                id: 'TECHNICAL',
                name: 'Technical Trader',
                description: 'Time the market with charts and tape reading.',
                color: '#f59e0b',
                nodes: [
                    { id: 'tt-1', branch: 'TECHNICAL', level: 1, title: 'Candle Apprentice', description: 'Read the market\'s emotional pulse.', prerequisites: ['root'], xpCost: 100, xpBenefit: 50, questHint: 'Log 5 trades with chart screenshots', questType: 'TRADE_COUNT', icon: 'CandlestickChart' },
                    { id: 'tt-2', branch: 'TECHNICAL', level: 2, title: 'Trend Rider', description: 'Ride momentum with discipline.', prerequisites: ['tt-1'], xpCost: 250, xpBenefit: 120, questHint: 'Maintain 60%+ win rate over 15 trades', questType: 'WIN_RATE', icon: 'TrendingUp' },
                    { id: 'tt-3', branch: 'TECHNICAL', level: 3, title: 'Pattern Whisperer', description: 'Spot flags, wedges, and breakouts.', prerequisites: ['tt-2'], xpCost: 500, xpBenefit: 200, questHint: 'Log 30 trades with setup grades', questType: 'TRADE_COUNT', icon: 'Activity' },
                    { id: 'tt-4', branch: 'TECHNICAL', level: 4, title: 'Volume Cartographer', description: 'Decode accumulation and distribution.', prerequisites: ['tt-3'], xpCost: 800, xpBenefit: 350, questHint: 'Generate ₹25k+ profit', questType: 'ALPHA', icon: 'BarChart3' },
                    { id: 'tt-5', branch: 'TECHNICAL', level: 5, title: 'Tape Reader', description: 'React to order flow in real time.', prerequisites: ['tt-4'], xpCost: 1200, xpBenefit: 500, questHint: 'Hit 70%+ win rate with 50+ trades', questType: 'WIN_RATE', icon: 'Radio' },
                ]
            },
            {
                id: 'QUANT',
                name: 'Quant / Derivative Master',
                description: 'Engineer edge through math and Greeks.',
                color: '#a78bfa',
                nodes: [
                    { id: 'qd-1', branch: 'QUANT', level: 1, title: 'Probability Initiate', description: 'Think in odds, not narratives.', prerequisites: ['root'], xpCost: 150, xpBenefit: 75, questHint: 'Log 5 options trades', questType: 'TRADE_COUNT', icon: 'Sigma' },
                    { id: 'qd-2', branch: 'QUANT', level: 2, title: 'Greeks Adept', description: 'Speak Delta, Theta, Vega fluently.', prerequisites: ['qd-1'], xpCost: 300, xpBenefit: 150, questHint: 'Log 15 trades with risk-reward ≥ 2:1', questType: 'TRADE_COUNT', icon: 'Sigma' },
                    { id: 'qd-3', branch: 'QUANT', level: 3, title: 'Volatility Sculptor', description: 'Trade IV crush, skew, and term structure.', prerequisites: ['qd-2'], xpCost: 600, xpBenefit: 250, questHint: 'Generate ₹15k+ on options trades', questType: 'ALPHA', icon: 'Waves' },
                    { id: 'qd-4', branch: 'QUANT', level: 4, title: 'Strategy Architect', description: 'Design multi-leg structures.', prerequisites: ['qd-3'], xpCost: 1000, xpBenefit: 400, questHint: 'Hit 65%+ win rate on options', questType: 'WIN_RATE', icon: 'Network' },
                    { id: 'qd-5', branch: 'QUANT', level: 5, title: 'Quant Strategist', description: 'Build, backtest, and deploy alpha models.', prerequisites: ['qd-4'], xpCost: 1500, xpBenefit: 700, questHint: 'Maintain 70%+ win rate over 60 trades', questType: 'WIN_RATE', icon: 'Cpu' },
                    { id: 'qd-6', branch: 'QUANT', level: 6, title: 'Derivative Grandmaster', description: 'Hedge any portfolio with surgical precision.', prerequisites: ['qd-5'], xpCost: 2500, xpBenefit: 1200, questHint: 'Reach 100+ trades with discipline', questType: 'TRADE_COUNT', icon: 'Crown' },
                    { id: 'qd-7', branch: 'QUANT', level: 7, title: 'Wealth Master', description: 'Master of the mathematical edge.', prerequisites: ['qd-6'], xpCost: 4000, xpBenefit: 2000, questHint: 'Hit 75%+ win rate on 100+ trades', questType: 'WIN_RATE', icon: 'Crown' },
                ]
            },
            {
                id: 'RISK',
                name: 'Risk Governor',
                description: 'Protect capital like a vault.',
                color: '#10b981',
                nodes: [
                    { id: 'rg-1', branch: 'RISK', level: 1, title: 'Stop Loss Initiate', description: 'Never enter a trade without a stop.', prerequisites: ['root'], xpCost: 100, xpBenefit: 50, questHint: 'Set stop loss on 10 trades', questType: 'STOP_LOSS_DISCIPLINE', icon: 'Shield' },
                    { id: 'rg-2', branch: 'RISK', level: 2, title: 'Position Sizer', description: 'Risk 1-2% per trade, always.', prerequisites: ['rg-1'], xpCost: 250, xpBenefit: 120, questHint: 'Keep avg risk per trade < 2%', questType: 'STOP_LOSS_DISCIPLINE', icon: 'Sliders' },
                    { id: 'rg-3', branch: 'RISK', level: 3, title: 'Correlation Sentinel', description: 'Diversify away hidden portfolio risk.', prerequisites: ['rg-2'], xpCost: 500, xpBenefit: 200, questHint: 'Keep portfolio avg correlation < 0.3', questType: 'RISK_SENTINEL', icon: 'Radar' },
                    { id: 'rg-4', branch: 'RISK', level: 4, title: 'Drawdown Surgeon', description: 'Cut losers fast, ride winners longer.', prerequisites: ['rg-3'], xpCost: 800, xpBenefit: 350, questHint: 'Hold across 4+ sectors with entropy > 0.6', questType: 'DIVERSIFICATION', icon: 'Activity' },
                    { id: 'rg-5', branch: 'RISK', level: 5, title: 'Hedge Strategist', description: 'Use options to insure tail risk.', prerequisites: ['rg-4'], xpCost: 1200, xpBenefit: 500, questHint: 'Maintain 85%+ SL discipline over 30 trades', questType: 'STOP_LOSS_DISCIPLINE', icon: 'Umbrella' },
                ]
            }
        ];

        return { branches };
    }

    /**
     * Compute live quest progress for a given skill node based on the engine's
     * quest evaluators and trade stats.
     */
    public evaluateNodeQuest(node: SkillNode, ctx: MasteryContext): { progress: number; target: number; done: boolean } {
        const trades = ctx.trades || [];
        const holdings = ctx.holdings || ctx.portfolio || [];
        const closed = trades.filter(t => typeof t.exitPrice === 'number' && t.exitPrice > 0);
        switch (node.questType) {
            case 'TRADE_COUNT': {
                const target = node.level * 10;
                return { progress: Math.min(closed.length, target), target, done: closed.length >= target };
            }
            case 'WIN_RATE': {
                if (closed.length < 10) return { progress: 0, target: 100, done: false };
                const winRate = (closed.filter(t => (t.pnl || 0) > 0).length / closed.length) * 100;
                const target = 60 + node.level * 2;
                return { progress: Math.min(Math.round(winRate), target), target, done: winRate >= target };
            }
            case 'ALPHA': {
                const target = node.level * 10000;
                const totalPnl = closed.reduce((acc, t) => acc + (t.pnl || 0), 0);
                return { progress: Math.max(0, Math.min(totalPnl, target)), target, done: totalPnl >= target };
            }
            case 'STOP_LOSS_DISCIPLINE': {
                const target = 100;
                const progress = this.evaluateStopLossDisciplineQuest(trades) ? 100 : (closed.filter(t => !!t.stopLoss).length / Math.max(1, closed.length)) * 100;
                return { progress: Math.round(progress), target, done: progress >= 85 };
            }
            case 'RISK_SENTINEL': {
                const target = 100;
                const done = this.evaluateRiskSentinelQuest(holdings as any);
                return { progress: done ? 100 : 0, target, done };
            }
            case 'DIVERSIFICATION': {
                const target = 100;
                const done = this.evaluateDiversificationQuest(holdings as any);
                return { progress: done ? 100 : 0, target, done };
            }
            case 'STREAK': {
                const target = 7;
                return { progress: Math.min(ctx.tradeLoggingStreak || 0, target), target, done: (ctx.tradeLoggingStreak || 0) >= target };
            }
            default:
                return { progress: 0, target: 100, done: false };
        }
    }

    /**
     * Skill Tree Definitions & Calculations
     */
    public async getSkillTrees(trades: Trade[], investments: Investment[], mistakes: Mistake[], goals: Goal[], ipos: IPOApplication[]): Promise<SkillTree[]> {
        return [
            await this.calcTradingPrecision(trades),
            await this.calcPortfolioArchitect(investments),
            await this.calcAlphaHunter(investments, trades),
            await this.calcRiskSamurai(trades, mistakes),
            await this.calcKnowledgeSage(),
            await this.calcOracleReader()
        ];
    }

    private async calcTradingPrecision(trades: Trade[]): Promise<SkillTree> {
        const winRate = trades.length > 0 ? (trades.filter(t => (t.pnl || 0) > 0).length / trades.length) * 100 : 0;
        const count = trades.length;

        let level: MasteryLevel = 'Novice';
        if (count >= 50 && winRate >= 60) level = 'Master';
        else if (count >= 30 && winRate >= 55) level = 'Expert';
        else if (count >= 15 && winRate >= 50) level = 'Apprentice';

        return {
            id: 'trading_precision',
            name: 'Trading Precision',
            level,
            xp: Math.min(count * 20, 5000),
            nextLevelXp: 1000,
            progress: Math.min((count / 50) * 100, 100),
            description: 'Measures win rate, discipline, and execution quality.',
            icon: 'Target'
        };
    }

    private async calcPortfolioArchitect(investments: Investment[]): Promise<SkillTree> {
        const assetClasses = new Set(investments.map(i => i.type)).size;
        let level: MasteryLevel = 'Novice';
        if (assetClasses >= 6) level = 'Legend';
        else if (assetClasses >= 5) level = 'Master';
        else if (assetClasses >= 4) level = 'Expert';
        else if (assetClasses >= 3) level = 'Apprentice';

        return {
            id: 'portfolio_architect',
            name: 'Portfolio Architect',
            level,
            xp: assetClasses * 200,
            nextLevelXp: 1000,
            progress: (assetClasses / 6) * 100,
            description: 'Measures diversification and asset allocation health.',
            icon: 'Layout'
        };
    }

    private async calcAlphaHunter(investments: Investment[], trades: Trade[]): Promise<SkillTree> {
        // Mock Alpha calculation - in reality would compare against Nifty
        const highProfitTrades = trades.filter(t => (t.pnl || 0) > 10000).length;
        let level: MasteryLevel = 'Novice';
        if (highProfitTrades >= 20) level = 'Legend';
        else if (highProfitTrades >= 10) level = 'Master';

        return {
            id: 'alpha_hunter',
            name: 'Alpha Hunter',
            level,
            xp: highProfitTrades * 100,
            nextLevelXp: 1000,
            progress: (highProfitTrades / 20) * 100,
            description: 'Measures ability to generate market-beating returns.',
            icon: 'Zap'
        };
    }

    private async calcRiskSamurai(trades: Trade[], mistakes: Mistake[]): Promise<SkillTree> {
        const tradesWithSL = trades.filter(t => t.stopLoss).length;
        const slAdherence = trades.length > 0 ? (tradesWithSL / trades.length) * 100 : 0;
        const mistakeCount = mistakes.length;

        let level: MasteryLevel = 'Novice';
        if (slAdherence >= 95 && mistakeCount < 5) level = 'Legend';

        return {
            id: 'risk_samurai',
            name: 'Risk Samurai',
            level,
            xp: Math.max(0, (slAdherence * 10) - (mistakeCount * 50)),
            nextLevelXp: 1000,
            progress: slAdherence,
            description: 'Measures risk management mastery and emotional control.',
            icon: 'Shield'
        };
    }

    private async calcKnowledgeSage(): Promise<SkillTree> {
        const progress = await db.quiz_progress.where('userId').equals('default').first();
        const xp = progress?.totalXP || 0;
        let level: MasteryLevel = 'Novice';
        if (xp >= 2000) level = 'Legend';
        else if (xp >= 1000) level = 'Master';

        return {
            id: 'knowledge_sage',
            name: 'Knowledge Sage',
            level,
            xp: xp % 1000,
            nextLevelXp: 1000,
            progress: (xp % 1000) / 10,
            description: 'Measures financial education and quiz performance.',
            icon: 'BookOpen'
        };
    }

    private async calcOracleReader(): Promise<SkillTree> {
        // Check cache for oracle usage count
        const usageCount = Number(localStorage.getItem('oracle_usage_count') || 0);
        let level: MasteryLevel = 'Novice';
        if (usageCount >= 50) level = 'Legend';

        return {
            id: 'oracle_reader',
            name: 'Oracle Reader',
            level,
            xp: usageCount * 50,
            nextLevelXp: 1000,
            progress: (usageCount / 50) * 100,
            description: 'Measures use of AI insights and predictive tools.',
            icon: 'Eye'
        };
    }

    /**
     * Achievement Checking Logic
     */
    public async checkAchievements(): Promise<Achievement[]> {
        const trades = await db.trades.toArray();
        const investments = await db.investments.toArray();
        const mistakes = await db.mistakes.toArray();

        // Calculate live quest results so the achievement cabinet can use them
        const slDiscipline = this.evaluateStopLossDisciplineQuest(trades);
        const riskSentinel = this.evaluateRiskSentinelQuest(investments as any);
        const diversification = this.evaluateDiversificationQuest(investments as any);

        const achievements: Achievement[] = [
            {
                id: 'first_blood',
                title: 'First Blood',
                description: 'Logged your first execution. The journey begins.',
                category: 'TRADING',
                rarity: 'COMMON',
                isUnlocked: trades.length > 0,
                unlockedAt: trades.length > 0 ? new Date().toISOString() : undefined,
                xpReward: 100,
                emoji: '🩸'
            },
            {
                id: 'first_hedged_trade',
                title: 'First Hedged Trade',
                description: 'Opened a position with both stop loss and take profit. Pro-grade risk.',
                category: 'TRADING',
                rarity: 'UNCOMMON',
                isUnlocked: trades.some(t => typeof t.stopLoss === 'number' && (t.stopLoss as number) > 0 && typeof t.takeProfit === 'number' && (t.takeProfit as number) > 0),
                xpReward: 250,
                emoji: '🎯'
            },
            {
                id: 'perfect_streak',
                title: 'Perfect Streak',
                description: '5 winning trades in a row. The edge is real.',
                category: 'DISCIPLINE',
                rarity: 'RARE',
                isUnlocked: (() => {
                    let streak = 0;
                    for (const t of trades) {
                        if ((t.pnl || 0) > 0) { streak++; if (streak >= 5) return true; }
                        else streak = 0;
                    }
                    return false;
                })(),
                xpReward: 500,
                emoji: '🔥'
            },
            {
                id: 'discipline_master',
                title: 'Discipline Master',
                description: 'Set stop losses on 10 consecutive trades. Process over ego.',
                category: 'DISCIPLINE',
                rarity: 'UNCOMMON',
                isUnlocked: trades.slice(-10).every(t => !!t.stopLoss) && trades.length >= 10,
                xpReward: 300,
                emoji: '🧘'
            },
            {
                id: 'risk_zero',
                title: 'Risk Zero',
                description: 'Never breached 2% per trade across 30+ closed trades.',
                category: 'RISK',
                rarity: 'EPIC',
                isUnlocked: (() => {
                    const closed = trades.filter(t => typeof t.exitPrice === 'number' && t.exitPrice > 0);
                    if (closed.length < 30) return false;
                    return closed.every(t => {
                        const risk = t.entryPrice - (t.stopLoss || t.entryPrice);
                        const accountRisk = Math.abs(risk) * (t.quantity || 0) / 100000; // assume 1L account baseline
                        return accountRisk <= 2;
                    });
                })(),
                xpReward: 1500,
                emoji: '🛡️'
            },
            {
                id: 'risk_sentinel',
                title: 'Risk Sentinel',
                description: 'Maintained average correlation < 0.3 across your portfolio.',
                category: 'RISK',
                rarity: 'RARE',
                isUnlocked: riskSentinel,
                xpReward: 600,
                emoji: '🛰️'
            },
            {
                id: 'diversified_mind',
                title: 'Diversified Mind',
                description: 'Held 4+ sectors with entropy above 0.6.',
                category: 'PORTFOLIO',
                rarity: 'RARE',
                isUnlocked: diversification,
                xpReward: 500,
                emoji: '🧬'
            },
            {
                id: 'stop_loss_guru',
                title: 'Stop Loss Guru',
                description: '≥85% of closed trades carry a stop loss. The shield holds.',
                category: 'DISCIPLINE',
                rarity: 'UNCOMMON',
                isUnlocked: slDiscipline,
                xpReward: 400,
                emoji: '🛡️'
            },
            {
                id: 'iron_hands',
                title: 'Iron Hands',
                description: 'Held a position through a 15% drawdown that recovered. Emotional steel.',
                category: 'PORTFOLIO',
                rarity: 'RARE',
                isUnlocked: investments.some(i => (i.currentValue / i.investedAmount) > 1.1 && i.tags?.includes('recovered')),
                xpReward: 500,
                emoji: '💎'
            },
            {
                id: 'the_contrarian',
                title: 'The Contrarian',
                description: 'Profited when Nifty was down 3%+. You swim against the tide.',
                category: 'ALPHA',
                rarity: 'RARE',
                isUnlocked: trades.some(t => (t.pnl || 0) > 0 && t.tags?.includes('contrarian')),
                xpReward: 600,
                emoji: '👺'
            },
            {
                id: 'tax_ninja',
                title: 'Tax Ninja',
                description: 'Used the Tax Harvester to save ₹10k+. SEBI respects the hustle.',
                category: 'RISK',
                rarity: 'EPIC',
                isUnlocked: Number(localStorage.getItem('total_tax_saved') || 0) > 10000,
                xpReward: 1000,
                emoji: '🥷'
            },
            {
                id: 'oracle_seeker',
                title: 'Oracle Seeker',
                description: 'Ran 10 Monte Carlo simulations. You peer into the future.',
                category: 'ORACLE',
                rarity: 'UNCOMMON',
                isUnlocked: Number(localStorage.getItem('oracle_usage_count') || 0) >= 10,
                xpReward: 400,
                emoji: '🔮'
            },
            {
                id: 'legendary_trader',
                title: 'Legendary Trader',
                description: '100 trades with 65%+ win rate. Pure market dominance.',
                category: 'TRADING',
                rarity: 'LEGENDARY',
                isUnlocked: trades.length >= 100 && (trades.filter(t => (t.pnl || 0) > 0).length / trades.length) >= 0.65,
                xpReward: 5000,
                emoji: '👑'
            }
        ];

        return achievements;
    }

    /**
     * Mission Generator (AI Powered)
     */
    public async generateMissions(): Promise<DailyMission[]> {
        const cached = await alphaCache.get('daily_missions');
        if (cached && !cached.isStale) return cached.data;

        const prompt = `Generate 3 daily trading/finance missions for a wealth app.
        Missions should be actionable and focus on discipline, education, or analysis.
        Use a professional, encouraging Indian advisor tone.
        Return ONLY JSON: [{"id": "m1", "title": "...", "description": "...", "rewardXp": 100}]`;

        try {
            const response = await llmPipeline(prompt, { modelOverride: 'llama-3.1-8b-instant', jsonMode: true });
            const parsed = JSON.parse(response.text) as any[];
            const missions: DailyMission[] = parsed.map(m => ({
                ...m,
                isCompleted: false,
                expiresAt: new Date(new Date().setHours(23, 59, 59, 999)).toISOString()
            }));
            await alphaCache.set('daily_missions', missions, 12);
            return missions;
        } catch (e) {
            logger.warn('Mission generation failed, using fallback missions', { error: String(e) }, 'mastery');
            return [
                { id: 'd1', title: 'Journal Session', description: 'Log today\'s execution with mood notes. Keep the edge sharp.', rewardXp: 50, isCompleted: false, expiresAt: '' },
                { id: 'd2', title: 'Radar Check', description: 'Review your top 3 holdings for concentration risk. Stay lean.', rewardXp: 50, isCompleted: false, expiresAt: '' }
            ];
        }
    }
}

export const masteryEngine = MasteryEngine.getInstance();
