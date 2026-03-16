/**
 * Quantum Phase 12 — "Anyone Can Win" cross-cutting layer.
 *
 * The user explicitly asked: "if anyone, even without market knowledge,
 * could use, they should learn everything and be profitable".
 *
 * This file implements the single-number KPI that makes the system
 * honest — a 0..100 Profitability Score that the Quantum deck surfaces
 * on every screen, with a coach cue that points at the lowest
 * sub-component.
 *
 * Pure math → cache in `quantumStore.profitability`. The hook
 * `useProfitabilityRecompute` recomputes it whenever trades, journal,
 * or settings change.
 */
import { useEffect } from 'react';
import { liveQuery } from 'dexie';
import { db, Trade } from '../database';
import { useQuantumStore } from '../store/quantumStore';
import { computeProfitabilityScore } from './QuantumMath';
import type { ProfitabilityScore } from '../types/quantum';
import { logger } from './Logger';

/**
 * Compute the score, given the full set of inputs the rest of the
 * app already has. Pure — re-derives from scratch every time, no
 * caching here. The caller is responsible for memoization.
 */
export async function computeScoreFromDb(): Promise<ProfitabilityScore> {
    const trades = await db.trades.toArray();
    const journalEntries = await db.trades.where('notes').notEqual('').count().catch(() => 0);
    const closed = trades.filter(t => typeof t.exitPrice === 'number' && t.exitPrice > 0);
    const maxDD = closed.length > 1
        ? Math.max(0, ...closed.map(t => Math.abs(t.pnl ?? 0))) / Math.max(1, closed.reduce((s, t) => s + (t.entryPrice ?? 0) * (t.quantity ?? 0), 0))
        : 0;
    // "Revenge trade" heuristic: a trade within 15 minutes of a losing trade
    let revenge = 0;
    const sortedByTime = [...trades].sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
    for (let i = 1; i < sortedByTime.length; i++) {
        const prev = sortedByTime[i - 1]!;
        const cur = sortedByTime[i]!;
        if ((prev.pnl || 0) < 0) {
            const dt = new Date(cur.date || 0).getTime() - new Date(prev.date || 0).getTime();
            if (dt > 0 && dt < 15 * 60_000) revenge++;
        }
    }
    return computeProfitabilityScore(trades, {
        journalEntries,
        maxDrawdownPct: maxDD * 100,
        revengeTradeCount: revenge,
        lessonsCompleted: 0,
        backtestsRun: 0,
        streakDays: streakDays(closed),
    });
}

function streakDays(trades: Trade[]): number {
    if (trades.length === 0) return 0;
    const days = new Set(trades.map(t => t.date?.slice(0, 10)).filter(Boolean) as string[]);
    return days.size;
}

/**
 * React hook: subscribes to trade / journal changes and recomputes
 * the score. Mount once at the Quantum category root.
 */
export function useProfitabilityRecompute() {
    const setProfitability = useQuantumStore(s => s.setProfitability);
    useEffect(() => {
        let cancelled = false;
        const compute = async () => {
            try {
                const s = await computeScoreFromDb();
                if (!cancelled) setProfitability(s);
            } catch (err) {
                logger.warn('[useProfitabilityRecompute] failed', err);
            }
        };
        compute();
        const sub = liveQuery(() => db.trades.toArray()).subscribe({
            next: () => { compute(); },
        });
        return () => { cancelled = true; sub.unsubscribe(); };
    }, [setProfitability]);
}

void liveQuery;
