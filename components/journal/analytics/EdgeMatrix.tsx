import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Crosshair, Target, Ghost } from 'lucide-react';
import { Trade } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import { EmptyState } from '../../shared/EmptyState';

interface EdgeMatrixProps {
    trades: Trade[];
    isVisible?: boolean;
}

/**
 * Edge Finder: Setup-vs-Performance correlation.
 *
 * Profit Factor is now computed as `wins / losses` (positive ratio) and
 * surfaced as `∞` when there are no losses — previously the `Math.abs`
 * guard made the metric drop toward 0, which was misleading. We also
 * add Avg Win and Avg Loss columns for a more complete picture.
 */
export const EdgeMatrix = React.memo(({ trades }: EdgeMatrixProps) => {
    const edgeData = useMemo(() => {
        const map: Record<string, { wins: number, loss: number, winsPnL: number, lossesPnL: number, totalPnL: number, count: number }> = {};
        trades.forEach(t => {
            const setup = t.setup || 'No Setup';
            if (!map[setup]) map[setup] = { wins: 0, loss: 0, winsPnL: 0, lossesPnL: 0, totalPnL: 0, count: 0 };
            const pnl = t.pnl || 0;
            map[setup].count++;
            map[setup].totalPnL += pnl;
            if (pnl > 0) {
                map[setup].wins++;
                map[setup].winsPnL += pnl;
            } else {
                map[setup].loss++;
                map[setup].lossesPnL += Math.abs(pnl);
            }
        });
        return Object.entries(map)
            .map(([name, data]) => {
                const winRate = data.count > 0 ? (data.wins / data.count) * 100 : 0;
                const avgPnL = data.count > 0 ? data.totalPnL / data.count : 0;
                // Edge-safe profit factor: positive ratio, ∞ when no losses
                const profitFactor = data.loss > 0 ? data.wins / data.loss : (data.wins > 0 ? Infinity : 0);
                const avgWin = data.wins > 0 ? data.winsPnL / data.wins : 0;
                const avgLoss = data.loss > 0 ? data.lossesPnL / data.loss : 0;
                return {
                    name,
                    winRate,
                    avgPnL,
                    totalPnL: data.totalPnL,
                    count: data.count,
                    profitFactor,
                    avgWin,
                    avgLoss,
                };
            })
            .sort((a, b) => b.totalPnL - a.totalPnL);
    }, [trades]);

    const formatPF = (pf: number) => {
        if (!Number.isFinite(pf)) return '∞';
        if (pf === 0) return '—';
        return pf.toFixed(2);
    };

    const pfTone = (pf: number) => {
        if (!Number.isFinite(pf)) return 'text-cyan-400';
        if (pf >= 1.5) return 'text-emerald-400';
        if (pf >= 1) return 'text-amber-400';
        return 'text-rose-400';
    };

    return (
        <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-6 border-b border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/5 backdrop-blur-md">
                <div>
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <Crosshair className="text-cyan-400" /> The Edge Finder
                    </h3>
                    <p className="text-sm text-slate-400">Correlation Matrix: Strategy vs. Performance</p>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-950 text-slate-500 uppercase font-bold text-xs tracking-wider">
                        <tr>
                            <th className="p-4">Strategy / Setup</th>
                            <th className="p-4 text-center">Count</th>
                            <th className="p-4 text-center">Win Rate</th>
                            <th className="p-4 text-right">Avg Win</th>
                            <th className="p-4 text-right">Avg Loss</th>
                            <th className="p-4 text-right">Total Net</th>
                            <th className="p-4 text-center">Profit Factor</th>
                            <th className="p-4 text-center">Rating</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 bg-slate-900/40 backdrop-blur-sm">
                        {edgeData.map((edge) => {
                            const isA_Plus = edge.winRate > 50 && edge.totalPnL > 0;
                            const isBleeding = edge.totalPnL < 0;
                            return (
                                <tr key={edge.name} className="hover:bg-white/5 transition-colors group">
                                    <td className="p-4 font-bold text-white flex items-center gap-2">
                                        {isA_Plus && <Target size={14} className="text-emerald-500" />}
                                        {isBleeding && <Ghost size={14} className="text-rose-500" />}
                                        {edge.name}
                                    </td>
                                    <td className="p-4 text-center text-slate-400">{edge.count}</td>
                                    <td className="p-4 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                                <div className={`h-full ${edge.winRate > 50 ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${edge.winRate}%` }}></div>
                                            </div>
                                            <span className={`text-xs font-mono ${edge.winRate > 50 ? 'text-emerald-400' : 'text-rose-400'}`}>{edge.winRate.toFixed(0)}%</span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-right font-mono text-emerald-400">{edge.avgWin > 0 ? `+${formatCurrency(edge.avgWin)}` : '—'}</td>
                                    <td className="p-4 text-right font-mono text-rose-400">{edge.avgLoss > 0 ? `-${formatCurrency(edge.avgLoss)}` : '—'}</td>
                                    <td className={`p-4 text-right font-mono font-bold text-base ${edge.totalPnL > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{edge.totalPnL > 0 ? '+' : ''}{formatCurrency(edge.totalPnL)}</td>
                                    <td className={`p-4 text-center font-mono font-bold ${pfTone(edge.profitFactor)}`}>{formatPF(edge.profitFactor)}</td>
                                    <td className="p-4 text-center">
                                        {isA_Plus ? <span className="px-2 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-xs font-bold">A+</span> : isBleeding ? <span className="px-2 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded text-xs font-bold">F</span> : <span className="px-2 py-1 bg-slate-800 text-slate-400 border border-slate-700 rounded text-xs font-bold">C</span>}
                                    </td>
                                </tr>
                            );
                        })}
                        {edgeData.length === 0 && (
                            <tr>
                                <td colSpan={8} className="p-0">
                                    <motion.div
                                        initial={{ opacity: 0, y: 4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.3, ease: 'easeOut' }}
                                    >
                                        <EmptyState
                                            type="no-trades"
                                            title="No edge data available"
                                            message="Log more trades to unlock your Edge Matrix."
                                        />
                                    </motion.div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
});
