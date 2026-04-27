import React, { useEffect, useState, useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { liveQuery } from 'dexie';
import { db, Trade, calculatePnL } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import {
    Target, Shield, Zap, Calendar, AlertTriangle, TrendingUp,
    CheckCircle2, XCircle, Trophy, RefreshCw, Settings, HelpCircle,
    ArrowUpRight, ArrowDownRight, Award, Flame, Play, Trash2
} from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ComposedChart, Line
} from 'recharts';
import { CustomTooltip } from '../../shared/CustomTooltip';

interface ChallengeConfig {
    isActive: boolean;
    startingCapital: number;
    targetPercent: number;
    maxDrawdownPercent: number;
    durationDays: number;
    startDate: string;
    rules: string[];
}

export const ChallengeTab: React.FC = () => {
    const [trades, setTrades] = useState<Trade[]>([]);
    
    // Load config from localStorage
    const [config, setConfig] = useState<ChallengeConfig>(() => {
        const saved = localStorage.getItem('wealth_trading_challenge');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                // fallback
            }
        }
        return {
            isActive: false,
            startingCapital: 100000,
            targetPercent: 10,
            maxDrawdownPercent: 5,
            durationDays: 30,
            startDate: new Date().toISOString().split('T')[0],
            rules: [
                "Strictly follow daily max risk",
                "Always use a hard stop loss",
                "Do not revenge trade after a loss",
                "No trading outside predefined playbook strategies"
            ]
        };
    });

    // Temp setup states
    const [setupCapital, setSetupCapital] = useState(config.startingCapital);
    const [setupTarget, setSetupTarget] = useState(config.targetPercent);
    const [setupDrawdown, setSetupDrawdown] = useState(config.maxDrawdownPercent);
    const [setupDuration, setSetupDuration] = useState(config.durationDays);
    const [setupStartDate, setSetupStartDate] = useState(config.startDate);
    const [newRuleText, setNewRuleText] = useState('');
    const [setupRules, setSetupRules] = useState<string[]>(config.rules);

    // Load trades reactively from Dexie
    useEffect(() => {
        const subscription = liveQuery(() => db.trades.filter((t: any) => !t.isDeleted).toArray()).subscribe(data => {
            const enriched = (data || []).map(t => ({
                ...t,
                pnl: calculatePnL(t)
            }));
            setTrades(enriched);
        });
        return () => subscription.unsubscribe();
    }, []);

    // Save config helper
    const saveConfig = (newConfig: ChallengeConfig) => {
        setConfig(newConfig);
        localStorage.setItem('wealth_trading_challenge', JSON.stringify(newConfig));
    };

    // Start a new challenge
    const handleStartChallenge = () => {
        saveConfig({
            isActive: true,
            startingCapital: setupCapital,
            targetPercent: setupTarget,
            maxDrawdownPercent: setupDrawdown,
            durationDays: setupDuration,
            startDate: setupStartDate,
            rules: setupRules
        });
    };

    // End/Reset challenge
    const handleResetChallenge = () => {
        if (confirm("Are you sure you want to reset the current challenge? This will clear your progress tracker.")) {
            saveConfig({
                ...config,
                isActive: false
            });
        }
    };

    // Calculations based on active challenge and trades
    const challengeData = useMemo(() => {
        if (!config.isActive) return null;

        // Filter trades taken after the start date (inclusive)
        const challengeTrades = trades
            .filter(t => {
                const tradeDate = t.date.split('T')[0];
                return tradeDate >= config.startDate;
            })
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const startingCapital = config.startingCapital;
        const targetValue = startingCapital * (1 + config.targetPercent / 100);
        const drawdownLimitValue = startingCapital * (1 - config.maxDrawdownPercent / 100);
        
        let currentBalance = startingCapital;
        let peakBalance = startingCapital;
        let maxDrawdownHit = false;
        let targetReached = false;
        let netPnL = 0;
        let wins = 0;
        let losses = 0;
        let grossProfit = 0;
        let grossLoss = 0;

        // Construct Equity Curve
        const equityCurve = [{
            date: config.startDate,
            balance: startingCapital,
            pnl: 0,
            tradeIndex: 0
        }];

        challengeTrades.forEach((t, index) => {
            const pnl = t.pnl || 0;
            currentBalance += pnl;
            netPnL += pnl;
            
            if (pnl > 0) {
                wins++;
                grossProfit += pnl;
            } else if (pnl < 0) {
                losses++;
                grossLoss += Math.abs(pnl);
            }

            if (currentBalance > peakBalance) {
                peakBalance = currentBalance;
            }

            const currentDrawdownPercent = ((peakBalance - currentBalance) / peakBalance) * 100;
            if (currentBalance <= drawdownLimitValue || currentDrawdownPercent >= config.maxDrawdownPercent) {
                maxDrawdownHit = true;
            }

            if (currentBalance >= targetValue) {
                targetReached = true;
            }

            equityCurve.push({
                date: new Date(t.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                balance: currentBalance,
                pnl,
                tradeIndex: index + 1
            });
        });

        // Time calculations
        const startMs = new Date(config.startDate).getTime();
        const durationMs = config.durationDays * 24 * 60 * 60 * 1000;
        const endMs = startMs + durationMs;
        const todayMs = new Date().getTime();
        
        const daysElapsed = Math.max(0, Math.floor((todayMs - startMs) / (24 * 60 * 60 * 1000)));
        const daysRemaining = Math.max(0, config.durationDays - daysElapsed);
        const timeLimitExceeded = todayMs > endMs && !targetReached;

        // Overall status determination
        let status: 'ACTIVE' | 'PASSED' | 'FAILED' = 'ACTIVE';
        if (maxDrawdownHit) {
            status = 'FAILED';
        } else if (targetReached) {
            status = 'PASSED';
        } else if (timeLimitExceeded) {
            status = 'FAILED';
        }

        const winRate = challengeTrades.length > 0 ? (wins / challengeTrades.length) * 100 : 0;
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.9 : 0;
        const currentDrawdown = peakBalance - currentBalance;
        const maxDrawdownObserved = peakBalance > startingCapital ? ((peakBalance - currentBalance) / peakBalance) * 100 : 0;

        return {
            trades: challengeTrades,
            startingCapital,
            targetValue,
            drawdownLimitValue,
            currentBalance,
            peakBalance,
            netPnL,
            wins,
            losses,
            winRate,
            profitFactor,
            status,
            daysElapsed,
            daysRemaining,
            maxDrawdownHit,
            targetReached,
            timeLimitExceeded,
            equityCurve,
            currentDrawdown,
            maxDrawdownObserved
        };
    }, [config, trades]);

    // Setup rules helper
    const handleAddRule = () => {
        if (newRuleText.trim()) {
            setSetupRules([...setupRules, newRuleText.trim()]);
            setNewRuleText('');
        }
    };

    const handleRemoveRule = (index: number) => {
        setSetupRules(setupRules.filter((_, i) => i !== index));
    };

    // If challenge is inactive, show Setup Screen
    if (!config.isActive) {
        return (
            <div className="space-y-6 pb-20 max-w-4xl mx-auto">
                {/* Hero Setup */}
                <div className="bg-gradient-to-br from-indigo-500/10 to-violet-500/10 dark:from-indigo-950/20 dark:to-violet-950/20 border border-indigo-200/40 dark:border-indigo-900/30 rounded-3xl p-6 md:p-8 text-center relative overflow-hidden">
                    <div className="absolute top-0 left-1/4 w-72 h-72 bg-indigo-500/10 rounded-full blur-3xl -z-10 pointer-events-none"></div>
                    <div className="absolute bottom-0 right-1/4 w-72 h-72 bg-violet-500/10 rounded-full blur-3xl -z-10 pointer-events-none"></div>
                    
                    <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500 mx-auto mb-4">
                        <Trophy size={32} />
                    </div>
                    <h2 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tight">Trading Challenge Center</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 max-w-xl mx-auto leading-relaxed">
                        Replicate prop firm conditions or define your own custom balance sprint. Set targets, manage drawdown limits, and track execution under pressure.
                    </p>
                </div>

                {/* Configuration Deck */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Parameters Panel */}
                    <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-850 rounded-2xl p-6 shadow-sm backdrop-blur-md space-y-6">
                        <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3">
                            <Settings size={18} className="text-indigo-500" />
                            <h3 className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-widest">Challenge Parameters</h3>
                        </div>

                        <div className="space-y-4">
                            {/* Starting Capital */}
                            <div>
                                <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">Starting Capital (₹)</label>
                                <input
                                    type="number"
                                    value={setupCapital}
                                    onChange={(e) => setSetupCapital(Math.max(1000, Number(e.target.value)))}
                                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 font-mono font-bold text-sm text-slate-900 dark:text-white focus:border-indigo-500 outline-none transition-colors"
                                />
                            </div>

                            {/* Profit Target */}
                            <div>
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">Profit Target</label>
                                    <span className="text-xs font-bold text-emerald-500">+{setupTarget}% (+{formatCurrency(setupCapital * setupTarget / 100)})</span>
                                </div>
                                <input
                                    type="range"
                                    min={2}
                                    max={50}
                                    step={1}
                                    value={setupTarget}
                                    onChange={(e) => setSetupTarget(Number(e.target.value))}
                                    className="w-full accent-emerald-500 h-1 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>

                            {/* Max Drawdown */}
                            <div>
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">Max Drawdown Limit</label>
                                    <span className="text-xs font-bold text-rose-500">-{setupDrawdown}% (-{formatCurrency(setupCapital * setupDrawdown / 100)})</span>
                                </div>
                                <input
                                    type="range"
                                    min={1}
                                    max={25}
                                    step={1}
                                    value={setupDrawdown}
                                    onChange={(e) => setSetupDrawdown(Number(e.target.value))}
                                    className="w-full accent-rose-500 h-1 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>

                            {/* Duration & Start Date */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">Duration (Days)</label>
                                    <select
                                        value={setupDuration}
                                        onChange={(e) => setSetupDuration(Number(e.target.value))}
                                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-3 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500 transition-colors cursor-pointer"
                                    >
                                        <option value={7}>7 Days</option>
                                        <option value={14}>14 Days</option>
                                        <option value={30}>30 Days</option>
                                        <option value={60}>60 Days</option>
                                        <option value={90}>90 Days</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">Start Date</label>
                                    <input
                                        type="date"
                                        value={setupStartDate}
                                        onChange={(e) => setSetupStartDate(e.target.value)}
                                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500 transition-colors"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Rules Panel */}
                    <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-850 rounded-2xl p-6 shadow-sm backdrop-blur-md flex flex-col justify-between">
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3">
                                <Shield size={18} className="text-violet-500" />
                                <h3 className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-widest">Discipline Rules</h3>
                            </div>

                            {/* Add Rule Input */}
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Add custom rule (e.g. Stop after 2 losses)..."
                                    value={newRuleText}
                                    onChange={(e) => setNewRuleText(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddRule()}
                                    className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500 transition-colors"
                                />
                                <button
                                    onClick={handleAddRule}
                                    className="px-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs transition-colors"
                                >
                                    Add
                                </button>
                            </div>

                            {/* Rules List */}
                            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                                {setupRules.map((rule, idx) => (
                                    <div key={idx} className="flex justify-between items-center text-xs p-2.5 bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-slate-100 dark:border-slate-800/60">
                                        <span className="text-slate-700 dark:text-slate-300 font-medium leading-relaxed">{rule}</span>
                                        <button
                                            onClick={() => handleRemoveRule(idx)}
                                            className="text-slate-400 hover:text-rose-500 p-1 rounded transition-colors"
                                            title="Delete rule"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                ))}
                                {setupRules.length === 0 && (
                                    <p className="text-xs text-slate-400 italic text-center py-4">No custom rules added. Rules help enforce emotional control.</p>
                                )}
                            </div>
                        </div>

                        {/* Action CTA */}
                        <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80">
                            <button
                                onClick={handleStartChallenge}
                                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 active:scale-95 transition-all"
                            >
                                <Play size={16} /> Deploy & Launch Challenge
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Safety fallback
    if (!challengeData) return null;

    const isPassed = challengeData.status === 'PASSED';
    const isFailed = challengeData.status === 'FAILED';
    const isWin = challengeData.netPnL >= 0;

    return (
        <div className="space-y-6 pb-20">
            {/* Telemetry Header Scoreboard */}
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-850 rounded-2xl p-5 shadow-sm backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${isPassed ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : isFailed ? 'bg-rose-500/10 border-rose-500/20 text-rose-500' : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-500'}`}>
                        {isPassed ? <Award size={20} /> : isFailed ? <AlertTriangle size={20} /> : <Flame size={20} />}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-md font-bold text-slate-800 dark:text-white">Active Capital Sprint</h2>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${isPassed ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : isFailed ? 'bg-rose-500/10 border-rose-500/20 text-rose-500' : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-500'}`}>
                                {challengeData.status}
                            </span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5">Start Date: {config.startDate} | Capital: {formatCurrency(config.startingCapital)}</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={handleResetChallenge}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 font-bold border border-slate-200 dark:border-slate-700 rounded-xl text-xs flex items-center gap-2 transition-colors"
                    >
                        <RefreshCw size={14} /> Reset / Setup New
                    </button>
                </div>
            </div>

            {/* Dashboard Scoreboard Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Account Balance */}
                <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-800 rounded-2xl p-5 shadow-sm backdrop-blur-md">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Account Balance</span>
                    <div className="text-2xl font-black font-mono text-slate-950 dark:text-white mt-2">
                        {formatCurrency(challengeData.currentBalance)}
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-[10px]">
                        {isWin ? (
                            <span className="text-emerald-500 font-bold flex items-center"><ArrowUpRight size={12} /> +{((challengeData.currentBalance - challengeData.startingCapital) / challengeData.startingCapital * 100).toFixed(2)}%</span>
                        ) : (
                            <span className="text-rose-500 font-bold flex items-center"><ArrowDownRight size={12} /> {((challengeData.currentBalance - challengeData.startingCapital) / challengeData.startingCapital * 100).toFixed(2)}%</span>
                        )}
                        <span className="text-slate-400">vs start</span>
                    </div>
                </div>

                {/* Profit Target Progress */}
                <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-800 rounded-2xl p-5 shadow-sm backdrop-blur-md flex flex-col justify-between">
                    <div>
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Profit Target</span>
                            <span className="text-[10px] font-bold text-emerald-500">{config.targetPercent}% target</span>
                        </div>
                        <div className="text-2xl font-black font-mono text-slate-950 dark:text-white mt-1">
                            {formatCurrency(challengeData.targetValue)}
                        </div>
                    </div>
                    <div className="mt-2.5">
                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                            <div
                                className="bg-gradient-to-r from-emerald-500 to-teal-400 h-1.5 rounded-full transition-all"
                                style={{ width: `${Math.min(100, Math.max(0, (challengeData.currentBalance - challengeData.startingCapital) / (challengeData.targetValue - challengeData.startingCapital) * 100))}%` }}
                            ></div>
                        </div>
                        <div className="flex justify-between items-center mt-1 text-[9px] text-slate-400">
                            <span>Remaining: {formatCurrency(Math.max(0, challengeData.targetValue - challengeData.currentBalance))}</span>
                            <span>{Math.min(100, Math.max(0, (challengeData.currentBalance - challengeData.startingCapital) / (challengeData.targetValue - challengeData.startingCapital) * 100)).toFixed(0)}%</span>
                        </div>
                    </div>
                </div>

                {/* Drawdown Risk Gauge */}
                <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-800 rounded-2xl p-5 shadow-sm backdrop-blur-md flex flex-col justify-between">
                    <div>
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Max Drawdown Limit</span>
                            <span className="text-[10px] font-bold text-rose-500">-{config.maxDrawdownPercent}% limit</span>
                        </div>
                        <div className="text-2xl font-black font-mono text-slate-950 dark:text-white mt-1">
                            {formatCurrency(challengeData.drawdownLimitValue)}
                        </div>
                    </div>
                    <div className="mt-2.5">
                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                            <div
                                className="bg-gradient-to-r from-rose-500 to-red-400 h-1.5 rounded-full transition-all"
                                style={{ width: `${Math.min(100, Math.max(0, (challengeData.currentBalance - challengeData.drawdownLimitValue) / (challengeData.startingCapital - challengeData.drawdownLimitValue) * 100))}%` }}
                            ></div>
                        </div>
                        <div className="flex justify-between items-center mt-1 text-[9px] text-slate-400">
                            <span>Buffer: {formatCurrency(Math.max(0, challengeData.currentBalance - challengeData.drawdownLimitValue))}</span>
                            <span>{Math.max(0, 100 - (challengeData.currentBalance - challengeData.drawdownLimitValue) / (challengeData.startingCapital - challengeData.drawdownLimitValue) * 100).toFixed(0)}% used</span>
                        </div>
                    </div>
                </div>

                {/* Time Elapsed */}
                <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-800 rounded-2xl p-5 shadow-sm backdrop-blur-md flex flex-col justify-between">
                    <div>
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Days Remaining</span>
                            <span className="text-[10px] font-bold text-violet-500">{config.durationDays}D total</span>
                        </div>
                        <div className="text-2xl font-black font-mono text-slate-950 dark:text-white mt-1">
                            {challengeData.daysRemaining} Days
                        </div>
                    </div>
                    <div className="mt-2.5">
                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                            <div
                                className="bg-gradient-to-r from-violet-500 to-fuchsia-400 h-1.5 rounded-full transition-all"
                                style={{ width: `${(challengeData.daysRemaining / config.durationDays) * 100}%` }}
                            ></div>
                        </div>
                        <div className="flex justify-between items-center mt-1 text-[9px] text-slate-400">
                            <span>Elapsed: {challengeData.daysElapsed} days</span>
                            <span>{((config.durationDays - challengeData.daysRemaining) / config.durationDays * 100).toFixed(0)}%</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Equity Trajectory Chart & Rules Checklist */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Equity Curve Chart */}
                <div className="lg:col-span-2 bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-850 rounded-2xl p-5 shadow-sm backdrop-blur-md flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Challenge Trajectory</h3>
                            <p className="text-[10px] text-slate-400 mt-0.5">Real-time account balance plotting vs targets</p>
                        </div>
                    </div>

                    <div className="h-64 w-full">
                        <SafeChartContainer>
                            <ComposedChart data={challengeData.equityCurve} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="challengeCurveGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.08} />
                                <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                                <YAxis tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}k`} tick={{ fontSize: 9 }} width={50} />
                                <Tooltip
                                    content={<CustomTooltip />}
                                    cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '3 3' }}
                                />

                                <Area type="monotone" dataKey="balance" stroke="#6366f1" strokeWidth={2} fill="url(#challengeCurveGrad)" name="Balance" />
                                <Line type="monotone" dataKey="balance" stroke="#4f46e5" strokeWidth={2} dot={true} name="Balance Point" />
                                
                                <ReferenceLine y={challengeData.startingCapital} stroke="#94a3b8" strokeDasharray="3 3" label="Start" />
                                <ReferenceLine y={challengeData.targetValue} stroke="#10b981" strokeDasharray="3 3" label="Target" />
                                <ReferenceLine y={challengeData.drawdownLimitValue} stroke="#ef4444" strokeDasharray="3 3" label="Drawdown Limit" />
                            </ComposedChart>
                        </SafeChartContainer>
                    </div>
                </div>

                {/* Rules & Discipline Checklist */}
                <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-850 rounded-2xl p-5 shadow-sm backdrop-blur-md">
                    <h3 className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-4">
                        <Shield size={14} className="text-indigo-500" /> Rules Compliance
                    </h3>

                    <div className="space-y-3">
                        {/* Target Rule */}
                        <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-850 rounded-xl">
                            <div className="mt-0.5">
                                {isPassed ? (
                                    <CheckCircle2 size={16} className="text-emerald-500" />
                                ) : (
                                    <div className="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-700 flex items-center justify-center text-[9px] font-bold text-slate-400">T</div>
                                )}
                            </div>
                            <div>
                                <p className="text-xs font-bold text-slate-700 dark:text-slate-250">Reach Profit Target (+{config.targetPercent}%)</p>
                                <p className="text-[9px] text-slate-400 mt-0.5">Achieve balance of {formatCurrency(challengeData.targetValue)}</p>
                            </div>
                        </div>

                        {/* Drawdown Rule */}
                        <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-850 rounded-xl">
                            <div className="mt-0.5">
                                {challengeData.maxDrawdownHit ? (
                                    <XCircle size={16} className="text-rose-500" />
                                ) : (
                                    <CheckCircle2 size={16} className="text-emerald-500" />
                                )}
                            </div>
                            <div>
                                <p className="text-xs font-bold text-slate-700 dark:text-slate-250">Protect Drawdown Limit (-{config.maxDrawdownPercent}%)</p>
                                <p className="text-[9px] text-slate-400 mt-0.5">Do not drop below balance of {formatCurrency(challengeData.drawdownLimitValue)}</p>
                            </div>
                        </div>

                        {/* Time Rule */}
                        <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-850 rounded-xl">
                            <div className="mt-0.5">
                                {challengeData.timeLimitExceeded ? (
                                    <XCircle size={16} className="text-rose-500" />
                                ) : (
                                    <CheckCircle2 size={16} className="text-emerald-500" />
                                )}
                            </div>
                            <div>
                                <p className="text-xs font-bold text-slate-700 dark:text-slate-250">Time Limit: {config.durationDays} Days</p>
                                <p className="text-[9px] text-slate-400 mt-0.5">{challengeData.daysRemaining} days remaining in this sprint</p>
                            </div>
                        </div>

                        {/* Custom Rules */}
                        {config.rules.map((rule, idx) => (
                            <div key={idx} className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-850 rounded-xl">
                                <div className="mt-0.5">
                                    <CheckCircle2 size={16} className="text-slate-400 dark:text-slate-600" />
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-slate-600 dark:text-slate-400">{rule}</p>
                                    <p className="text-[9px] text-slate-400 mt-0.5">Self-regulated discipline check</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Statistics summary */}
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-850 rounded-2xl p-5 shadow-sm backdrop-blur-md">
                <h3 className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4">Sprint Execution Stats</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Trades Taken</p>
                        <h4 className="text-2xl font-black text-slate-800 dark:text-white mt-1 font-mono">{challengeData.trades.length}</h4>
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Win Rate</p>
                        <h4 className="text-2xl font-black text-slate-800 dark:text-white mt-1 font-mono">{challengeData.winRate.toFixed(1)}%</h4>
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Profit Factor</p>
                        <h4 className="text-2xl font-black text-slate-800 dark:text-white mt-1 font-mono">{challengeData.profitFactor.toFixed(2)}</h4>
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Max DD Observed</p>
                        <h4 className="text-2xl font-black text-slate-800 dark:text-white mt-1 font-mono text-rose-500">{challengeData.maxDrawdownObserved.toFixed(2)}%</h4>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ChallengeTab;
