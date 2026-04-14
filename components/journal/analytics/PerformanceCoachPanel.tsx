import React, { useMemo } from 'react';
import { Brain, Gauge, Layers3, TrendingUp } from 'lucide-react';
import { Trade } from '../../../database';
import { summarizeJournalPerformance } from '../../../services/JournalPerformanceService';
import { formatCurrency } from '../../../utils/helpers';

interface PerformanceCoachPanelProps {
    trades: Trade[];
    isVisible?: boolean;
}

export const PerformanceCoachPanel = React.memo(({ trades }: PerformanceCoachPanelProps) => {
    const summary = useMemo(() => summarizeJournalPerformance(trades), [trades]);

    return (
        <div className="bg-slate-950 border border-white/10 rounded-2xl p-4 sm:p-5 md:p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    <Brain size={18} />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white">Performance Coach</h3>
                    <p className="text-xs text-slate-400">Expectancy, setup quality, and execution efficiency in one loop.</p>
                </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
                <div className="rounded-xl border border-white/5 bg-white/5 p-4">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        <TrendingUp size={12} /> Expectancy
                    </div>
                    <p className={`mt-2 text-2xl font-black font-mono ${summary.expectancy >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {summary.expectancy >= 0 ? '+' : ''}{summary.expectancy.toFixed(2)}R
                    </p>
                </div>
                <div className="rounded-xl border border-white/5 bg-white/5 p-4">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        <Gauge size={12} /> Process
                    </div>
                    <p className="mt-2 text-2xl font-black text-white">{summary.processScore.toFixed(0)}</p>
                    <p className="text-[10px] text-slate-500">out of 100</p>
                </div>
                <div className="rounded-xl border border-white/5 bg-white/5 p-4">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        <Layers3 size={12} /> Avg MAE
                    </div>
                    <p className="mt-2 text-xl font-black text-rose-400">{formatCurrency(summary.averageMae)}</p>
                </div>
                <div className="rounded-xl border border-white/5 bg-white/5 p-4">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        <Layers3 size={12} /> Avg MFE
                    </div>
                    <p className="mt-2 text-xl font-black text-emerald-400">{formatCurrency(summary.averageMfe)}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Best Setup</p>
                    <p className="mt-2 text-sm font-bold text-white">{summary.bestSetup?.setup || 'Not enough data yet'}</p>
                    {summary.bestSetup && (
                        <p className="mt-1 text-xs text-emerald-100">
                            {summary.bestSetup.count} trades, {summary.bestSetup.winRate.toFixed(0)}% win rate, {summary.bestSetup.expectancy.toFixed(2)}R expectancy
                        </p>
                    )}
                </div>
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-rose-200">Needs Work</p>
                    <p className="mt-2 text-sm font-bold text-white">{summary.weakestSetup?.setup || 'Not enough data yet'}</p>
                    {summary.weakestSetup && (
                        <p className="mt-1 text-xs text-rose-100">
                            {summary.weakestSetup.count} trades, {summary.weakestSetup.winRate.toFixed(0)}% win rate, {summary.weakestSetup.expectancy.toFixed(2)}R expectancy
                        </p>
                    )}
                </div>
            </div>

            <div className="mt-5 space-y-2">
                {summary.coachingNotes.map((note) => (
                    <div key={note} className="rounded-xl border border-white/5 bg-slate-900/70 px-3 py-2 text-sm text-slate-300">
                        {note}
                    </div>
                ))}
            </div>
        </div>
    );
});
