import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { liveQuery } from 'dexie';
import { db, Trade, calculatePnL } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import {
    MetricCard,
    SectionCard,
    PageHeader,
    DataTable,
    DirectionBadge,
    CategoryBadge,
    EmptyState,
    GradientProgressBar
} from './ReusableUI';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, BarChart, Bar, ReferenceLine
} from 'recharts';
import {
    TrendingUp, TrendingDown, Target, Brain, Clipboard,
    BarChart3, AlertTriangle, AlertCircle, Plus, Calendar, Clock, Heart, Trash2
} from 'lucide-react';
import { deleteWithUndo } from '../../../lib/deleteWithUndo';
import { consumeUndo } from '../../../lib/undoStack';
import { COPY } from '../../../utils/appCopy';
import { useToast } from '../../shared/ToastProvider';
import { EntryTimingAnalyzer } from '../../../services/ml/EntryTimingAnalyzer';
import { MoodPerformanceAnalyzer } from '../../../services/ml/MoodPerformanceAnalyzer';
import { useSandboxStore } from '../../../store/sandboxStore';
import { SyncSandboxTradesButton } from '../../journal/SyncSandboxTradesButton';

export const JournalDashboardTab: React.FC<{
    onNewTrade?: () => void;
    onEditTrade?: (trade: Trade) => void;
}> = ({ onNewTrade, onEditTrade }) => {
    const { toast } = useToast();
    const isSandboxMode = useSandboxStore(state => state.isSandboxMode);
    const [allTrades, setAllTrades] = useState<Trade[]>([]);
    const [loading, setLoading] = useState(true);

    // Fetch trades (excluding soft-deleted)
    useEffect(() => {
        const subscription = liveQuery(() => db.trades.filter((t: any) => !t.isDeleted).toArray()).subscribe(data => {
            const enriched = (data || []).map(t => ({
                ...t,
                pnl: calculatePnL(t)
            }));
            setAllTrades(enriched);
            setLoading(false);
        });
        return () => subscription.unsubscribe();
    }, []);

    // Reactive filter based on Sandbox Mode toggle
    const trades = useMemo(() => {
        return allTrades.filter(t => isSandboxMode ? t.source === 'SANDBOX' : t.source !== 'SANDBOX');
    }, [allTrades, isSandboxMode]);

    const handleDeleteTrade = useCallback(async (t: Trade) => {
        if (!t.id) return;
        const label = t.ticker || 'Trade';
        const entryId = await deleteWithUndo({
            table: 'trades',
            id: t.id,
            kind: 'trade',
            label,
            message: COPY.undo.tradeDeleted(label),
        });
        if (!entryId) {
            toast.error(COPY.undo.failed);
            return;
        }
        toast.success(COPY.undo.tradeDeleted(label), {
            duration: 30000,
            action: { label: 'Undo', onClick: () => { void consumeUndo(entryId)?.undo(); } },
        });
    }, [toast]);

    // 1. Metric calculations
    const stats = useMemo(() => {
        if (trades.length === 0) {
            return {
                totalPnL: 0,
                winRate: 0,
                avgRR: 0,
                tradesThisMonth: 0,
                confidenceIndex: 100
            };
        }

        let totalPnL = 0;
        let wins = 0;
        let rrSum = 0;
        let rrCount = 0;
        let tradesThisMonth = 0;
        let emotionalCount = 0;

        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();

        trades.forEach(t => {
            const pnl = t.pnl || 0;
            totalPnL += pnl;

            if (pnl > 0) wins++;

            if (t.riskRewardRatio && t.riskRewardRatio > 0) {
                rrSum += t.riskRewardRatio;
                rrCount++;
            }

            const tradeDate = new Date(t.date);
            if (tradeDate.getMonth() === currentMonth && tradeDate.getFullYear() === currentYear) {
                tradesThisMonth++;
            }

            const emotionalStates = ['Anxious', 'Revenge', 'Greedy', 'Panic', 'Regret', 'Euphoric'];
            if (emotionalStates.includes(t.moodEntry) || emotionalStates.includes(t.moodExit)) {
                emotionalCount++;
            }
        });

        const winRate = (wins / trades.length) * 100;
        const avgRR = rrCount > 0 ? rrSum / rrCount : 0;
        const confidenceIndex = Math.max(0, 100 - Math.round((emotionalCount / trades.length) * 100));

        return {
            totalPnL,
            winRate,
            avgRR,
            tradesThisMonth,
            confidenceIndex
        };
    }, [trades]);

    const timingSlots = useMemo(() => EntryTimingAnalyzer.analyze(trades), [trades]);
    const moodStats = useMemo(() => MoodPerformanceAnalyzer.analyze(trades), [trades]);

    // Equity curve data
    const equityCurveData = useMemo(() => {
        let cumulative = 0;
        const sorted = [...trades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        return sorted.map((t, idx) => {
            cumulative += t.pnl || 0;
            return {
                index: idx + 1,
                date: new Date(t.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                pnl: cumulative
            };
        });
    }, [trades]);

    // Top trades (max 5 sorted by PnL descending)
    const topTrades = useMemo(() => {
        return [...trades]
            .sort((a, b) => (b.pnl || 0) - (a.pnl || 0))
            .slice(0, 5);
    }, [trades]);

    // Win / Loss donut chart data
    const winLossData = useMemo(() => {
        let wins = 0;
        let losses = 0;
        let be = 0;

        trades.forEach(t => {
            const p = t.pnl || 0;
            if (p > 0) wins++;
            else if (p < 0) losses++;
            else be++;
        });

        return [
            { name: 'Wins', value: wins, color: '#00d4aa' },
            { name: 'Losses', value: losses, color: '#ef4444' },
            { name: 'BE', value: be, color: '#64748b' }
        ].filter(d => d.value > 0);
    }, [trades]);

    // Strategy vs PnL data
    const strategyData = useMemo(() => {
        const map: Record<string, number> = {};
        trades.forEach(t => {
            const setup = t.setup || 'Unknown';
            map[setup] = (map[setup] || 0) + (t.pnl || 0);
        });

        return Object.entries(map).map(([name, pnl]) => ({
            name,
            pnl
        })).sort((a, b) => b.pnl - a.pnl);
    }, [trades]);

    // Daily PnL chart data
    const dailyPnLData = useMemo(() => {
        const map: Record<string, number> = {};
        trades.forEach(t => {
            map[t.date] = (map[t.date] || 0) + (t.pnl || 0);
        });

        return Object.entries(map).map(([date, pnl]) => ({
            date: new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            pnl
        })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(-10); // last 10 days
    }, [trades]);

    // Most common mistakes
    const commonMistakes = useMemo(() => {
        const map: Record<string, { count: number; cost: number }> = {};
        trades.forEach(t => {
            const p = t.pnl || 0;
            if (t.mistakes) {
                t.mistakes.forEach(m => {
                    if (!map[m]) map[m] = { count: 0, cost: 0 };
                    map[m].count++;
                    if (p < 0) {
                        map[m].cost += Math.abs(p);
                    }
                });
            }
        });

        return Object.entries(map).map(([name, val]) => ({
            name,
            count: val.count,
            cost: val.cost
        })).sort((a, b) => b.cost - a.cost).slice(0, 5);
    }, [trades]);

    const recentTrades = useMemo(() => {
        return [...trades]
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, 5);
    }, [trades]);

    if (loading) {
        return (
            <div className="w-full h-96 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-10 h-10 rounded-full border-4 border-t-[#3b82f6] border-[#1c2333] animate-spin" />
                    <span className="text-xs text-[#64748b] uppercase font-bold tracking-widest">Loading Dashboard...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="page-shell space-y-5 pb-24 tab-content">
            {/* Header */}
            <PageHeader
                title="Trading Journal Dashboard"
                subtitle="High-performance tracking and behavioral analytics"
                rightControls={
                    <div className="flex items-center gap-2">
                        <SyncSandboxTradesButton />
                        {onNewTrade && (
                            <button
                                onClick={onNewTrade}
                                className="px-4 py-2 bg-[#3b82f6] hover:bg-[#3b82f6]/90 active:scale-95 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-blue-500/20 transition-all duration-150"
                            >
                                <Plus size={14} /> Record Trade
                            </button>
                        )}
                    </div>
                }
            />

            {/* Metric Cards Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    label="Net P&L"
                    value={formatCurrency(stats.totalPnL)}
                    icon={BarChart3}
                    iconColor={stats.totalPnL >= 0 ? '#00d4aa' : '#ef4444'}
                    iconBg={stats.totalPnL >= 0 ? 'rgba(0,212,170,0.12)' : 'rgba(239,68,68,0.12)'}
                    progressColor={stats.totalPnL >= 0 ? '#00d4aa' : '#ef4444'}
                />
                <MetricCard
                    label="Win Rate"
                    value={`${stats.winRate.toFixed(1)}%`}
                    icon={Target}
                    iconColor="#3b82f6"
                    iconBg="rgba(59,130,246,0.12)"
                    progressColor="#3b82f6"
                />
                <MetricCard
                    label="Avg. Risk / Reward"
                    value={`1:${stats.avgRR.toFixed(2)}`}
                    icon={Brain}
                    iconColor="#8b5cf6"
                    iconBg="rgba(139,92,246,0.12)"
                    progressColor="#8b5cf6"
                />
                <MetricCard
                    label="Trades This Month"
                    value={stats.tradesThisMonth}
                    icon={Clipboard}
                    iconColor="#f59e0b"
                    iconBg="rgba(245,158,11,0.12)"
                    progressColor="#f59e0b"
                />
            </div>

            {/* Confidence Index widget */}
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
                <GradientProgressBar
                    value={stats.confidenceIndex}
                    label="Discipline Index (Zen / Emotional Ratio)"
                />
                <p className="text-[11px] text-[#64748b] mt-2 leading-relaxed">
                    Based on entry and exit emotional tags. Zen trading prevents compulsion and over-trading losses.
                </p>
            </div>

            {/* Domain 4.2 & 4.3 ML Behavioral Analytics Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Domain 4.2: Optimal Entry Time Windows */}
                <div className="bg-slate-900/60 backdrop-blur-xl border border-indigo-500/20 rounded-2xl p-5 space-y-3 shadow-lg">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <Clock className="w-4 h-4 text-indigo-400" />
                            Best Entry Time Windows (Domain 4.2 ML)
                        </h3>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase tracking-wider">
                            Intraday Heatmap
                        </span>
                    </div>
                    {timingSlots.length === 0 ? (
                        <div className="text-xs text-slate-500 py-4 text-center">Log trades with entry times to populate timing heatmap.</div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                            {timingSlots.map((slot, idx) => (
                                <div
                                    key={idx}
                                    className={`p-2.5 rounded-xl border flex flex-col justify-between ${
                                        slot.isOptimal
                                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                            : 'bg-white/5 border-white/10 text-slate-300'
                                    }`}
                                >
                                    <div className="text-[10px] font-mono font-bold text-slate-400">{slot.timeSlot}</div>
                                    <div className="text-xs font-bold mt-1">{(slot.winRate * 100).toFixed(0)}% Win Rate</div>
                                    <div className="text-[9px] text-slate-500 font-mono mt-0.5">{slot.tradeCount} trades · {formatCurrency(slot.avgPnl)}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Domain 4.3: Mood vs Performance Chart */}
                <div className="bg-slate-900/60 backdrop-blur-xl border border-indigo-500/20 rounded-2xl p-5 space-y-3 shadow-lg">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <Heart className="w-4 h-4 text-rose-400" />
                            Mood vs Performance (Domain 4.3 ML)
                        </h3>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase tracking-wider">
                            Psych Analytics
                        </span>
                    </div>
                    {moodStats.length === 0 ? (
                        <div className="text-xs text-slate-500 py-4 text-center">Log trades with mood tags to view psych stats.</div>
                    ) : (
                        <div className="space-y-2 pt-1">
                            {moodStats.map((stat, idx) => (
                                <div key={idx} className="bg-white/5 border border-white/10 rounded-xl p-2.5 flex items-center justify-between text-xs">
                                    <div>
                                        <span className="font-bold text-slate-200">{stat.mood}</span>
                                        <span className="text-[10px] text-slate-400 ml-2">({stat.tradeCount} trades)</span>
                                        {stat.recommendation && (
                                            <p className="text-[9px] text-amber-400 mt-0.5 font-medium">{stat.recommendation}</p>
                                        )}
                                    </div>
                                    <div className="text-right font-mono">
                                        <span className={`font-bold ${stat.winRate >= 0.5 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {(stat.winRate * 100).toFixed(0)}%
                                        </span>
                                        <span className="text-[9px] text-slate-500 block">{formatCurrency(stat.avgPnl)} avg</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Two columns (70/30 split) */}
            <div className="grid grid-cols-1 lg:grid-cols-10 gap-5">
                {/* Cumulative P&L chart card */}
                <div className="lg:col-span-7 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.3)] flex flex-col justify-between h-[360px]">
                    <div className="flex items-center justify-between mb-4 border-b border-white/[0.03] pb-2">
                        <h3 className="text-sm font-semibold text-[#e2e8f0] tracking-wide">Cumulative P&L Trend</h3>
                        <span className="text-[11px] font-mono text-[#64748b]">Overall Equity Curve</span>
                    </div>
                    {equityCurveData.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center">
                            <EmptyState icon={TrendingUp} title="No Trade Data" subtitle="Record trades to populate the equity curve." />
                        </div>
                    ) : (
                        <div className="flex-1 min-h-0 w-full">
                            <SafeChartContainer>
                                <AreaChart data={equityCurveData}>
                                    <defs>
                                        <linearGradient id="colorPnL" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={stats.totalPnL >= 0 ? "#00d4aa" : "#ef4444"} stopOpacity={0.15}/>
                                            <stop offset="95%" stopColor={stats.totalPnL >= 0 ? "#00d4aa" : "#ef4444"} stopOpacity={0.01}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" />
                                    <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(val) => `₹${val}`} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: '8px' }}
                                        labelStyle={{ color: '#64748b', fontSize: '11px', fontWeight: 'bold' }}
                                        itemStyle={{ color: '#e2e8f0', fontSize: '12px' }}
                                        formatter={(value: any) => [`₹${value.toLocaleString()}`, 'Cumulative P&L']}
                                    />
                                    <Area type="monotone" dataKey="pnl" stroke={stats.totalPnL >= 0 ? "#00d4aa" : "#ef4444"} strokeWidth={2} fillOpacity={1} fill="url(#colorPnL)" />
                                </AreaChart>
                            </SafeChartContainer>
                        </div>
                    )}
                </div>

                {/* Top Trades card */}
                <div className="lg:col-span-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.3)] flex flex-col h-[360px]">
                    <div className="flex items-center justify-between mb-4 border-b border-white/[0.03] pb-2">
                        <h3 className="text-sm font-semibold text-[#e2e8f0] tracking-wide">Top Profitable Trades</h3>
                        <span className="text-[11px] font-mono text-[#64748b]">Best Performers</span>
                    </div>
                    {topTrades.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center">
                            <EmptyState icon={Target} title="No Closed Trades" subtitle="Closed trades will be ranked here." />
                        </div>
                    ) : (
                        <div className="flex-1 overflow-y-auto space-y-2.5">
                            {topTrades.map((t, idx) => (
                                <div key={t.id ?? idx} className="flex items-center justify-between p-2.5 bg-white/[0.02] border border-white/[0.03] rounded-lg">
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-white truncate">{t.ticker}</p>
                                        <p className="text-[9px] text-[#64748b] mt-0.5">{new Date(t.date).toLocaleDateString()}</p>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xs font-mono font-bold text-[#00d4aa]">+{formatCurrency(t.pnl || 0)}</span>
                                        <p className="text-[9px] text-[#64748b] mt-0.5">R:R 1:{t.riskRewardRatio?.toFixed(1) || '0'}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Two columns (50/50) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Win/Loss Distribution (donut chart) */}
                <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.3)] h-[280px] flex flex-col">
                    <h3 className="text-sm font-semibold text-[#e2e8f0] tracking-wide mb-4 border-b border-white/[0.03] pb-2">Outcome Distribution</h3>
                    {winLossData.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center">
                            <EmptyState icon={Target} title="No Data" subtitle="Distribution will be shown once trades are logged." />
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="w-[180px] h-[180px] relative">
                                <SafeChartContainer>
                                    <PieChart>
                                        <Pie
                                            data={winLossData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={50}
                                            outerRadius={65}
                                            paddingAngle={3}
                                            dataKey="value"
                                        >
                                            {winLossData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Pie>
                                    </PieChart>
                                </SafeChartContainer>
                                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                    <span className="text-xs text-[#64748b] uppercase tracking-wider">Win Rate</span>
                                    <span className="text-xl font-bold text-white">{stats.winRate.toFixed(0)}%</span>
                                </div>
                            </div>
                            <div className="ml-6 space-y-2">
                                {winLossData.map((d, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                                        <span className="text-xs text-[#e2e8f0] font-semibold">{d.name}</span>
                                        <span className="text-xs text-[#64748b]">({d.value} trades)</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Strategy vs P&L (bar chart) */}
                <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.3)] h-[280px] flex flex-col">
                    <h3 className="text-sm font-semibold text-[#e2e8f0] tracking-wide mb-4 border-b border-white/[0.03] pb-2">Strategy Performance</h3>
                    {strategyData.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center">
                            <EmptyState icon={Target} title="No Strategies" subtitle="Link setups to trades to see profitability." />
                        </div>
                    ) : (
                        <div className="flex-1 min-h-0 w-full">
                            <SafeChartContainer>
                                <BarChart data={strategyData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" />
                                    <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: '8px' }}
                                        labelStyle={{ color: '#64748b', fontSize: '11px', fontWeight: 'bold' }}
                                        formatter={(value: any) => [`₹${value.toLocaleString()}`, 'Net P&L']}
                                    />
                                    <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                                        {strategyData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#00d4aa' : '#ef4444'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </SafeChartContainer>
                        </div>
                    )}
                </div>
            </div>

            {/* Two columns (50/50) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Most Common Mistakes */}
                <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.3)] h-[300px] flex flex-col">
                    <h3 className="text-sm font-semibold text-[#e2e8f0] tracking-wide mb-4 border-b border-white/[0.03] pb-2">Most Expensive Mistakes</h3>
                    {commonMistakes.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center">
                            <EmptyState icon={AlertTriangle} title="Clean Slate!" subtitle="No trading mistakes logged yet." />
                        </div>
                    ) : (
                        <div className="flex-1 overflow-y-auto space-y-3">
                            {commonMistakes.map((m, idx) => (
                                <div key={idx} className="flex flex-col">
                                    <div className="flex items-center justify-between text-xs font-semibold mb-1">
                                        <span className="text-[#e2e8f0]">{m.name} <span className="text-[10px] text-[#64748b] font-normal">({m.count}x)</span></span>
                                        <span className="text-rose-500 font-bold">-₹{m.cost.toLocaleString()}</span>
                                    </div>
                                    <div className="w-full h-1.5 bg-[var(--bg-surface-2)] rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-rose-500 rounded-full"
                                            style={{
                                                width: `${Math.min(100, (m.cost / Math.max(1, commonMistakes[0].cost)) * 100)}%`
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Daily P&L (bar chart) */}
                <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.3)] h-[300px] flex flex-col">
                    <h3 className="text-sm font-semibold text-[#e2e8f0] tracking-wide mb-4 border-b border-white/[0.03] pb-2">Daily Profit / Loss</h3>
                    {dailyPnLData.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center">
                            <EmptyState icon={BarChart3} title="No Trading Data" subtitle="Daily breakdown will appear here." />
                        </div>
                    ) : (
                        <div className="flex-1 min-h-0 w-full">
                            <SafeChartContainer>
                                <BarChart data={dailyPnLData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" />
                                    <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: '8px' }}
                                        labelStyle={{ color: '#64748b', fontSize: '11px', fontWeight: 'bold' }}
                                        formatter={(value: any) => [`₹${value.toLocaleString()}`, 'Daily P&L']}
                                    />
                                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
                                    <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                                        {dailyPnLData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#00d4aa' : '#ef4444'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </SafeChartContainer>
                        </div>
                    )}
                </div>
            </div>

            {/* Trade History (full width) */}
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/[0.03]">
                    <h3 className="text-sm font-semibold text-[#e2e8f0] tracking-wide">Recent Logged Trades</h3>
                    <span className="text-[11px] text-[#64748b] font-mono">Last 5 records</span>
                </div>

                {recentTrades.length === 0 ? (
                    <EmptyState icon={Clipboard} title="No Trades Recorded" subtitle="Your trade history ledger is currently empty." />
                ) : (
                    <DataTable headers={['Date', 'Symbol', 'Direction', 'Entry Price', 'Exit Price', 'P&L', 'R:R', 'Strategy', 'Actions']}>
                        {recentTrades.map((t) => (
                            <tr key={t.id} className="hover:bg-white/[0.01] transition-colors">
                                <td className="px-4 py-3 text-xs font-mono font-medium">
                                    <div>{new Date(t.date).toLocaleDateString()}</div>
                                    {t.entryTime && (
                                        <div className="text-[10px] text-[#64748b] flex items-center gap-1 mt-0.5">
                                            <span>{t.entryTime}{t.exitTime && t.exitTime !== t.entryTime ? ` → ${t.exitTime}` : ''}</span>
                                        </div>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-xs font-bold text-white">{t.ticker}</td>
                                <td className="px-4 py-3 text-xs"><DirectionBadge direction={t.direction} /></td>
                                <td className="px-4 py-3 text-xs font-mono">₹{t.entryPrice?.toLocaleString() || '0'}</td>
                                <td className="px-4 py-3 text-xs font-mono">₹{t.exitPrice?.toLocaleString() || '0'}</td>
                                <td className={`px-4 py-3 text-xs font-mono font-bold ${(t.pnl || 0) >= 0 ? 'text-[#00d4aa]' : 'text-[#ef4444]'}`}>
                                    {(t.pnl || 0) >= 0 ? '+' : ''}₹{t.pnl?.toLocaleString() || '0'}
                                </td>
                                <td className="px-4 py-3 text-xs font-mono">1:{t.riskRewardRatio?.toFixed(1) || '0'}</td>
                                <td className="px-4 py-3 text-xs"><span className="text-xs text-[#94a3b8]">{t.setup || 'Manual'}</span></td>
                                <td className="px-4 py-3 text-xs">
                                    <div className="flex items-center gap-1.5">
                                        {onEditTrade && (
                                            <button
                                                onClick={() => onEditTrade(t)}
                                                className="px-2.5 py-1 rounded-lg bg-white/[0.03] hover:bg-[#3b82f6]/10 border border-white/[0.05] hover:border-[#3b82f6]/30 text-xs text-[#94a3b8] hover:text-[#3b82f6] font-bold transition-all"
                                            >
                                                View / Edit
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleDeleteTrade(t)}
                                            className="p-1 rounded-lg bg-white/[0.03] hover:bg-rose-500/10 border border-white/[0.05] hover:border-rose-500/30 text-slate-400 hover:text-rose-500 transition-all"
                                            title="Delete Trade"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </DataTable>
                )}
            </div>
        </div>
    );
};

export default JournalDashboardTab;
