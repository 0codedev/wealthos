import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Shield, Clock, RefreshCw, Compass, AlertTriangle, HelpCircle
} from 'lucide-react';
import { usePageVisibility } from '../../../contexts/PageVisibilityContext';
import { portfolioGreeksService, PortfolioGreeks } from '../../../services/PortfolioGreeksService';
import { CountUp } from '../../shared/CountUp';
import { ValueFlash } from '../../shared/ValueFlash';

const PortfolioGreeksWidget: React.FC = () => {
    const [stats, setStats] = useState<PortfolioGreeks | null>(null);
    const [loading, setLoading] = useState(true);
    const isVisible = usePageVisibility();

    const refreshData = async () => {
        setLoading(true);
        const res = await portfolioGreeksService.calculatePortfolioGreeks();
        setStats(res);
        setLoading(false);
    };

    useEffect(() => {
        if (!isVisible) return;
        refreshData();
        const interval = setInterval(refreshData, 5 * 60 * 1000); // Auto-refresh every 5 mins
        return () => clearInterval(interval);
    }, [isVisible]);

    const deltaValue = stats?.totalDelta || 0;
    const deltaColor = deltaValue > 0 ? 'text-emerald-600 dark:text-emerald-400' : deltaValue < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400';
    const isHeavyExposure = Math.abs(deltaValue) > 500; // Delta exposure threshold

    // Gamma risk check (high absolute Gamma means high sensitivity near expiry)
    const gammaValue = stats?.totalGamma || 0;
    const isHighGammaRisk = Math.abs(gammaValue) > 50; 

    // Theta decay check (long options bleed value)
    const thetaValue = stats?.totalTheta || 0;
    const isThetaBleeding = thetaValue < 0;

    // Vega volatility check
    const vegaValue = stats?.totalVega || 0;

    return (
        <div className="h-full flex flex-col bg-white/60 dark:bg-slate-900/50 backdrop-blur-xl border border-slate-200 dark:border-slate-800 p-5 relative overflow-hidden group">
            {/* Background Radar Effect */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border border-indigo-500/5 rounded-full pointer-events-none" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border border-indigo-500/10 rounded-full pointer-events-none" />
            
            {/* Header */}
            <div className="flex items-center justify-between mb-4 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/10 rounded-xl">
                        <Compass className="text-emerald-600 dark:text-emerald-400" size={20} />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 uppercase tracking-wider">Portfolio Greeks</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase">Net Risk Radar</p>
                    </div>
                </div>
                <button 
                    onClick={refreshData}
                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 mb-4 relative z-10">
                {/* Net Delta */}
                <div className="p-3 bg-white/60 dark:bg-slate-800/40 backdrop-blur-sm rounded-xl border border-slate-200 dark:border-slate-700/40 relative group/tooltip">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
                            Delta (Δ)
                            <HelpCircle size={10} className="text-slate-500 cursor-help" />
                        </span>
                        {isHeavyExposure && <AlertTriangle size={10} className="text-amber-550 dark:text-amber-400 animate-pulse" />}
                    </div>
                    <div className={`text-lg font-black ${deltaColor}`}>
                        <ValueFlash value={deltaValue} className="inline-block">
                            <CountUp
                                value={deltaValue}
                                startFromZero
                                decimals={1}
                                format={(n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`}
                            />
                        </ValueFlash>
                    </div>
                    <p className="text-[8px] font-bold text-slate-500 uppercase mt-0.5">Directional Bias</p>
                    
                    {/* Tooltip Content */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-30 text-[9px] text-slate-650 dark:text-slate-400 leading-normal">
                        Your portfolio value changes by approx <span className="font-bold text-slate-900 dark:text-white">₹{Math.abs(deltaValue).toFixed(0)}</span> for every 1-point move in the underlying asset.
                    </div>
                </div>

                {/* Net Gamma */}
                <div className="p-3 bg-white/60 dark:bg-slate-800/40 backdrop-blur-sm rounded-xl border border-slate-200 dark:border-slate-700/40 relative group/tooltip">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
                            Gamma (Γ)
                            <HelpCircle size={10} className="text-slate-500 cursor-help" />
                        </span>
                        {isHighGammaRisk && <AlertTriangle size={10} className="text-rose-500 dark:text-rose-400 animate-pulse" />}
                    </div>
                    <div className="text-lg font-black text-indigo-650 dark:text-indigo-400">
                        <ValueFlash value={gammaValue} className="inline-block">
                            <CountUp value={gammaValue} startFromZero decimals={3} format={(n) => n.toFixed(3)} />
                        </ValueFlash>
                    </div>
                    <p className="text-[8px] font-bold text-slate-505 uppercase mt-0.5">Delta Acceleration</p>

                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-30 text-[9px] text-slate-655 dark:text-slate-400 leading-normal">
                        Represents how fast your Delta changes. High Gamma makes your position highly sensitive to spot moves, especially close to expiry.
                    </div>
                </div>

                {/* Net Theta */}
                <div className="p-3 bg-white/60 dark:bg-slate-800/40 backdrop-blur-sm rounded-xl border border-slate-200 dark:border-slate-700/40 relative group/tooltip">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1 mb-1">
                        Theta (θ)
                        <HelpCircle size={10} className="text-slate-500 cursor-help" />
                    </span>
                    <div className={`text-lg font-black ${isThetaBleeding ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        <ValueFlash value={thetaValue} className="inline-block">
                            <CountUp
                                value={thetaValue}
                                startFromZero
                                decimals={1}
                                format={(n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`}
                            />
                        </ValueFlash>
                    </div>
                    <p className="text-[8px] font-bold text-slate-500 uppercase mt-0.5">Time Decay (Daily)</p>

                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-30 text-[9px] text-slate-655 dark:text-slate-400 leading-normal">
                        The amount your options positions lose in time value per day. Long options bleed Theta, while short options gain it.
                    </div>
                </div>

                {/* Net Vega */}
                <div className="p-3 bg-white/60 dark:bg-slate-800/40 backdrop-blur-sm rounded-xl border border-slate-200 dark:border-slate-700/40 relative group/tooltip">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1 mb-1">
                        Vega (ν)
                        <HelpCircle size={10} className="text-slate-500 cursor-help" />
                    </span>
                    <div className="text-lg font-black text-sky-600 dark:text-sky-400">
                        <ValueFlash value={vegaValue} className="inline-block">
                            <CountUp value={vegaValue} startFromZero decimals={1} format={(n) => n.toFixed(1)} />
                        </ValueFlash>
                    </div>
                    <p className="text-[8px] font-bold text-slate-500 uppercase mt-0.5">Volatility Exposure</p>

                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-30 text-[9px] text-slate-655 dark:text-slate-400 leading-normal">
                        Your portfolio changes by approx <span className="font-bold text-slate-900 dark:text-white">₹{Math.abs(vegaValue).toFixed(0)}</span> for every 1% absolute change in Implied Volatility (IV).
                    </div>
                </div>
            </div>

            {/* Slider Visualizer */}
            <div className="bg-white/40 dark:bg-slate-800/20 backdrop-blur-sm rounded-xl border border-slate-200 dark:border-slate-700/30 p-4 mb-4 relative z-10">
                <div className="flex justify-between text-[9px] font-bold uppercase text-slate-500 mb-2">
                    <span>Bearish</span>
                    <span>Neutral</span>
                    <span>Bullish</span>
                </div>
                <div className="h-1.5 w-full bg-slate-250 dark:bg-slate-800 rounded-full relative overflow-hidden">
                    <div className="absolute left-1/2 top-0 bottom-0 w-1 bg-slate-300 dark:bg-slate-700 -translate-x-1/2" />
                    <motion.div 
                        className={`h-full absolute top-0 ${deltaValue >= 0 ? 'bg-emerald-500 left-1/2' : 'bg-rose-500 right-1/2'}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(50, (Math.abs(deltaValue) / 1000) * 50)}%` }}
                        transition={{ type: 'spring', damping: 15 }}
                    />
                </div>
                <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-slate-500">
                        <Clock size={10} />
                        <span className="text-[8px] font-bold uppercase">Updated {stats?.lastUpdated ? new Date(stats.lastUpdated).toLocaleTimeString() : ''}</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-650 dark:text-indigo-400 text-[8px] font-black uppercase">
                        {stats?.positionCount || 0} Positions
                    </span>
                </div>
            </div>

            {/* Risk Insights Panel */}
            <div className="p-3 bg-white/40 dark:bg-slate-800/20 backdrop-blur-sm rounded-xl border border-slate-200 dark:border-slate-700/30 flex items-start gap-2.5 relative z-10">
                <Shield size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                <div className="text-[10px] leading-relaxed text-slate-655 dark:text-slate-400">
                    {stats?.positionCount === 0 ? (
                        "No active options positions found. Add option contracts to Dhan to begin tracking portfolio Greeks."
                    ) : (
                        <>
                            {isThetaBleeding ? (
                                <span>You are losing <span className="font-bold text-rose-600 dark:text-rose-400">₹{Math.abs(thetaValue).toFixed(0)}</span> per day in time decay. </span>
                            ) : (
                                <span>You are earning <span className="font-bold text-emerald-600 dark:text-emerald-400">₹{thetaValue.toFixed(0)}</span> per day from net positive time decay. </span>
                            )}
                            {isHighGammaRisk && (
                                <span className="text-rose-600 dark:text-rose-400 font-bold block mt-1">
                                    ⚠️ High Gamma Risk! Delta is highly sensitive to price action.
                                </span>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PortfolioGreeksWidget;
