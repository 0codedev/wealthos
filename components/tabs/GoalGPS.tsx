import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import {
    Target, Compass, TrendingUp, AlertCircle,
    Settings, RefreshCw, CheckCircle2, XCircle,
    Shield, Zap, Gauge, Scale, Table, Download,
    ArrowUpRight, ArrowDownRight, Plus
} from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ComposedChart, Line
} from 'recharts';
import { CustomTooltip } from '../../components/shared/CustomTooltip';
import { formatCurrency } from '../../utils/helpers';

import OracleHub from '../dashboard/hubs/OracleHub';
import TabHero from '../shared/TabHero';
import { usePortfolio } from '../../hooks/usePortfolio';
import { useGoals } from '../../hooks/useGoals';
import { GoalCard } from '../goals/GoalCard';
import { AddGoalModal } from '../goals/AddGoalModal';
import { SectionHeader, StateSurface } from '../shared/SurfacePrimitives';



const GoalGPS: React.FC = () => {
    // --- GLOBAL STATE ---
    const { stats, lifeEvents, addLifeEvent, deleteLifeEvent } = usePortfolio();

    // --- STATE ---
    const [targetAmount, setTargetAmount] = useState(50000000); // 5 Cr
    const [targetYear, setTargetYear] = useState(2035);
    const [currentWealth, setCurrentWealth] = useState(stats?.totalCurrent || 2500000);
    const [monthlySip, setMonthlySip] = useState(50000);
    const [inflationRate, setInflationRate] = useState(6);
    const [expectedReturn, setExpectedReturn] = useState(12); // New slider state
    const [isInflationAdjusted, setIsInflationAdjusted] = useState(false);
    const [riskProfile, setRiskProfile] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
    const [showTable, setShowTable] = useState(false);
    const [scenario, setScenario] = useState<'base' | 'bear' | 'bull'>('base');

    // Life Event State
    const [newEvent, setNewEvent] = useState({ name: '', amount: 1000000, year: new Date().getFullYear() + 1, type: 'EXPENSE' as const });
    const [isEventModalOpen, setIsEventModalOpen] = useState(false);

    // Sync current wealth
    React.useEffect(() => {
        if (stats?.totalCurrent) {
            setCurrentWealth(stats.totalCurrent);
        }
    }, [stats?.totalCurrent]);

    // Update expected return based on risk profile (unless manually overridden)
    React.useEffect(() => {
        const returns = { conservative: 8, balanced: 12, aggressive: 15 };
        setExpectedReturn(returns[riskProfile]);
    }, [riskProfile]);

    // --- MONTE CARLO ENGINE ---
    const simulationData = useMemo(() => {
        const years = targetYear - new Date().getFullYear();
        if (years <= 0) return null;

        const simulations = 1000;
        const results: number[][] = [];
        const currentYear = new Date().getFullYear();

        // Market Assumptions
        // We use the slider value (expectedReturn) as the base mean
        let mean = expectedReturn / 100;
        let stdDev = riskProfile === 'conservative' ? 0.05 : riskProfile === 'balanced' ? 0.12 : 0.20;

        if (scenario === 'bear') { mean -= 0.04; stdDev += 0.05; }
        if (scenario === 'bull') { mean += 0.04; stdDev -= 0.02; }

        for (let s = 0; s < simulations; s++) {
            let wealth = currentWealth;
            const path = [wealth];

            for (let m = 1; m <= years * 12; m++) {
                // Returns
                const randomShock = (Math.random() + Math.random() + Math.random() + Math.random() + Math.random() + Math.random() - 3) / Math.sqrt(0.5);
                const monthlyReturn = (mean / 12) + (stdDev / Math.sqrt(12)) * randomShock;

                wealth = wealth * (1 + monthlyReturn) + monthlySip;

                // CHECK LIFE EVENTS
                const simDate = new Date();
                simDate.setMonth(simDate.getMonth() + m);
                const simYear = simDate.getFullYear();
                const simMonth = simDate.getMonth(); // 0-11

                // Apply ONE-TIME large withdrawals/deposits if they match this month
                // We assume events happen in June (month 5) of the target year for simplicity, or spread them?
                // Better: Just match the year. If matches year, apply in the first month of that year (to be safe)
                if (lifeEvents && simMonth === 5) { // Apply mid-year
                    const eventsThisYear = lifeEvents.filter(e => new Date(e.date).getFullYear() === simYear);
                    eventsThisYear.forEach(e => {
                        if (e.type === 'EXPENSE') wealth -= e.amount;
                        else wealth += e.amount;
                    });
                }

                if (wealth < 0) wealth = 0; // Bankruptcy check

                if (m % 12 === 0) {
                    // Adjust for Inflation
                    const realWealth = isInflationAdjusted
                        ? wealth / Math.pow(1 + inflationRate / 100, m / 12)
                        : wealth;
                    path.push(realWealth);
                }
            }
            results.push(path);
        }

        // Calculate Percentiles
        const chartData = [];
        const finalValues = [];

        for (let y = 0; y <= years; y++) {
            const yearValues = results.map(r => r[y]).sort((a, b) => a - b);
            const p10 = yearValues[Math.floor(simulations * 0.1)];
            const p50 = yearValues[Math.floor(simulations * 0.5)];
            const p90 = yearValues[Math.floor(simulations * 0.9)];

            // Markers
            const relevantEvents = lifeEvents?.filter(e => new Date(e.date).getFullYear() === (currentYear + y));

            chartData.push({
                year: currentYear + y,
                p10,
                p50,
                p90,
                target: isInflationAdjusted ? targetAmount / Math.pow(1 + inflationRate / 100, y) : targetAmount,
                events: relevantEvents
            });

            if (y === years) finalValues.push(...yearValues);
        }

        const targetVal = isInflationAdjusted ? targetAmount / Math.pow(1 + inflationRate / 100, years) : targetAmount;
        const successCount = finalValues.filter(v => v >= targetVal).length;
        const probability = (successCount / simulations) * 100;

        // Suggestions logic remains similar...
        const suggestions = [];
        if (probability < 50) {
            suggestions.push({
                icon: TrendingUp,
                text: `Probability Low. Try increasing SIP or delaying goal by 2 years.`,
                type: 'critical'
            });
        } else if (probability < 80) {
            suggestions.push({
                icon: AlertCircle,
                text: "Good track. A small step-up SIP of 10% annually would secure this.",
                type: 'info'
            });
        } else {
            suggestions.push({
                icon: CheckCircle2,
                text: "Plan is solid. You are positioned for success.",
                type: 'success'
            });
        }

        return { chartData, probability, medianOutcome: chartData[chartData.length - 1].p50, suggestions };
    }, [targetAmount, targetYear, currentWealth, monthlySip, inflationRate, isInflationAdjusted, riskProfile, scenario, expectedReturn, lifeEvents]);

    const handleAddEvent = () => {
        addLifeEvent({
            name: newEvent.name,
            amount: newEvent.amount,
            date: `${newEvent.year}-06-01`, // Default mid-year
            type: newEvent.type
        });
        setIsEventModalOpen(false);
        setNewEvent({ name: '', amount: 1000000, year: new Date().getFullYear() + 1, type: 'EXPENSE' });
    };

    if (!simulationData) return null;

    return (
        <div className="page-shell space-y-6 animate-in fade-in duration-500 pb-24">

            <TabHero
                eyebrow="Life Planner"
                title="Wealth Simulator"
                description="Advanced Monte Carlo projection, life-event modeling, and goal trajectory planning in one strategic workspace."
                icon={Compass}
                iconTone="text-emerald-500"
                gradientClassName="from-emerald-50 via-white to-indigo-50 dark:from-emerald-950/20 dark:via-slate-950 dark:to-indigo-950/20"
                chips={['Monte Carlo', 'Life events', isInflationAdjusted ? 'Real value' : 'Nominal view']}
                actions={
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                            onClick={() => setIsInflationAdjusted(!isInflationAdjusted)}
                            className={`inline-flex min-h-[38px] items-center justify-center rounded-full px-3 py-1.5 text-[11px] font-bold ${isInflationAdjusted ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white/85 text-slate-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300'}`}
                        >
                            {isInflationAdjusted ? 'Real' : 'Nominal'}
                        </button>
                        <button
                            onClick={() => setIsEventModalOpen(true)}
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-full border border-emerald-200 bg-white/85 px-3 py-1.5 text-[11px] font-bold text-emerald-700 dark:border-emerald-800 dark:bg-slate-900/80 dark:text-emerald-300"
                        >
                            <Plus size={12} /> Event
                        </button>
                    </div>
                }
            />

            {/* ORACLE HUB */}
            <OracleHub totalPortfolioValue={stats?.totalCurrent || 0} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Configuration Panel */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 h-fit space-y-6">
                    <SectionHeader
                        eyebrow="Simulation Setup"
                        title="Control Deck"
                        description="Tune assumptions, risk profile, and life events before running projection decisions."
                        icon={Settings}
                        tone="info"
                        badge={isInflationAdjusted ? 'real value' : 'nominal'}
                        actions={
                            <button
                                onClick={() => setIsInflationAdjusted(!isInflationAdjusted)}
                                className={`inline-flex min-h-[32px] items-center justify-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${isInflationAdjusted ? 'bg-indigo-600 dark:bg-indigo-500 text-white border-indigo-600 dark:border-indigo-400' : 'text-slate-500 border-slate-200 dark:border-slate-700'}`}
                            >
                                {isInflationAdjusted ? 'REAL' : 'NOMINAL'}
                            </button>
                        }
                    />

                    {/* Quick Stats inputs */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">Current Wealth</label>
                            <input
                                type="number"
                                value={currentWealth}
                                onChange={(e) => setCurrentWealth(Number(e.target.value))}
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 mt-1 font-mono font-bold text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">Monthly SIP</label>
                            <input
                                type="number"
                                value={monthlySip}
                                onChange={(e) => setMonthlySip(Number(e.target.value))}
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 mt-1 font-mono font-bold text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                            />
                        </div>
                    </div>

                    {/* SLIDERS */}
                    <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                        <label className="block">
                            <div className="flex justify-between mb-2">
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Target Year</span>
                                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-500">{targetYear} ({targetYear - new Date().getFullYear()} yrs)</span>
                            </div>
                            <input
                                type="range"
                                min={new Date().getFullYear() + 1}
                                max={2060}
                                value={targetYear}
                                onChange={(e) => setTargetYear(Number(e.target.value))}
                                className="w-full accent-indigo-600 h-1 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
                            />
                        </label>

                        <label className="block">
                            <div className="flex justify-between mb-2">
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Inflation Rate</span>
                                <span className="text-xs font-bold text-rose-600 dark:text-rose-500">{inflationRate}%</span>
                            </div>
                            <input
                                type="range"
                                min={2}
                                max={15}
                                step={0.5}
                                value={inflationRate}
                                onChange={(e) => setInflationRate(Number(e.target.value))}
                                className="w-full accent-rose-600 h-1 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
                            />
                        </label>

                        <label className="block">
                            <div className="flex justify-between mb-2">
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Expected Return</span>
                                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-500">{expectedReturn}%</span>
                            </div>
                            <input
                                type="range"
                                min={5}
                                max={25}
                                step={0.5}
                                value={expectedReturn}
                                onChange={(e) => setExpectedReturn(Number(e.target.value))}
                                className="w-full accent-emerald-600 h-1 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
                            />
                        </label>
                    </div>

                    {/* Life Events Manager */}
                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                        <div className="flex justify-between items-center mb-3">
                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Life Events</span>
                            <button onClick={() => setIsEventModalOpen(true)} className="text-xs bg-indigo-50 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-slate-700 px-2.5 py-1.5 rounded-lg font-bold text-indigo-600 dark:text-indigo-400 transition-colors">
                                + Add Event
                            </button>
                        </div>
                        <div className="space-y-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                            {lifeEvents?.map(e => (
                                <div key={e.id} className="flex justify-between items-center text-xs p-2.5 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                                    <div>
                                        <p className="font-bold text-slate-800 dark:text-slate-200">{e.name}</p>
                                        <p className="text-slate-500 dark:text-slate-400 font-medium">{new Date(e.date).getFullYear()}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={e.type === 'EXPENSE' ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-emerald-600 dark:text-emerald-400 font-bold'}>
                                            {e.type === 'EXPENSE' ? '-' : '+'} {formatCurrency(e.amount)}
                                        </span>
                                        <button onClick={() => e.id && deleteLifeEvent(e.id)} className="p-1 text-slate-400 hover:text-rose-600 transition-colors"><XCircle size={14} /></button>
                                    </div>
                                </div>
                            ))}
                            {(!lifeEvents || lifeEvents.length === 0) && (
                                <StateSurface
                                    title="No Life Events Added"
                                    description="Add expected expenses or income events to make future cashflow simulation more realistic."
                                    icon={Target}
                                    tone="neutral"
                                    badge="optional"
                                    compact
                                    className="bg-transparent border-dashed border-slate-200 dark:border-slate-800"
                                />
                            )}
                        </div>
                    </div>
                </div>

                {/* Simulation Chart */}
                <div className="lg:col-span-2 space-y-6">

                    {/* Probability Score Card */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className={`p-6 rounded-2xl border flex items-center gap-4 transition-all duration-300 ${simulationData.probability > 75 ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/30' : simulationData.probability > 50 ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/30' : 'bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-900/30'}`}>
                            <div className={`p-3 rounded-full ${simulationData.probability > 75 ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : simulationData.probability > 50 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' : 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'}`}>
                                {simulationData.probability > 75 ? <CheckCircle2 size={32} /> : simulationData.probability > 50 ? <AlertCircle size={32} /> : <XCircle size={32} />}
                            </div>
                            <div>
                                <p className="text-xs font-bold uppercase opacity-70">Success Probability</p>
                                <h3 className="text-3xl font-black tabular-nums">
                                    {simulationData.probability.toFixed(1)}%
                                </h3>
                            </div>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">Median Outcome (50th %)</p>
                            <h3 className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                                {formatCurrency(simulationData.medianOutcome)}
                            </h3>
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 font-medium">
                                vs Target: {formatCurrency(targetAmount)}
                            </p>
                        </div>
                    </div>

                    {simulationData.suggestions.length > 0 && (
                        <StateSurface
                            title={simulationData.suggestions[0].text}
                            description="Action guidance auto-generated from your current simulation probability and scenario setup."
                            icon={simulationData.suggestions[0].icon}
                            tone={simulationData.suggestions[0].type === 'critical' ? 'danger' : simulationData.suggestions[0].type === 'success' ? 'success' : 'info'}
                            badge="next best move"
                            compact
                        />
                    )}

                    {/* The Cone Chart */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                <TrendingUp size={20} className="text-indigo-600 dark:text-indigo-500" /> Wealth Trajectory
                            </h3>

                            {/* Scenario Toggles */}
                            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 shadow-inner">
                                <button onClick={() => setScenario('bear')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${scenario === 'bear' ? 'bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Bear</button>
                                <button onClick={() => setScenario('base')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${scenario === 'base' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Base</button>
                                <button onClick={() => setScenario('bull')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${scenario === 'bull' ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Bull</button>
                            </div>
                        </div>

                        <div className="h-80 w-full">
                            <SafeChartContainer>
                                <ComposedChart data={simulationData.chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="coneGradient" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.1} />
                                    <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                                    <YAxis tickFormatter={(val) => `${(val / 10000000).toFixed(1)}Cr`} tick={{ fontSize: 10 }} width={40} />
                                    <Tooltip
                                        content={<CustomTooltip />}
                                        cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '3 3' }}
                                    />

                                    <Area type="monotone" dataKey="p90" stroke="#6366f1" strokeWidth={1} strokeDasharray="5 5" fill="url(#coneGradient)" name="Optimistic" />
                                    <Area type="monotone" dataKey="p10" stroke="#6366f1" strokeWidth={1} strokeDasharray="5 5" fill="transparent" name="Pessimistic" />

                                    <Line type="monotone" dataKey="p50" stroke="#4f46e5" strokeWidth={3} dot={false} name="Median" />
                                    <ReferenceLine y={isInflationAdjusted ? targetAmount / Math.pow(1 + inflationRate / 100, simulationData.chartData.length) : targetAmount} stroke="#ef4444" strokeDasharray="3 3" label="Target" />

                                    {/* Event Markers: Render vertical lines for events */}
                                    {simulationData.chartData.map((point) => (
                                        point.events && point.events.length > 0 && (
                                            <ReferenceLine key={point.year} x={point.year} stroke="#f43f5e" strokeDasharray="3 3">
                                                <div className="text-[10px] text-rose-600 dark:text-rose-500 -mt-4 bg-rose-50 dark:bg-rose-950 px-1.5 py-0.5 rounded border border-rose-200 dark:border-rose-800 shadow-sm">
                                                    {point.events[0].name}
                                                </div>
                                            </ReferenceLine>
                                        )
                                    ))}

                                </ComposedChart>
                            </SafeChartContainer>
                        </div>
                    </div>
                </div>
            </div>

            {/* QUICK ADD MODAL */}
            {isEventModalOpen && (
                <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 p-8 rounded-[2rem] w-full max-w-md border border-slate-200 dark:border-slate-800 shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800">
                                <Plus size={20} />
                            </div>
                            <h3 className="font-bold text-xl text-slate-900 dark:text-white uppercase tracking-tight">Add Life Event</h3>
                        </div>
                        <div className="space-y-5">
                            <div>
                                <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Event Description</label>
                                <input
                                    type="text" placeholder="e.g. Wedding, Property, Education"
                                    value={newEvent.name} onChange={e => setNewEvent({ ...newEvent, name: e.target.value })}
                                    className="w-full p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-inner"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Amount (₹)</label>
                                <input
                                    type="number" placeholder="10,00,000"
                                    value={newEvent.amount} onChange={e => setNewEvent({ ...newEvent, amount: Number(e.target.value) })}
                                    className="w-full p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-inner"
                                />
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Occurrence Year</label>
                                    <input
                                        type="number" placeholder="2028"
                                        value={newEvent.year} onChange={e => setNewEvent({ ...newEvent, year: Number(e.target.value) })}
                                        className="w-full p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-inner"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Event Type</label>
                                    <select
                                        value={newEvent.type} onChange={e => setNewEvent({ ...newEvent, type: e.target.value as any })}
                                        className="w-full p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-inner cursor-pointer"
                                    >
                                        <option value="EXPENSE">🔴 Withdrawal</option>
                                        <option value="INCOME">🟢 Deposit</option>
                                    </select>
                                </div>
                            </div>
                            <div className="pt-4 flex gap-3">
                                <button onClick={() => setIsEventModalOpen(false)} className="flex-1 py-3.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl font-bold text-sm transition-all">Cancel</button>
                                <button onClick={handleAddEvent} className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-600/20 transition-all active:scale-[0.98]">Save Event</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Wrap with React.memo to prevent unnecessary re-renders
export default React.memo(GoalGPS);
