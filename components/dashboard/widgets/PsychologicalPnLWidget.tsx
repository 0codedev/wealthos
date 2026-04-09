import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Brain, AlertCircle, TrendingUp, TrendingDown,
    Target, Zap, RefreshCw, BarChart2, BookOpen
} from 'lucide-react';
import { psychologicalPnLService, PsychologicalStats } from '../../../services/PsychologicalPnLService';
import { EmptyState } from '../../shared/EmptyState';
import { ValueFlash } from '../../shared/ValueFlash';
import { formatCurrency } from '../../../utils/helpers';

const PsychologicalPnLWidget: React.FC = () => {
    const [stats, setStats] = useState<PsychologicalStats | null>(null);
    const [loading, setLoading] = useState(true);

    const refreshStats = async () => {
        setLoading(true);
        try {
            const result = await psychologicalPnLService.calculateFromDb();
            setStats(result);
        } catch (err) {
            console.error('PsychologicalPnLWidget: failed to load stats', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refreshStats();
    }, []);

    if (!stats && loading) return (
        <div className="h-full flex items-center justify-center bg-white/60 dark:bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-200 dark:border-slate-800">
            <RefreshCw className="animate-spin text-indigo-500" size={24} />
        </div>
    );

    if (stats && stats.totalTrades === 0) {
        return (
            <div className="h-full flex flex-col bg-white/60 dark:bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-200 dark:border-slate-800 p-5 relative overflow-hidden">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl">
                        <Brain className="text-indigo-600 dark:text-indigo-400" size={20} />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 uppercase tracking-wider">Psychological PnL</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase">The Mirror of Truth</p>
                    </div>
                </div>
                <EmptyState
                    variant="card"
                    icon={BookOpen}
                    title="No trades logged"
                    description="Log your first trade in the journal to start uncovering behavioral tax leaks."
                    actionLabel="Log Trade"
                    onAction={() => window.dispatchEvent(new CustomEvent('app:open-add-trade'))}
                />
            </div>
        );
    }

    const isPositive = (stats?.actualPnL || 0) >= 0;
    const efficiencyColor = (stats?.efficiencyScore || 0) > 80 ? 'text-emerald-600 dark:text-emerald-400' : (stats?.efficiencyScore || 0) > 50 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400';

    return (
        <div className="h-full flex flex-col bg-white/60 dark:bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-200 dark:border-slate-800 p-5 relative overflow-hidden group">
            {/* Background Glow */}
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/10 blur-[80px] rounded-full group-hover:bg-indigo-500/20 transition-colors" />

            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl">
                        <Brain className="text-indigo-600 dark:text-indigo-400" size={20} />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 uppercase tracking-wider">Psychological PnL</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase">The Mirror of Truth</p>
                    </div>
                </div>
                <button 
                    onClick={refreshStats}
                    className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 transition-colors"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Main Stats Grid */}
            <div className="grid grid-cols-2 gap-4 mb-4">
                {/* Actual PnL */}
                <div className="p-4 bg-white/60 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700/50">
                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Realized PnL</p>
                    <ValueFlash value={stats?.actualPnL || 0} className="inline-block" epsilon={1}>
                        <div className={`text-lg font-black flex items-center gap-1.5 ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {isPositive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                            {formatCurrency(Math.abs(stats?.actualPnL || 0))}
                        </div>
                    </ValueFlash>
                </div>

                {/* Efficiency Score */}
                <div className="p-4 bg-white/60 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700/50">
                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Efficiency Index</p>
                    <div className={`text-lg font-black ${efficiencyColor}`}>
                        {stats?.efficiencyScore.toFixed(1)}%
                    </div>
                </div>
            </div>

            {/* Trading Metrics Row */}
            <div className="grid grid-cols-3 gap-3 mb-6">
                {/* Win Rate */}
                <div className="p-3 bg-white/40 dark:bg-slate-800/20 rounded-xl border border-slate-200/50 dark:border-slate-700/30 text-center">
                    <p className="text-[9px] font-bold text-slate-500 uppercase mb-0.5">Win Rate</p>
                    <div className="text-sm font-black text-slate-900 dark:text-slate-100">
                        {stats?.winRate ? stats.winRate.toFixed(1) : '0.0'}%
                    </div>
                </div>

                {/* Avg R:R */}
                <div className="p-3 bg-white/40 dark:bg-slate-800/20 rounded-xl border border-slate-200/50 dark:border-slate-700/30 text-center">
                    <p className="text-[9px] font-bold text-slate-500 uppercase mb-0.5">Avg R:R</p>
                    <div className="text-sm font-black text-slate-900 dark:text-slate-100">
                        1 : {stats?.avgRR ? stats.avgRR.toFixed(2) : '0.00'}
                    </div>
                </div>

                {/* Total Trades */}
                <div className="p-3 bg-white/40 dark:bg-slate-800/20 rounded-xl border border-slate-200/50 dark:border-slate-700/30 text-center">
                    <p className="text-[9px] font-bold text-slate-500 uppercase mb-0.5">Total Trades</p>
                    <div className="text-sm font-black text-slate-900 dark:text-slate-100">
                        {stats?.totalTrades || 0}
                    </div>
                </div>
            </div>

            {/* The Behavioral Tax Section */}
            <div className="flex-1 bg-gradient-to-br from-indigo-500/5 to-transparent bg-white/40 dark:bg-slate-900/20 rounded-2xl border border-indigo-100 dark:border-indigo-500/10 p-5 mb-4 relative overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <AlertCircle className="text-rose-600 dark:text-rose-400" size={16} />
                        <span className="text-[10px] font-black text-rose-600 dark:text-rose-400 uppercase tracking-widest">Behavioral Tax</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[9px] font-black uppercase">
                        {stats?.mistakeCount} Mistakes
                    </span>
                </div>

                <div className="text-3xl font-black text-slate-900 dark:text-slate-100 mb-1">
                    {formatCurrency(stats?.behavioralTax || 0)}
                </div>
                <p className="text-[10px] font-bold text-slate-500 uppercase mb-4">The cost of emotional trading</p>

                {/* Visual Gap Bar */}
                <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-bold uppercase text-slate-500">
                        <span>Actual Potential</span>
                        <span>{formatCurrency(stats?.psychologicalPnL || 0)}</span>
                    </div>
                    <div className="h-2 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden flex">
                        <div 
                            className="h-full bg-emerald-500/80 transition-all duration-1000" 
                            style={{ width: `${stats?.efficiencyScore}%` }}
                        />
                        <div 
                            className="h-full bg-rose-500/40 transition-all duration-1000" 
                            style={{ width: `${100 - (stats?.efficiencyScore || 0)}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Insights Footer */}
            <div className="flex items-center gap-3 p-3 bg-white/60 dark:bg-slate-800/20 backdrop-blur-sm rounded-xl border border-slate-200 dark:border-slate-700/30">
                <Zap size={14} className="text-amber-500 dark:text-amber-400 shrink-0" />
                <div className="text-[10px] leading-tight text-slate-600 dark:text-slate-400">
                    Your biggest leak is <span className="font-black text-rose-600 dark:text-rose-400 uppercase">{stats?.topMistakeType}</span>. 
                    Eliminating this would increase your PnL by <span className="font-black text-emerald-600 dark:text-emerald-400 uppercase">{((stats?.behavioralTax || 0) / (stats?.psychologicalPnL || 1) * 100).toFixed(1)}%</span>.
                </div>
            </div>
        </div>
    );
};

export default PsychologicalPnLWidget;
