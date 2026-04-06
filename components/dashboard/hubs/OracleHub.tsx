import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import {
    Sparkles, Target, ShieldAlert, Zap, TrendingUp, TrendingDown,
    AlertTriangle, Info, Layers, BarChart3, RefreshCw, ChevronDown,
    Skull, ArrowRight, Clock, DollarSign, Percent
} from 'lucide-react';
import { formatCurrency } from '../../../utils/helpers';
import {
    runMonteCarlo, PRESET_SCENARIOS, BLACK_SWAN_EVENTS,
    Scenario, BlackSwanEvent, YearlyPath
} from '../../../utils/MonteCarlo';
import {
    AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ComposedChart, Line
} from 'recharts';
import { useSettingsStore } from '../../../store/settingsStore';

interface OracleHubProps {
    totalPortfolioValue: number;
    monthlyInvestment?: number;
}

// ===================== CONFIDENCE BAND CHART =====================
const ConfidenceBandChart: React.FC<{ paths: YearlyPath[]; targetWealth: number; isDarkMode: boolean }> = ({ paths, targetWealth, isDarkMode }) => {
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload) return null;
        const data = payload[0]?.payload;
        return (
            <div className="bg-white dark:bg-slate-900 border border-indigo-250 dark:border-indigo-500/30 rounded-xl p-3 shadow-xl">
                <p className="text-xs font-bold text-indigo-600 dark:text-indigo-300 mb-2">Year {label}</p>
                <div className="space-y-1 text-[10px]">
                    <div className="flex justify-between gap-4">
                        <span className="text-emerald-600 dark:text-emerald-400">P95 (Best):</span>
                        <span className="font-mono text-slate-900 dark:text-white">{formatCurrency(data?.p95 || 0)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-indigo-650 dark:text-indigo-300">P50 (Median):</span>
                        <span className="font-mono text-slate-900 dark:text-white">{formatCurrency(data?.p50 || 0)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-rose-600 dark:text-rose-400">P5 (Worst):</span>
                        <span className="font-mono text-slate-900 dark:text-white">{formatCurrency(data?.p5 || 0)}</span>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="h-48 w-full">
            <SafeChartContainer>
                <AreaChart data={paths} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                        <linearGradient id="p95Gradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
                        </linearGradient>
                        <linearGradient id="p75Gradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0.05} />
                        </linearGradient>
                        <linearGradient id="p25Gradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.05} />
                        </linearGradient>
                    </defs>
                    <XAxis dataKey="year" tick={{ fill: isDarkMode ? '#64748b' : '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis
                        tickFormatter={(val) => `₹${(val / 100000).toFixed(0)}L`}
                        tick={{ fill: isDarkMode ? '#64748b' : '#475569', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={50}
                    />
                    <Tooltip content={<CustomTooltip />} />

                    {/* Confidence Bands */}
                    <Area type="monotone" dataKey="p95" stackId="1" stroke="none" fill="url(#p95Gradient)" />
                    <Area type="monotone" dataKey="p75" stackId="2" stroke="none" fill="url(#p75Gradient)" />
                    <Area type="monotone" dataKey="p25" stackId="3" stroke="none" fill="url(#p25Gradient)" />

                    {/* Median Line */}
                    <Line type="monotone" dataKey="p50" stroke="#818cf8" strokeWidth={2} dot={false} />

                    {/* Target Line */}
                    <ReferenceLine y={targetWealth} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={2} />
                </AreaChart>
            </SafeChartContainer>
        </div>
    );
};

// ===================== SCENARIO COMPARISON =====================
const ScenarioCard: React.FC<{
    scenario: Scenario;
    result: any;
    isActive: boolean;
    onClick: () => void;
}> = ({ scenario, result, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`p-3 rounded-xl border text-left transition-all w-full ${isActive
            ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/50 shadow-lg shadow-indigo-500/20'
            : 'border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-950/30 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
    >
        <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-900 dark:text-white">{scenario.name}</span>
            <span className={`text-lg font-black font-mono ${result.successProbability > 70 ? 'text-emerald-600 dark:text-emerald-400' :
                result.successProbability > 40 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
                }`}>
                {result.successProbability.toFixed(0)}%
            </span>
        </div>
        <p className="text-[10px] text-slate-500 dark:text-slate-400">{scenario.description}</p>
        <div className="mt-2 flex gap-2 text-[10px]">
            <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-600 dark:text-slate-400">
                {(scenario.expectedReturn * 100).toFixed(0)}% return
            </span>
            <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-600 dark:text-slate-400">
                {(scenario.volatility * 100).toFixed(0)}% vol
            </span>
        </div>
    </button>
);
// ===================== BLACK SWAN STRESS TESTER =====================
const BlackSwanTester: React.FC<{
    portfolioValue: number;
    monthlyContribution: number
}> = ({ portfolioValue, monthlyContribution }) => {
    const [selectedEvent, setSelectedEvent] = useState<BlackSwanEvent>(BLACK_SWAN_EVENTS[0]);
    const [showDetails, setShowDetails] = useState(false);

    const crashedValue = portfolioValue * (1 + selectedEvent.impact);
    const lossAmount = portfolioValue - crashedValue;
    const recoveryContributions = monthlyContribution * selectedEvent.recoveryYears * 12;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
                {BLACK_SWAN_EVENTS.map(event => (
                    <button
                        key={event.name}
                        onClick={() => setSelectedEvent(event)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${selectedEvent.name === event.name
                            ? 'bg-rose-600 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                            }`}
                    >
                        {event.name.split(' ').slice(0, 2).join(' ')}
                    </button>
                ))}
            </div>

            <div className="bg-gradient-to-br from-rose-50/30 to-slate-50 dark:from-rose-950/30 dark:to-slate-950 rounded-2xl p-5 border border-rose-200 dark:border-rose-500/30">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Skull className="text-rose-600 dark:text-rose-500" size={20} />
                        <div>
                            <p className="text-sm font-bold text-slate-900 dark:text-white">{selectedEvent.name}</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">Historical market crash simulation</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-2xl font-black font-mono text-rose-600 dark:text-rose-500">{(selectedEvent.impact * 100).toFixed(0)}%</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-450">Market Drop</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl p-3 border border-slate-200 dark:border-slate-800">
                        <p className="text-[10px] text-slate-500 dark:text-slate-450 uppercase font-bold mb-1">Portfolio After Crash</p>
                        <p className="text-lg font-mono font-bold text-slate-900 dark:text-white">{formatCurrency(crashedValue)}</p>
                        <p className="text-[10px] text-rose-600 dark:text-rose-400">-{formatCurrency(lossAmount)} wiped</p>
                    </div>
                    <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl p-3 border border-slate-200 dark:border-slate-800">
                        <p className="text-[10px] text-slate-500 dark:text-slate-450 uppercase font-bold mb-1">Recovery Timeline</p>
                        <p className="text-lg font-mono font-bold text-amber-600 dark:text-amber-400">{selectedEvent.recoveryYears} years</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-450">Historical avg</p>
                    </div>
                </div>

                <div className="bg-white/40 dark:bg-slate-900/30 rounded-xl p-3 border border-slate-200 dark:border-slate-800/50">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-650 dark:text-slate-400">SIP contributions during recovery:</span>
                        <span className="text-sm font-mono font-bold text-emerald-600 dark:text-emerald-400">+{formatCurrency(recoveryContributions)}</span>
                    </div>
                    <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-450 flex items-center gap-1">
                        <Info size={10} />
                        <span>Continuing SIPs during crashes historically leads to better long-term returns</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ===================== WHAT-IF SLIDERS =====================
const WhatIfSliders: React.FC<{
    monthlyContribution: number;
    years: number;
    onMonthlyChange: (val: number) => void;
    onYearsChange: (val: number) => void;
}> = ({ monthlyContribution, years, onMonthlyChange, onYearsChange }) => (
    <div className="bg-white/60 dark:bg-slate-950/50 backdrop-blur-sm rounded-2xl p-4 border border-indigo-100 dark:border-indigo-500/20 space-y-4">
        <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-300 uppercase flex items-center gap-2">
            <Layers size={14} /> What-If Analysis
        </h4>

        <div className="space-y-3">
            <div>
                <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold">Monthly SIP</span>
                    <span className="text-sm font-mono font-bold text-slate-900 dark:text-white">{formatCurrency(monthlyContribution)}</span>
                </div>
                <input
                    type="range"
                    min="5000"
                    max="200000"
                    step="5000"
                    value={monthlyContribution}
                    onChange={e => onMonthlyChange(parseInt(e.target.value))}
                    className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <div className="flex justify-between text-[9px] text-slate-500 dark:text-slate-600 mt-1">
                    <span>₹5K</span>
                    <span>₹2L</span>
                </div>
            </div>

            <div>
                <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold">Time Horizon</span>
                    <span className="text-sm font-mono font-bold text-slate-900 dark:text-white">{years} Years</span>
                </div>
                <input
                    type="range"
                    min="1"
                    max="30"
                    step="1"
                    value={years}
                    onChange={e => onYearsChange(parseInt(e.target.value))}
                    className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <div className="flex justify-between text-[9px] text-slate-500 dark:text-slate-600 mt-1">
                    <span>1 Yr</span>
                    <span>30 Yrs</span>
                </div>
            </div>
        </div>
    </div>
);

// ===================== GOAL ACHIEVEMENT METER =====================
const GoalMeter: React.FC<{ probability: number; target: number; median: number }> = ({ probability, target, median }) => {
    const status = probability > 80 ? 'excellent' : probability > 60 ? 'good' : probability > 40 ? 'moderate' : 'low';
    const colors = {
        excellent: { ring: 'stroke-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
        good: { ring: 'stroke-indigo-500', text: 'text-indigo-650 dark:text-indigo-400', bg: 'bg-indigo-500/10' },
        moderate: { ring: 'stroke-amber-500', text: 'text-amber-655 dark:text-amber-400', bg: 'bg-amber-500/10' },
        low: { ring: 'stroke-rose-500', text: 'text-rose-650 dark:text-rose-400', bg: 'bg-rose-500/10' },
    };
    const c = colors[status];
    const circumference = 2 * Math.PI * 45;
    const offset = circumference - (probability / 100) * circumference;

    return (
        <div className="flex items-center gap-6">
            <div className="relative w-28 h-28">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="45" fill="none" className="stroke-slate-200 dark:stroke-slate-800" strokeWidth="8" />
                    <circle
                        cx="50" cy="50" r="45" fill="none"
                        className={`${c.ring} transition-all duration-1000`}
                        strokeWidth="8"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-3xl font-black font-mono ${c.text}`}>{probability.toFixed(0)}%</span>
                    <span className="text-[9px] text-slate-550 dark:text-slate-400 uppercase">Success</span>
                </div>
            </div>
            <div className="space-y-2">
                <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${c.bg} ${c.text}`}>
                    {status} chance
                </div>
                <div className="text-[10px] text-slate-600 dark:text-slate-400">
                    <span className="text-slate-900 dark:text-white font-bold">Target:</span> {formatCurrency(target)}
                </div>
                <div className="text-[10px] text-slate-600 dark:text-slate-400">
                    <span className="text-indigo-600 dark:text-indigo-400 font-bold">Median:</span> {formatCurrency(median)}
                </div>
            </div>
        </div>
    );
};

// ===================== MAIN ORACLE HUB =====================
const OracleHub: React.FC<OracleHubProps> = ({ totalPortfolioValue, monthlyInvestment = 25000 }) => {
    // State
    const isDarkMode = useSettingsStore(state => state.isDarkMode);
    const [targetWealth, setTargetWealth] = useState(10000000);
    const [yearsToGoal, setYearsToGoal] = useState(10);
    const [monthlyContribution, setMonthlyContribution] = useState(monthlyInvestment);
    const [activeTab, setActiveTab] = useState<'projection' | 'scenarios' | 'stress'>('projection');
    const [activeScenario, setActiveScenario] = useState<Scenario>(PRESET_SCENARIOS[3]); // Index Only

    // Monte Carlo Simulation
    const simulation = useMemo(() => {
        return runMonteCarlo(
            totalPortfolioValue,
            monthlyContribution,
            yearsToGoal,
            targetWealth,
            activeScenario.expectedReturn,
            activeScenario.volatility
        );
    }, [totalPortfolioValue, monthlyContribution, yearsToGoal, targetWealth, activeScenario]);

    // Scenario Comparison
    const scenarioResults = useMemo(() => {
        const results = new Map();
        PRESET_SCENARIOS.forEach(scenario => {
            const result = runMonteCarlo(
                totalPortfolioValue,
                monthlyContribution,
                yearsToGoal,
                targetWealth,
                scenario.expectedReturn,
                scenario.volatility
            );
            results.set(scenario.name, result);
        });
        return results;
    }, [totalPortfolioValue, monthlyContribution, yearsToGoal, targetWealth]);

    const tabs = [
        { id: 'projection', label: 'Projections', icon: <TrendingUp size={14} /> },
        { id: 'scenarios', label: 'Scenarios', icon: <Layers size={14} /> },
        { id: 'stress', label: 'Stress Test', icon: <Skull size={14} /> },
    ];

    return (
        <div className="bg-gradient-to-br from-white via-indigo-50/30 to-slate-50 dark:from-slate-900 dark:via-indigo-950 dark:to-slate-900 border border-indigo-100 dark:border-indigo-900/50 rounded-3xl p-6 shadow-2xl relative overflow-hidden mb-6">
            {/* Background Effects */}
            <div className="absolute top-0 right-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2" />

            <div className="relative z-10">
                {/* Header */}
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h2 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2 tracking-tight">
                            <Sparkles className="text-amber-500 dark:text-amber-400 fill-amber-500 dark:fill-amber-400" size={24} />
                            THE ORACLE 2.0
                        </h2>
                        <p className="text-slate-500 dark:text-indigo-200/60 text-sm font-medium">Advanced Wealth Prediction Engine</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-300 text-[10px] font-bold uppercase tracking-wider">
                            Gold Tier
                        </span>
                    </div>
                </div>

                {/* Tab Navigation */}
                <div className="flex gap-1 p-1 bg-white/50 dark:bg-slate-950/50 rounded-xl border border-slate-200 dark:border-slate-800 mb-6">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === tab.id
                                ? 'bg-indigo-600 text-white shadow-lg'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* TAB: Projections */}
                {activeTab === 'projection' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Left: Goal Meter & Controls */}
                        <div className="space-y-6">
                            <div className="bg-white/60 dark:bg-slate-950/50 backdrop-blur-sm rounded-2xl p-5 border border-indigo-100 dark:border-indigo-500/20">
                                <h3 className="text-xs font-bold text-indigo-600 dark:text-indigo-300 uppercase mb-4 flex items-center gap-2">
                                    <Target size={14} /> Goal Achievement
                                </h3>
                                <GoalMeter
                                    probability={simulation.successProbability}
                                    target={targetWealth}
                                    median={simulation.percentiles.p50}
                                />
                            </div>

                            {/* Target Input */}
                            <div className="bg-white/60 dark:bg-slate-950/50 backdrop-blur-sm rounded-2xl p-4 border border-slate-200 dark:border-slate-800">
                                <label className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold block mb-2">Target Wealth</label>
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-500">₹</span>
                                    <input
                                        type="number"
                                        value={targetWealth}
                                        onChange={e => setTargetWealth(parseFloat(e.target.value) || 0)}
                                        className="flex-1 bg-transparent text-xl font-mono font-bold text-slate-900 dark:text-white outline-none border-b border-dashed border-slate-300 dark:border-slate-700 focus:border-indigo-500"
                                    />
                                </div>
                                <div className="flex gap-2 mt-3">
                                    {[5000000, 10000000, 25000000, 50000000].map(val => (
                                        <button
                                            key={val}
                                            onClick={() => setTargetWealth(val)}
                                            className={`px-2 py-1 rounded text-[10px] font-bold ${targetWealth === val
                                                ? 'bg-indigo-600 text-white'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                                                }`}
                                        >
                                            {(val / 10000000).toFixed(1)}Cr
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <WhatIfSliders
                                monthlyContribution={monthlyContribution}
                                years={yearsToGoal}
                                onMonthlyChange={setMonthlyContribution}
                                onYearsChange={setYearsToGoal}
                            />
                        </div>

                        {/* Middle & Right: Chart & Percentiles */}
                        <div className="lg:col-span-2 space-y-6">
                            <div className="bg-white/60 dark:bg-slate-950/50 backdrop-blur-sm rounded-2xl p-5 border border-indigo-100 dark:border-indigo-500/20">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-xs font-bold text-indigo-600 dark:text-indigo-300 uppercase flex items-center gap-2">
                                        <BarChart3 size={14} /> Confidence Bands (P5-P95)
                                    </h3>
                                    <div className="flex items-center gap-2 text-[10px] text-slate-600 dark:text-slate-400">
                                        <span className="flex items-center gap-1"><span className="w-3 h-1 bg-emerald-500 rounded" /> P95</span>
                                        <span className="flex items-center gap-1"><span className="w-3 h-1 bg-indigo-500 rounded" /> P50</span>
                                        <span className="flex items-center gap-1"><span className="w-3 h-1 bg-amber-500 rounded" /> P5</span>
                                    </div>
                                </div>
                                <ConfidenceBandChart paths={simulation.yearlyPaths} targetWealth={targetWealth} isDarkMode={isDarkMode} />
                            </div>

                            {/* Percentile Grid */}
                            <div className="grid grid-cols-4 gap-3">
                                {[
                                    { label: 'P5 (Worst)', value: simulation.percentiles.p5, color: 'text-rose-600 dark:text-rose-400' },
                                    { label: 'P25', value: simulation.percentiles.p25, color: 'text-amber-600 dark:text-amber-400' },
                                    { label: 'P50 (Median)', value: simulation.percentiles.p50, color: 'text-indigo-600 dark:text-indigo-300' },
                                    { label: 'P95 (Best)', value: simulation.percentiles.p95, color: 'text-emerald-600 dark:text-emerald-400' },
                                ].map(p => (
                                    <div key={p.label} className="bg-white/60 dark:bg-slate-900/50 backdrop-blur-sm rounded-xl p-3 border border-slate-200 dark:border-slate-800 text-center">
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase mb-1">{p.label}</p>
                                        <p className={`text-sm font-mono font-bold ${p.color}`}>{formatCurrency(p.value)}</p>
                                    </div>
                                ))}
                            </div>

                            {/* Statistics */}
                            <div className="bg-slate-100/40 dark:bg-slate-900/30 rounded-xl p-4 border border-slate-200 dark:border-slate-800/50">
                                <div className="flex justify-between text-[10px] text-slate-600 dark:text-slate-400">
                                    <span>Mean: <span className="text-slate-900 dark:text-white font-mono">{formatCurrency(simulation.statistics.mean)}</span></span>
                                    <span>Std Dev: <span className="text-slate-900 dark:text-white font-mono">{formatCurrency(simulation.statistics.std)}</span></span>
                                    <span>Range: <span className="text-slate-900 dark:text-white font-mono">{formatCurrency(simulation.statistics.min)} - {formatCurrency(simulation.statistics.max)}</span></span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB: Scenarios */}
                {activeTab === 'scenarios' && (
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                        {PRESET_SCENARIOS.map(scenario => (
                            <ScenarioCard
                                key={scenario.name}
                                scenario={scenario}
                                result={scenarioResults.get(scenario.name)}
                                isActive={activeScenario.name === scenario.name}
                                onClick={() => setActiveScenario(scenario)}
                            />
                        ))}
                    </div>
                )}

                {/* TAB: Stress Test */}
                {activeTab === 'stress' && (
                    <BlackSwanTester
                        portfolioValue={totalPortfolioValue}
                        monthlyContribution={monthlyContribution}
                    />
                )}
            </div>
        </div>
    );
};

export default OracleHub;
