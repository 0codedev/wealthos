
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
    SkillTree,
    Achievement,
    DailyMission,
    masteryEngine,
    MasteryContext
} from '../services/MasteryEngine';
import { db } from '../database';
import { Trade } from '../database';
import { Investment, Holding } from '../types';
import { triggerXP, triggerLevelUp, triggerAchievement } from '../components/mastery/XPCelebration';

interface MasteryState {
    skillTrees: SkillTree[];
    achievements: Achievement[];
    dailyMissions: DailyMission[];
    totalMasteryXp: number;
    archetype: string | null;

    // Phase CC31 — Gamified Financial Skill Trees
    allocatedNodes: string[];        // ids of skill nodes the user has allocated
    activeMultiplier: number;        // last computed XP multiplier
    multiplierReason: string | null; // human-readable reason for the multiplier

    // Actions (existing)
    refreshMastery: () => Promise<void>;
    completeMission: (id: string) => Promise<void>;
    checkAchievements: () => Promise<void>;

    // Actions (CC31)
    evaluateLiveQuests: (
        portfolio: Holding[] | Investment[],
        trades: Trade[],
        holdings: Investment[]
    ) => Promise<DailyMission[]>;
    awardXP: (amount: number, reason: string) => number;
    claimAchievement: (id: string) => void;
    allocateSkillNode: (nodeId: string, xpCost: number) => { success: boolean; message: string };
    updateMultiplier: (context: MasteryContext) => number;
}

const multiplierReason = (multiplier: number, ctx: MasteryContext): string | null => {
    if (multiplier >= 2.0 && ctx.isFirstAchievement) return 'First achievement bonus (2.0x)';
    if (multiplier >= 1.5 && (ctx.vix ?? 0) > 18) return 'High-VIX surge (1.5x)';
    if (multiplier >= 1.25 && (ctx.tradeLoggingStreak ?? 0) >= 3) return '3+ day trade-logging streak (1.25x)';
    return null;
};

export const useMasteryStore = create<MasteryState>()(
    persist(
        (set, get) => ({
            skillTrees: [],
            achievements: [],
            dailyMissions: [],
            totalMasteryXp: 0,
            archetype: null,
            allocatedNodes: [],
            activeMultiplier: 1,
            multiplierReason: null,

            refreshMastery: async () => {
                const trades = await db.trades.toArray();
                const investments = await db.investments.toArray();
                const mistakes = await db.mistakes.toArray();
                const goals = await db.goals.toArray();
                const ipos = await db.ipo_applications.toArray();

                const trees = await masteryEngine.getSkillTrees(trades, investments, mistakes, goals, ipos);
                let missions = await masteryEngine.generateMissions();
                const achievements = await masteryEngine.checkAchievements();

                // Wire live quest evaluators into the daily missions
                try {
                    const liveMissions = await get().evaluateLiveQuests(investments as any, trades, investments);
                    // Merge live quest results (live missions override / augment the AI missions)
                    const liveIds = new Set(liveMissions.map(m => m.id));
                    missions = [...liveMissions, ...missions.filter(m => !liveIds.has(m.id))];
                } catch (e) {
                    // non-fatal; fall back to AI missions
                }

                const totalXp = trees.reduce((acc, tree) => acc + tree.xp, 0);

                set({
                    skillTrees: trees,
                    dailyMissions: missions,
                    achievements,
                    totalMasteryXp: totalXp
                });
            },

            completeMission: async (id: string) => {
                const { dailyMissions } = get();
                const mission = dailyMissions.find(m => m.id === id);
                const updated = dailyMissions.map(m => m.id === id ? { ...m, isCompleted: true } : m);
                set({ dailyMissions: updated });
                if (mission && !mission.isCompleted) {
                    // Award XP for the completed mission (with multiplier applied)
                    get().awardXP(mission.rewardXp, `Mission: ${mission.title}`);
                }
            },

            checkAchievements: async () => {
                const achievements = await masteryEngine.checkAchievements();
                set({ achievements });
            },

            /**
             * Run all 3 quest evaluators against the live portfolio and update
             * dailyMissions in-place. Live missions are auto-generated with the
             * result of each evaluator.
             */
            evaluateLiveQuests: async (portfolio, trades, holdings) => {
                const riskDone = masteryEngine.evaluateRiskSentinelQuest(portfolio);
                const slDone = masteryEngine.evaluateStopLossDisciplineQuest(trades);
                const divDone = masteryEngine.evaluateDiversificationQuest(holdings);

                const closedTrades = trades.filter(t => typeof t.exitPrice === 'number' && t.exitPrice > 0);
                const slCount = closedTrades.filter(t => !!t.stopLoss).length;
                const slProgress = closedTrades.length > 0 ? Math.round((slCount / closedTrades.length) * 100) : 0;

                const liveMissions: DailyMission[] = [
                    {
                        id: 'live-risk-sentinel',
                        title: 'Risk Sentinel Active',
                        description: 'Keep your portfolio\'s average correlation below 0.3.',
                        rewardXp: 200,
                        isCompleted: riskDone,
                        expiresAt: new Date(new Date().setHours(23, 59, 59, 999)).toISOString(),
                        isLive: true,
                        liveCheck: 'RISK_SENTINEL',
                        liveProgress: riskDone ? 100 : 0
                    },
                    {
                        id: 'live-stop-loss-discipline',
                        title: 'Stop Loss Discipline',
                        description: 'Set a stop loss on at least 85% of your closed trades.',
                        rewardXp: 150,
                        isCompleted: slDone,
                        expiresAt: new Date(new Date().setHours(23, 59, 59, 999)).toISOString(),
                        isLive: true,
                        liveCheck: 'STOP_LOSS_DISCIPLINE',
                        liveProgress: slProgress
                    },
                    {
                        id: 'live-diversification',
                        title: 'Diversification Verified',
                        description: 'Hold 4+ sectors with portfolio entropy above 0.6.',
                        rewardXp: 175,
                        isCompleted: divDone,
                        expiresAt: new Date(new Date().setHours(23, 59, 59, 999)).toISOString(),
                        isLive: true,
                        liveCheck: 'DIVERSIFICATION',
                        liveProgress: divDone ? 100 : 0
                    }
                ];

                return liveMissions;
            },

            /**
             * Award XP with the current multiplier applied. Returns the
             * final amount of XP added.
             */
            awardXP: (amount, reason) => {
                const state = get();
                const multiplier = state.activeMultiplier || 1;
                const finalAmount = Math.round(amount * multiplier);
                const newTotal = state.totalMasteryXp + finalAmount;
                set({ totalMasteryXp: newTotal });
                if (finalAmount > 0) {
                    try { triggerXP(finalAmount); } catch { /* no-op in non-DOM env */ }
                }
                // Emit a small custom event so listeners (e.g. orchestrators) can react
                try {
                    window.dispatchEvent(new CustomEvent('mastery:xp-awarded', {
                        detail: { amount: finalAmount, reason, multiplier, total: newTotal }
                    }));
                } catch { /* non-DOM env */ }
                return finalAmount;
            },

            /**
             * Mark an achievement as claimed (sets `claimedAt` timestamp).
             * Re-claiming is a no-op. Also dispatches the achievement event
             * the first time the achievement is unlocked.
             */
            claimAchievement: (id) => {
                const { achievements } = get();
                let firstUnlock: Achievement | null = null;
                const updated = achievements.map(a => {
                    if (a.id !== id) return a;
                    if (a.claimedAt) return a;
                    const claimedAt = new Date().toISOString();
                    if (a.isUnlocked && !a.unlockedAt) {
                        // first time we ever noticed this as unlocked
                        firstUnlock = { ...a, claimedAt };
                    }
                    return { ...a, claimedAt };
                });
                set({ achievements: updated });

                if (firstUnlock) {
                    try {
                        triggerAchievement((firstUnlock as Achievement).title);
                    } catch { /* non-DOM env */ }
                    // XP reward for claiming
                    get().awardXP((firstUnlock as Achievement).xpReward, `Achievement: ${(firstUnlock as Achievement).title}`);
                }
            },

            /**
             * Allocate a skill tree node. Decrements totalMasteryXp by `xpCost`
             * and adds the node to `allocatedNodes`. Prereqs are enforced.
             */
            allocateSkillNode: (nodeId, xpCost) => {
                const state = get();
                const graph = masteryEngine.getSkillGraph();
                const allNodes = graph.branches.flatMap(b => b.nodes);
                const node = allNodes.find(n => n.id === nodeId);
                if (!node) return { success: false, message: 'Node not found' };
                if (state.allocatedNodes.includes(nodeId)) {
                    return { success: false, message: 'Already allocated' };
                }
                const prereqsMet = node.prerequisites.every(p => p === 'root' || state.allocatedNodes.includes(p));
                if (!prereqsMet) {
                    return { success: false, message: 'Prerequisites not met' };
                }
                if (state.totalMasteryXp < xpCost) {
                    return { success: false, message: 'Insufficient XP' };
                }
                const newTotal = state.totalMasteryXp - xpCost;
                set({
                    totalMasteryXp: newTotal,
                    allocatedNodes: [...state.allocatedNodes, nodeId]
                });
                // Reward benefit
                get().awardXP(node.xpBenefit, `Skill Node: ${node.title}`);
                try { triggerLevelUp(node.title); } catch { /* no-op */ }
                return { success: true, message: `Allocated ${node.title} (-${xpCost} / +${node.xpBenefit})` };
            },

            /**
             * Recompute the XP multiplier using the provided context.
             * Returns the new multiplier.
             */
            updateMultiplier: (context) => {
                const multiplier = masteryEngine.getCurrentMultiplier(context);
                set({ activeMultiplier: multiplier, multiplierReason: multiplierReason(multiplier, context) });
                return multiplier;
            }
        }),
        {
            name: 'wealth-aggregator-mastery',
            version: 2,
            migrate: (persisted: any, _version) => {
                if (!persisted) return persisted as any;
                // Defensive: ensure new fields exist for older persisted state
                if (!Array.isArray(persisted.allocatedNodes)) persisted.allocatedNodes = [];
                if (typeof persisted.activeMultiplier !== 'number') persisted.activeMultiplier = 1;
                if (typeof persisted.multiplierReason === 'undefined') persisted.multiplierReason = null;
                return persisted as any;
            }
        }
    )
);
