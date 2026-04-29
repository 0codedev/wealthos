import React, { useState, useMemo, useEffect } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import {
    TrendingUp, Calendar, Target, AlertTriangle,
    RefreshCw, Info, DollarSign, Calculator, Play,
    ChevronRight, Shield, Loader2
} from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, AreaChart, Area, ReferenceLine
} from 'recharts';
import { Investment } from '../../types';
import { useMonteCarloWorker } from '../../hooks/useMonteCarloWorker';
import TabHero from '../shared/TabHero';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useShallow } from 'zustand/react/shallow';
import { formatCurrency } from '../../utils/helpers';

interface RetirementPlannerProps {}

interface RetirementResult {
    simulations: { year: number; corpus: number }[][];
    successRate: number;
}

const RetirementPlanner: React.FC<RetirementPlannerProps> = () => {
    const investments = usePortfolioStore(useShallow(s => s.investments));
    const stats = usePortfolioStore(useShallow(s => s.stats));
    const currentCorpus = stats?.totalCurrent || 0;

    // --- State ---
    const [currentAge, setCurrentAge] = useState(30);
    const [retirementAge, setRetirementAge] = useState(60);
    const [monthlyExpenses, setMonthlyExpenses] = useState(50000);
    const [expectedReturn, setExpectedReturn] = useState(12); // Equity return
    const [inflation, setInflation] = useState(6);
    const [volatility, setVolatility] = useState(15); // Std Dev
    const [monthlyContribution, setMonthlyContribution] = useState(25000);
    const { data: mcResult, isLoading: isSimulating, progress, run: runWorker } =
        useMonteCarloWorker<RetirementResult>('RETIREMENT');

    const simulations = mcResult?.simulations || [];
    const successRate = mcResult?.successRate || 0;

    // --- Calculations ---
    const yearsToRetirement = retirementAge - currentAge;
    const expenseAtRetirement = monthlyExpenses * Math.pow(1 + inflation / 100, yearsToRetirement);
    const requiredCorpus = (expenseAtRetirement * 12) / ((expectedReturn - inflation) / 100); // Simple Perpetuity
    // A safer withdrawal rate rule (4%)
    const safeCorpus = (expenseAtRetirement * 12) * 25;

    // --- Monte Carlo Engine (Web Worker) ---
    const runMonteCarlo = () => {
        runWorker({
            currentAge,
            retirementAge,
            currentCorpus,
            monthlyContribution,
            monthlyExpenses,
            expectedReturn,
            inflation,
            volatility,
            numSimulations: 500,
            forecastYears: 40
        });
    };

    return (
        <div className="space-y-5 pb-20 animate-in fade-in duration-500">
            <TabHero
                eyebrow="Life Planner"
                title="Retirement & FIRE"
                description="Monte Carlo retirement planning, corpus modeling, and financial independence readiness in one forecasting console."
                icon={Target}
                iconTone="text-emerald-500"
                gradientClassName="from-emerald-50 via-white to-amber-50 dark:from-emerald-950/20 dark:via-slate-950 dark:to-amber-950/20"
                chips={['Retirement model', 'FIRE planning', 'Scenario analysis']}
                actions={
                    <div className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-emerald-200 bg-white/85 px-3 py-1.5 font-mono text-[11px] font-bold text-emerald-700 dark:border-emerald-800 dark:bg-slate-900/80 dark:text-emerald-300">
                        <Shield size={12} />
                        Current Net Worth: {formatCurrency(currentCorpus)}
                    </div>
                }
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                {/* 1. INPUT CONSOLE */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2 mb-4">
                        <Calculator size={16} className="text-indigo-600 dark:text-indigo-500" /> Parameters
                    </h3>

                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-[0.14em]">Current Age</label>
                                <input
                                    type="number" value={currentAge} onChange={e => setCurrentAge(Number(e.target.value))}
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-center text-sm text-slate-900 dark:text-white mt-1 p-2 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-[0.14em]">Retire Age</label>
                                <input
                                    type="number" value={retirementAge} onChange={e => setRetirementAge(Number(e.target.value))}
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-center text-sm text-slate-900 dark:text-white mt-1 p-2 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-[0.14em]">Monthly Expenses</label>
                            <input
                                type="range" min="20000" max="500000" step="5000" value={monthlyExpenses} onChange={e => setMonthlyExpenses(Number(e.target.value))}
                                className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer mt-2 accent-indigo-600"
                            />
                            <div className="flex justify-between text-[11px] mt-1 font-bold text-slate-600 dark:text-slate-300">
                                <span>{formatCurrency(monthlyExpenses)} /mo</span>
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-[0.14em]">Monthly Investment</label>
                            <input
                                type="range" min="0" max="500000" step="5000" value={monthlyContribution} onChange={e => setMonthlyContribution(Number(e.target.value))}
                                className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer mt-2 accent-emerald-600"
                            />
                            <div className="flex justify-between text-[11px] mt-1 font-bold text-slate-600 dark:text-slate-300">
                                <span>{formatCurrency(monthlyContribution)} /mo</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-[0.14em]">Return %</label>
                                <input
                                    type="number" value={expectedReturn} onChange={e => setExpectedReturn(Number(e.target.value))}
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-900 dark:text-white mt-1 p-2 text-center text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-[0.14em]">Inflation %</label>
                                <input
                                    type="number" value={inflation} onChange={e => setInflation(Number(e.target.value))}
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-900 dark:text-white mt-1 p-2 text-center text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                />
                            </div>
                        </div>

                        <button
                            onClick={runMonteCarlo}
                            disabled={isSimulating}
                            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white rounded-xl text-[11px] font-bold uppercase tracking-[0.14em] flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-500/30"
                        >
                            {isSimulating ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                            Run Simulation
                        </button>
                    </div>
                </div>

                {/* 2. STATS & FIRE GOALS */}
                <div className="lg:col-span-2 flex flex-col gap-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                            <h4 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-[0.14em] mb-1">Required Corpus</h4>
                            <p className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                                {formatCurrency(safeCorpus)}
                            </p>
                            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">To sustain {formatCurrency(expenseAtRetirement)}/mo expenses @ {retirementAge}</p>
                        </div>

                        <div className={`rounded-2xl p-5 shadow-lg text-white ${successRate > 90 ? 'bg-emerald-600' : successRate > 75 ? 'bg-amber-500' : 'bg-rose-600'}`}>
                            <h4 className="text-[10px] font-bold text-white/80 uppercase tracking-[0.14em] mb-1">Success Probability</h4>
                            <p className="text-3xl font-black font-mono">
                                {successRate.toFixed(1)}%
                            </p>
                            <p className="text-[11px] text-white/80 mt-1">From 500 Monte Carlo iterations</p>
                        </div>
                        </div>

                        {/* CHART */}
                        <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm min-h-[360px]">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-6 uppercase tracking-wider">Monte Carlo Wealth Projections</h3>
                        <div className="h-[320px] w-full">
                            {simulations.length > 0 ? (
                                <SafeChartContainer>
                                    <LineChart>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.1} />
                                        <XAxis dataKey="year" type="number" domain={['dataMin', 'dataMax']} />
                                        <YAxis tickFormatter={(val) => `${(val / 10000000).toFixed(0)}Cr`} />
                                        <Tooltip
                                            formatter={((val: number | undefined) => val ? formatCurrency(val) : '') as any}
                                            labelFormatter={(label) => `Age: ${label}`}
                                        />
                                        {simulations.map((s, i) => (
                                            <Line
                                                key={i}
                                                data={s}
                                                type="monotone"
                                                dataKey="corpus"
                                                stroke={i === 0 ? "#10b981" : "#6366f1"}
                                                strokeWidth={i === 0 ? 3 : 1}
                                                opacity={i === 0 ? 1 : 0.05}
                                                dot={false}
                                            />
                                        ))}
                                        <ReferenceLine x={retirementAge} stroke="orange" strokeDasharray="3 3" label="RETIRE" />
                                    </LineChart>
                                </SafeChartContainer>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                    <TrendingUp size={48} className="mb-4 opacity-20" />
                                    <p>Run simulation to view projections</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RetirementPlanner;
