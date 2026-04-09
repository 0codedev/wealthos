/**
 * MacroClockWidget — A2 (Lane 3.1 of ULTIMATE_BREAKTHROUGH_FEATURES.md)
 *
 * Dashboard widget that surfaces the two macro numbers a trader checks
 * every morning:
 *
 *   1. RBI repo rate (cost of money for the whole economy)
 *   2. India VIX (market's pricing of risk over the next 30 days)
 *
 * Design — two tiles side-by-side + a footer with the last/next MPC
 * date. RBI tile shows direction-of-change (▲ HAWKISH / ▼ DOVISH /
 * — NEUTRAL) with a 10 bps floor. VIX tile shows a color zone: emerald
 * < 14, amber 14–18, rose > 18.
 *
 * Re-uses:
 *   - `useMarketSentiment()` for VIX (no new fetch code).
 *   - `useRbiPolicy()` for the repo rate (new hook, this file's pair).
 *   - `useReducedMotion()` from framer-motion for the count-up animation.
 *
 * Zero new deps. Mirrors the `RiskScoreCardWidget.tsx:91` headline-number
 * style (`text-4xl font-black`) and the `HeatmapWidget.tsx:48` card
 * envelope.
 */
import React, { useEffect, useMemo } from 'react';
import { Clock, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { useMarketSentiment } from '../../../hooks/useMarketSentiment';
import { useRbiPolicy } from '../../../hooks/useRbiPolicy';
import { MPC_CALENDAR } from '../../../services/rbiRepoRateSeed';
import { logger } from '../../../utils/logger';

// --- VIX color zones ---
function vixZone(vix: number): { color: string; label: string; bgClass: string; textClass: string } {
    if (vix < 14) return { color: 'emerald', label: 'Calm',     bgClass: 'bg-emerald-500/10', textClass: 'text-emerald-400' };
    if (vix <= 18) return { color: 'amber',  label: 'Elevated', bgClass: 'bg-amber-500/10',   textClass: 'text-amber-400'   };
    return                   { color: 'rose',    label: 'Fearful',  bgClass: 'bg-rose-500/10',    textClass: 'text-rose-400'    };
}

// --- Date helpers ---
function formatShort(iso: string): string {
    // "2026-06-06" -> "06 Jun"
    const d = new Date(iso + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

function formatRange(start: string, end: string): string {
    // "2026-06-04" / "2026-06-06" -> "04–06 Jun 2026"
    const s = new Date(start + 'T00:00:00Z');
    const e = new Date(end + 'T00:00:00Z');
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return `${start}–${end}`;
    const sameMonth = s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear();
    if (sameMonth) {
        return `${s.getUTCDate()}–${e.getUTCDate()} ${e.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
    }
    return `${formatShort(start)}–${formatShort(end)} ${e.getUTCFullYear()}`;
}

function pickLastAndNext(now: number = Date.now()): { last: typeof MPC_CALENDAR[number] | null; next: typeof MPC_CALENDAR[number] | null } {
    let last: typeof MPC_CALENDAR[number] | null = null;
    let next: typeof MPC_CALENDAR[number] | null = null;
    for (const m of MPC_CALENDAR) {
        const startMs = Date.parse(m.start + 'T00:00:00Z');
        if (startMs <= now) last = m;
        else if (next == null) next = m;
    }
    return { last, next };
}

export const MacroClockWidget: React.FC = () => {
    const { vix } = useMarketSentiment();
    const { snapshot, loading, isStale: rbiStale, lastFetchedAt, refresh } = useRbiPolicy();
    const reduceMotion = useReducedMotion();

    // Maintenance log for the operator: if the seed is > 60 days old
    // we want a console.warn so the user notices on dev refreshes.
    useEffect(() => {
        if (!snapshot) return;
        const ageMs = Date.now() - Date.parse(snapshot.effectiveDate);
        if (Number.isFinite(ageMs) && ageMs > 60 * 24 * 60 * 60 * 1000) {
            logger.warn('MacroClockWidget', `RBI repo rate seed is ${Math.round(ageMs / 86400000)} days old. Update services/rbiRepoRateSeed.ts after the next MPC review.`);
        }
    }, [snapshot]);

    const zone = useMemo(() => vixZone(vix), [vix]);
    const { last, next } = useMemo(() => pickLastAndNext(), []);

    // --- Headline numbers ---
    const rbiText = snapshot ? `${snapshot.repoRate.toFixed(2)}%` : '—';
    const vixText = Number.isFinite(vix) ? vix.toFixed(2) : '—';

    // --- Direction glyph ---
    const dir = snapshot?.direction ?? 'NEUTRAL';
    const DirIcon = dir === 'HAWKISH' ? TrendingUp : dir === 'DOVISH' ? TrendingDown : Minus;
    const dirColor = dir === 'HAWKISH' ? 'text-rose-400' : dir === 'DOVISH' ? 'text-emerald-400' : 'text-slate-400';

    // --- VIX "vs prior" delta, computed locally from a memory slot ---
    // We don't have a "previous VIX" feed; render the raw VIX without
    // an invented delta. The tile shows the current value, color zone
    // and a one-word label.
    const vixDeltaLabel = Number.isFinite(vix) && vix > 0 ? `Zone: ${zone.label}` : '';

    return (
        <div
            data-testid="macro-clock-widget"
            data-loading={loading ? 'true' : 'false'}
            className="h-full min-h-[200px] bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-4 sm:p-5 flex flex-col"
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    <Clock className="w-3.5 h-3.5" />
                    Macro Clock
                </div>
                <div className="flex items-center gap-2">
                    {rbiStale && snapshot && (
                        <span
                            data-testid="macro-clock-stale"
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                        >
                            <AlertTriangle className="w-2.5 h-2.5" />
                            Needs refresh
                        </span>
                    )}
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                        {lastFetchedAt ? (reduceMotion ? formatAgo(lastFetchedAt) : formatAgo(lastFetchedAt)) : '—'}
                    </span>
                    <button
                        type="button"
                        onClick={refresh}
                        disabled={loading}
                        aria-label="Refresh macro data"
                        data-testid="macro-clock-refresh"
                        className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Tiles */}
            <div className="grid grid-cols-2 gap-3 flex-1">
                {/* RBI Repo Rate */}
                <div
                    data-testid="macro-clock-rbi-tile"
                    className={`rounded-xl p-3 border ${rbiStale && snapshot ? 'border-amber-400/60 dark:border-amber-500/40' : 'border-slate-100 dark:border-slate-800'} ${snapshot ? 'bg-slate-50 dark:bg-slate-800/40' : 'bg-slate-50/50 dark:bg-slate-800/20'}`}
                >
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
                        RBI Repo Rate
                    </div>
                    <div className="flex items-baseline gap-1.5">
                        <span data-testid="macro-clock-rbi-value" className="text-3xl font-black tabular-nums text-slate-900 dark:text-slate-50">
                            {rbiText}
                        </span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold">
                        <DirIcon className={`w-3 h-3 ${dirColor}`} />
                        <span data-testid="macro-clock-rbi-direction" className={dirColor}>
                            {dir}
                        </span>
                        {snapshot && (
                            <span className="text-slate-400 dark:text-slate-500 font-normal">
                                · since {formatShort(snapshot.effectiveDate)}
                            </span>
                        )}
                    </div>
                </div>

                {/* India VIX */}
                <div
                    data-testid="macro-clock-vix-tile"
                    className={`rounded-xl p-3 border border-slate-100 dark:border-slate-800 ${zone.bgClass}`}
                >
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
                        India VIX
                    </div>
                    <div className="flex items-baseline gap-1.5">
                        <span data-testid="macro-clock-vix-value" className={`text-3xl font-black tabular-nums ${zone.textClass}`}>
                            {vixText}
                        </span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full bg-current ${zone.textClass}`} />
                        <span data-testid="macro-clock-vix-zone" className={zone.textClass}>
                            {vixDeltaLabel}
                        </span>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div
                data-testid="macro-clock-footer"
                className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1"
            >
                <span>
                    Last MPC: <span className="font-bold text-slate-700 dark:text-slate-300">{last ? formatRange(last.start, last.end) : '—'}</span>
                </span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span>
                    Next: <span className="font-bold text-slate-700 dark:text-slate-300">{next ? formatRange(next.start, next.end) : 'TBA'}</span>
                </span>
                {snapshot && (
                    <span className="ml-auto text-[9px] font-mono text-slate-400">
                        source: {snapshot.source}
                    </span>
                )}
            </div>
        </div>
    );
};

function formatAgo(d: Date | null): string {
    if (!d) return '—';
    const ms = Date.now() - d.getTime();
    if (ms < 60_000) return 'just now';
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h ago`;
    return `${Math.round(ms / 86_400_000)} d ago`;
}

export default MacroClockWidget;
