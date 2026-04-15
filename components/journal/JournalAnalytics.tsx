import React, { useMemo, useState, useRef, useEffect, useDeferredValue } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid
} from 'recharts';
import {
    Clock, RefreshCcw, Zap, TrendingUp, TrendingDown, ToggleLeft, ToggleRight
} from 'lucide-react';

import { Trade } from '../../database';
import { formatCurrency } from '../../utils/helpers';
import { CustomTooltip } from '../shared/CustomTooltip';
import LazyRender from '../shared/LazyRender';

import { analyzeTradePatterns } from '../../services/JournalIntelligenceService';
import { usePageVisibility } from '../../contexts/PageVisibilityContext';
import { useLiteModeStore } from '../../store/liteModeStore';

// Static Analytics Widgets
import { EquityCurveCard } from './analytics/EquityCurveCard';
import { ExpectancyEngine } from './analytics/ExpectancyEngine';
import { TiltMeter } from './analytics/TiltMeter';
import { EdgeMatrix } from './analytics/EdgeMatrix';
import { DayOfWeekPerformance } from './analytics/DayOfWeekPerformance';
import { TickerLeaderboard } from './analytics/TickerLeaderboard';
import { GradePerformanceChart } from './analytics/GradePerformanceChart';
import { MoodCorrelationMatrix } from './analytics/MoodCorrelationMatrix';
import { AssetClassDistribution } from './analytics/AssetClassDistribution';
import { MAEMFEScatter } from './analytics/MAEMFEScatter';
import { RiskRatioScorecard } from './analytics/RiskRatioScorecard';
import { PnLDistributionChart } from './analytics/PnLDistributionChart';
import { ConvictionAnalyzer } from './analytics/ConvictionAnalyzer';
import { ExecutionHeatmap } from './analytics/ExecutionHeatmap';
import { PhysicalStateGrid } from './analytics/PhysicalStateGrid';
import { SeasonalHeatmap } from './analytics/SeasonalHeatmap';
import { RMultipleChart } from './analytics/RMultipleChart';
import { PerformanceCoachPanel } from './analytics/PerformanceCoachPanel';

/**
 * Local helper to guard charts against zero-size render warnings.
 */
const ChartGuard: React.FC<{ children: React.ReactNode; height: number | string }> = ({ children, height }) => {
    const [isReady, setIsReady] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const resolvedRef = useRef(false);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const fallback = setTimeout(() => {
            if (resolvedRef.current) return;
            resolvedRef.current = true;
            setIsReady(true);
        }, 200);

        const observer = new ResizeObserver(([entry]) => {
            if (resolvedRef.current) return;
            if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
                resolvedRef.current = true;
                setIsReady(true);
                clearTimeout(fallback);
                observer.disconnect();
            }
        });
        observer.observe(el);
        return () => {
            clearTimeout(fallback);
            observer.disconnect();
        };
    }, []);

    return (
        <div ref={containerRef} style={{ width: '100%', height, contain: 'layout' }}>
            {isReady ? children : <div className="w-full h-full bg-slate-900/30 animate-pulse rounded-xl" />}
        </div>
    );
};

interface JournalAnalyticsProps {
    trades: Trade[];
    timeframe: 'ALL' | '30D' | '90D' | 'CUSTOM';
    ignoredMistakes: string[];
    setIgnoredMistakes: React.Dispatch<React.SetStateAction<string[]>>;
    customStart?: string;
    customEnd?: string;
}

const JournalAnalytics: React.FC<JournalAnalyticsProps> = React.memo(({
    trades: allTrades,
    timeframe,
    ignoredMistakes,
    setIgnoredMistakes,
    customStart,
    customEnd
}) => {
    const isVisible = usePageVisibility();
    const isLiteMode = useLiteModeStore(state => state.isLiteMode);

    const deferredTrades = useDeferredValue(allTrades);
    const tradesAreStale = deferredTrades !== allTrades;
    const isUrgent = tradesAreStale;

    const filteredTrades = useMemo(() => {
        if (timeframe === 'ALL') return deferredTrades;
        if (timeframe === 'CUSTOM') {
            const start = customStart ? new Date(customStart) : new Date(0);
            start.setHours(0, 0, 0, 0);
            const end = customEnd ? new Date(customEnd) : new Date();
            end.setHours(23, 59, 59, 999);
            return deferredTrades.filter(t => {
                const tDate = new Date(t.date);
                return tDate >= start && tDate <= end;
            });
        }
        const now = new Date();
        const days = timeframe === '30D' ? 30 : 90;
        const cutoff = new Date(now.setDate(now.getDate() - days));
        return deferredTrades.filter(t => new Date(t.date) >= cutoff);
    }, [deferredTrades, timeframe, customStart, customEnd]);

    // --- BEHAVIORAL ANALYTICS ---
    const hourlyStats = useMemo(() => {
        const hours = ['09', '10', '11', '12', '13', '14', '15'];
        const map: Record<string, { pnl: number, count: number }> = {};
        hours.forEach(h => map[h] = { pnl: 0, count: 0 });

        filteredTrades.forEach(t => {
            if (t.entryTime) {
                const hour = t.entryTime.split(':')[0];
                if (map[hour]) {
                    map[hour].pnl += (t.pnl || 0);
                    map[hour].count++;
                }
            }
        });

        return hours.map(hour => ({
            hour: hour === '09' ? '09:15' : `${hour}:00`,
            pnl: map[hour].pnl,
            count: map[hour].count
        }));
    }, [filteredTrades]);

    const directionalStats = useMemo(() => {
        let longPnL = 0, shortPnL = 0;
        let longCount = 0, shortCount = 0;
        let longWins = 0, shortWins = 0;

        filteredTrades.forEach(t => {
            if (t.direction === 'Long') {
                longPnL += (t.pnl || 0);
                longCount++;
                if ((t.pnl || 0) > 0) longWins++;
            } else {
                shortPnL += (t.pnl || 0);
                shortCount++;
                if ((t.pnl || 0) > 0) shortWins++;
            }
        });

        return {
            long: { pnl: longPnL, count: longCount, winRate: longCount > 0 ? (longWins / longCount) * 100 : 0 },
            short: { pnl: shortPnL, count: shortCount, winRate: shortCount > 0 ? (shortWins / shortCount) * 100 : 0 }
        };
    }, [filteredTrades]);

    const getTradeMistakes = (t: any): string[] => {
        const set = new Set<string>(t.mistakes || []);
        if ((t.fomoLevel || 0) >= 7) set.add('High FOMO');
        if (t.forcedTrade) set.add('Forced Trade');
        if (t.moodEntry === 'Revenge') set.add('Revenge Trading');
        return Array.from(set);
    };

    const whatIfStats = useMemo(() => {
        const actualPnL = filteredTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);

        const potentialPnL = filteredTrades.reduce((acc, t) => {
            const mistakes = getTradeMistakes(t);
            if (mistakes.some(m => ignoredMistakes.includes(m))) return acc;
            return acc + (t.pnl || 0);
        }, 0);

        const diff = potentialPnL - actualPnL;
        return { actualPnL, potentialPnL, diff };
    }, [filteredTrades, ignoredMistakes]);

    const allMistakes = useMemo(() => {
        const set = new Set<string>();
        filteredTrades.forEach(t => {
            getTradeMistakes(t).forEach(m => set.add(m));
        });
        return Array.from(set);
    }, [filteredTrades]);

    const journalInsights = useMemo(() => analyzeTradePatterns(filteredTrades), [filteredTrades]);

    return (
        <div className="space-y-6 pb-20">
            {isLiteMode && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-3">
                    <Zap size={16} className="text-amber-500" />
                    <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">
                        Lite Mode Active — High-resource widgets hidden to save battery
                    </p>
                </div>
            )}

            {/* Above the Fold */}
            <EquityCurveCard trades={filteredTrades} isVisible={isVisible && !isUrgent} />
            <ExpectancyEngine trades={filteredTrades} isVisible={isVisible && !isUrgent} />
            <TiltMeter trades={filteredTrades} isVisible={isVisible && !isUrgent} />

            {/* Below the Fold: Use LazyRender + Suspense */}
            {!isLiteMode && (
                <LazyRender minHeight={300}>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* CHRONOBIOLOGY */}
                        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-5 md:p-6 shadow-xl overflow-hidden" style={{ contain: 'layout' }}>
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                    <Clock size={16} className="text-indigo-500" /> Chronobiology
                                </h3>
                            </div>
                            <div className="h-48 w-full mb-6" style={{ contain: 'layout' }}>
                                <ChartGuard height="100%">
                                    <SafeChartContainer>
                                        <BarChart data={hourlyStats}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.1} />
                                            <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                            <YAxis hide />
                                            <Tooltip
                                                content={<CustomTooltip />}
                                                cursor={{ fill: 'transparent' }}
                                            />
                                            <Bar dataKey="pnl" isAnimationActive={isVisible && !isUrgent}>
                                                {hourlyStats.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </SafeChartContainer>
                                </ChartGuard>
                            </div>

                            <div className="grid grid-cols-2 gap-4 border-t border-white/5 pt-4">
                                <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                                    <p className="text-xs text-emerald-400 font-bold uppercase mb-1 flex items-center gap-1">
                                        <TrendingUp size={12} /> Long Bias
                                    </p>
                                    <div className="flex justify-between items-end">
                                        <span className={`text-sm font-black font-mono ${directionalStats.long.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(directionalStats.long.pnl)}</span>
                                        <span className="text-[10px] text-slate-400">{directionalStats.long.winRate.toFixed(0)}% WR</span>
                                    </div>
                                </div>
                                <div className="p-3 bg-rose-500/10 rounded-xl border border-rose-500/20">
                                    <p className="text-xs text-rose-400 font-bold uppercase mb-1 flex items-center gap-1">
                                        <TrendingDown size={12} /> Short Bias
                                    </p>
                                    <div className="flex justify-between items-end">
                                        <span className={`text-sm font-black font-mono ${directionalStats.short.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(directionalStats.short.pnl)}</span>
                                        <span className="text-[10px] text-slate-400">{directionalStats.short.winRate.toFixed(0)}% WR</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* THE WHAT-IF SIMULATOR */}
                        <div className="bg-slate-950 border border-white/10 rounded-2xl p-4 sm:p-5 md:p-6 shadow-xl relative overflow-hidden flex flex-col">
                            <div className="absolute top-0 right-0 p-4 opacity-5">
                                <RefreshCcw size={100} className="text-indigo-500" />
                            </div>

                            <div className="relative z-10">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
                                    <RefreshCcw size={20} className="text-indigo-400" /> The What-If Simulator
                                </h3>
                                <p className="text-xs text-slate-400 mb-6">Eliminate specific mistakes to see your potential.</p>

                                <div className="flex flex-wrap gap-2 mb-6">
                                    {allMistakes.map(m => (
                                        <button
                                            key={m}
                                            onClick={() => setIgnoredMistakes(prev => prev.includes(m) ? prev.filter(i => i !== m) : [...prev, m])}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-2 ${ignoredMistakes.includes(m) ? 'bg-rose-500/20 border-rose-500 text-rose-400 line-through opacity-70' : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-indigo-500'}`}
                                        >
                                            {ignoredMistakes.includes(m) ? <ToggleLeft size={14} /> : <ToggleRight size={14} />} {m}
                                        </button>
                                    ))}
                                    {allMistakes.length === 0 && <span className="text-xs text-slate-600 italic">No mistakes logged yet.</span>}
                                </div>

                                <div className="space-y-4">
                                    <div className="flex justify-between items-center bg-slate-900/50 p-3 rounded-xl border border-white/5">
                                        <span className="text-xs font-bold text-slate-500 uppercase">Actual PnL</span>
                                        <span className={`font-mono font-bold ${whatIfStats.actualPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatCurrency(whatIfStats.actualPnL)}</span>
                                    </div>
                                    <div className="flex justify-between items-center bg-indigo-500/10 p-3 rounded-xl border border-indigo-500/30 relative overflow-hidden">
                                        <div className="absolute inset-0 bg-indigo-500/5 animate-pulse"></div>
                                        <span className="text-xs font-bold text-indigo-300 uppercase relative z-10 flex items-center gap-2"><Zap size={12} /> Potential PnL</span>
                                        <span className={`font-mono font-bold relative z-10 text-xl ${whatIfStats.potentialPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(whatIfStats.potentialPnL)}</span>
                                    </div>

                                    {whatIfStats.diff > 0 && (
                                        <div className="text-center">
                                            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Cost of Bad Habits</p>
                                            <p className="text-lg font-black text-rose-500">{formatCurrency(whatIfStats.diff)}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </LazyRender>
            )}

            <LazyRender minHeight={200}>
                <PerformanceCoachPanel trades={filteredTrades} isVisible={isVisible && !isUrgent} />
            </LazyRender>

            {!isLiteMode && (
                <LazyRender minHeight={400}>
                    <EdgeMatrix trades={filteredTrades} isVisible={isVisible && !isUrgent} />
                </LazyRender>
            )}

            {journalInsights.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {journalInsights.map((insight) => (
                        <div
                            key={insight.id}
                            className={`rounded-2xl border p-4 ${insight.severity === 'high'
                                ? 'bg-rose-950/40 border-rose-500/20'
                                : insight.severity === 'medium'
                                    ? 'bg-amber-950/30 border-amber-500/20'
                                    : 'bg-indigo-950/20 border-indigo-500/20'
                                }`}
                        >
                            <div className="flex items-center justify-between gap-3">
                                <h3 className="text-sm font-bold text-white">{insight.title}</h3>
                                {insight.metric && (
                                    <span className="text-[10px] font-mono text-slate-400">{insight.metric}</span>
                                )}
                            </div>
                            <p className="mt-2 text-xs leading-relaxed text-slate-300">{insight.description}</p>
                        </div>
                    ))}
                </div>
            )}

            <LazyRender minHeight={400}>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <DayOfWeekPerformance trades={filteredTrades} isVisible={isVisible && !isUrgent} />
                    <TickerLeaderboard trades={filteredTrades} isVisible={isVisible && !isUrgent} />
                </div>
            </LazyRender>

            {!isLiteMode && (
                <>
                    <LazyRender minHeight={400}>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <AssetClassDistribution trades={filteredTrades} isVisible={isVisible && !isUrgent} />
                            <GradePerformanceChart trades={filteredTrades} isVisible={isVisible && !isUrgent} />
                            <MoodCorrelationMatrix trades={filteredTrades} isVisible={isVisible && !isUrgent} />
                        </div>
                    </LazyRender>

                    <LazyRender minHeight={150}>
                        <RiskRatioScorecard trades={filteredTrades} isVisible={isVisible && !isUrgent} />
                    </LazyRender>

                    <LazyRender minHeight={400}>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <MAEMFEScatter trades={filteredTrades} isVisible={isVisible && !isUrgent} />
                            <PnLDistributionChart trades={filteredTrades} isVisible={isVisible && !isUrgent} />
                        </div>
                    </LazyRender>

                    <LazyRender minHeight={400}>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <ConvictionAnalyzer trades={filteredTrades} isVisible={isVisible && !isUrgent} />
                            <PhysicalStateGrid trades={filteredTrades} isVisible={isVisible && !isUrgent} />
                        </div>
                    </LazyRender>

                    <LazyRender minHeight={300}>
                        <ExecutionHeatmap trades={filteredTrades} isVisible={isVisible && !isUrgent} />
                    </LazyRender>

                    <LazyRender minHeight={400}>
                        <SeasonalHeatmap trades={filteredTrades} isVisible={isVisible && !isUrgent} />
                    </LazyRender>
                </>
            )}

            <LazyRender minHeight={400}>
                <RMultipleChart trades={filteredTrades} isVisible={isVisible && !isUrgent} />
            </LazyRender>
        </div>
    );
});

export default JournalAnalytics;
