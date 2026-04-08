import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    Beaker, Play, History, TrendingUp, TrendingDown, 
    CheckCircle, XCircle, Info, Filter, Brain, Zap, Send
} from 'lucide-react';
import { backtestingService, BacktestResult, BacktestRule } from '../../../services/BacktestingService';
import { formatCurrency } from '../../../utils/helpers';

const BacktesterWidget: React.FC = () => {
    const [results, setResults] = useState<BacktestResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);

    const rules = backtestingService.getPresetRules();

    const runSimulation = async (rule: BacktestRule) => {
        setLoading(true);
        setSelectedRuleId(rule.id);
        try {
            const res = await backtestingService.runBacktest(rule);
            setResults(res);
        } catch (err) {
            console.error(err);
        }
        setLoading(false);
    };

    return (
        <div className="h-full flex flex-col bg-white/60 dark:bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-200 dark:border-slate-800 p-5 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/10 rounded-xl">
                        <Beaker className="text-emerald-600 dark:text-emerald-400" size={20} />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 uppercase tracking-wider">Strategy Lab</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase">AI Backtesting Engine</p>
                    </div>
                </div>
            </div>

            {/* AI Strategy Lab */}
            <div className="mb-6">
                <div className="flex items-center gap-2 mb-3 px-1">
                    <Brain className="text-violet-600 dark:text-violet-400" size={14} />
                    <span className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-400 tracking-wider">AI Strategy Lab</span>
                </div>
                <div className="flex gap-2">
                    <div className="flex-1 relative">
                        <input 
                            type="text" 
                            placeholder="e.g. What if I never trade after 2:30 PM?"
                            className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-indigo-500/50 dark:focus:border-indigo-500/50 outline-none transition-all"
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                            <span className="text-[8px] font-bold text-slate-400 dark:text-slate-700 uppercase">Shift + Enter</span>
                            <Zap className="text-slate-400 dark:text-slate-700" size={10} />
                        </div>
                    </div>
                    <button className="px-4 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 rounded-xl text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-all">
                        <Send size={16} />
                    </button>
                </div>
            </div>

            {/* Rule Selection Grid */}
            <div className="space-y-2 mb-6">
                <p className="text-[10px] font-black text-slate-500 uppercase mb-2 px-1">Select A Scenario</p>
                {rules.map((rule) => (
                    <button
                        key={rule.id}
                        onClick={() => runSimulation(rule)}
                        disabled={loading}
                        className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                            selectedRuleId === rule.id 
                            ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-100' 
                            : 'bg-white/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/50 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                    >
                        <div className="flex items-center gap-3">
                            <Filter size={14} className={selectedRuleId === rule.id ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'} />
                            <div className="text-left">
                                <p className="text-[11px] font-black uppercase tracking-tight">{rule.name}</p>
                            </div>
                        </div>
                        {loading && selectedRuleId === rule.id ? (
                            <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <Play size={12} className="opacity-40 group-hover:opacity-100" />
                        )}
                    </button>
                ))}
            </div>

            {/* Results Section */}
            <div className="flex-1 relative">
                <AnimatePresence mode="wait">
                    {results ? (
                        <motion.div
                            key="results"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="h-full flex flex-col"
                        >
                            <div className="p-4 bg-white/60 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/50 mb-4">
                                <div className="flex justify-between items-center mb-4">
                                    <span className="text-[10px] font-black uppercase text-slate-500">PnL Impact</span>
                                    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                                        results.difference > 0 ? 'bg-emerald-100/50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-100/50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                    }`}>
                                        {results.difference > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                        {results.difference > 0 ? '+' : ''}{formatCurrency(results.difference)}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">Simulated PnL</p>
                                        <p className="text-xl font-black text-slate-900 dark:text-slate-100">{formatCurrency(results.simulatedPnL)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">Original PnL</p>
                                        <p className="text-xl font-black text-slate-500">{formatCurrency(results.originalPnL)}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <div className="p-3 bg-white/60 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/30">
                                    <p className="text-[9px] font-bold text-slate-500">Trades Filtered</p>
                                    <p className="text-sm font-black text-slate-800 dark:text-slate-200">{results.tradesRemoved}</p>
                                </div>
                                <div className="p-3 bg-white/60 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/30">
                                    <p className="text-[9px] font-bold text-slate-500">Win Rate Chg</p>
                                    <p className={`text-sm font-black ${results.successRateChange >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                        {results.successRateChange >= 0 ? '+' : ''}{results.successRateChange.toFixed(1)}%
                                    </p>
                                </div>
                            </div>

                            {/* AI Verdict */}
                            <div className={`p-4 rounded-2xl border flex items-center gap-4 ${
                                results.verdict === 'ADOPT' ? 'bg-emerald-100/50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30' : 
                                results.verdict === 'REJECT' ? 'bg-rose-100/50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30' : 
                                'bg-white/60 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/50'
                            }`}>
                                {results.verdict === 'ADOPT' ? <CheckCircle className="text-emerald-600 dark:text-emerald-400 shrink-0" size={24} /> : 
                                 results.verdict === 'REJECT' ? <XCircle className="text-rose-600 dark:text-rose-400 shrink-0" size={24} /> : 
                                 <Info className="text-slate-500 dark:text-slate-400 shrink-0" size={24} />}
                                
                                <div>
                                    <p className="text-[10px] font-black uppercase text-slate-500 mb-0.5">AI Verdict</p>
                                    <p className={`text-xs font-black uppercase tracking-tight ${
                                        results.verdict === 'ADOPT' ? 'text-emerald-600 dark:text-emerald-400' : 
                                        results.verdict === 'REJECT' ? 'text-rose-600 dark:text-rose-400' : 
                                        'text-slate-800 dark:text-slate-300'
                                    }`}>
                                        {results.verdict === 'ADOPT' ? 'Highly Recommended: Adopt this rule.' : 
                                         results.verdict === 'REJECT' ? 'Rule Rejected: Degrades performance.' : 
                                         'Neutral Impact: Not enough data or negligible change.'}
                                    </p>
                                </div>
                            </div>
                        </motion.div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center p-6 bg-white/40 dark:bg-slate-800/20 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700/50">
                            <History className="text-slate-400 dark:text-slate-700 mb-3" size={40} />
                            <h4 className="text-xs font-black text-slate-500 uppercase mb-2">Simulation Ready</h4>
                            <p className="text-[10px] leading-relaxed text-slate-600 max-w-[200px]">
                                Select a rule above to run a synthetic backtest against your trade history.
                            </p>
                        </div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default BacktesterWidget;
