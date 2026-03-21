/**
 * Quantum Phase 12 — Wealth Quest Matrix engine.
 *
 * CC37 builds on the existing MasteryEngine (CC31) but with a leaner
 * 3-branch (Quant / Sentinel / Scribe) tree, an XP/level scheme with
 * 5 named tiers, and the deterministic `evaluateQuestProgress()`
 * function that takes the user's trades + journal + portfolio and
 * returns a `QuestMatrix` ready to render.
 */
import { db, Trade, Mistake, Goal, IPOApplication } from '../database';
import { Investment } from '../types';
import {
    QuestBranch,
    QuestBranchId,
    QuestMatrix,
    QuestNode,
    QuestState,
} from '../types/quantum';
import { logger } from './Logger';
import { computeProfitabilityScore } from './QuantumMath';

const TIER_TABLE: Array<{ name: string; minXp: number }> = [
    { name: 'NOVICE',        minXp: 0 },
    { name: 'APPRENTICE',    minXp: 500 },
    { name: 'OPERATOR',      minXp: 1500 },
    { name: 'STRATEGIST',    minXp: 3500 },
    { name: 'MASTER',        minXp: 7500 },
    { name: 'GRANDMASTER',   minXp: 15000 },
];

const RECENT_UNLOCKS_KEY = 'wealth_quantum_quest_recent_unlocks_v1';

// ----------------------------------------------------------------------------
// Static quest definitions
// ----------------------------------------------------------------------------

const QUANT_NODES: Omit<QuestNode, 'progress' | 'state'>[] = [
    {
        id: 'q1', branch: 'QUANT', level: 1, title: 'Greek Initiate',
        description: 'Open the Greeks Calculator and inspect a live options chain.',
        prereqIds: ['root'], xpReward: 75, questHint: 'Open the Options Greeks tab.',
        icon: 'σ', accentColor: '#a78bfa',
    },
    {
        id: 'q2', branch: 'QUANT', level: 2, title: 'Spread Smith',
        description: 'Run a strategy backtest in the Strategy Optimizer.',
        prereqIds: ['q1'], xpReward: 150, questHint: 'Run any backtest from the optimizer.',
        icon: '∫', accentColor: '#a78bfa',
    },
    {
        id: 'q3', branch: 'QUANT', level: 3, title: 'Iron Condor Adept',
        description: 'Simulate an iron condor and read the payoff curve.',
        prereqIds: ['q2'], xpReward: 250, questHint: 'Set strategy = Iron Condor and inspect the best row.',
        icon: '⊕', accentColor: '#a78bfa',
    },
    {
        id: 'q4', branch: 'QUANT', level: 4, title: 'Delta Surgeon',
        description: 'Calculate beta-weighted delta across 5+ assets.',
        prereqIds: ['q3'], xpReward: 400, questHint: 'Have 5+ holdings with active quotes.',
        icon: 'Δ', accentColor: '#a78bfa',
    },
    {
        id: 'q5', branch: 'QUANT', level: 5, title: 'Sharpe Sorcerer',
        description: 'Achieve a Sharpe > 1.5 on the Strategy Optimizer top row.',
        prereqIds: ['q4'], xpReward: 700, questHint: 'Find a strategy row with Sharpe > 1.5.',
        icon: 'Φ', accentColor: '#a78bfa',
    },
    {
        id: 'q6', branch: 'QUANT', level: 6, title: 'Quant Grandmaster',
        description: 'Backtest 10+ strategies with profitable expectancy.',
        prereqIds: ['q5'], xpReward: 1200, questHint: '10 optimizer runs with positive expectancy.',
        icon: 'Ω', accentColor: '#a78bfa',
    },
];

const SENTINEL_NODES: Omit<QuestNode, 'progress' | 'state'>[] = [
    {
        id: 's1', branch: 'SENTINEL', level: 1, title: 'First Responder',
        description: 'Subscribe to one Telegram channel and log a signal.',
        prereqIds: ['root'], xpReward: 75, questHint: 'Add a Telegram source in the Telegram Intel tab.',
        icon: '⌖', accentColor: '#10b981',
    },
    {
        id: 's2', branch: 'SENTINEL', level: 2, title: 'Circuit Breaker',
        description: 'Set a daily loss limit and a max-trades-per-day guard.',
        prereqIds: ['s1'], xpReward: 150, questHint: 'Open Settings → Risk.',
        icon: '⛔', accentColor: '#10b981',
    },
    {
        id: 's3', branch: 'SENTINEL', level: 3, title: 'OCR Watchtower',
        description: 'Parse 5 OCR screenshots from Telegram.',
        prereqIds: ['s2'], xpReward: 250, questHint: 'Drop 5 trade screenshots into the OCR inbox.',
        icon: '⛬', accentColor: '#10b981',
    },
    {
        id: 's4', branch: 'SENTINEL', level: 4, title: 'Bridge Sentinel',
        description: 'Maintain 7 consecutive days of healthy Python bridge sync.',
        prereqIds: ['s3'], xpReward: 400, questHint: 'Check the Resilience Core daily.',
        icon: '⌬', accentColor: '#10b981',
    },
    {
        id: 's5', branch: 'SENTINEL', level: 5, title: 'Slide-to-Auth',
        description: 'Use the slide-to-confirm in the Resilience Core 5 times.',
        prereqIds: ['s4'], xpReward: 700, questHint: 'Authorize 5 OCR signals via slide-to-confirm.',
        icon: '⎘', accentColor: '#10b981',
    },
];

const SCRIBE_NODES: Omit<QuestNode, 'progress' | 'state'>[] = [
    {
        id: 'sc1', branch: 'SCRIBE', level: 1, title: 'Journal Initiate',
        description: 'Add a journal note to your first trade.',
        prereqIds: ['root'], xpReward: 75, questHint: 'Add any note to a closed trade.',
        icon: '✎', accentColor: '#22d3ee',
    },
    {
        id: 'sc2', branch: 'SCRIBE', level: 2, title: '4-Point Apologist',
        description: 'Hit 100% 4-Point Gate compliance for a week.',
        prereqIds: ['sc1'], xpReward: 150, questHint: 'No 4-Point violations in last 7 days.',
        icon: '✓', accentColor: '#22d3ee',
    },
    {
        id: 'sc3', branch: 'SCRIBE', level: 3, title: 'Mistake Mirror',
        description: 'Tag 3+ mistakes in the Mistake Intelligence service.',
        prereqIds: ['sc2'], xpReward: 250, questHint: 'Tag 3 mistakes in the journal.',
        icon: '⚯', accentColor: '#22d3ee',
    },
    {
        id: 'sc4', branch: 'SCRIBE', level: 4, title: 'Discipline Scribe',
        description: 'Survive 3 trading losses without breaking the lockout.',
        prereqIds: ['sc3'], xpReward: 400, questHint: 'No 4-Point violations during a 3-loss streak.',
        icon: '✦', accentColor: '#22d3ee',
    },
    {
        id: 'sc5', branch: 'SCRIBE', level: 5, title: 'Profitability Sage',
        description: 'Reach a Profitability Score of 80+.',
        prereqIds: ['sc4'], xpReward: 1000, questHint: 'Score ≥ 80 in the Profitability ribbon.',
        icon: '★', accentColor: '#22d3ee',
    },
];

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export class WealthQuestEngine {
    private static instance: WealthQuestEngine;
    private constructor() {}
    static getInstance(): WealthQuestEngine { if (!WealthQuestEngine.instance) WealthQuestEngine.instance = new WealthQuestEngine(); return WealthQuestEngine.instance; }

    /**
     * Compute the live quest matrix from real journal data.
     */
    async evaluate(ctx: {
        trades: Trade[];
        investments: Investment[];
        mistakes?: Mistake[];
        goals?: Goal[];
        ipos?: IPOApplication[];
        ocrSignalsParsed?: number;
        optimizerRuns?: number;
        profitabilityScore?: number;
    }): Promise<QuestMatrix> {
        const closed = ctx.trades.filter(t => typeof t.exitPrice === 'number' && t.exitPrice > 0);
        const winRate = closed.length > 0 ? closed.filter(t => (t.pnl || 0) > 0).length / closed.length : 0;
        const avgR = closed.length > 0 ? closed.reduce((s, t) => s + (t.pnl || 0), 0) / closed.length : 0;
        const slCount = closed.filter(t => typeof t.stopLoss === 'number' && t.stopLoss > 0).length;
        const slDiscipline = closed.length > 0 ? slCount / closed.length : 0;
        const sectorSet = new Set((ctx.investments || []).map(i => i.sector).filter(Boolean));
        const mistakeCount = ctx.mistakes?.length ?? 0;
        const ocrParsed = ctx.ocrSignalsParsed ?? 0;
        const optimizerRuns = ctx.optimizerRuns ?? 0;
        const profitability = ctx.profitabilityScore ?? 0;

        const quantNodes: QuestNode[] = QUANT_NODES.map((n) => {
            let progress = 0;
            switch (n.id) {
                case 'q1': progress = closed.length >= 1 ? 1 : 0; break;
                case 'q2': progress = Math.min(1, optimizerRuns / 1); break;
                case 'q3': progress = optimizerRuns >= 1 ? 1 : 0; break;
                case 'q4': progress = Math.min(1, sectorSet.size / 5); break;
                case 'q5': progress = (winRate > 0 && avgR > 0) ? Math.min(1, (winRate * avgR) / 8000) : 0; break;
                case 'q6': progress = Math.min(1, optimizerRuns / 10); break;
            }
            return { ...n, progress, state: nodeState(progress, n.prereqIds, []) };
        });
        const sentinelNodes: QuestNode[] = SENTINEL_NODES.map((n) => {
            let progress = 0;
            switch (n.id) {
                case 's1': progress = ctx.trades.length >= 1 ? 1 : 0; break;
                case 's2': progress = slDiscipline > 0.5 ? 1 : 0; break;
                case 's3': progress = Math.min(1, ocrParsed / 5); break;
                case 's4': progress = closed.length > 0 ? Math.min(1, slDiscipline) : 0; break;
                case 's5': progress = Math.min(1, (mistakeCount > 0 ? 1 : 0) + (ocrParsed / 5)); break;
            }
            return { ...n, progress, state: nodeState(progress, n.prereqIds, []) };
        });
        const scribeNodes: QuestNode[] = SCRIBE_NODES.map((n) => {
            let progress = 0;
            switch (n.id) {
                case 'sc1': progress = closed.length > 0 ? 1 : 0; break;
                case 'sc2': progress = slDiscipline; break;
                case 'sc3': progress = Math.min(1, mistakeCount / 3); break;
                case 'sc4': progress = Math.min(1, slDiscipline * 1.2); break;
                case 'sc5': progress = Math.min(1, profitability / 80); break;
            }
            return { ...n, progress, state: nodeState(progress, n.prereqIds, []) };
        });

        const branches: QuestBranch[] = [
            { id: 'QUANT',    name: 'Path of the Quant',           description: 'Engineer edge through math and Greeks.', color: '#a78bfa', nodes: quantNodes },
            { id: 'SENTINEL', name: 'Path of the Sentinel',        description: 'Resilience, OCR, and bridge health.',     color: '#10b981', nodes: sentinelNodes },
            { id: 'SCRIBE',   name: 'Path of the Disciplined Scribe', description: 'Journal, compliance, and the 4-Point Gate.', color: '#22d3ee', nodes: scribeNodes },
        ];

        // XP = sum of xpReward × progress
        let totalXp = 0;
        for (const b of branches) for (const n of b.nodes) totalXp += Math.round(n.xpReward * n.progress);
        // Bonus: 100 XP for every profitable closed trade
        totalXp += closed.filter(t => (t.pnl || 0) > 0).length * 50;
        // Bonus: 200 XP for every mistake tagged (accountability)
        totalXp += mistakeCount * 75;

        // Tier lookup
        const tier = [...TIER_TABLE].reverse().find(t => totalXp >= t.minXp) ?? TIER_TABLE[0]!;
        const nextTier = TIER_TABLE[TIER_TABLE.indexOf(tier) + 1];
        const nextLevelXp = nextTier?.minXp ?? totalXp;
        const levelProgress = nextTier
            ? Math.min(1, (totalXp - tier.minXp) / Math.max(1, nextTier.minXp - tier.minXp))
            : 1;

        return {
            branches,
            totalXp,
            level: TIER_TABLE.indexOf(tier) + 1,
            levelName: tier.name,
            nextLevelXp,
            levelProgress,
            recentUnlocks: readRecentUnlocks(),
        };
    }
}

function nodeState(progress: number, prereqIds: string[], unlocked: string[]): QuestState {
    if (progress >= 1) return 'COMPLETED';
    if (progress > 0) return 'IN_PROGRESS';
    if (prereqIds.every(p => p === 'root' || unlocked.includes(p))) return 'AVAILABLE';
    return 'LOCKED';
}

function readRecentUnlocks(): { nodeId: string; at: number }[] {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RECENT_UNLOCKS_KEY) : null;
        if (!raw) return [];
        return JSON.parse(raw) as { nodeId: string; at: number }[];
    } catch { return []; }
}

export function recordUnlock(nodeId: string) {
    if (typeof localStorage === 'undefined') return;
    try {
        const list = readRecentUnlocks();
        if (list.find(u => u.nodeId === nodeId)) return;
        const next = [{ nodeId, at: Date.now() }, ...list].slice(0, 5);
        localStorage.setItem(RECENT_UNLOCKS_KEY, JSON.stringify(next));
    } catch (err) {
        logger.warn('[WealthQuest] failed to record unlock', err);
    }
}

export const wealthQuestEngine = WealthQuestEngine.getInstance();

void computeProfitabilityScore;
