import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid, ReferenceLine, ScatterChart, Scatter, ZAxis
} from 'recharts';
import { BrainCircuit, Meh, Frown, Smile, Skull, Flame } from 'lucide-react';
import { Trade } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import { CustomTooltip } from '../../shared/CustomTooltip';
import { EmptyState } from '../../shared/EmptyState';
import { motion } from 'framer-motion';

interface MoodCorrelationMatrixProps {
    trades: Trade[];
    isVisible?: boolean;
}

export const MoodCorrelationMatrix = React.memo(({ trades, isVisible = true }: MoodCorrelationMatrixProps) => {
    const data = useMemo(() => {
        const map: Record<string, { pnl: number; count: number; win: number }> = {};
        
        trades.forEach(t => {
            const mood = t.moodEntry || 'Neutral';
            if (!map[mood]) map[mood] = { pnl: 0, count: 0, win: 0 };
            
            const pnl = t.pnl || 0;
            map[mood].pnl += pnl;
            map[mood].count++;
            if (pnl > 0) map[mood].win++;
        });

        const metrics = Object.entries(map).map(([mood, stats]) => ({
            mood,
            pnl: stats.pnl,
            avgPnL: stats.count > 0 ? stats.pnl / stats.count : 0,
            winRate: stats.count > 0 ? (stats.win / stats.count) * 100 : 0,
            count: stats.count
        })).sort((a, b) => b.pnl - a.pnl);

        return metrics;
    }, [trades]);

    if (!data || data.length === 0) return null;

    const getMoodIcon = (mood: string, size = 16) => {
        switch (mood.toLowerCase()) {
            case 'focused': return <BrainCircuit size={size} className="text-emerald-500" />;
            case 'anxious': return <Frown size={size} className="text-amber-500" />;
            case 'bored': return <Meh size={size} className="text-slate-500" />;
            case 'revenge': return <Skull size={size} className="text-rose-500" />;
            case 'greedy': return <Flame size={size} className="text-orange-500" />;
            default: return <Smile size={size} className="text-indigo-500" />;
        }
    };

    return (
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-5 md:p-6 shadow-xl w-full h-full flex flex-col overflow-hidden">
            <div className="flex justify-between items-start mb-6 shrink-0">
                <div>
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <BrainCircuit size={16} className="text-indigo-400" /> Psychology Heatmap
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">Mental State vs Financial Reality</p>
                </div>
            </div>
            
            <div className="flex-1 w-full flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-2">
                {/* Top Mood Summary Pills */}
                {data.length > 0 && (() => {
                    const bestMood = data.reduce((best, m) => m.avgPnL > best.avgPnL ? m : best, data[0]);
                    const worstMood = data.reduce((worst, m) => m.avgPnL < worst.avgPnL ? m : worst, data[0]);
                    const mostFrequent = data.reduce((freq, m) => m.count > freq.count ? m : freq, data[0]);
                    return (
                        <div className="flex gap-2 flex-wrap mb-2">
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                                {getMoodIcon(bestMood.mood, 14)}
                                <span className="text-[10px] font-black text-emerald-400 uppercase">Best: {bestMood.mood}</span>
                                <span className="text-[10px] font-mono text-emerald-300 ml-auto">{formatCurrency(bestMood.avgPnL)}/trade</span>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 rounded-lg border border-rose-500/20">
                                {getMoodIcon(worstMood.mood, 14)}
                                <span className="text-[10px] font-black text-rose-400 uppercase">Worst: {worstMood.mood}</span>
                                <span className="text-[10px] font-mono text-rose-300 ml-auto">{formatCurrency(worstMood.avgPnL)}/trade</span>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 rounded-lg border border-amber-500/20">
                                {getMoodIcon(mostFrequent.mood, 14)}
                                <span className="text-[10px] font-black text-amber-400 uppercase">Most Frequent: {mostFrequent.mood}</span>
                                <span className="text-[10px] font-mono text-amber-300 ml-auto">{mostFrequent.count} trades</span>
                            </div>
                        </div>
                    );
                })()}

                {/* Horizontal Bar Chart */}
                <div className="flex-1 w-full" style={{ height: Math.max(160, data.length * 44), contain: 'layout' }}>
                    <SafeChartContainer>
                        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" opacity={0.3} />
                            <XAxis
                                type="number"
                                tickFormatter={(v) => formatCurrency(Math.abs(v))}
                                tick={{ fontSize: 9, fill: '#64748b' }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <YAxis
                                type="category"
                                dataKey="mood"
                                width={70}
                                tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip
                                content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const d = payload[0].payload;
                                        return (
                                            <div className="bg-slate-950/95 backdrop-blur-md border border-slate-700/50 p-3 rounded-xl shadow-2xl ring-1 ring-white/10">
                                                <p className="text-white font-bold text-sm mb-1">{d.mood}</p>
                                                <div className="space-y-0.5">
                                                    <div className="flex justify-between gap-4 text-[11px]">
                                                        <span className="text-slate-400">Avg P&L</span>
                                                        <span className={`font-mono font-bold ${d.avgPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(d.avgPnL)}</span>
                                                    </div>
                                                    <div className="flex justify-between gap-4 text-[11px]">
                                                        <span className="text-slate-400">Total P&L</span>
                                                        <span className={`font-mono font-bold ${d.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(d.pnl)}</span>
                                                    </div>
                                                    <div className="flex justify-between gap-4 text-[11px]">
                                                        <span className="text-slate-400">Trades</span>
                                                        <span className="font-mono font-bold text-white">{d.count}</span>
                                                    </div>
                                                    <div className="flex justify-between gap-4 text-[11px]">
                                                        <span className="text-slate-400">Win Rate</span>
                                                        <span className="font-mono font-bold text-sky-400">{d.winRate.toFixed(0)}%</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }
                                    return null;
                                }}
                                cursor={{ fill: 'transparent' }}
                            />
                            <ReferenceLine x={0} stroke="#334155" strokeWidth={1} />
                            <Bar dataKey="avgPnL" name="Avg P&L" radius={[0, 4, 4, 0]} barSize={20} isAnimationActive={isVisible}>
                                {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.avgPnL >= 0 ? '#10b981' : '#f43f5e'} fillOpacity={0.8} />
                                ))}
                            </Bar>
                        </BarChart>
                    </SafeChartContainer>
                </div>

                {/* Mistake Correlation Heatmap: mood × trade outcome intensity */}
                <MistakeCorrelationHeatmap trades={trades} />
            </div>
        </div>
    );
});

/**
 * Renders a 2D grid: rows = mood, columns = bucket (Win / BE / Loss),
 * cell color = P&L intensity. This is the "Mistake Correlation Heatmap"
 * the user asked for — a compact matrix linking emotional state to
 * financial outcome so behavior patterns are immediately visible.
 */
const MistakeCorrelationHeatmap: React.FC<{ trades: Trade[] }> = React.memo(({ trades }) => {
    const matrix = React.useMemo(() => {
        const moods = Array.from(new Set(trades.map(t => t.moodEntry || 'Neutral')));
        const buckets: Array<{ id: 'WIN' | 'BE' | 'LOSS'; label: string; filter: (p: number) => boolean }> = [
            { id: 'WIN', label: 'Win', filter: (p) => p > 0 },
            { id: 'BE', label: 'BE', filter: (p) => p === 0 },
            { id: 'LOSS', label: 'Loss', filter: (p) => p < 0 },
        ];
        const cells = moods.map(mood => {
            const moodTrades = trades.filter(t => (t.moodEntry || 'Neutral') === mood);
            return buckets.map(b => {
                const subset = moodTrades.filter(t => b.filter(t.pnl || 0));
                const total = subset.reduce((s, t) => s + (t.pnl || 0), 0);
                return { mood, bucket: b.id, label: b.label, totalPnL: total, count: subset.length };
            });
        }).flat();
        return { moods, buckets, cells };
    }, [trades]);

    if (matrix.moods.length === 0) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
            >
                <EmptyState
                    type="no-trades"
                    title="No mood data available"
                    message="Log trades with mood tags to see how your emotions correlate with P&L."
                />
            </motion.div>
        );
    }

    // Find the absolute max P&L across cells for normalization
    const maxAbs = matrix.cells.reduce((m, c) => Math.max(m, Math.abs(c.totalPnL)), 0) || 1;

    return (
        <div className="mt-5 pt-4 border-t border-white/5">
            <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <BrainCircuit size={12} className="text-rose-400" />
                    Mistake Correlation Heatmap
                </p>
                <p className="text-[9px] text-slate-500 uppercase tracking-widest">Mood × Outcome P&L</p>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-[10px]">
                    <thead>
                        <tr>
                            <th className="p-1.5 text-slate-500 font-black uppercase tracking-widest">Mood</th>
                            {matrix.buckets.map(b => (
                                <th key={b.id} className="p-1.5 text-center text-slate-500 font-black uppercase tracking-widest">{b.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {matrix.moods.map(mood => (
                            <tr key={mood}>
                                <td className="p-1.5 font-bold text-slate-300 uppercase tracking-tight whitespace-nowrap">{mood}</td>
                                {matrix.buckets.map(b => {
                                    const cell = matrix.cells.find(c => c.mood === mood && c.bucket === b.id);
                                    if (!cell || cell.count === 0) {
                                        return (
                                            <td key={b.id} className="p-1.5">
                                                <div className="h-9 rounded-md bg-slate-800/30 border border-slate-800/50 flex items-center justify-center text-slate-600 text-[9px]">·</div>
                                            </td>
                                        );
                                    }
                                    const intensity = Math.min(Math.abs(cell.totalPnL) / maxAbs, 1);
                                    const isPositive = cell.totalPnL > 0;
                                    const color = isPositive
                                        ? `rgba(16, 185, 129, ${0.15 + intensity * 0.65})`
                                        : `rgba(244, 63, 94, ${0.15 + intensity * 0.65})`;
                                    return (
                                        <td key={b.id} className="p-1.5">
                                            <div
                                                className="h-9 rounded-md flex flex-col items-center justify-center border border-white/5 backdrop-blur-sm transition-transform hover:scale-105"
                                                style={{ background: color }}
                                                title={`${mood} → ${b.label}: ${formatCurrency(cell.totalPnL)} across ${cell.count} trade(s)`}
                                            >
                                                <span className={`text-[10px] font-black font-mono ${isPositive ? 'text-emerald-100' : 'text-rose-100'}`}>
                                                    {formatCurrency(Math.abs(cell.totalPnL)).replace('₹', '')}
                                                </span>
                                                <span className="text-[8px] text-white/60">{cell.count}T</span>
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
});
