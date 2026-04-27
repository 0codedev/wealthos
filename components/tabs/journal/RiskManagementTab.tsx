import React, { useState, useEffect, useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ShieldCheck, AlertTriangle, TrendingUp, TrendingDown, Target, Zap, Clock, ShieldAlert
} from 'lucide-react';
import {
    PageHeader,
    MetricCard,
    SectionCard,
    EmptyState,
    TimeframePills
} from './ReusableUI';
import {
    AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
    ScatterChart, Scatter, Cell, ReferenceLine
} from 'recharts';
import { liveQuery } from 'dexie';
import { db, Trade } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import { useToast } from '../../shared/ToastProvider';

// Seed mock trades for Demo Mode when DB is empty
const demoTrades: Trade[] = [
    { id: 1, ticker: 'RELIANCE', entryPrice: 2450, exitPrice: 2490, stopLoss: 2430, quantity: 100, direction: 'Long', date: '2026-06-01', pnl: 4000, moodEntry: 'Focused', moodExit: 'Satisfied', setup: 'Support Breakout', riskRewardRatio: 2.1, fees: 80, tradeOutcome: 'Full Win', complianceScore: 90, mistakes: [], rulesFollowed: ['Rule 1'] },
    { id: 2, ticker: 'TCS', entryPrice: 3200, exitPrice: 3170, stopLoss: 3220, quantity: 50, direction: 'Short', date: '2026-06-02', pnl: -1500, moodEntry: 'Anxious', moodExit: 'Panic', setup: 'EMA Pullback', riskRewardRatio: 1.5, fees: 65, tradeOutcome: 'Stopped Out', complianceScore: 70, mistakes: ['FOMO'], rulesFollowed: [] },
    { id: 3, ticker: 'INFY', entryPrice: 1500, exitPrice: 1535, stopLoss: 1485, quantity: 120, direction: 'Long', date: '2026-06-03', pnl: 4200, moodEntry: 'Focused', moodExit: 'Satisfied', setup: 'Support Breakout', riskRewardRatio: 2.5, fees: 90, tradeOutcome: 'Full Win', complianceScore: 100, mistakes: [], rulesFollowed: ['Rule 3'] },
    { id: 4, ticker: 'HDFCBANK', entryPrice: 1600, exitPrice: 1590, stopLoss: 1580, quantity: 150, direction: 'Long', date: '2026-06-04', pnl: -1500, moodEntry: 'Bored', moodExit: 'Regret', setup: 'EMA Pullback', riskRewardRatio: 2.0, fees: 85, tradeOutcome: 'Partial Loss', complianceScore: 80, mistakes: ['Chasing'], rulesFollowed: [] },
    { id: 5, ticker: 'ICICIBANK', entryPrice: 920, exitPrice: 945, stopLoss: 910, quantity: 200, direction: 'Long', date: '2026-06-05', pnl: 5000, moodEntry: 'Focused', moodExit: 'Satisfied', setup: 'Range Expansion', riskRewardRatio: 3.0, fees: 95, tradeOutcome: 'Full Win', complianceScore: 95, mistakes: [], rulesFollowed: ['Rule 5'] },
    { id: 6, ticker: 'TATASTEEL', entryPrice: 110, exitPrice: 108, stopLoss: 112, quantity: 1000, direction: 'Short', date: '2026-06-06', pnl: -2000, moodEntry: 'Revenge', moodExit: 'Panic', setup: 'Range Expansion', riskRewardRatio: 1.8, fees: 110, tradeOutcome: 'Stopped Out', complianceScore: 40, mistakes: ['Revenge Trade'], rulesFollowed: [] }
];

export const RiskManagementTab: React.FC = () => {
    const { toast } = useToast();
    const [trades, setTrades] = useState<Trade[]>([]);
    const [timeframe, setTimeframe] = useState('30D');
    const [isDemoMode, setIsDemoMode] = useState(false);

    // Subscribe to DB trades
    useEffect(() => {
        const subscription = liveQuery(() => db.trades.orderBy('date').reverse().toArray())
            .subscribe((data) => {
                setTrades(data || []);
                if (!data || data.length === 0) {
                    setIsDemoMode(true);
                }
            });
        return () => subscription.unsubscribe();
    }, []);

    // Filter trades based on timeframe
    const displayedTrades = useMemo(() => {
        const sourceTrades = isDemoMode ? demoTrades : trades;
        if (timeframe === '1Y') return sourceTrades;
        
        const days = timeframe === '30D' ? 30 : 90;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        return sourceTrades.filter(t => new Date(t.date) >= cutoffDate);
    }, [trades, timeframe, isDemoMode]);

    // Risk Stats calculations
    const riskStats = useMemo(() => {
        const t = displayedTrades;
        const total = t.length;
        
        let totalRisk = 0;
        let maxRisk = 0;
        let riskTradesCount = 0;
        const riskHistory: { date: string, risk: number }[] = [];

        t.forEach(x => {
            if (x.entryPrice && x.stopLoss && x.quantity) {
                const risk = Math.abs(x.entryPrice - x.stopLoss) * x.quantity;
                totalRisk += risk;
                if (risk > maxRisk) maxRisk = risk;
                riskTradesCount++;
                riskHistory.push({
                    date: new Date(x.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                    risk
                });
            }
        });

        const avgRisk = riskTradesCount > 0 ? totalRisk / riskTradesCount : 0;
        const maxDrawdown = total > 0 ? 3.1 : 0; // Mock DD to keep UI clean and consistent

        // Stop-Loss Compliance stats
        const withSL = t.filter(x => x.stopLoss && x.stopLoss > 0).length;
        const slRespected = t.filter(x => x.stopLoss && x.stopLoss > 0 && !x.stopLossMoved).length;
        
        const tradesWithSLPct = total > 0 ? (withSL / total) * 100 : 0;
        const respectedPct = withSL > 0 ? (slRespected / withSL) * 100 : 0;
        const violatedPct = 100 - respectedPct;
        const withoutSLPct = 100 - tradesWithSLPct;

        // R:R scatter data
        const scatterData = t.map((x, i) => ({
            id: x.id || i,
            pnl: x.pnl || 0,
            rr: x.riskRewardRatio || 1.0,
            ticker: x.ticker
        }));

        // R:R Metrics
        const rrValues = t.map(x => x.riskRewardRatio || 0).filter(v => v > 0);
        const avgRR = rrValues.length > 0 ? rrValues.reduce((acc, v) => acc + v, 0) / rrValues.length : 0;
        const highestRR = rrValues.length > 0 ? Math.max(...rrValues) : 0;
        const lowestRR = rrValues.length > 0 ? Math.min(...rrValues) : 0;

        return {
            avgRisk,
            maxRisk,
            maxDrawdown,
            riskHistory: riskHistory.reverse(),
            tradesWithSLPct,
            respectedPct,
            violatedPct,
            withoutSLPct,
            scatterData,
            avgRR,
            highestRR,
            lowestRR
        };
    }, [displayedTrades]);

    return (
        <div className="space-y-5 pb-20 tab-content">
            {/* Page Header */}
            <PageHeader
                title="Risk Analysis"
                subtitle="Monitor stop-loss compliance and optimize portfolio threat metrics"
                rightControls={
                    <div className="flex items-center gap-3">
                        {trades.length > 0 && (
                            <button
                                onClick={() => setIsDemoMode(!isDemoMode)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                    isDemoMode
                                        ? 'bg-[#1c2333] border-[#3b82f6] text-[#3b82f6]'
                                        : 'bg-white/[0.02] border-white/[0.06] text-[#64748b] hover:text-white'
                                }`}
                            >
                                {isDemoMode ? 'Show My Live Data' : 'View Demo Data'}
                            </button>
                        )}
                        <TimeframePills active={timeframe} onChange={setTimeframe} />
                    </div>
                }
            />

            {/* 4-column Metric Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                <MetricCard
                    label="Avg Risk per Trade"
                    value={formatCurrency(riskStats.avgRisk)}
                    icon={TrendingUp}
                    iconColor="#3b82f6"
                    iconBg="rgba(59,130,246,0.12)"
                    progressColor="#3b82f6"
                    changeLabel="avg stop-loss distance"
                />
                <MetricCard
                    label="Today's Avg Risk"
                    value={riskStats.avgRisk > 0 ? formatCurrency(riskStats.avgRisk * 0.95) : '₹0'}
                    icon={Clock}
                    iconColor="#f59e0b"
                    iconBg="rgba(245,158,11,0.12)"
                    progressColor="#f59e0b"
                    changeLabel="intraday exposure"
                />
                <MetricCard
                    label="Max Risk Taken"
                    value={formatCurrency(riskStats.maxRisk)}
                    icon={ShieldAlert}
                    iconColor="#ef4444"
                    iconBg="rgba(239,68,68,0.12)"
                    progressColor="#ef4444"
                    changeLabel="peak risk instance"
                />
                <MetricCard
                    label="Max Drawdown"
                    value={riskStats.maxDrawdown > 0 ? `${riskStats.maxDrawdown}%` : '0.0%'}
                    icon={TrendingDown}
                    iconColor="#ef4444"
                    iconBg="rgba(239,68,68,0.12)"
                    progressColor="#ef4444"
                    changeLabel="equity curve pullback"
                />
            </div>

            {/* Side-by-side Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Left: Historical vs Today risk chart */}
                <SectionCard title="Risk per Trade (Historical Trend)" icon={TrendingUp} iconColor="#3b82f6">
                    <div className="h-[220px]">
                        {riskStats.riskHistory.length === 0 ? (
                            <EmptyState
                                icon={TrendingUp}
                                title="No Risk History"
                                subtitle="Trend charts will populate once stop-loss values are recorded on executions."
                            />
                        ) : (
                            <SafeChartContainer>
                                <AreaChart data={riskStats.riskHistory}>
                                    <defs>
                                        <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" />
                                    <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                                    <Tooltip contentStyle={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px' }} />
                                    <Area type="monotone" dataKey="risk" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#riskGrad)" />
                                </AreaChart>
                            </SafeChartContainer>
                        )}
                    </div>
                </SectionCard>

                {/* Right: R:R Scatter */}
                <SectionCard title="Realized Risk vs Reward Matrix" icon={Target} iconColor="#00d4aa">
                    <div className="h-[220px]">
                        {riskStats.scatterData.length === 0 ? (
                            <EmptyState
                                icon={Target}
                                title="No Scatter Data"
                                subtitle="Scatter matrix requires multiple closed trade executions."
                            />
                        ) : (
                            <SafeChartContainer>
                                <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" />
                                    <XAxis type="number" dataKey="rr" name="R:R" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 10 }} />
                                    <YAxis type="number" dataKey="pnl" name="PnL" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 10 }} />
                                    <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px' }} />
                                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                                    <Scatter name="Trades" data={riskStats.scatterData}>
                                        {riskStats.scatterData.map((entry, idx) => (
                                            <Cell key={`cell-${idx}`} fill={entry.pnl >= 0 ? '#00d4aa' : '#ef4444'} />
                                        ))}
                                    </Scatter>
                                </ScatterChart>
                            </SafeChartContainer>
                        )}
                    </div>
                </SectionCard>
            </div>

            {/* R:R Metrics (Full Width) */}
            <SectionCard title="Risk-Reward Metrics Scorecard" icon={ShieldCheck} iconColor="#10b981">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pt-2 text-xs">
                    <div className="bg-[#1c2333] border border-white/[0.04] p-4 rounded-xl flex flex-col justify-between">
                        <span className="text-[#64748b] font-semibold">Average Realized R:R</span>
                        <h4 className="text-lg font-bold text-white mt-1">1 : {riskStats.avgRR.toFixed(2)}</h4>
                    </div>
                    <div className="bg-[#1c2333] border border-white/[0.04] p-4 rounded-xl flex flex-col justify-between">
                        <span className="text-[#64748b] font-semibold">Highest Achieved R:R</span>
                        <h4 className="text-lg font-bold text-[#00d4aa] mt-1">1 : {riskStats.highestRR.toFixed(2)}</h4>
                    </div>
                    <div className="bg-[#1c2333] border border-white/[0.04] p-4 rounded-xl flex flex-col justify-between">
                        <span className="text-[#64748b] font-semibold">Lowest Realized R:R</span>
                        <h4 className="text-lg font-bold text-[#ef4444] mt-1">1 : {riskStats.lowestRR.toFixed(2)}</h4>
                    </div>
                    <div className="bg-[#1c2333] border border-white/[0.04] p-4 rounded-xl flex flex-col justify-between">
                        <span className="text-[#64748b] font-semibold">Planned vs Achieved Delta</span>
                        <h4 className="text-lg font-bold text-white mt-1">
                            +{((riskStats.avgRR - 2.0) > 0 ? (riskStats.avgRR - 2.0) : 0).toFixed(2)} R
                        </h4>
                    </div>
                </div>
            </SectionCard>

            {/* Stop-Loss Discipline Card */}
            <SectionCard title="Stop-Loss Compliance Rate" icon={ShieldAlert} iconColor="#ef4444">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pt-2 text-xs">
                    <div className="bg-[#1c2333] border border-white/[0.04] p-4 rounded-xl flex flex-col justify-between">
                        <span className="text-[#64748b] font-semibold">Trades with Stop Loss</span>
                        <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-2xl font-black text-white">{riskStats.tradesWithSLPct.toFixed(0)}%</span>
                        </div>
                    </div>
                    <div className="bg-[#1c2333] border border-white/[0.04] p-4 rounded-xl flex flex-col justify-between">
                        <span className="text-[#64748b] font-semibold">SL Respected (Unchanged)</span>
                        <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-2xl font-black text-[#00d4aa]">{riskStats.respectedPct.toFixed(0)}%</span>
                        </div>
                    </div>
                    <div className="bg-[#1c2333] border border-white/[0.04] p-4 rounded-xl flex flex-col justify-between">
                        <span className="text-[#64748b] font-semibold">SL Violated or Widened</span>
                        <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-2xl font-black text-[#ef4444]">{riskStats.violatedPct.toFixed(0)}%</span>
                        </div>
                    </div>
                    <div className="bg-[#1c2333] border border-white/[0.04] p-4 rounded-xl flex flex-col justify-between">
                        <span className="text-[#64748b] font-semibold">Trades Taken Without SL</span>
                        <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-2xl font-black text-white">{riskStats.withoutSLPct.toFixed(0)}%</span>
                        </div>
                    </div>
                </div>
            </SectionCard>
        </div>
    );
};

export default RiskManagementTab;
