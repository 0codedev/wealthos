import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { motion, AnimatePresence } from 'framer-motion';
import { Ghost, Play, RotateCcw, TrendingUp, Info, Zap, AlertCircle, TrendingDown } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { formatCurrency } from '../../../utils/helpers';

interface GhostPortfolioProps {
    currentNetWorth: number;
    investments: any[];
}

const HISTORICAL_ASSETS = [
    { id: 'BTC', name: 'Bitcoin', cagr: 0.85, volatility: 0.60, color: '#F7931A' },
    { id: 'ETH', name: 'Ethereum', cagr: 0.70, volatility: 0.70, color: '#627EEA' },
    { id: 'NIFTY', name: 'Nifty 50', cagr: 0.12, volatility: 0.15, color: '#22C55E' },
    { id: 'GOLD', name: 'Gold', cagr: 0.09, volatility: 0.12, color: '#EAB308' },
    { id: 'AAPL', name: 'Apple (US Tech)', cagr: 0.25, volatility: 0.25, color: '#000000' },
];

export const GhostPortfolio: React.FC<GhostPortfolioProps> = ({ currentNetWorth, investments }) => {
    const [selectedAsset, setSelectedAsset] = useState(HISTORICAL_ASSETS[0]);
    const [investmentAmount, setInvestmentAmount] = useState(100000); // 1 Lakh default
    const [yearsAgo, setYearsAgo] = useState(3);
    const [isSimulated, setIsSimulated] = useState(false);

    const simulationData = useMemo(() => {
        if (!isSimulated) return [];

        const data = [];
        let ghostValue = investmentAmount;
        let realValue = investmentAmount; // Comparison baseline
        
        // Simple geometric brownian motion simulation for historical "feel"
        const annualReturn = selectedAsset.cagr;
        const volatility = selectedAsset.volatility;
        const baselineReturn = 0.07; // 7% safe return as baseline
        
        const steps = yearsAgo * 12;
        const now = new Date();
        
        for (let i = 0; i <= steps; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() - (steps - i), 1);
            const dateStr = date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
            
            if (i > 0) {
                // Ghost growth with randomness
                const monthReturn = (annualReturn / 12) + (volatility / Math.sqrt(12) * (Math.random() - 0.5) * 2);
                ghostValue = ghostValue * (1 + monthReturn);
                
                // Baseline growth
                realValue = realValue * (1 + (baselineReturn / 12));
            }

            data.push({
                date: dateStr,
                ghost: Math.round(ghostValue),
                baseline: Math.round(realValue),
            });
        }
        return data;
    }, [isSimulated, selectedAsset, investmentAmount, yearsAgo]);

    const finalGhost = simulationData.length > 0 ? simulationData[simulationData.length - 1].ghost : 0;
    const finalBaseline = simulationData.length > 0 ? simulationData[simulationData.length - 1].baseline : 0;
    const multiplier = (finalGhost / investmentAmount).toFixed(1);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm flex flex-col h-full">
            {/* Header */}
            <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                        <Ghost size={20} />
                        <h3 className="text-sm font-black uppercase tracking-wider">Ghost Portfolio</h3>
                    </div>
                    <div className="flex items-center gap-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full text-[10px] font-bold">
                        <Zap size={10} /> WHAT-IF SIMULATOR
                    </div>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Simulate hypothetical investment outcomes based on historical volatility.</p>
            </div>

            {/* Controls */}
            <div className="p-4 sm:p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Select Asset</label>
                        <select 
                            value={selectedAsset.id}
                            onChange={(e) => setSelectedAsset(HISTORICAL_ASSETS.find(a => a.id === e.target.value) || HISTORICAL_ASSETS[0])}
                            className="w-full bg-slate-100 dark:bg-slate-800 border-none rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                        >
                            {HISTORICAL_ASSETS.map(asset => (
                                <option key={asset.id} value={asset.id}>{asset.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Time Horizon</label>
                        <div className="flex gap-2">
                            {[1, 3, 5].map(y => (
                                <button
                                    key={y}
                                    onClick={() => setYearsAgo(y)}
                                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${yearsAgo === y ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}
                                >
                                    {y}Y
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Simulated Amount</label>
                        <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">{formatCurrency(investmentAmount)}</span>
                    </div>
                    <input 
                        type="range"
                        min={10000}
                        max={1000000}
                        step={10000}
                        value={investmentAmount}
                        onChange={(e) => setInvestmentAmount(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                </div>

                <button
                    onClick={() => setIsSimulated(true)}
                    className="w-full py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-black text-sm flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all shadow-xl shadow-slate-900/10 dark:shadow-white/5"
                >
                    <Play size={16} fill="currentColor" /> RUN SIMULATION
                </button>
            </div>

            {/* Results Area */}
            <AnimatePresence>
                {isSimulated && (
                    <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="flex-1 border-t border-slate-100 dark:border-slate-800 flex flex-col"
                    >
                        {/* Chart */}
                        <div className="h-48 w-full p-4">
                            <SafeChartContainer>
                                <AreaChart data={simulationData}>
                                    <defs>
                                        <linearGradient id="colorGhost" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={selectedAsset.color} stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor={selectedAsset.color} stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.3} />
                                    <XAxis 
                                        dataKey="date" 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                                        interval={Math.floor(simulationData.length / 4)}
                                    />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '12px', fontSize: '10px' }}
                                        itemStyle={{ color: '#fff' }}
                                        formatter={(value) => {
                                            const numericValue = typeof value === 'number' ? value : Number(value) || 0;
                                            return [formatCurrency(numericValue), ''];
                                        }}
                                    />
                                    <Area 
                                        type="monotone" 
                                        dataKey="ghost" 
                                        stroke={selectedAsset.color} 
                                        strokeWidth={3}
                                        fillOpacity={1} 
                                        fill="url(#colorGhost)" 
                                        animationDuration={1500}
                                    />
                                    <Area 
                                        type="monotone" 
                                        dataKey="baseline" 
                                        stroke="#94a3b8" 
                                        strokeWidth={1}
                                        strokeDasharray="4 4"
                                        fill="transparent" 
                                        animationDuration={1500}
                                    />
                                </AreaChart>
                            </SafeChartContainer>
                        </div>

                        {/* Summary Stats */}
                        <div className="p-4 sm:p-6 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between mt-auto">
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase">Outcome</p>
                                <div className="flex items-baseline gap-2">
                                    <h4 className="text-2xl font-black text-slate-900 dark:text-white">{formatCurrency(finalGhost)}</h4>
                                    <span className="text-xs font-bold text-emerald-500 flex items-center gap-0.5">
                                        <TrendingUp size={10} /> {multiplier}x
                                    </span>
                                </div>
                                <p className="text-[10px] text-slate-500 mt-1">vs {formatCurrency(finalBaseline)} (Safe Baseline)</p>
                            </div>
                            <button
                                onClick={() => { setIsSimulated(false); }}
                                className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-rose-500 transition-colors"
                            >
                                <RotateCcw size={16} />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Hint */}
            {!isSimulated && (
                <div className="p-4 flex items-center gap-3 bg-indigo-50 dark:bg-indigo-900/20 m-4 rounded-2xl border border-indigo-100 dark:border-indigo-800/30">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400 flex-shrink-0">
                        <Info size={16} />
                    </div>
                    <p className="text-[10px] leading-normal text-indigo-700 dark:text-indigo-300 font-medium">
                        "What-if" simulations help visualize the cost of inaction. Compare historical volatility benchmarks against safe-haven baselines.
                    </p>
                </div>
            )}
        </div>
    );
};
