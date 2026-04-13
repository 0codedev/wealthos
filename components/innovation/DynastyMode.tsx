import React, { useMemo, useState } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { Crown, Users, Baby, Infinity, Calculator, Minus, Plus } from 'lucide-react';
import { usePortfolio } from '../../hooks/usePortfolio';
import { runMonteCarlo } from '../../utils/MonteCarlo';
import { formatCurrency } from '../../utils/helpers';

export const DynastyMode: React.FC = () => {
    const { stats } = usePortfolio();

    // Inheritance calculator state
    const [heirCount, setHeirCount] = useState(2);
    const ESTATE_TAX_RATE = 0.10; // Hypothetical 10% estate tax

    // Assumptions
    const currentPrincipal = stats?.totalCurrent || 0;
    const monthlyContribution = 25000;
    const simulationYears = 100;
    const inflationRate = 0.05;

    const data = useMemo(() => {
        if (currentPrincipal === 0) return [];

        const sim = runMonteCarlo(
            currentPrincipal,
            monthlyContribution,
            simulationYears,
            currentPrincipal * 100 // Target irrelevant for this viz
        );

        return sim.yearlyPaths.map(p => ({
            year: `Year ${p.year}`,
            wealth: p.p50,
            inflationAdjusted: p.p50 / Math.pow(1 + inflationRate, p.year),
            yearNum: p.year
        }));
    }, [currentPrincipal, monthlyContribution]);

    const finalAmount = data[data.length - 1]?.wealth || 0;
    const finalRealAmount = data[data.length - 1]?.inflationAdjusted || 0;
    const multiplier = currentPrincipal > 0 ? (finalAmount / currentPrincipal).toFixed(0) : '0';

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto">
            <div className="mb-8 relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-900 via-violet-900 to-slate-900 p-8 text-white shadow-2xl">
                <div className="absolute top-0 right-0 p-12 opacity-10">
                    <Crown size={200} />
                </div>
                <div className="relative z-10">
                    <h1 className="text-4xl font-bold flex items-center gap-3 mb-2 font-serif">
                        <Crown className="text-yellow-400" />
                        Dynasty Mode
                    </h1>
                    <p className="text-indigo-200 text-lg max-w-2xl">
                        "Someone's sitting in the shade today because someone planted a tree a long time ago." — Warren Buffett
                    </p>

                    <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-8">
                        <div>
                            <p className="text-indigo-300 text-sm uppercase tracking-wide">Projected Legacy (2125)</p>
                            <p className="text-4xl font-bold text-white mt-1 font-mono">{formatCurrency(finalAmount)}</p>
                            <p className="text-sm text-indigo-400 mt-1">Nominal Value</p>
                        </div>
                        <div>
                            <p className="text-indigo-300 text-sm uppercase tracking-wide">In Today's Money</p>
                            <p className="text-4xl font-bold text-emerald-400 mt-1 font-mono">{formatCurrency(finalRealAmount)}</p>
                            <p className="text-sm text-indigo-400 mt-1">Real Purchasing Power</p>
                        </div>
                        <div>
                            <p className="text-indigo-300 text-sm uppercase tracking-wide">Wealth Multiplier</p>
                            <p className="text-4xl font-bold text-yellow-400 mt-1">{multiplier}x</p>
                            <p className="text-sm text-indigo-400 mt-1">Growth Factor</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Timeline Chart */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-xl border border-slate-200 dark:border-slate-800 flex-1 min-h-[400px]">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-slate-800 dark:text-white">The 100-Year View</h2>
                    <div className="flex gap-4 text-sm text-slate-500">
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 bg-indigo-500 rounded-full"></span> Generation 1
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 bg-violet-500 rounded-full"></span> Generation 2
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 bg-fuchsia-500 rounded-full"></span> Generation 3
                        </div>
                    </div>
                </div>

                <SafeChartContainer>
                    <AreaChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                        <defs>
                            <linearGradient id="colorWealth" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="30%" stopColor="#6366f1" stopOpacity={0.3} /> {/* Gen 1 */}
                                <stop offset="60%" stopColor="#8b5cf6" stopOpacity={0.3} /> {/* Gen 2 */}
                                <stop offset="100%" stopColor="#d946ef" stopOpacity={0.3} /> {/* Gen 3 */}
                            </linearGradient>
                            <linearGradient id="strokeWealth" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="30%" stopColor="#6366f1" />
                                <stop offset="60%" stopColor="#8b5cf6" />
                                <stop offset="100%" stopColor="#d946ef" />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis
                            dataKey="year"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
                            ticks={['Year 0', 'Year 25', 'Year 50', 'Year 75', 'Year 100']}
                        />
                        <YAxis
                            stroke="#94a3b8"
                            tickFormatter={(val) => `₹${(val / 10000000).toFixed(0)}Cr`}
                            domain={['auto', 'auto']}
                        />
                        <Tooltip
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                            formatter={((val: number | undefined) => val ? [formatCurrency(val), 'Wealth'] : ['', '']) as any}
                            labelFormatter={(label) => label}
                        />
                        <Area
                            type="monotone"
                            dataKey="wealth"
                            stroke="url(#strokeWealth)"
                            strokeWidth={3}
                            fill="url(#colorWealth)"
                        />

                        <ReferenceLine x="Year 30" stroke="#94a3b8" strokeDasharray="3 3">
                            <text x="30%" y={10} fill="#64748b" fontSize={12} textAnchor="middle">Next Gen</text>
                        </ReferenceLine>
                        <ReferenceLine x="Year 60" stroke="#94a3b8" strokeDasharray="3 3">
                            <text x="60%" y={10} fill="#64748b" fontSize={12} textAnchor="middle">Grandkids</text>
                        </ReferenceLine>

                    </AreaChart>
                </SafeChartContainer>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
                <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl flex items-center gap-4">
                    <div className="p-3 bg-white dark:bg-indigo-900 rounded-lg text-indigo-600">
                        <Users size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-bold text-indigo-900 dark:text-indigo-200">The Torch Pass</p>
                        <p className="text-xs text-indigo-700 dark:text-indigo-300">Year 30 - 40</p>
                    </div>
                </div>
                <div className="bg-violet-50 dark:bg-violet-900/20 p-4 rounded-xl flex items-center gap-4">
                    <div className="p-3 bg-white dark:bg-violet-900 rounded-lg text-violet-600">
                        <Baby size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-bold text-violet-900 dark:text-violet-200">New Blood</p>
                        <p className="text-xs text-violet-700 dark:text-violet-300">Year 60 (Grandkids)</p>
                    </div>
                </div>
                <div className="bg-fuchsia-50 dark:bg-fuchsia-900/20 p-4 rounded-xl flex items-center gap-4">
                    <div className="p-3 bg-white dark:bg-fuchsia-900 rounded-lg text-fuchsia-600">
                        <Infinity size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-bold text-fuchsia-900 dark:text-fuchsia-200">True Dynasty</p>
                        <p className="text-xs text-fuchsia-700 dark:text-fuchsia-300">Year 100+</p>
                    </div>
                </div>
            </div>

            {/* Inheritance Calculator */}
            <div className="mt-6 bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-xl border border-slate-200 dark:border-slate-800">
                <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-3 mb-4">
                    <Calculator className="text-amber-500" size={24} />
                    Inheritance Calculator
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    {/* Heir Count Selector */}
                    <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl">
                        <p className="text-sm text-slate-500 mb-2">Number of Heirs</p>
                        <div className="flex items-center justify-center gap-4">
                            <button
                                onClick={() => setHeirCount(Math.max(1, heirCount - 1))}
                                className="p-2 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                            >
                                <Minus size={16} />
                            </button>
                            <span className="text-3xl font-bold text-slate-800 dark:text-white">{heirCount}</span>
                            <button
                                onClick={() => setHeirCount(Math.min(10, heirCount + 1))}
                                className="p-2 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                            >
                                <Plus size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Estate Value */}
                    <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl">
                        <p className="text-sm text-indigo-600 dark:text-indigo-400">Total Estate (Year 100)</p>
                        <p className="text-2xl font-bold text-indigo-900 dark:text-indigo-200 mt-1">{formatCurrency(finalAmount)}</p>
                    </div>

                    {/* Estimated Tax */}
                    <div className="bg-rose-50 dark:bg-rose-900/20 p-4 rounded-xl">
                        <p className="text-sm text-rose-600 dark:text-rose-400">Estate Tax (~{ESTATE_TAX_RATE * 100}%)</p>
                        <p className="text-2xl font-bold text-rose-900 dark:text-rose-200 mt-1">-{formatCurrency(finalAmount * ESTATE_TAX_RATE)}</p>
                    </div>

                    {/* Per Heir Share */}
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-xl">
                        <p className="text-sm text-emerald-600 dark:text-emerald-400">Each Heir Receives</p>
                        <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-200 mt-1">
                            {formatCurrency((finalAmount * (1 - ESTATE_TAX_RATE)) / heirCount)}
                        </p>
                    </div>
                </div>
                <p className="text-xs text-slate-400 mt-4 text-center">* Estate tax is hypothetical. India currently has no inheritance tax but this may change.</p>
            </div>
        </div>
    );
};

// Wrap with React.memo to prevent unnecessary re-renders
export default React.memo(DynastyMode);
