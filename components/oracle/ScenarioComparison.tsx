import React, { useState, useEffect, useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { 
    Ghost, 
    ArrowRight, 
    TrendingUp, 
    AlertCircle,
    Calendar
} from 'lucide-react';
import { 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    AreaChart,
    Area
} from 'recharts';
import { usePortfolioStore } from '../../store/portfolioStore';
import { db } from '../../database';
import { runMonteCarlo } from '../../utils/MonteCarlo';
import { CHART_COLORS, CHART_DEFAULTS } from '../../utils/chartTheme';

const GHOST_STRATEGIES = [
    { id: 'nifty', name: 'Nifty 50 Benchmark', icon: TrendingUp, desc: 'What if you just bought the index?' },
    { id: 'early-sip', name: '2 Years Early Start', icon: Calendar, desc: 'Impact of time on compounding.' },
    { id: 'clean-sheet', name: 'Avoided 3 Worst Trades', icon: Ghost, desc: 'Reality vs Process Perfection.' }
];

export const ScenarioComparison: React.FC = () => {
    const investments = usePortfolioStore(s => s.investments);
    const [selectedGhost, setSelectedGhost] = useState(GHOST_STRATEGIES[0]);
    const [stats, setStats] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);

    const calculateComparison = async () => {
        setIsLoading(true);
        const totalPrincipal = investments.reduce((sum, inv) => sum + (inv.currentValue || 0), 0);
        const monthlySIP = 50000;
        
        const reality = runMonteCarlo(totalPrincipal, monthlySIP, 10, 50000000, 0.12, 0.18);
        let ghost;

        if (selectedGhost.id === 'nifty') {
            ghost = runMonteCarlo(totalPrincipal, monthlySIP, 10, 50000000, 0.14, 0.12);
        } else if (selectedGhost.id === 'early-sip') {
            const earlyStartPrincipal = totalPrincipal * Math.pow(1.12, 2) + (monthlySIP * 12 * 2 * 1.06); 
            ghost = runMonteCarlo(earlyStartPrincipal, monthlySIP, 10, 50000000, 0.12, 0.18);
        } else {
            const trades = await db.trades.toArray();
            const worstTrades = [...trades].sort((a, b) => (a.pnl || 0) - (b.pnl || 0)).slice(0, 3);
            const lostCapital = Math.abs(worstTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));
            ghost = runMonteCarlo(totalPrincipal + lostCapital, monthlySIP, 10, 50000000, 0.12, 0.18);
            (ghost as any).lostCapital = lostCapital;
        }

        setStats({
            reality: reality.yearlyPaths,
            ghost: ghost.yearlyPaths,
            finalReality: reality.percentiles.p50,
            finalGhost: ghost.percentiles.p50,
            diff: ghost.percentiles.p50 - reality.percentiles.p50,
            lostCapital: (ghost as any).lostCapital
        });
        setIsLoading(false);
    };

    useEffect(() => {
        calculateComparison();
    }, [selectedGhost, investments]);

    const chartData = useMemo(() => {
        if (!stats) return [];
        return stats.reality.map((r: any, i: number) => ({
            year: r.year,
            reality: Math.round(r.p50 / 100000 * 100) / 100, // Lakhs
            ghost: Math.round(stats.ghost[i].p50 / 100000 * 100) / 100
        }));
    }, [stats]);

    return (
        <div className="p-4 md:p-6 space-y-6 bg-slate-50 dark:bg-slate-950 min-h-full text-slate-900 dark:text-slate-100">
            {/* Unified Header */}
            <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900 dark:text-slate-50 flex items-center gap-2">
                        <Ghost className="w-7 h-7 text-indigo-500" />
                        Ghost Portfolio
                        <span className="ml-2 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-indigo-100 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 tracking-widest">
                            Simulation
                        </span>
                    </h1>
                    <p className="text-sm text-slate-550 dark:text-slate-400 mt-1 max-w-2xl">
                        Compare your reality with alternative timelines. See what happens if you avoided emotional errors or regularized your compounding.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-4 space-y-4">
                    <h2 className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest px-2">Alternative Timelines</h2>
                    {GHOST_STRATEGIES.map(g => (
                        <button
                            key={g.id}
                            onClick={() => setSelectedGhost(g)}
                            className={`w-full p-4 rounded-xl border transition-all text-left group ${
                                selectedGhost.id === g.id 
                                ? 'bg-indigo-500/5 dark:bg-indigo-500/10 border-indigo-500/35 text-indigo-950 dark:text-indigo-300' 
                                : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                        >
                            <div className="flex items-center gap-4">
                                <div className={`p-2 rounded-xl ${selectedGhost.id === g.id ? 'bg-indigo-500/25 text-indigo-650 dark:text-indigo-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
                                    <g.icon className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className={`font-bold text-sm ${selectedGhost.id === g.id ? 'text-indigo-850 dark:text-indigo-350' : 'text-slate-700 dark:text-slate-300'}`}>{g.name}</h3>
                                    <p className="text-[10px] text-slate-450 dark:text-slate-500 mt-1">{g.desc}</p>
                                </div>
                            </div>
                        </button>
                    ))}

                    <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl mt-6 shadow-sm">
                        <h2 className="text-[10px] font-black text-slate-500 dark:text-slate-450 uppercase tracking-widest mb-4">Timeline Divergence</h2>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center text-sm font-bold">
                                <span className="text-slate-455 dark:text-slate-400">Wealth Gap</span>
                                <span className="text-emerald-500 font-mono font-bold">+₹{(stats?.diff / 100000 || 0).toFixed(1)}L</span>
                            </div>
                            <div className="flex justify-between items-center text-sm font-bold">
                                <span className="text-slate-455 dark:text-slate-400">Growth Multiplier</span>
                                <span className="text-indigo-600 dark:text-indigo-400 font-mono font-bold">{(stats?.finalGhost / stats?.finalReality || 0).toFixed(2)}x</span>
                            </div>
                            {selectedGhost.id === 'clean-sheet' && stats?.lostCapital > 0 && (
                                <div className="p-3 bg-red-500/5 dark:bg-red-500/10 border border-red-500/15 rounded-xl mt-4">
                                    <div className="flex gap-2 items-start text-[10px] font-bold text-red-500 dark:text-red-400">
                                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                        <span>₹{(stats.lostCapital / 1000).toFixed(0)}K lost to emotional errors in 3 trades.</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 min-h-[500px] relative shadow-sm flex flex-col justify-between">
                    <div className="flex justify-between items-center mb-8 relative z-10">
                        <div className="flex gap-6 items-center">
                            <div>
                                <span className="block text-[10px] text-slate-500 uppercase font-black mb-1">Reality Path</span>
                                <span className="text-2xl font-black tracking-tighter text-slate-800 dark:text-slate-100">₹{(stats?.finalReality / 10000000 || 0).toFixed(2)} Cr</span>
                            </div>
                            <ArrowRight className="w-5 h-5 text-slate-300 dark:text-slate-650" />
                            <div>
                                <span className="block text-[10px] text-indigo-550 dark:text-indigo-400 uppercase font-black mb-1">Ghost Timeline</span>
                                <span className="text-2xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-indigo-550 to-emerald-500 dark:from-indigo-400 dark:to-emerald-400">
                                    ₹{(stats?.finalGhost / 10000000 || 0).toFixed(2)} Cr
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="h-[380px] w-full flex-grow">
                        <SafeChartContainer>
                            <AreaChart data={chartData}>
                                <defs>
                                    <linearGradient id="realityGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={CHART_COLORS.neutral} stopOpacity={0.15}/>
                                        <stop offset="95%" stopColor={CHART_COLORS.neutral} stopOpacity={0}/>
                                    </linearGradient>
                                    <linearGradient id="ghostGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.1}/>
                                        <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid {...CHART_DEFAULTS.grid} />
                                <XAxis 
                                    dataKey="year" 
                                    {...CHART_DEFAULTS.axis}
                                    tickFormatter={v => `Yr ${v}`}
                                />
                                <YAxis 
                                    {...CHART_DEFAULTS.axis}
                                    tickFormatter={v => `₹${v}L`}
                                />
                                <Tooltip 
                                    {...CHART_DEFAULTS.tooltip}
                                    labelFormatter={v => `Year ${v}`}
                                    formatter={(value: any, name: any) => [
                                        `₹${Number(value).toFixed(2)} Lakhs`,
                                        name === 'reality' ? 'Reality Path' : `${selectedGhost.name} Path`
                                    ]}
                                />
                                <Area 
                                    type="monotone" 
                                    dataKey="reality" 
                                    stroke={CHART_COLORS.neutral} 
                                    strokeWidth={2}
                                    fill="url(#realityGrad)" 
                                />
                                <Area 
                                    type="monotone" 
                                    dataKey="ghost" 
                                    stroke={CHART_COLORS.primary} 
                                    strokeWidth={3}
                                    strokeDasharray="5 5"
                                    fill="url(#ghostGrad)" 
                                />
                            </AreaChart>
                        </SafeChartContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ScenarioComparison;
