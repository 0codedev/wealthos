import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Users, Target, TrendingUp, TrendingDown,
    Zap, RefreshCw, Layers, ShieldCheck
} from 'lucide-react';
import { shadowPortfolioService, ShadowStats } from '../../../services/ShadowPortfolioService';
import { useLiteModeStore } from '../../../store/liteModeStore';
import { useShallow } from 'zustand/react/shallow';
import { usePageVisibility } from '../../../contexts/PageVisibilityContext';
import { ValueFlash } from '../../shared/ValueFlash';
import { formatCurrency } from '../../../utils/helpers';

const ShadowPortfolioWidget: React.FC = () => {
    const [stats, setStats] = useState<ShadowStats | null>(null);
    const [loading, setLoading] = useState(true);
    const isLiteMode = useLiteModeStore(useShallow(state => state.isLiteMode));
    const isVisible = usePageVisibility();

    const refreshData = async () => {
        setLoading(true);
        try {
            const res = await shadowPortfolioService.getComparisonStats();
            setStats(res);
        } catch (err) {
            console.error('ShadowPortfolioWidget: failed to load comparison stats', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refreshData();
    }, []);

    const isUserWinning = (stats?.gap || 0) >= 0;
    const efficiencyColor = (stats?.sizingEfficiency || 0) > 90 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400';

    if (isLiteMode) {
        return (
            <div className="h-full flex flex-col bg-white/60 dark:bg-slate-900/50 backdrop-blur-xl border border-slate-200 dark:border-slate-800 p-5 relative overflow-hidden group">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-violet-500/10 rounded-xl">
                            <Layers className="text-violet-600 dark:text-violet-400" size={16} />
                        </div>
                        <div>
                            <h3 className="text-xs font-black text-slate-900 dark:text-slate-100 uppercase tracking-wider">Shadow Stats</h3>
                        </div>
                    </div>
                    <div className="px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-505 rounded text-[8px] font-black uppercase tracking-widest border border-amber-500/20">
                        Lite Active
                    </div>
                </div>

                <div className="space-y-4 flex-1 flex flex-col justify-center">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-white/60 dark:bg-slate-800/30 backdrop-blur-sm rounded-xl border border-slate-200 dark:border-slate-700/50">
                            <p className="text-[8px] font-bold text-slate-500 uppercase mb-1">Efficiency</p>
                            <p className={`text-sm font-black ${efficiencyColor}`}>{stats?.sizingEfficiency.toFixed(1)}%</p>
                        </div>
                        <div className="p-3 bg-white/60 dark:bg-slate-800/30 backdrop-blur-sm rounded-xl border border-slate-200 dark:border-slate-700/50 text-right">
                            <p className="text-[8px] font-bold text-slate-500 uppercase mb-1">Gap</p>
                            <p className={`text-sm font-black ${isUserWinning ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {formatCurrency(stats?.gap || 0)}
                            </p>
                        </div>
                    </div>
                    
                    <div className="p-3 bg-white/40 dark:bg-indigo-500/5 backdrop-blur-sm rounded-xl border border-slate-200 dark:border-indigo-500/10 flex items-center gap-2">
                        <Zap size={12} className="text-amber-550 dark:text-amber-400 shrink-0" />
                        <p className="text-[9px] leading-tight text-slate-600 dark:text-slate-400">
                            {isUserWinning ? "Discretion adding value." : "Math-sizing is winning."}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-white/60 dark:bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-200 dark:border-slate-800 p-5 relative overflow-hidden group">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-violet-500/10 rounded-xl">
                        <Layers className="text-violet-600 dark:text-violet-400" size={20} />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 uppercase tracking-wider">Shadow Portfolio</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase">Real vs. Math-Sized</p>
                    </div>
                </div>
                <button 
                    onClick={refreshData}
                    className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 transition-colors"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* THE RIVAL: Competition Bar */}
            <div className="mb-6">
                <div className="flex justify-between text-[10px] font-black uppercase mb-2 px-1">
                    <span className={isUserWinning ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}>Discretionary Edge</span>
                    <span className={!isUserWinning ? 'text-violet-600 dark:text-violet-400' : 'text-slate-500'}>Mathematical Edge</span>
                </div>
                <div className="h-6 w-full bg-slate-200/50 dark:bg-slate-800/50 rounded-xl overflow-hidden flex p-1 border border-slate-300/50 dark:border-slate-700/50 relative">
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="h-full w-[1px] bg-slate-400 dark:bg-slate-600" />
                    </div>
                    <motion.div 
                        className="h-full bg-emerald-500/80 rounded-l-lg relative"
                        initial={{ width: '50%' }}
                        animate={{ width: `${Math.max(5, Math.min(95, (50 + (stats?.sizingEfficiency || 0) / 4)))}%` }}
                        transition={{ type: 'spring', stiffness: 50 }}
                    >
                         {isUserWinning && <div className={`absolute right-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_10px_#fff] ${isVisible ? 'animate-pulse' : ''}`} />}
                     </motion.div>
                    <div className="flex-1 bg-violet-500/30 rounded-r-lg" />
                </div>
            </div>

            {/* Comparison Cards */}
            <div className="grid grid-cols-2 gap-4 mb-6 relative">

                {/* VS Badge */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                    <div className="w-8 h-8 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-[10px] font-black text-slate-500">VS</div>
                </div>

                {/* Real Account */}
                <div className={`p-4 rounded-2xl border transition-all ${isUserWinning ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-white/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/50'}`}>
                    <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">Your Real PnL</p>
                    <ValueFlash value={stats?.actualPnL || 0} className="inline-block" epsilon={1}>
                        <div className={`text-lg font-black ${stats?.actualPnL && stats.actualPnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {formatCurrency(stats?.actualPnL || 0)}
                        </div>
                    </ValueFlash>
                    <div className="mt-1 flex items-center gap-1">
                        <Users size={10} className="text-slate-500" />
                        <span className="text-[8px] font-bold text-slate-500 uppercase">Manual Sizing</span>
                    </div>
                </div>

                {/* Shadow Account */}
                <div className={`p-4 rounded-2xl border transition-all ${!isUserWinning ? 'bg-violet-500/5 border-violet-500/20' : 'bg-white/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/50'}`}>
                    <p className="text-[9px] font-bold text-slate-500 uppercase mb-1 text-right">Shadow (1% Risk)</p>
                    <ValueFlash value={stats?.shadowPnL || 0} className="inline-block" epsilon={1}>
                        <div className={`text-lg font-black text-right ${stats?.shadowPnL && stats.shadowPnL >= 0 ? 'text-violet-600 dark:text-violet-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {formatCurrency(stats?.shadowPnL || 0)}
                        </div>
                    </ValueFlash>
                    <div className="mt-1 flex items-center gap-1 justify-end">
                        <span className="text-[8px] font-bold text-slate-500 uppercase">Fixed Risk</span>
                        <ShieldCheck size={10} className="text-violet-500" />
                    </div>
                </div>
            </div>

            {/* Gap Analysis */}
            <div className="flex-1 bg-white/40 dark:bg-slate-800/20 rounded-2xl border border-slate-200 dark:border-slate-700/30 p-5 mb-4">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Performance Gap</span>
                    <span className={`text-sm font-black ${isUserWinning ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {isUserWinning ? '+' : ''}{formatCurrency(stats?.gap || 0)}
                    </span>
                </div>
                
                <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden mb-4">
                    <div 
                        className={`h-full transition-all duration-1000 ${isUserWinning ? 'bg-emerald-500' : 'bg-rose-500'}`} 
                        style={{ width: `${Math.min(100, (Math.abs(stats?.gap || 0) / (Math.abs(stats?.shadowPnL || 1) || 1)) * 100)}%` }}
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <p className="text-[9px] font-bold text-slate-500 uppercase mb-0.5">Sizing Efficiency</p>
                        <p className={`text-sm font-black ${efficiencyColor}`}>{stats?.sizingEfficiency.toFixed(1)}%</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[9px] font-bold text-slate-500 uppercase mb-0.5">Edge Status</p>
                        <p className="text-sm font-black text-slate-800 dark:text-slate-200 uppercase">{isUserWinning ? 'Alpha Found' : 'Math Wins'}</p>
                    </div>
                </div>
            </div>

            {/* Insight */}
            <div className="p-3 bg-white/40 dark:bg-indigo-500/5 rounded-xl border border-slate-200 dark:border-indigo-500/10 flex items-center gap-3">
                <Zap size={14} className="text-amber-500 dark:text-amber-400 shrink-0" />
                <p className="text-[10px] leading-tight text-slate-600 dark:text-slate-400">
                    {isUserWinning 
                        ? "Your discretion is adding value. Your 'Gut Feel' sizing is outperforming the math." 
                        : "The Shadow Account is winning. Switch to 1% fixed risk to instantly increase PnL."}
                </p>
            </div>
        </div>
    );
};

export default ShadowPortfolioWidget;
