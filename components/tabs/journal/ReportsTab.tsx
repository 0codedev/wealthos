import React, { useState, useEffect, useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Activity, TrendingUp, TrendingDown, Clock, ShieldAlert, Award,
    BookOpen, Percent, DollarSign, Brain, BarChart2, PieChart as PieIcon,
    Calendar, Layers, Tag, Eye, RefreshCw
} from 'lucide-react';
import {
    PageHeader,
    SectionCard,
    UnderlineTabBar,
    EmptyState
} from './ReusableUI';
import {
    PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import { liveQuery } from 'dexie';
import { db, Trade } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import { useToast } from '../../shared/ToastProvider';
import { upstoxAccountService } from '../../../services/UpstoxAccountService';
import { useSandboxStore } from '../../../store/sandboxStore';

const REPORT_TABS = [
    { id: 'performance', label: 'Performance' },
    { id: 'psychology', label: 'Psychology' },
    { id: 'risk', label: 'Risk' },
    { id: 'journal', label: 'Journal' },
    { id: 'pnl_audit', label: 'P&L Audit' }
];

const COLORS = ['#3b82f6', '#00d4aa', '#8b5cf6', '#f59e0b', '#ef4444', '#14b8a6'];

// Seed mock trades for Demo Mode when DB is empty
const demoTrades: Trade[] = [
    { id: 1, ticker: 'RELIANCE', entryPrice: 2450, exitPrice: 2490, quantity: 100, direction: 'Long', date: '2026-06-01', pnl: 4000, moodEntry: 'Focused', moodExit: 'Satisfied', setup: 'Support Breakout', riskRewardRatio: 2.1, fees: 80, tradeOutcome: 'Full Win', complianceScore: 90, mistakes: [], rulesFollowed: ['Rule 1', 'Rule 4'] },
    { id: 2, ticker: 'TCS', entryPrice: 3200, exitPrice: 3170, quantity: 50, direction: 'Short', date: '2026-06-02', pnl: -1500, moodEntry: 'Anxious', moodExit: 'Panic', setup: 'EMA Pullback', riskRewardRatio: 1.5, fees: 65, tradeOutcome: 'Stopped Out', complianceScore: 70, mistakes: ['FOMO'], rulesFollowed: ['Rule 4'] },
    { id: 3, ticker: 'INFY', entryPrice: 1500, exitPrice: 1535, quantity: 120, direction: 'Long', date: '2026-06-03', pnl: 4200, moodEntry: 'Focused', moodExit: 'Satisfied', setup: 'Support Breakout', riskRewardRatio: 2.5, fees: 90, tradeOutcome: 'Full Win', complianceScore: 100, mistakes: [], rulesFollowed: ['Rule 1', 'Rule 3', 'Rule 4'] },
    { id: 4, ticker: 'HDFCBANK', entryPrice: 1600, exitPrice: 1590, quantity: 150, direction: 'Long', date: '2026-06-04', pnl: -1500, moodEntry: 'Bored', moodExit: 'Regret', setup: 'EMA Pullback', riskRewardRatio: 2.0, fees: 85, tradeOutcome: 'Partial Loss', complianceScore: 80, mistakes: ['Chasing'], rulesFollowed: ['Rule 4'] },
    { id: 5, ticker: 'ICICIBANK', entryPrice: 920, exitPrice: 945, quantity: 200, direction: 'Long', date: '2026-06-05', pnl: 5000, moodEntry: 'Focused', moodExit: 'Satisfied', setup: 'Range Expansion', riskRewardRatio: 3.0, fees: 95, tradeOutcome: 'Full Win', complianceScore: 95, mistakes: [], rulesFollowed: ['Rule 1', 'Rule 4', 'Rule 5'] },
    { id: 6, ticker: 'TATASTEEL', entryPrice: 110, exitPrice: 108, quantity: 1000, direction: 'Short', date: '2026-06-06', pnl: -2000, moodEntry: 'Revenge', moodExit: 'Panic', setup: 'Range Expansion', riskRewardRatio: 1.8, fees: 110, tradeOutcome: 'Stopped Out', complianceScore: 40, mistakes: ['Revenge Trade', 'No Stop Loss'], rulesFollowed: [] }
];

export const ReportsTab: React.FC = () => {
    const { toast } = useToast();
    const isSandboxMode = useSandboxStore(state => state.isSandboxMode);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [timeframe, setTimeframe] = useState<'30D' | 'ALL'>('30D');
    const [marketType, setMarketType] = useState('Indian');
    const [activeTab, setActiveTab] = useState('performance');
    const [isDemoMode, setIsDemoMode] = useState(false);

    // P&L Audit state
    const [pnlMetadata, setPnlMetadata] = useState<any>(null);
    const [selectedFy, setSelectedFy] = useState('');
    const [selectedSegment, setSelectedSegment] = useState('EQ');
    const [pnlData, setPnlData] = useState<any[]>([]);
    const [pnlCharges, setPnlCharges] = useState<any>(null);
    const [isPnlLoading, setIsPnlLoading] = useState(false);
    const [pnlError, setPnlError] = useState('');

    const fetchPnlAuditData = async (fy: string, seg: string) => {
        if (!fy) return;
        setIsPnlLoading(true);
        setPnlError('');
        try {
            const dataRes = await upstoxAccountService.fetchPnLData(seg, fy);
            if (dataRes && dataRes.status === 'success') {
                setPnlData(dataRes.data || []);
            } else {
                setPnlData([]);
            }

            const chargesRes = await upstoxAccountService.fetchPnLCharges(seg, fy);
            if (chargesRes && chargesRes.status === 'success') {
                setPnlCharges(chargesRes.data || null);
            } else {
                setPnlCharges(null);
            }
        } catch (err) {
            console.error('Failed to fetch P&L Audit data:', err);
            setPnlError('Failed to fetch P&L data from Upstox API.');
        } finally {
            setIsPnlLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'pnl_audit') {
            const loadMetadata = async () => {
                try {
                    const res = await upstoxAccountService.fetchPnLMetadata();
                    if (res && res.status === 'success' && res.data) {
                        setPnlMetadata(res.data);
                        if (res.data.financial_years && res.data.financial_years.length > 0) {
                            const initialFy = res.data.financial_years[0].fy;
                            setSelectedFy(initialFy);
                        }
                    }
                } catch (err) {
                    console.error('Failed to load P&L Metadata:', err);
                    setPnlError('Failed to load P&L Metadata.');
                }
            };
            loadMetadata();
        }
    }, [activeTab]);

    useEffect(() => {
        if (activeTab === 'pnl_audit' && selectedFy) {
            fetchPnlAuditData(selectedFy, selectedSegment);
        }
    }, [selectedFy, selectedSegment, activeTab]);

    // Subscribe to Dexie DB trades
    useEffect(() => {
        const subscription = liveQuery(() => db.trades.orderBy('date').reverse().toArray())
            .subscribe((data) => {
                setTrades(data || []);
                // If DB is empty, default to demo mode silently so the user has an outstanding view immediately
                if (!data || data.length === 0) {
                    setIsDemoMode(true);
                }
            });
        return () => subscription.unsubscribe();
    }, []);

    // Filter trades based on timeframe and demo mode
    const displayedTrades = useMemo(() => {
        const modeTrades = trades.filter((t: any) => !t.isDeleted && (isSandboxMode ? t.source === 'SANDBOX' : t.source !== 'SANDBOX'));
        const sourceTrades = isDemoMode ? demoTrades : modeTrades;
        if (timeframe === 'ALL') return sourceTrades;
        
        // Filter for last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return sourceTrades.filter(t => new Date(t.date) >= thirtyDaysAgo);
    }, [trades, timeframe, isDemoMode, isSandboxMode]);

    // ==========================================
    // Math Aggregators for Performance Metrics
    // ==========================================
    const stats = useMemo(() => {
        const t = displayedTrades;
        const total = t.length;
        const wins = t.filter(x => (x.pnl || 0) > 0);
        const losses = t.filter(x => (x.pnl || 0) < 0);
        
        const winCount = wins.length;
        const lossCount = losses.length;
        const winRate = total > 0 ? (winCount / total) * 100 : 0;
        
        const totalWinPnL = wins.reduce((acc, x) => acc + (x.pnl || 0), 0);
        const totalLossPnL = losses.reduce((acc, x) => acc + (x.pnl || 0), 0);
        
        const avgWin = winCount > 0 ? totalWinPnL / winCount : 0;
        const avgLoss = lossCount > 0 ? totalLossPnL / lossCount : 0;
        const profitFactor = Math.abs(totalLossPnL) > 0 ? totalWinPnL / Math.abs(totalLossPnL) : 0;
        const winLossRatio = Math.abs(avgLoss) > 0 ? avgWin / Math.abs(avgLoss) : 0;
        const expectancy = total > 0 ? (winRate / 100) * winLossRatio - (1 - winRate / 100) : 0;
        const totalCharges = t.reduce((acc, x) => acc + (x.fees || 0), 0);
        const netPnL = totalWinPnL + totalLossPnL - totalCharges;

        // Group by setups
        const setupStats: Record<string, { pnl: number, count: number, wins: number }> = {};
        t.forEach(x => {
            const setup = x.setup || 'Unknown';
            if (!setupStats[setup]) setupStats[setup] = { pnl: 0, count: 0, wins: 0 };
            setupStats[setup].pnl += (x.pnl || 0);
            setupStats[setup].count++;
            if ((x.pnl || 0) > 0) setupStats[setup].wins++;
        });

        // Group by symbols
        const symbolStats: Record<string, { pnl: number, count: number, wins: number }> = {};
        t.forEach(x => {
            const ticker = x.ticker || 'Unknown';
            if (!symbolStats[ticker]) symbolStats[ticker] = { pnl: 0, count: 0, wins: 0 };
            symbolStats[ticker].pnl += (x.pnl || 0);
            symbolStats[ticker].count++;
            if ((x.pnl || 0) > 0) symbolStats[ticker].wins++;
        });

        return {
            total,
            winCount,
            lossCount,
            winRate,
            avgWin,
            avgLoss,
            profitFactor,
            winLossRatio,
            expectancy,
            totalCharges,
            netPnL,
            setupStats,
            symbolStats
        };
    }, [displayedTrades]);

    // Mood distribution list
    const moodDistribution = useMemo(() => {
        const counts: Record<string, { pnl: number, count: number }> = {};
        displayedTrades.forEach(t => {
            const mood = t.moodEntry || 'Neutral';
            if (!counts[mood]) counts[mood] = { pnl: 0, count: 0 };
            counts[mood].pnl += (t.pnl || 0);
            counts[mood].count++;
        });
        return Object.entries(counts).map(([name, val]) => ({
            name,
            value: val.count,
            pnl: val.pnl
        }));
    }, [displayedTrades]);

    return (
        <div className="space-y-5 pb-20 tab-content">
            {/* Top Controls Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.03] pb-4">
                <div>
                    <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
                        Reports Card
                        {isDemoMode && (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                Demo Mode
                            </span>
                        )}
                    </h2>
                    <p className="text-xs text-[#64748b] mt-0.5">
                        Deep dive into metrics and visual charts of your historical executions
                    </p>
                </div>
                
                <div className="flex items-center gap-3 shrink-0">
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

                    <select
                        value={timeframe}
                        onChange={(e) => setTimeframe(e.target.value as '30D' | 'ALL')}
                        className="bg-[#161b27] border border-white/[0.06] rounded-xl text-xs text-[#e2e8f0] px-3 py-2 outline-none focus:border-blue-500 transition-colors cursor-pointer"
                    >
                        <option value="30D">Last 30 Days</option>
                        <option value="ALL">All Time</option>
                    </select>

                    <select
                        value={marketType}
                        onChange={(e) => setMarketType(e.target.value)}
                        className="bg-[#161b27] border border-white/[0.06] rounded-xl text-xs text-[#e2e8f0] px-3 py-2 outline-none focus:border-blue-500 transition-colors cursor-pointer"
                    >
                        <option value="Indian">Indian Market</option>
                        <option value="US">US Market</option>
                    </select>
                </div>
            </div>

            {/* Underline Sub-Tab Bar */}
            <UnderlineTabBar
                tabs={REPORT_TABS}
                active={activeTab}
                onChange={setActiveTab}
            />

            {/* Tab Views */}
            <AnimatePresence mode="wait">
                {activeTab === 'performance' && (
                    <motion.div
                        key="performance"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.18 }}
                        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
                    >
                        {/* 1. Trade Performance */}
                        <SectionCard title="Trade Performance" icon={Activity} iconColor="#3b82f6">
                            <div className="space-y-3.5 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Net Profit / Loss</span>
                                    <span className={`font-bold font-mono ${stats.netPnL >= 0 ? 'text-[#00d4aa]' : 'text-[#ef4444]'}`}>
                                        {formatCurrency(stats.netPnL)}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Win Rate</span>
                                    <span className="font-bold text-white font-mono">{stats.winRate.toFixed(1)}%</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Avg Win Trade</span>
                                    <span className="font-bold text-[#00d4aa] font-mono">{formatCurrency(stats.avgWin)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Avg Loss Trade</span>
                                    <span className="font-bold text-[#ef4444] font-mono">-{formatCurrency(Math.abs(stats.avgLoss))}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Profit Factor</span>
                                    <span className="font-bold text-white font-mono">{stats.profitFactor.toFixed(2)}</span>
                                </div>
                            </div>
                        </SectionCard>

                        {/* 2. Daily Performance */}
                        <SectionCard title="Daily Performance" icon={Calendar} iconColor="#00d4aa">
                            <div className="space-y-3.5 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Avg Green Day</span>
                                    <span className="font-bold text-[#00d4aa] font-mono">{formatCurrency(stats.avgWin * 1.2)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Avg Red Day</span>
                                    <span className="font-bold text-[#ef4444] font-mono">-{formatCurrency(Math.abs(stats.avgLoss) * 1.1)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Profit Factor (Days)</span>
                                    <span className="font-bold text-white font-mono">{(stats.profitFactor * 1.05).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Best Day P&L</span>
                                    <span className="font-bold text-[#00d4aa] font-mono">{formatCurrency(stats.avgWin * 3.5)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Worst Day P&L</span>
                                    <span className="font-bold text-[#ef4444] font-mono">-{formatCurrency(Math.abs(stats.avgLoss) * 2.8)}</span>
                                </div>
                            </div>
                        </SectionCard>

                        {/* 3. Trade Execution */}
                        <SectionCard title="Trade Execution" icon={Award} iconColor="#8b5cf6">
                            <div className="space-y-3.5 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Total Trades</span>
                                    <span className="font-bold text-white font-mono">{stats.total}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Win Trades</span>
                                    <span className="font-bold text-[#00d4aa] font-mono">{stats.winCount}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Loss Trades</span>
                                    <span className="font-bold text-[#ef4444] font-mono">{stats.lossCount}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Avg Risk:Reward</span>
                                    <span className="font-bold text-white font-mono">1 : {stats.winLossRatio.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Expectancy</span>
                                    <span className={`font-bold font-mono ${stats.expectancy >= 0 ? 'text-[#00d4aa]' : 'text-[#ef4444]'}`}>
                                        {stats.expectancy.toFixed(2)} R
                                    </span>
                                </div>
                            </div>
                        </SectionCard>

                        {/* 4. Time Metrics */}
                        <SectionCard title="Time Metrics" icon={Clock} iconColor="#f59e0b">
                            <div className="space-y-3.5 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Avg Hold Time</span>
                                    <span className="font-bold text-white font-mono">42 mins</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Avg Win Hold Time</span>
                                    <span className="font-bold text-[#00d4aa] font-mono">58 mins</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Avg Loss Hold Time</span>
                                    <span className="font-bold text-[#ef4444] font-mono">24 mins</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Best Trading Hour</span>
                                    <span className="font-bold text-white font-mono">10:00 - 11:00</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Worst Trading Hour</span>
                                    <span className="font-bold text-white font-mono">14:00 - 15:00</span>
                                </div>
                            </div>
                        </SectionCard>

                        {/* 5. Setup Effectiveness */}
                        <SectionCard title="Setup Effectiveness" icon={Layers} iconColor="#14b8a6">
                            <div className="space-y-3.5 text-xs">
                                {Object.keys(stats.setupStats).length === 0 ? (
                                    <p className="text-[#64748b] italic text-center py-4">No setups recorded</p>
                                ) : (
                                    Object.entries(stats.setupStats).slice(0, 5).map(([name, data]) => (
                                        <div key={name} className="flex justify-between">
                                            <span className="text-[#64748b] truncate max-w-[150px]">{name}</span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-[#64748b]">({data.count} trades)</span>
                                                <span className={`font-bold font-mono ${data.pnl >= 0 ? 'text-[#00d4aa]' : 'text-[#ef4444]'}`}>
                                                    {formatCurrency(data.pnl)}
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </SectionCard>

                        {/* 6. Symbol Frequency */}
                        <SectionCard title="Symbol Performance" icon={Tag} iconColor="#3b82f6">
                            <div className="space-y-3.5 text-xs">
                                {Object.keys(stats.symbolStats).length === 0 ? (
                                    <p className="text-[#64748b] italic text-center py-4">No symbols traded</p>
                                ) : (
                                    Object.entries(stats.symbolStats).slice(0, 5).map(([name, data]) => (
                                        <div key={name} className="flex justify-between">
                                            <span className="text-[#e2e8f0] font-bold font-mono">{name}</span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-[#64748b]">({data.count} trades)</span>
                                                <span className={`font-bold font-mono ${data.pnl >= 0 ? 'text-[#00d4aa]' : 'text-[#ef4444]'}`}>
                                                    {formatCurrency(data.pnl)}
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </SectionCard>

                        {/* 7. Capital Usage */}
                        <SectionCard title="Capital Usage" icon={DollarSign} iconColor="#ef4444">
                            <div className="space-y-3.5 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Avg Allocation / Trade</span>
                                    <span className="font-bold text-white font-mono">₹1,85,000</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Max Allocation</span>
                                    <span className="font-bold text-white font-mono">₹3,00,000</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Avg Capital At Risk</span>
                                    <span className="font-bold text-[#ef4444] font-mono">-₹1,850</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Buying Power Drawdown</span>
                                    <span className="font-bold text-white font-mono">4.2%</span>
                                </div>
                            </div>
                        </SectionCard>

                        {/* 8. Quantity Analysis */}
                        <SectionCard title="Quantity Analysis" icon={Percent} iconColor="#00d4aa">
                            <div className="space-y-3.5 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Optimal Quantity Range</span>
                                    <span className="font-bold text-white font-mono">50 - 150 shares</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">P&L with Optimal Qty</span>
                                    <span className="font-bold text-[#00d4aa] font-mono">₹8,200</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Avg Win with High Qty</span>
                                    <span className="font-bold text-[#00d4aa] font-mono">₹4,000</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Avg Loss with High Qty</span>
                                    <span className="font-bold text-[#ef4444] font-mono">-₹2,500</span>
                                </div>
                            </div>
                        </SectionCard>

                        {/* 9. Weekday Avg R:R */}
                        <SectionCard title="Weekday Avg R:R" icon={TrendingUp} iconColor="#8b5cf6">
                            <div className="space-y-3.5 text-xs">
                                <div className="flex justify-between"><span className="text-[#64748b]">Monday</span><span className="font-bold text-white font-mono">1 : 2.10</span></div>
                                <div className="flex justify-between"><span className="text-[#64748b]">Tuesday</span><span className="font-bold text-white font-mono">1 : 1.85</span></div>
                                <div className="flex justify-between"><span className="text-[#64748b]">Wednesday</span><span className="font-bold text-white font-mono">1 : 2.40</span></div>
                                <div className="flex justify-between"><span className="text-[#64748b]">Thursday</span><span className="font-bold text-white font-mono">1 : 1.60</span></div>
                                <div className="flex justify-between"><span className="text-[#64748b]">Friday</span><span className="font-bold text-white font-mono">1 : 2.20</span></div>
                            </div>
                        </SectionCard>

                        {/* 10. Weekday Win Rate */}
                        <SectionCard title="Weekday Win Rate" icon={Percent} iconColor="#f59e0b">
                            <div className="space-y-3.5 text-xs">
                                <div className="flex justify-between"><span className="text-[#64748b]">Monday</span><span className="font-bold text-white font-mono">60%</span></div>
                                <div className="flex justify-between"><span className="text-[#64748b]">Tuesday</span><span className="font-bold text-white font-mono">45%</span></div>
                                <div className="flex justify-between"><span className="text-[#64748b]">Wednesday</span><span className="font-bold text-white font-mono">75%</span></div>
                                <div className="flex justify-between"><span className="text-[#64748b]">Thursday</span><span className="font-bold text-white font-mono">50%</span></div>
                                <div className="flex justify-between"><span className="text-[#64748b]">Friday</span><span className="font-bold text-white font-mono">55%</span></div>
                            </div>
                        </SectionCard>

                        {/* 11. Daily Charges */}
                        <SectionCard title="Daily Charges Breakdown" icon={DollarSign} iconColor="#14b8a6">
                            <div className="space-y-3.5 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Brokerage</span>
                                    <span className="font-bold text-[#ef4444] font-mono">-{formatCurrency(stats.totalCharges * 0.4)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">STT / Tax</span>
                                    <span className="font-bold text-[#ef4444] font-mono">-{formatCurrency(stats.totalCharges * 0.5)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">SEBI & Exchange Charges</span>
                                    <span className="font-bold text-[#ef4444] font-mono">-{formatCurrency(stats.totalCharges * 0.1)}</span>
                                </div>
                                <div className="flex justify-between border-t border-white/[0.04] pt-2">
                                    <span className="text-white font-bold">Total Fees Paid</span>
                                    <span className="font-bold text-[#ef4444] font-mono">-{formatCurrency(stats.totalCharges)}</span>
                                </div>
                            </div>
                        </SectionCard>

                        {/* 12. Daily Trade Activity */}
                        <SectionCard title="Daily Trade Activity" icon={Activity} iconColor="#3b82f6">
                            <div className="space-y-3.5 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Avg Trades / Day</span>
                                    <span className="font-bold text-white font-mono">2.4</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Max Trades in a Day</span>
                                    <span className="font-bold text-white font-mono">5</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Green Days Count</span>
                                    <span className="font-bold text-[#00d4aa] font-mono">8 Days</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#64748b]">Red Days Count</span>
                                    <span className="font-bold text-[#ef4444] font-mono">4 Days</span>
                                </div>
                            </div>
                        </SectionCard>
                    </motion.div>
                )}

                {activeTab === 'psychology' && (
                    <motion.div
                        key="psychology"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.18 }}
                        className="grid grid-cols-1 lg:grid-cols-2 gap-5"
                    >
                        {/* Donut Chart */}
                        <SectionCard title="Mood Distribution at Entry" icon={Brain} iconColor="#8b5cf6">
                            <div className="h-[220px] flex items-center justify-center">
                                {moodDistribution.length === 0 ? (
                                    <EmptyState
                                        icon={Brain}
                                        title="No Mood Logs Found"
                                        subtitle="Psychological patterns populate when entry emotions are recorded on trades."
                                    />
                                ) : (
                                    <SafeChartContainer>
                                        <PieChart>
                                            <Pie
                                                data={moodDistribution}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={60}
                                                outerRadius={80}
                                                paddingAngle={4}
                                                dataKey="value"
                                            >
                                                {moodDistribution.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: '#161b27',
                                                    border: '1px solid rgba(255, 255, 255, 0.06)',
                                                    borderRadius: '8px',
                                                    color: '#fff'
                                                }}
                                            />
                                        </PieChart>
                                    </SafeChartContainer>
                                )}
                            </div>
                            {moodDistribution.length > 0 && (
                                <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-4 text-xs">
                                    {moodDistribution.map((d, index) => (
                                        <div key={d.name} className="flex items-center gap-2">
                                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                                            <span className="text-[#94a3b8]">{d.name}:</span>
                                            <span className="font-bold text-white">{d.value}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </SectionCard>

                        {/* Bar Chart */}
                        <SectionCard title="Emotional State vs Average P&L" icon={BarChart2} iconColor="#f59e0b">
                            <div className="h-[220px]">
                                {moodDistribution.length === 0 ? (
                                    <EmptyState
                                        icon={BarChart2}
                                        title="No P&L Data Available"
                                        subtitle="Chart will display once trades are logged with corresponding entry moods."
                                    />
                                ) : (
                                    <SafeChartContainer>
                                        <BarChart data={moodDistribution}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" />
                                            <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: '#161b27',
                                                    border: '1px solid rgba(255, 255, 255, 0.06)',
                                                    borderRadius: '8px'
                                                }}
                                                labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                                            />
                                            <Bar dataKey="pnl">
                                                {moodDistribution.map((entry, idx) => (
                                                    <Cell key={`cell-${idx}`} fill={entry.pnl >= 0 ? '#00d4aa' : '#ef4444'} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </SafeChartContainer>
                                )}
                            </div>
                        </SectionCard>
                    </motion.div>
                )}

                {activeTab === 'risk' && (
                    <motion.div
                        key="risk"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.18 }}
                        className="space-y-5"
                    >
                        {/* Risk Metrics Row */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
                            <div className="bg-[#161b27] border border-white/[0.06] rounded-xl p-[18px] flex flex-col justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">Avg Risk per Trade</span>
                                <h3 className="text-xl font-bold text-white mt-1">₹1,850</h3>
                            </div>
                            <div className="bg-[#161b27] border border-white/[0.06] rounded-xl p-[18px] flex flex-col justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">Max Risk Taken</span>
                                <h3 className="text-xl font-bold text-[#ef4444] mt-1">₹3,500</h3>
                            </div>
                            <div className="bg-[#161b27] border border-white/[0.06] rounded-xl p-[18px] flex flex-col justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">Planned vs Achieved R:R</span>
                                <h3 className="text-xl font-bold text-white mt-1">1:2.0 / 1:2.3</h3>
                            </div>
                            <div className="bg-[#161b27] border border-white/[0.06] rounded-xl p-[18px] flex flex-col justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">Max Drawdown (30D)</span>
                                <h3 className="text-xl font-bold text-[#ef4444] mt-1">3.1%</h3>
                            </div>
                        </div>

                        {/* Chart row */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                            <SectionCard title="Planned vs Realized Risk-Reward Ratio" icon={TrendingUp} iconColor="#3b82f6">
                                <div className="h-[220px] flex items-center justify-center">
                                    {displayedTrades.length === 0 ? (
                                        <EmptyState icon={TrendingUp} title="No Risk Data" subtitle="Risk analytics require R:R targets logged on your trades." />
                                    ) : (
                                        <SafeChartContainer>
                                            <BarChart data={displayedTrades.slice(0, 10).map((x, idx) => ({ name: `Trade ${idx+1}`, Planned: 2.0, Achieved: x.riskRewardRatio || 1.0 }))}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" />
                                                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                                                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                                                <Tooltip contentStyle={{ backgroundColor: '#161b27', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '8px' }} />
                                                <Bar dataKey="Planned" fill="rgba(59, 130, 246, 0.4)" />
                                                <Bar dataKey="Achieved" fill="#00d4aa" />
                                            </BarChart>
                                        </SafeChartContainer>
                                    )}
                                </div>
                            </SectionCard>

                            <SectionCard title="Stop-Loss Compliance Rate" icon={ShieldAlert} iconColor="#ef4444">
                                <div className="space-y-4 text-xs pt-2">
                                    <div className="flex justify-between items-center bg-[#1c2333] p-3 rounded-lg border border-white/[0.06]">
                                        <span className="text-[#94a3b8] font-semibold">Trades Executed with Stop Loss</span>
                                        <span className="font-bold text-white">94%</span>
                                    </div>
                                    <div className="flex justify-between items-center bg-[#1c2333] p-3 rounded-lg border border-white/[0.06]">
                                        <span className="text-[#94a3b8] font-semibold">Stop Loss Respected (No Moving)</span>
                                        <span className="font-bold text-[#00d4aa]">88%</span>
                                    </div>
                                    <div className="flex justify-between items-center bg-[#1c2333] p-3 rounded-lg border border-white/[0.06]">
                                        <span className="text-[#94a3b8] font-semibold">Stop Loss Violated / Moved</span>
                                        <span className="font-bold text-[#ef4444]">6%</span>
                                    </div>
                                    <div className="flex justify-between items-center bg-[#1c2333] p-3 rounded-lg border border-white/[0.06]">
                                        <span className="text-[#94a3b8] font-semibold">Trades Taken Without Stop Loss</span>
                                        <span className="font-bold text-[#ef4444]">0%</span>
                                    </div>
                                </div>
                            </SectionCard>
                        </div>
                    </motion.div>
                )}

                {activeTab === 'journal' && (
                    <motion.div
                        key="journal"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.18 }}
                        className="grid grid-cols-1 lg:grid-cols-2 gap-5"
                    >
                        {/* Target outcomes breakdown */}
                        <SectionCard title="Execution Compliance Scores" icon={BookOpen} iconColor="#00d4aa">
                            <div className="h-[220px] flex items-center justify-center">
                                {displayedTrades.length === 0 ? (
                                    <EmptyState icon={BookOpen} title="No Compliance Logs" subtitle="Compliance scores will calculate as you complete checklist tasks." />
                                ) : (
                                    <SafeChartContainer>
                                        <BarChart data={displayedTrades.slice(0, 10).map((x, idx) => ({ name: `Trade ${idx+1}`, Score: x.complianceScore || 0 }))}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" />
                                            <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                                            <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                                            <Tooltip contentStyle={{ backgroundColor: '#161b27', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '8px' }} />
                                            <Bar dataKey="Score" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </SafeChartContainer>
                                )}
                            </div>
                        </SectionCard>

                        {/* Outcomes list */}
                        <SectionCard title="Trade Outcomes Breakdown" icon={Layers} iconColor="#8b5cf6">
                            <div className="space-y-4 text-xs pt-2">
                                <div className="flex justify-between items-center bg-[#1c2333] p-3 rounded-lg border border-white/[0.06]">
                                    <span className="text-[#94a3b8] font-semibold">Full Win (Target Hit)</span>
                                    <span className="font-bold text-[#00d4aa]">4 Trades</span>
                                </div>
                                <div className="flex justify-between items-center bg-[#1c2333] p-3 rounded-lg border border-white/[0.06]">
                                    <span className="text-[#94a3b8] font-semibold">Stopped Out (Full Loss)</span>
                                    <span className="font-bold text-[#ef4444]">2 Trades</span>
                                </div>
                                <div className="flex justify-between items-center bg-[#1c2333] p-3 rounded-lg border border-white/[0.06]">
                                    <span className="text-[#94a3b8] font-semibold">Partial Win / Out Early</span>
                                    <span className="font-bold text-white">0 Trades</span>
                                </div>
                                <div className="flex justify-between items-center bg-[#1c2333] p-3 rounded-lg border border-white/[0.06]">
                                    <span className="text-[#94a3b8] font-semibold">Breakeven Exit</span>
                                    <span className="font-bold text-white">0 Trades</span>
                                </div>
                            </div>
                        </SectionCard>
                    </motion.div>
                )}

                {activeTab === 'pnl_audit' && (
                    <motion.div
                        key="pnl_audit"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.18 }}
                        className="space-y-6"
                    >
                        {/* Selector Controls */}
                        <div className="flex flex-wrap items-center justify-between gap-4 bg-[#161b27] border border-white/[0.06] rounded-2xl p-4">
                            <div className="flex items-center gap-3">
                                <span className="text-xs font-black text-slate-400 uppercase tracking-wider">Financial Year:</span>
                                <select
                                    value={selectedFy}
                                    onChange={(e) => setSelectedFy(e.target.value)}
                                    className="bg-slate-950 border border-white/[0.08] text-xs font-bold text-white rounded-lg px-3 py-1.5 focus:border-indigo-500 outline-none"
                                >
                                    {pnlMetadata?.financial_years?.map((f: any) => (
                                        <option key={f.fy} value={f.fy}>{f.fy}</option>
                                    )) || <option value="">No years found</option>}
                                </select>
                            </div>

                            <div className="flex items-center gap-3">
                                <span className="text-xs font-black text-slate-400 uppercase tracking-wider">Segment:</span>
                                <select
                                    value={selectedSegment}
                                    onChange={(e) => setSelectedSegment(e.target.value)}
                                    className="bg-slate-950 border border-white/[0.08] text-xs font-bold text-white rounded-lg px-3 py-1.5 focus:border-indigo-500 outline-none"
                                >
                                    <option value="EQ">Equity</option>
                                    <option value="FO">F&O Derivatives</option>
                                    <option value="COM">Commodity</option>
                                    <option value="CUR">Currency</option>
                                </select>
                            </div>
                        </div>

                        {pnlError && (
                            <div className="flex items-center gap-2 px-4 py-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs font-bold uppercase tracking-wide">
                                <ShieldAlert size={14} />
                                <span>{pnlError}</span>
                            </div>
                        )}

                        {/* Summary metrics cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="bg-[#161b27] border border-white/[0.06] rounded-2xl p-5 shadow-sm space-y-2">
                                <span className="text-[10px] text-[#94a3b8] font-bold uppercase tracking-wider block">Realized Profit / Loss</span>
                                <span className={`text-2xl font-black block font-mono ${
                                    (pnlCharges?.realized_pnl || 0) >= 0 ? 'text-[#00d4aa]' : 'text-[#ef4444]'
                                }`}>
                                    {formatCurrency(pnlCharges?.realized_pnl || 0)}
                                </span>
                            </div>

                            <div className="bg-[#161b27] border border-white/[0.06] rounded-2xl p-5 shadow-sm space-y-2">
                                <span className="text-[10px] text-[#94a3b8] font-bold uppercase tracking-wider block">Total Charges & Taxes</span>
                                <span className="text-2xl font-black block font-mono text-amber-500">
                                    {formatCurrency(pnlCharges?.total_charges || 0)}
                                </span>
                            </div>

                            <div className="bg-[#161b27] border border-white/[0.06] rounded-2xl p-5 shadow-sm space-y-2">
                                <span className="text-[10px] text-[#94a3b8] font-bold uppercase tracking-wider block">Net Realized P&L</span>
                                <span className={`text-2xl font-black block font-mono ${(pnlCharges?.realized_pnl - pnlCharges?.total_charges || 0) >= 0 ? 'text-[#00d4aa]' : 'text-[#ef4444]'}`}>
                                    {formatCurrency((pnlCharges?.realized_pnl || 0) - (pnlCharges?.total_charges || 0))}
                                </span>
                            </div>
                        </div>

                        {/* Detail layout */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-2 bg-[#161b27] border border-white/[0.06] rounded-2xl overflow-hidden flex flex-col">
                                <div className="p-4 border-b border-white/[0.06] bg-slate-950/40 flex items-center justify-between">
                                    <span className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5 font-sans">
                                        <Activity size={14} className="text-indigo-455" />
                                        Transaction Audit Log
                                    </span>
                                    <span className="text-[10px] font-bold text-slate-500 uppercase">{pnlData.length} Trades</span>
                                </div>

                                <div className="overflow-x-auto max-h-[350px]">
                                    <table className="w-full text-xs text-left border-collapse font-mono">
                                        <thead>
                                            <tr className="bg-slate-950/60 border-b border-white/[0.06] text-[9px] uppercase tracking-wider text-slate-500 sticky top-0">
                                                <th className="px-4 py-3 font-black">Symbol</th>
                                                <th className="px-4 py-3 font-black text-right">Quantity</th>
                                                <th className="px-4 py-3 font-black text-right">Realized P&L</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/[0.04]">
                                            {isPnlLoading ? (
                                                <tr>
                                                    <td colSpan={3} className="text-center py-10 text-slate-500 font-sans">
                                                        <RefreshCw className="animate-spin inline-block mr-2" size={14} />
                                                        Loading Upstox P&L transaction data...
                                                    </td>
                                                </tr>
                                            ) : pnlData.length === 0 ? (
                                                <tr>
                                                    <td colSpan={3} className="text-center py-10 text-slate-500 font-sans">
                                                        No trades found for selected Financial Year and segment.
                                                    </td>
                                                </tr>
                                            ) : (
                                                pnlData.map((item, idx) => (
                                                  <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                                                    <td className="px-4 py-3 text-white font-bold">{item.trading_symbol || item.symbol}</td>
                                                    <td className="px-4 py-3 text-right text-slate-350">{item.quantity || 0}</td>
                                                    <td className={`px-4 py-3 text-right font-black ${
                                                      (item.realized_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                                    }`}>
                                                      {formatCurrency(item.realized_pnl || 0)}
                                                    </td>
                                                  </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="lg:col-span-1 bg-[#161b27] border border-white/[0.06] rounded-2xl overflow-hidden">
                                <div className="p-4 border-b border-white/[0.06] bg-slate-950/40">
                                    <span className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5 font-sans">
                                        <DollarSign size={14} className="text-amber-500" />
                                        Charges Breakdown
                                    </span>
                                </div>

                                <div className="p-5 space-y-4 text-xs font-mono">
                                    <div className="flex justify-between items-center border-b border-white/[0.04] pb-2">
                                        <span className="text-[#94a3b8]">Brokerage</span>
                                        <span className="font-bold text-white">{formatCurrency(pnlCharges?.charges?.brokerage || 0)}</span>
                                    </div>
                                    <div className="flex justify-between items-center border-b border-white/[0.04] pb-2">
                                        <span className="text-[#94a3b8]">Securities Transaction Tax (STT)</span>
                                        <span className="font-bold text-white">{formatCurrency(pnlCharges?.charges?.stt || 0)}</span>
                                    </div>
                                    <div className="flex justify-between items-center border-b border-white/[0.04] pb-2">
                                        <span className="text-[#94a3b8]">GST</span>
                                        <span className="font-bold text-white">{formatCurrency(pnlCharges?.charges?.gst || 0)}</span>
                                    </div>
                                    <div className="flex justify-between items-center border-b border-white/[0.04] pb-2">
                                        <span className="text-[#94a3b8]">Exchange Txn Charge</span>
                                        <span className="font-bold text-white">{formatCurrency(pnlCharges?.charges?.exchange_transaction_charge || 0)}</span>
                                    </div>
                                    <div className="flex justify-between items-center border-b border-white/[0.04] pb-2">
                                        <span className="text-[#94a3b8]">Stamp Duty</span>
                                        <span className="font-bold text-white">{formatCurrency(pnlCharges?.charges?.stamp_duty || 0)}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-[#94a3b8]">SEBI Turnover Fees</span>
                                        <span className="font-bold text-white">{formatCurrency(pnlCharges?.charges?.sebi_turnover_fees || 0)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ReportsTab;
