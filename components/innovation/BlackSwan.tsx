import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { AlertTriangle, TrendingDown, Clock, ShieldAlert, ArrowRight, RefreshCcw } from 'lucide-react';
import { usePortfolio } from '../../hooks/usePortfolio';
import { runMonteCarlo, calculateRecoveryPath, BLACK_SWAN_EVENTS, BlackSwanEvent } from '../../utils/MonteCarlo';
import { formatCurrency } from '../../utils/helpers';
import { usePageVisibility } from '../../contexts/PageVisibilityContext';

export const BlackSwan: React.FC = () => {
    const isVisible = usePageVisibility();
    const { stats, investments } = usePortfolio();
    const [selectedEvent, setSelectedEvent] = useState<BlackSwanEvent>(BLACK_SWAN_EVENTS[0]);

    // Default assumptions if stats are missing
    const currentPrincipal = stats?.totalCurrent || 0;
    const monthlyContribution = 25000; // Default assumption or fetch from user settings?

    // Simulate Data
    const simulationData = useMemo(() => {
        if (currentPrincipal === 0) return [];

        // 1. Business As Usual (BAU) - 10 Year Projection
        const bauSim = runMonteCarlo(
            currentPrincipal,
            monthlyContribution,
            10,
            currentPrincipal * 10 // Arbitrary high target
        );

        // 2. Shocked Path
        // We simulate a crash occurring at Year 1 (Month 12)
        // Then we append the recovery path
        const crashValue = currentPrincipal * (1 + selectedEvent.impact);

        // Recovery simulation from the crashed value
        const recoverySim = runMonteCarlo(
            crashValue,
            monthlyContribution,
            9, // Remaining 9 years
            currentPrincipal * 10
        );

        // Combine data for charting
        return bauSim.yearlyPaths.map((path, idx) => {
            let shockedValue = 0;
            if (idx === 0) {
                shockedValue = currentPrincipal; // Start same
            } else if (idx === 1) {
                shockedValue = crashValue; // CRASH at Year 1
            } else {
                // Map recovery years (index 0 of recovery is Year 1 of timeline)
                // recoverySim.yearlyPaths[idx - 1] corresponds to recovery year (idx-1)
                const recoveryPoint = recoverySim.yearlyPaths[idx - 1];
                shockedValue = recoveryPoint ? recoveryPoint.p50 : 0;
            }

            return {
                year: `Year ${idx}`,
                bau: path.p50,
                shocked: shockedValue,
                impact: selectedEvent.name
            };
        });
    }, [currentPrincipal, monthlyContribution, selectedEvent]);

    // Derived Metrics
    const immediateLoss = currentPrincipal * Math.abs(selectedEvent.impact);

    // Find recovery year
    const recoveryYearIndex = simulationData.findIndex((d, idx) => idx > 0 && d.shocked >= d.bau); // This logic is flawed because BAU keeps growing. 
    // We should check when Shocked >= Original Principal? Or catch up to BAU?
    // Usually "Recovery" means getting back to High Water Mark (Principal at time of crash).
    const recoveryIndex = simulationData.findIndex((d, idx) => idx > 0 && d.shocked >= currentPrincipal);
    const timeToRecover = recoveryIndex > 0 ? `${recoveryIndex} Years` : '> 10 Years';

    const finalGap = (simulationData[simulationData.length - 1]?.bau || 0) - (simulationData[simulationData.length - 1]?.shocked || 0);

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-rose-600 to-orange-600 bg-clip-text text-transparent flex items-center gap-3">
                    <ShieldAlert className="text-rose-500" />
                    Black Swan Simulator
                </h1>
                <p className="text-slate-600 dark:text-slate-400 mt-2">
                    Stress-test your portfolio against historical market catastrophes.
                    See how long it takes to recover if history repeats itself tomorrow.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                {/* Event Selector */}
                <div className="lg:col-span-1 space-y-4">
                    <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">Select Stress Scenario</h3>
                    {BLACK_SWAN_EVENTS.map((event) => (
                        <button
                            key={event.name}
                            onClick={() => setSelectedEvent(event)}
                            className={`w-full text-left p-4 rounded-xl border transition-all ${selectedEvent.name === event.name
                                ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-500 shadow-md ring-1 ring-rose-500'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-300 dark:hover:border-rose-700'
                                }`}
                        >
                            <div className="flex justify-between items-center mb-1">
                                <span className={`font-bold ${selectedEvent.name === event.name ? 'text-rose-700 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300'}`}>
                                    {event.name}
                                </span>
                                <span className="text-xs font-mono py-1 px-2 bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-300 rounded">
                                    {Math.round(event.impact * 100)}%
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Estimated Recovery: {event.recoveryYears} years
                            </p>
                        </button>
                    ))}
                </div>

                {/* Main Chart */}
                <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                                <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Business As Usual</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-rose-500"></span>
                                <span className="text-sm font-medium text-slate-600 dark:text-slate-400">If Crash Happens Now</span>
                            </div>
                        </div>
                    </div>

                    <div className="h-80 w-full">
                        <SafeChartContainer>
                            <AreaChart data={simulationData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorBau" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorShock" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="year" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis
                                    stroke="#94a3b8"
                                    fontSize={12}
                                    tickFormatter={(val) => `₹${(val / 100000).toFixed(1)}L`}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip
                                    content={({ active, payload, label }) => {
                                        if (active && payload && payload.length) {
                                            return (
                                                <div className="bg-slate-950/95 backdrop-blur-md border border-slate-700/50 p-4 rounded-2xl shadow-2xl ring-1 ring-white/10 min-w-[200px]">
                                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-3 border-b border-slate-800 pb-2">{label}</p>
                                                    <div className="space-y-3">
                                                        {payload.map((entry: any, index: number) => (
                                                            <div key={index} className="flex flex-col gap-1">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: entry.color }}></div>
                                                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{entry.name === 'bau' ? 'Business As Usual' : 'Post-Crash Path'}</span>
                                                                </div>
                                                                <span className="text-sm font-black text-white font-mono">{formatCurrency(entry.value)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="bau"
                                    stroke="#10b981"
                                    strokeWidth={2}
                                    fillOpacity={1}
                                    fill="url(#colorBau)"
                                    isAnimationActive={isVisible}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="shocked"
                                    stroke="#f43f5e"
                                    strokeWidth={2}
                                    fillOpacity={1}
                                    fill="url(#colorShock)"
                                    isAnimationActive={isVisible}
                                />
                                <ReferenceLine x="Year 1" stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'top', value: 'IMPACT EVENT', fill: '#ef4444', fontSize: 10 }} />
                            </AreaChart>
                        </SafeChartContainer>
                    </div>
                </div>
            </div>

            {/* Impact Analysis Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-rose-50 dark:bg-rose-900/10 rounded-2xl p-6 border border-rose-100 dark:border-rose-900/30">
                    <div className="flex items-center gap-3 mb-2 text-rose-600 dark:text-rose-400">
                        <TrendingDown size={24} />
                        <h3 className="font-bold">Immediate Impact</h3>
                    </div>
                    <p className="text-3xl font-bold text-slate-800 dark:text-slate-100">
                        -{formatCurrency(immediateLoss)}
                    </p>
                    <p className="text-sm text-rose-600/80 mt-1">
                        Paper loss overnight if this happens.
                    </p>
                </div>

                <div className="bg-amber-50 dark:bg-amber-900/10 rounded-2xl p-6 border border-amber-100 dark:border-amber-900/30">
                    <div className="flex items-center gap-3 mb-2 text-amber-600 dark:text-amber-400">
                        <Clock size={24} />
                        <h3 className="font-bold">Time to Recover</h3>
                    </div>
                    <p className="text-3xl font-bold text-slate-800 dark:text-slate-100">
                        {timeToRecover}
                    </p>
                    <p className="text-sm text-amber-600/80 mt-1">
                        To get back to today's net worth.
                    </p>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-3 mb-2 text-slate-600 dark:text-slate-400">
                        <RefreshCcw size={24} />
                        <h3 className="font-bold">10-Year Gap</h3>
                    </div>
                    <p className="text-3xl font-bold text-slate-800 dark:text-slate-100">
                        -{formatCurrency(finalGap)}
                    </p>
                    <p className="text-sm text-slate-500 mt-1">
                        Wealth difference vs BAU scenario in 10 years.
                    </p>
                </div>
            </div>
        </div>
    );
};

// Wrap with React.memo to prevent unnecessary re-renders
export default React.memo(BlackSwan);
