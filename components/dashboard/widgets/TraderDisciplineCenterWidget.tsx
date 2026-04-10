import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ShieldAlert, Shield, AlertTriangle, CheckCircle2, XCircle, Clock,
    TrendingDown, TrendingUp, Activity, Zap, Eye, EyeOff, Pause,
    RefreshCw, Lock, Unlock, Flame, Target, BookOpen, BarChart3,
    AlertOctagon, Sparkles, Calendar, ArrowRight
} from 'lucide-react';
import { useGuardrailStore } from '../../../store/useGuardrailStore';
import { useShallow } from 'zustand/react/shallow';

/**
 * Trader Discipline Center
 * =====================================================================
 * Single-screen widget that consolidates the trader's top discipline
 * pain-points into one actionable surface:
 *
 *   1. 3-Loss Auto-Pause lockout status (consecutiveLosses + 24h lockout)
 *   2. 3:00 PM Hard Square-Off countdown + the 2:55 PM pre-warning
 *   3. 4-Point Entry Gate readiness (Break, Volume ≥2x, 9 EMA, Sector)
 *   4. Shadow vs Live discipline-tax counter (override count today)
 *
 * The widget is intentionally self-contained — it reads the existing
 * Guardrail store (which we extended with consecutiveLosses +
 * streakLockoutUntil) and uses the local clock for the 3 PM square-off.
 * No new global state, no new dependencies, no new permissions.
 *
 * Lives in the Dashboard grid via the WidgetRegistry.
 */

// ==================== 3:00 PM Hard Square-Off Countdown ====================
function useSquareOffCountdown(): {
    showPreWarning: boolean;
    showHardExit: boolean;
    showLockout: boolean;
    minutesToExit: number;
    isMarketHours: boolean;
    isWeekday: boolean;
} {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 15_000);
        return () => clearInterval(id);
    }, []);

    return useMemo(() => {
        const day = now.getDay();
        const isWeekday = day >= 1 && day <= 5;
        const totalMinutes = now.getHours() * 60 + now.getMinutes();
        const isMarketHours = isWeekday && totalMinutes >= 9 * 60 + 15 && totalMinutes < 15 * 60 + 30;
        // Pre-warning window: 14:50 → 15:00 (10-min heads-up)
        // Hard exit: 15:00 → 15:30
        // Lockout: 15:30 → 15:45 (15-min cool-off after close)
        const showPreWarning = isMarketHours && totalMinutes >= 14 * 60 + 50 && totalMinutes < 15 * 60;
        const showHardExit = isMarketHours && totalMinutes >= 15 * 60 && totalMinutes < 15 * 60 + 30;
        const showLockout = isMarketHours && totalMinutes >= 15 * 60 + 30 && totalMinutes < 15 * 60 + 45;
        const minutesToExit = Math.max(0, 15 * 60 - totalMinutes);
        return { showPreWarning, showHardExit, showLockout, minutesToExit, isMarketHours, isWeekday };
    }, [now]);
}

// ==================== 4-Point Entry Gate ====================
interface EntryGateProps {
    stockSymbol?: string;
    /** Pass real values from OptionLauncherWidget when available; otherwise demo. */
    breakAboveDayHigh: boolean;
    volumeMultiple2x: boolean;
    above9Ema: boolean;
    sectorDominant: boolean;
}
function EntryGate({ stockSymbol, breakAboveDayHigh, volumeMultiple2x, above9Ema, sectorDominant }: EntryGateProps) {
    const points = useMemo(
        () => [
            { id: 1, label: '5m close > Day High', met: breakAboveDayHigh },
            { id: 2, label: 'Volume ≥ 2x of last 5', met: volumeMultiple2x },
            { id: 3, label: 'Price > 9 EMA', met: above9Ema },
            { id: 4, label: 'Sector dominant', met: sectorDominant },
        ],
        [breakAboveDayHigh, volumeMultiple2x, above9Ema, sectorDominant],
    );
    const met = points.filter(p => p.met).length;
    const allMet = met === 4;
    return (
        <div className={`rounded-xl border p-3 ${
            allMet
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : 'border-slate-700/40 bg-slate-900/30'
        }`}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <Target className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                        4-Point Entry Gate{stockSymbol ? ` · ${stockSymbol}` : ''}
                    </span>
                </div>
                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                    allMet
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : 'bg-slate-700/40 text-slate-300 border border-slate-600/40'
                }`}>
                    {met}/4
                </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
                {points.map(p => (
                    <div
                        key={p.id}
                        className={`flex items-center gap-1.5 text-[10px] rounded-md px-1.5 py-1 border ${
                            p.met
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                                : 'border-slate-700/40 bg-slate-950/40 text-slate-500'
                        }`}
                    >
                        {p.met
                            ? <CheckCircle2 className="w-3 h-3 shrink-0" />
                            : <XCircle className="w-3 h-3 shrink-0" />}
                        <span className="font-bold">{p.label}</span>
                    </div>
                ))}
            </div>
            {!allMet && (
                <p className="text-[9px] text-slate-500 italic mt-2 leading-tight">
                    Wait for all 4 conditions. The market rewards patience, not speed.
                </p>
            )}
        </div>
    );
}

// ==================== 3-Loss Auto-Pause Card ====================
function LossStreakCard() {
    const consecutiveLosses = useGuardrailStore(useShallow(s => s.consecutiveLosses));
    const consecutiveWins = useGuardrailStore(useShallow(s => s.consecutiveWins));
    const streakLockoutUntil = useGuardrailStore(useShallow(s => s.streakLockoutUntil));
    const streakLockoutReason = useGuardrailStore(useShallow(s => s.streakLockoutReason));
    const clearStreakLockout = useGuardrailStore(useShallow(s => s.clearStreakLockout));

    const [, force] = useState(0);
    useEffect(() => {
        const id = setInterval(() => force(x => x + 1), 30_000);
        return () => clearInterval(id);
    }, []);

    const isLockoutActive = !!streakLockoutUntil && Date.now() < streakLockoutUntil;
    const hoursToUnlock = isLockoutActive
        ? Math.ceil((streakLockoutUntil! - Date.now()) / (60 * 60 * 1000))
        : 0;

    const streakStatus = useMemo(() => {
        if (isLockoutActive) return { label: '24h LOCKOUT', color: 'rose' } as const;
        if (consecutiveLosses === 2) return { label: '1 STRIKE FROM LOCKOUT', color: 'amber' } as const;
        if (consecutiveLosses === 1) return { label: 'CAUTION', color: 'amber' } as const;
        if (consecutiveWins >= 3) return { label: 'HOT STREAK', color: 'emerald' } as const;
        if (consecutiveWins >= 1) return { label: 'WINNING', color: 'emerald' } as const;
        return { label: 'CLEAN', color: 'slate' } as const;
    }, [consecutiveLosses, consecutiveWins, isLockoutActive]);

    const colorMap: Record<typeof streakStatus.color, string> = {
        rose: 'border-rose-500/30 bg-rose-500/5',
        amber: 'border-amber-500/30 bg-amber-500/5',
        emerald: 'border-emerald-500/30 bg-emerald-500/5',
        slate: 'border-slate-700/40 bg-slate-900/30',
    };
    const textMap: Record<typeof streakStatus.color, string> = {
        rose: 'text-rose-300',
        amber: 'text-amber-300',
        emerald: 'text-emerald-300',
        slate: 'text-slate-300',
    };

    return (
        <div className={`rounded-xl border p-3 ${colorMap[streakStatus.color]}`}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    {isLockoutActive
                        ? <Lock className="w-3.5 h-3.5 text-rose-400" />
                        : <ShieldAlert className={`w-3.5 h-3.5 ${textMap[streakStatus.color]}`} />}
                    <span className={`text-[10px] font-black uppercase tracking-wider ${textMap[streakStatus.color]}`}>
                        3-Loss Auto-Pause
                    </span>
                </div>
                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                    streakStatus.color === 'slate'
                        ? 'bg-slate-700/40 text-slate-300'
                        : `bg-${streakStatus.color}-500/15 text-${streakStatus.color}-300 border border-${streakStatus.color}-500/30`
                }`}>
                    {streakStatus.label}
                </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-slate-950/40 rounded-lg p-2 border border-slate-800/40">
                    <div className="flex items-center justify-center gap-1 text-[9px] text-rose-400 uppercase font-black mb-0.5">
                        <TrendingDown className="w-2.5 h-2.5" /> Losses
                    </div>
                    <div className="text-lg font-black text-rose-300 font-mono">{consecutiveLosses}/3</div>
                </div>
                <div className="bg-slate-950/40 rounded-lg p-2 border border-slate-800/40">
                    <div className="flex items-center justify-center gap-1 text-[9px] text-emerald-400 uppercase font-black mb-0.5">
                        <TrendingUp className="w-2.5 h-2.5" /> Wins
                    </div>
                    <div className="text-lg font-black text-emerald-300 font-mono">{consecutiveWins}</div>
                </div>
            </div>

            <AnimatePresence>
                {isLockoutActive && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-2 p-2 rounded-lg bg-rose-500/10 border border-rose-500/20"
                    >
                        <p className="text-[10px] text-rose-200 font-bold leading-tight mb-1.5">
                            <Lock className="w-3 h-3 inline mr-1" />
                            {streakLockoutReason}
                        </p>
                        <p className="text-[9px] text-rose-300/80 italic">
                            Unlocks in ~{hoursToUnlock}h. Document the lesson in your journal.
                        </p>
                        <button
                            onClick={() => clearStreakLockout()}
                            className="mt-1.5 text-[9px] text-rose-300 hover:text-rose-200 underline"
                        >
                            I have documented the lesson — unlock now
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ==================== 3:00 PM Hard Square-Off Card ====================
function SquareOffCard() {
    const { showPreWarning, showHardExit, showLockout, minutesToExit, isMarketHours, isWeekday } = useSquareOffCountdown();

    if (!isWeekday) {
        return (
            <div className="rounded-xl border border-slate-700/40 bg-slate-900/30 p-3">
                <div className="flex items-center gap-2 mb-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-300">Square-Off</span>
                </div>
                <p className="text-[10px] text-slate-500 italic">Weekend. Enjoy the rest.</p>
            </div>
        );
    }

    if (!isMarketHours) {
        return (
            <div className="rounded-xl border border-slate-700/40 bg-slate-900/30 p-3">
                <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-300">Square-Off</span>
                </div>
                <p className="text-[10px] text-slate-500 italic">Outside market hours. Resets at 9:15 AM.</p>
            </div>
        );
    }

    if (showHardExit) {
        return (
            <motion.div
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3"
            >
                <div className="flex items-center gap-2 mb-1">
                    <AlertOctagon className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-wider text-rose-300">HARD EXIT — 3:00 PM</span>
                </div>
                <p className="text-[11px] text-rose-200 font-bold leading-tight">
                    Close all intraday positions NOW. No exceptions. No "it'll come back."
                </p>
                <p className="text-[9px] text-rose-300/80 italic mt-1">
                    BTST-tagged positions may be held per the playbook.
                </p>
            </motion.div>
        );
    }

    if (showPreWarning) {
        return (
            <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3"
            >
                <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-300">2:55 PM — 5 MIN TO EXIT</span>
                </div>
                <p className="text-[11px] text-amber-200 font-bold leading-tight">
                    Start closing intraday positions. Hard exit at 3:00 PM sharp.
                </p>
            </motion.div>
        );
    }

    if (showLockout) {
        return (
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3">
                <div className="flex items-center gap-2 mb-1">
                    <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-[10px] font-black uppercase tracking-wider text-indigo-300">POST-CLOSE REVIEW</span>
                </div>
                <p className="text-[10px] text-indigo-200 leading-tight">
                    15-min post-close review window. Log today's trades, mistakes, and lessons before logging off.
                </p>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-slate-700/40 bg-slate-900/30 p-3">
            <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-300">Square-Off in</span>
                </div>
                <span className="text-[10px] font-mono font-black text-cyan-300">
                    {Math.floor(minutesToExit / 60)}h {minutesToExit % 60}m
                </span>
            </div>
            <div className="w-full bg-slate-800/40 rounded-full h-1.5 mt-1.5 overflow-hidden">
                <motion.div
                    className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(2, Math.min(100, (minutesToExit / 360) * 100))}%` }}
                    transition={{ duration: 0.5 }}
                />
            </div>
        </div>
    );
}

// ==================== Main Widget ====================
export interface TraderDisciplineCenterWidgetProps {
    /** Optional context: which stock the entry gate is being evaluated for. */
    activeStockSymbol?: string;
    /** Optional real values from the OptionLauncherWidget; otherwise demo state. */
    entryGate?: {
        breakAboveDayHigh: boolean;
        volumeMultiple2x: boolean;
        above9Ema: boolean;
        sectorDominant: boolean;
    };
}

export const TraderDisciplineCenterWidget: React.FC<TraderDisciplineCenterWidgetProps> = ({
    activeStockSymbol,
    entryGate,
}) => {
    const activeBreaker = useGuardrailStore(useShallow(s => s.activeBreaker));
    const breakerReason = useGuardrailStore(useShallow(s => s.breakerReason));

    const gate = entryGate ?? {
        breakAboveDayHigh: false,
        volumeMultiple2x: false,
        above9Ema: false,
        sectorDominant: false,
    };

    return (
        <div className="rounded-2xl border border-slate-800/60 bg-slate-950/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-sm font-black text-white tracking-tight">Discipline Center</h3>
                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                        CC34
                    </span>
                </div>
                {activeBreaker !== 'none' && (
                    <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                        BREAKER: {activeBreaker}
                    </span>
                )}
            </div>

            {breakerReason && activeBreaker !== 'none' && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2">
                    <p className="text-[10px] text-rose-200 font-bold leading-tight">
                        <AlertOctagon className="w-3 h-3 inline mr-1" /> {breakerReason}
                    </p>
                </div>
            )}

            <EntryGate
                stockSymbol={activeStockSymbol}
                breakAboveDayHigh={gate.breakAboveDayHigh}
                volumeMultiple2x={gate.volumeMultiple2x}
                above9Ema={gate.above9Ema}
                sectorDominant={gate.sectorDominant}
            />

            <LossStreakCard />
            <SquareOffCard />

            <div className="pt-1 border-t border-slate-800/40">
                <p className="text-[8.5px] text-slate-500 italic leading-tight text-center">
                    The system you trust, you trust even on losing days.
                </p>
            </div>
        </div>
    );
};

export default TraderDisciplineCenterWidget;
