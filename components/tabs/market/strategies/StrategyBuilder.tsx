import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../../../shared/SafeChartContainer';
import { motion } from 'framer-motion';
import {
    Beaker, TrendingUp, TrendingDown, BarChart3, Target, Zap,
    Calendar, DollarSign, Percent, AlertTriangle, CheckCircle2, Play, RotateCcw,
    Sparkles, MessageSquare, Save, X, Send, Bot, User
} from 'lucide-react';
import { db, Strategy as DbStrategy } from '../../../../database';
import { streamChatWithGemini } from '../../../../services/aiService';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Area, ComposedChart
} from 'recharts';
import { formatCurrencyCompact as formatCurrency } from '../../../../utils/helpers';

// ==================== TYPES ====================
interface BacktestResult {
    finalValue: number;
    totalReturn: number;
    cagr: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    totalTrades: number;
    bestMonth: number;
    worstMonth: number;
    volatility: number;
    chartData: { date: string; value: number; benchmark: number }[];
}

interface Strategy {
    id: string;
    name: string;
    description: string;
    rules: string[];
}

// ==================== MOCK HISTORICAL DATA ====================
// Simulated Nifty 50 monthly returns (2014-2024)
// Simulated Nifty 50 monthly returns (2014-2025)
const NIFTY_MONTHLY_RETURNS: number[] = [ /*
    0.07, 0.03, 0.05, -0.02, 0.04, 0.01, 0.06, -0.03, 0.02, 0.04, -0.01, 0.03, // 2014
    0.02, 0.01, -0.04, 0.03, 0.02, -0.01, 0.05, -0.06, -0.02, 0.03, 0.01, 0.02, // 2015
    -0.05, -0.07, 0.11, 0.02, 0.04, 0.01, 0.03, 0.02, -0.01, 0.04, -0.05, 0.03, // 2016
    0.05, 0.04, 0.03, 0.01, 0.03, 0.00, 0.05, -0.01, 0.02, 0.06, -0.02, 0.03, // 2017
    0.05, -0.05, -0.04, 0.06, 0.00, -0.01, 0.06, 0.03, -0.06, -0.05, 0.05, 0.00, // 2018
    0.00, -0.01, 0.08, 0.01, 0.02, -0.01, -0.06, -0.02, 0.04, 0.04, 0.02, 0.01, // 2019
    -0.02, -0.06, -0.23, 0.15, -0.03, 0.08, 0.08, 0.03, -0.01, -0.03, 0.12, 0.08, // 2020
    -0.03, 0.06, 0.00, -0.04, 0.06, 0.01, 0.00, 0.09, 0.03, 0.00, -0.04, 0.03, // 2021
    -0.01, -0.03, 0.04, -0.02, -0.03, -0.05, 0.09, 0.04, -0.03, -0.02, 0.04, -0.04, // 2022
    -0.03, -0.01, -0.01, 0.04, 0.03, 0.04, 0.03, -0.03, 0.02, -0.03, 0.06, 0.08, // 2023
    0.02, 0.00, 0.02, -0.01, 0.04, 0.05, 0.04, 0.01, 0.02, -0.06, 0.00, 0.01, // 2024
    -0.05, 0.02, 0.03 // 2025 (Partial)
*/ ];

// ==================== PRESET STRATEGIES ====================
const STRATEGIES: Strategy[] = [
    {
        id: 'buy-hold',
        name: 'Buy & Hold',
        description: 'Simple buy and hold strategy - fully invested at all times',
        rules: ['Invest 100% on day 1', 'Never sell', 'Benchmark strategy']
    },
    {
        id: 'sip',
        name: 'Monthly SIP',
        description: 'Systematic Investment Plan - fixed amount every month',
        rules: ['Invest fixed amount monthly', 'Ignores market conditions', 'Rupee cost averaging']
    },
    {
        id: 'value-avg',
        name: 'Value Averaging',
        description: 'Adjust investment to hit target portfolio value each month',
        rules: ['Set monthly target value increase', 'Invest more when market dips', 'Invest less when market rises']
    },
    {
        id: 'momentum',
        name: 'Momentum Strategy',
        description: 'Buy when 3-month return is positive, sell when negative',
        rules: ['Check 3-month trailing return', 'Fully invested if positive', 'Move to cash if negative']
    },
    {
        id: 'dip-buying',
        name: 'Buy The Dip',
        description: 'Invest extra 50% when market drops 10% from recent high',
        rules: ['SIP + extra on dips', '10% drop = 50% extra investment', 'Captures oversold conditions']
    }
];

// ==================== BACKTESTING ENGINE ====================
const runBacktest = (
    strategy: string,
    initialInvestment: number,
    monthlyContribution: number,
    years: number
): BacktestResult => {
    const months = Math.min(years * 12, NIFTY_MONTHLY_RETURNS.length);
    const chartData: { date: string; value: number; benchmark: number }[] = [];

    let portfolioValue = initialInvestment;
    let benchmarkValue = initialInvestment;
    let cash = 0;
    let totalInvested = initialInvestment;
    let monthlyValues: number[] = [];
    let peakValue = initialInvestment;
    let maxDrawdown = 0;
    let winMonths = 0;
    let totalTrades = 0;
    let recentHigh = initialInvestment;
    let targetValue = initialInvestment;

    // 3-month momentum lookback
    const momentumLookback: number[] = [];

    for (let i = 0; i < months; i++) {
        const monthReturn = NIFTY_MONTHLY_RETURNS[i];
        const year = 2014 + Math.floor(i / 12);
        const month = (i % 12) + 1;
        const dateStr = `${year}-${month.toString().padStart(2, '0')}`;

        // Strategy-specific logic
        switch (strategy) {
            case 'buy-hold':
                portfolioValue = portfolioValue * (1 + monthReturn);
                if (i > 0) totalInvested += monthlyContribution;
                portfolioValue += monthlyContribution;
                break;

            case 'sip':
                portfolioValue = portfolioValue * (1 + monthReturn);
                totalInvested += monthlyContribution;
                portfolioValue += monthlyContribution;
                break;

            case 'value-avg':
                targetValue += monthlyContribution * 1.01; // Target grows 1% monthly
                portfolioValue = portfolioValue * (1 + monthReturn);
                const valueGap = targetValue - portfolioValue;
                const contribution = Math.max(0, Math.min(valueGap, monthlyContribution * 2));
                portfolioValue += contribution;
                totalInvested += contribution;
                totalTrades++;
                break;

            case 'momentum':
                momentumLookback.push(monthReturn);
                if (momentumLookback.length > 3) momentumLookback.shift();

                const momentum3M = momentumLookback.reduce((a, b) => a + b, 0);

                if (momentum3M > 0) {
                    // Fully invested
                    portfolioValue = portfolioValue * (1 + monthReturn);
                    if (cash > 0) {
                        portfolioValue += cash;
                        cash = 0;
                        totalTrades++;
                    }
                } else {
                    // Move to cash
                    if (portfolioValue > 0) {
                        cash = portfolioValue;
                        portfolioValue = 0;
                        totalTrades++;
                    }
                }
                totalInvested += monthlyContribution;
                if (momentum3M > 0) {
                    portfolioValue += monthlyContribution;
                } else {
                    cash += monthlyContribution;
                }
                break;

            case 'dip-buying':
                portfolioValue = portfolioValue * (1 + monthReturn);
                recentHigh = Math.max(recentHigh, portfolioValue);

                const drawdownFromHigh = (recentHigh - portfolioValue) / recentHigh;
                let contribution2 = monthlyContribution;

                if (drawdownFromHigh > 0.10) {
                    // Buy the dip - extra 50%
                    contribution2 = monthlyContribution * 1.5;
                    totalTrades++;
                }

                portfolioValue += contribution2;
                totalInvested += contribution2;
                break;
        }

        // Benchmark (buy & hold)
        benchmarkValue = benchmarkValue * (1 + monthReturn);
        if (i > 0) benchmarkValue += monthlyContribution;

        // Track metrics
        const totalValue = portfolioValue + cash;
        monthlyValues.push(totalValue);

        if (i > 0) {
            const monthlyReturn = (totalValue - monthlyValues[i - 1]) / monthlyValues[i - 1];
            if (monthlyReturn > 0) winMonths++;
        }

        peakValue = Math.max(peakValue, totalValue);
        const currentDrawdown = (peakValue - totalValue) / peakValue;
        maxDrawdown = Math.max(maxDrawdown, currentDrawdown);

        chartData.push({
            date: dateStr,
            value: Math.round(totalValue),
            benchmark: Math.round(benchmarkValue)
        });
    }

    const finalValue = portfolioValue + cash;
    const totalReturn = ((finalValue - totalInvested) / totalInvested) * 100;
    const cagr = (Math.pow(finalValue / initialInvestment, 1 / years) - 1) * 100;

    // Calculate monthly returns for Sharpe ratio
    const monthlyReturns = monthlyValues.slice(1).map((v, i) => (v - monthlyValues[i]) / monthlyValues[i]);
    const avgMonthlyReturn = monthlyReturns.reduce((a, b) => a + b, 0) / monthlyReturns.length;
    const volatility = Math.sqrt(monthlyReturns.reduce((sum, r) => sum + Math.pow(r - avgMonthlyReturn, 2), 0) / monthlyReturns.length) * Math.sqrt(12);
    const riskFreeRate = 0.06; // 6% annual
    const sharpeRatio = (cagr / 100 - riskFreeRate) / volatility;

    return {
        finalValue: Math.round(finalValue),
        totalReturn: parseFloat(totalReturn.toFixed(2)),
        cagr: parseFloat(cagr.toFixed(2)),
        sharpeRatio: parseFloat(sharpeRatio.toFixed(2)),
        maxDrawdown: parseFloat((maxDrawdown * 100).toFixed(2)),
        winRate: parseFloat(((winMonths / (months - 1)) * 100).toFixed(1)),
        totalTrades: totalTrades || months,
        bestMonth: parseFloat((Math.max(...monthlyReturns) * 100).toFixed(2)),
        worstMonth: parseFloat((Math.min(...monthlyReturns) * 100).toFixed(2)),
        volatility: parseFloat((volatility * 100).toFixed(2)),
        chartData
    };
};

// ==================== COMPONENT ====================
const StrategyBuilder: React.FC = () => {
    const [selectedStrategy, setSelectedStrategy] = useState('sip');
    const [initialInvestment, setInitialInvestment] = useState(100000);
    const [monthlyContribution, setMonthlyContribution] = useState(10000);
    const [years, setYears] = useState(5);
    const [isRunning, setIsRunning] = useState(false);
    const [result, setResult] = useState<BacktestResult | null>(null);
    const [isLabOpen, setIsLabOpen] = useState(false);
    const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'model', text: string }[]>([]);
    const [aiInput, setAiInput] = useState('');
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const activeStrategy = STRATEGIES.find(s => s.id === selectedStrategy)!;

    const handleRunBacktest = () => {
        setIsRunning(true);
        setTimeout(() => {
            const backtestResult = runBacktest(selectedStrategy, initialInvestment, monthlyContribution, years);
            setResult(backtestResult);
            setIsRunning(false);
            
            // Suggest AI analysis
            if (aiMessages.length === 0) {
                setAiMessages([{ 
                    role: 'model', 
                    text: `Backtest complete! I see a ${backtestResult.cagr}% CAGR with a ${result?.sharpeRatio || backtestResult.sharpeRatio} Sharpe. Would you like me to analyze these results or suggest optimizations for the ${activeStrategy.name}?` 
                }]);
            }
        }, 800);
    };

    const handleExport = async () => {
        if (!result) return;
        setIsSaving(true);
        try {
            await db.strategies.add({
                name: activeStrategy.name,
                description: activeStrategy.description,
                rules: activeStrategy.rules,
                winRate: result.winRate,
                avgRMultiple: result.sharpeRatio, // Mapping Sharpe as a proxy for efficiency if needed, or we could add more fields
                totalTrades: result.totalTrades,
                isActive: true
            });
            alert("Strategy exported to Playbook successfully!");
        } catch (error) {
            console.error("Export failed:", error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleSendMessage = async () => {
        if (!aiInput.trim() || isAiLoading) return;
        
        const userMsg = aiInput.trim();
        setAiInput('');
        setAiMessages(prev => [...prev, { role: 'user', text: userMsg }]);
        setIsAiLoading(true);

        let fullResponse = '';
        const history = aiMessages.map(m => ({ 
            role: m.role, 
            parts: [{ text: m.text }] 
        }));

        const systemInstruction = `You are the Wealth Aggregator AI Strategy Consultant. 
        Current Strategy: ${activeStrategy.name}
        Rules: ${activeStrategy.rules.join(', ')}
        Backtest Results: ${result ? JSON.stringify(result) : 'No backtest run yet'}
        
        Analyze the strategy, suggest improvements, or answer questions about market conditions. 
        Keep responses concise and professional.`;

        try {
            await streamChatWithGemini(
                'gemini-2.0-flash',
                history,
                userMsg,
                systemInstruction,
                (token) => {
                    fullResponse += token;
                    setAiMessages(prev => {
                        const last = prev[prev.length - 1];
                        if (last && last.role === 'model') {
                            return [...prev.slice(0, -1), { role: 'model', text: fullResponse }];
                        }
                        return [...prev, { role: 'model', text: fullResponse }];
                    });
                },
                () => setIsAiLoading(false),
                (err) => {
                    console.error(err);
                    setIsAiLoading(false);
                }
            );
        } catch (err) {
            setIsAiLoading(false);
        }
    };



    return (
        <div className="bg-gradient-to-br from-slate-900 to-purple-950 rounded-2xl border border-purple-900/50 p-6 shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-cyan-400 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
                        <Zap size={24} className="text-white" />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                            Strategy Lab <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/30 uppercase tracking-tighter">AI Enabled</span>
                        </h3>
                        <p className="text-xs text-slate-400">Quantitative backtesting & AI optimization</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setIsLabOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-indigo-400 font-bold rounded-xl border border-indigo-500/20 hover:border-indigo-500/50 transition-all"
                    >
                        <Sparkles size={16} />
                        Consult AI
                    </motion.button>
                    <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={handleRunBacktest}
                        disabled={isRunning}
                        className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-cyan-500 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40 transition-shadow disabled:opacity-50"
                    >
                        {isRunning ? <RotateCcw size={18} className="animate-spin" /> : <Play size={18} />}
                        {isRunning ? 'Run Simulation' : 'Run Simulation'}
                    </motion.button>
                </div>
            </div>

            {/* Strategy Selector */}
            <div className="mb-6">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-3">Select Strategy</label>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {STRATEGIES.map(strategy => (
                        <button
                            key={strategy.id}
                            onClick={() => setSelectedStrategy(strategy.id)}
                            className={`p-3 rounded-xl border text-left transition-all ${selectedStrategy === strategy.id
                                ? 'bg-purple-500/20 border-purple-500/50 text-purple-300'
                                : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
                                }`}
                        >
                            <p className="text-sm font-bold truncate">{strategy.name}</p>
                        </button>
                    ))}
                </div>
                <p className="text-sm text-slate-400 mt-3">{activeStrategy.description}</p>
            </div>

            {/* Parameters */}
            <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Initial Investment</label>
                    <div className="flex items-center gap-2">
                        <DollarSign size={16} className="text-purple-400" />
                        <input
                            type="number"
                            value={initialInvestment}
                            onChange={(e) => setInitialInvestment(Number(e.target.value))}
                            className="w-full bg-transparent text-white font-mono font-bold text-lg outline-none"
                        />
                    </div>
                </div>
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Monthly Contribution</label>
                    <div className="flex items-center gap-2">
                        <Calendar size={16} className="text-purple-400" />
                        <input
                            type="number"
                            value={monthlyContribution}
                            onChange={(e) => setMonthlyContribution(Number(e.target.value))}
                            className="w-full bg-transparent text-white font-mono font-bold text-lg outline-none"
                        />
                    </div>
                </div>
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Duration (Years)</label>
                    <div className="flex items-center gap-2">
                        <input
                            type="range"
                            min="1"
                            max="10"
                            value={years}
                            onChange={(e) => setYears(Number(e.target.value))}
                            className="flex-1 accent-purple-500"
                        />
                        <span className="text-white font-mono font-bold w-8">{years}</span>
                    </div>
                </div>
            </div>

            {/* Results */}
            {result && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                >
                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <div className="bg-emerald-500/10 p-4 rounded-xl border border-emerald-500/30">
                            <p className="text-xs text-emerald-400 font-bold uppercase">Final Value</p>
                            <p className="text-xl font-black text-emerald-300">{formatCurrency(result.finalValue)}</p>
                        </div>
                        <div className={`p-4 rounded-xl border ${result.cagr >= 12 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
                            <p className="text-xs text-slate-400 font-bold uppercase">CAGR</p>
                            <p className={`text-xl font-black ${result.cagr >= 12 ? 'text-emerald-300' : 'text-amber-300'}`}>{result.cagr}%</p>
                        </div>
                        <div className={`p-4 rounded-xl border ${result.sharpeRatio >= 1 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-800/50 border-slate-700'}`}>
                            <p className="text-xs text-slate-400 font-bold uppercase">Sharpe Ratio</p>
                            <p className="text-xl font-black text-white">{result.sharpeRatio}</p>
                        </div>
                        <div className={`p-4 rounded-xl border ${result.maxDrawdown <= 20 ? 'bg-slate-800/50 border-slate-700' : 'bg-rose-500/10 border-rose-500/30'}`}>
                            <p className="text-xs text-slate-400 font-bold uppercase">Max Drawdown</p>
                            <p className={`text-xl font-black ${result.maxDrawdown <= 20 ? 'text-white' : 'text-rose-400'}`}>-{result.maxDrawdown}%</p>
                        </div>
                        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 group relative">
                            <p className="text-xs text-slate-400 font-bold uppercase">Win Rate</p>
                            <p className="text-xl font-black text-white">{result.winRate}%</p>
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={handleExport}
                                disabled={isSaving}
                                className="absolute -top-2 -right-2 w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/40 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                                title="Export to Journal"
                            >
                                {isSaving ? <RotateCcw size={14} className="animate-spin" /> : <Save size={14} className="text-white" />}
                            </motion.button>
                        </div>
                    </div>

                    {/* Chart */}
                    <div className="h-[300px] bg-slate-800/30 rounded-xl p-4">
                        <SafeChartContainer>
                            <ComposedChart data={result.chartData}>
                                <defs>
                                    <linearGradient id="strategyGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} />
                                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(v) => formatCurrency(v)} tickLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                                    formatter={((value: number | undefined) => value ? formatCurrency(value) : '') as any}
                                    labelFormatter={(label) => `Date: ${label}`}
                                />
                                <Area type="monotone" dataKey="value" stroke="#a855f7" fill="url(#strategyGradient)" strokeWidth={2} name="Strategy" />
                                <Line type="monotone" dataKey="benchmark" stroke="#64748b" strokeWidth={1} strokeDasharray="5 5" dot={false} name="Buy & Hold" />
                            </ComposedChart>
                        </SafeChartContainer>
                    </div>

                    {/* Additional Metrics */}
                    <div className="grid grid-cols-4 gap-3">
                        <div className="text-center p-3 bg-slate-800/30 rounded-xl">
                            <p className="text-xs text-slate-500 uppercase">Best Month</p>
                            <p className="text-lg font-bold text-emerald-400">+{result.bestMonth}%</p>
                        </div>
                        <div className="text-center p-3 bg-slate-800/30 rounded-xl">
                            <p className="text-xs text-slate-500 uppercase">Worst Month</p>
                            <p className="text-lg font-bold text-rose-400">{result.worstMonth}%</p>
                        </div>
                        <div className="text-center p-3 bg-slate-800/30 rounded-xl">
                            <p className="text-xs text-slate-500 uppercase">Volatility</p>
                            <p className="text-lg font-bold text-white">{result.volatility}%</p>
                        </div>
                        <div className="text-center p-3 bg-slate-800/30 rounded-xl">
                            <p className="text-xs text-slate-500 uppercase">Total Trades</p>
                            <p className="text-lg font-bold text-white">{result.totalTrades}</p>
                        </div>
                    </div>
                </motion.div>
            )}

            {/* Empty State */}
            {!result && (
                <div className="text-center py-12 text-slate-500">
                    <BarChart3 size={48} className="mx-auto mb-4 opacity-30" />
                    <p>Configure your strategy and click "Run Simulation" to see results</p>
                </div>
            )}

            {/* AI CONSULTANT SIDEBAR */}
            <motion.div
                initial={{ x: '100%' }}
                animate={{ x: isLabOpen ? 0 : '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed top-0 right-0 h-full w-[400px] bg-slate-900 border-l border-white/10 shadow-2xl z-[100] flex flex-col"
            >
                <div className="p-6 border-b border-white/10 flex items-center justify-between bg-slate-800/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center">
                            <Sparkles size={20} className="text-indigo-400" />
                        </div>
                        <div>
                            <h4 className="text-lg font-bold text-white">AI Consultant</h4>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest">Strategy Optimization</p>
                        </div>
                    </div>
                    <button onClick={() => setIsLabOpen(false)} className="p-2 hover:bg-white/5 rounded-lg text-slate-400">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {aiMessages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[85%] p-4 rounded-2xl text-sm ${
                                msg.role === 'user' 
                                ? 'bg-indigo-600 text-white' 
                                : 'bg-slate-800 text-slate-300 border border-white/5'
                            }`}>
                                <div className="flex items-center gap-2 mb-1.5 opacity-50">
                                    {msg.role === 'user' ? <User size={12} /> : <Bot size={12} />}
                                    <span className="text-[10px] font-bold uppercase tracking-tighter">{msg.role === 'user' ? 'You' : 'Strategy AI'}</span>
                                </div>
                                {msg.text}
                            </div>
                        </div>
                    ))}
                    {isAiLoading && (
                        <div className="flex justify-start">
                            <div className="bg-slate-800 p-4 rounded-2xl text-slate-300 border border-white/5 flex items-center gap-2">
                                <RotateCcw size={14} className="animate-spin text-indigo-400" />
                                <span className="text-xs italic">Analyzing results...</span>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-white/10 bg-slate-800/30">
                    <div className="relative">
                        <input 
                            value={aiInput}
                            onChange={e => setAiInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                            placeholder="Ask about strategy optimizations..."
                            className="w-full bg-slate-950 p-4 pr-12 rounded-xl border border-slate-700 outline-none focus:border-indigo-500 transition-all text-sm text-white"
                        />
                        <button 
                            onClick={handleSendMessage}
                            disabled={!aiInput.trim() || isAiLoading}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white disabled:opacity-50"
                        >
                            <Send size={16} />
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default StrategyBuilder;
