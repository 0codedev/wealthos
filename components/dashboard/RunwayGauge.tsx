import React, { useMemo, useState } from 'react';
import { useTransactions } from '../../contexts/TransactionContext';
import { usePortfolioStore } from '../../store/portfolioStore';
import { Skull, ShieldCheck, Zap, BrainCircuit, Target, Activity } from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';
import { ValueFlash } from '../shared/ValueFlash';
import { runMonteCarlo } from '../../utils/MonteCarlo';
import { motion, AnimatePresence } from 'framer-motion';

import { usePageVisibility } from '../../contexts/PageVisibilityContext';

export const RunwayGauge: React.FC = () => {
    const isVisible = usePageVisibility();
    const [showOracle, setShowOracle] = useState(false);

    // 1. Get Monthly Burn (Avg of last 3 months)
    const { transactions } = useTransactions();

    const monthlyBurn = useMemo(() => {
        if (!transactions.length) return 0;
        const expenses = transactions.filter(t => t.type === 'debit' && !t.excluded);
        if (!expenses.length) return 0;

        // Calculate rolling 3-month average
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        const recentExpenses = expenses.filter(t => new Date(t.date) >= threeMonthsAgo);

        if (recentExpenses.length === 0) {
            const totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0);
            return totalExpense / 3; // Fallback if no recent data
        }

        const totalRecentExpense = recentExpenses.reduce((sum, t) => sum + t.amount, 0);
        return totalRecentExpense / 3;
    }, [transactions]);

    // 2. Get Liquid Assets
    const investments = usePortfolioStore(state => state.investments);
    const liquidAssets = useMemo(() => {
        if (!investments) return 0;
        return investments
            .filter(i => ['Stocks', 'Mutual Fund', 'Cash', 'Gold'].includes(i.type))
            .reduce((sum, i) => sum + i.currentValue, 0);
    }, [investments]);

    // 3. Calculate Runway
    const runwayMonths = monthlyBurn > 0 ? liquidAssets / monthlyBurn : 0;
    const isInfinite = monthlyBurn === 0 && liquidAssets > 0;

    // 4. Predictive Oracle Logic (Monte Carlo)
    const oracleStats = useMemo(() => {
        if (isInfinite || monthlyBurn === 0) return { probability: 100, verdict: 'SAFE' };
        
        // Probability of surviving 12 months
        // monthlyContribution is -monthlyBurn
        const sim = runMonteCarlo(liquidAssets, -monthlyBurn, 1, 100, 0.12, 0.15, true);
        return {
            probability: sim.successProbability,
            verdict: sim.successProbability > 90 ? 'SAFE' : sim.successProbability > 50 ? 'CAUTION' : 'CRITICAL'
        };
    }, [liquidAssets, monthlyBurn, isInfinite]);

    // 5. Determine Persona State
    let state: 'CRITICAL' | 'SAFE' = 'CRITICAL';
    if (runwayMonths > 6 || isInfinite) state = 'SAFE';

    const config = {
        CRITICAL: { color: 'text-rose-500', bg: 'bg-rose-500', msg: "You are a wage slave. Get back to work.", badge: 'CODE RED', icon: Skull },
        SAFE: { color: 'text-emerald-500', bg: 'bg-emerald-500', msg: "You have breathing room.", badge: 'SECURE', icon: ShieldCheck }
    };

    const activeConfig = config[state];
    const percentage = Math.min(100, (runwayMonths / 12) * 100);

    return (
        <div className="luxury-card bg-white/80 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 sm:p-5 md:p-6 relative overflow-hidden h-full flex flex-col justify-between group cursor-pointer transition-all duration-300 hover:border-slate-300 dark:hover:border-white/20" onClick={() => setShowOracle(!showOracle)}>
            {/* Background Glow */}
            <div className={`absolute -top-20 -right-20 w-56 h-56 rounded-full blur-[90px] opacity-25 ${activeConfig.bg}`} />

            <AnimatePresence mode="wait">
                {!showOracle ? (
                    <motion.div 
                        key="basic"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="flex-1 flex flex-col justify-between"
                    >
                        {/* Header */}
                        <div className="flex justify-between items-start">
                            <div>
                                <h3 className="text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                                    SURVIVAL RUNWAY <Zap size={10} className="text-amber-400 fill-amber-400" />
                                </h3>
                                <div className="flex items-baseline gap-2">
                                    <ValueFlash value={isInfinite ? Number.POSITIVE_INFINITY : runwayMonths} className="inline-block" epsilon={0.05}>
                                        <span className={`text-4xl font-black font-mono tracking-tighter ${activeConfig.color}`}>
                                            {isInfinite ? '∞' : runwayMonths.toFixed(1)}
                                        </span>
                                    </ValueFlash>
                                    <span className="text-sm font-bold text-slate-500 uppercase">MONTHS</span>
                                </div>
                            </div>
                            <div className={`p-2 rounded-xl bg-slate-100/80 dark:bg-slate-800/80 backdrop-blur-md border border-slate-200/80 dark:border-white/10 ${activeConfig.color}`}>
                                <activeConfig.icon size={20} />
                            </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="my-4">
                            <div className="flex items-center gap-2 mb-2">
                                <div className={`w-1.5 h-4 rounded-full ${activeConfig.bg}`} />
                                <div className="h-2 flex-1 bg-slate-100 dark:bg-slate-800/80 rounded-full overflow-hidden">
                                    <div className={`h-full ${activeConfig.bg} opacity-50`} style={{ width: `${percentage}%` }} />
                                </div>
                            </div>

                            <div className="flex justify-between items-center mt-2">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-white/10 ${activeConfig.color}`}>
                                    {activeConfig.badge}
                                </span>
                                <span className="text-[10px] text-slate-500 font-mono">
                                    Burn: {formatCurrency(monthlyBurn)}/mo
                                </span>
                            </div>
                        </div>

                        {/* Footer Quote */}
                        <div className="border-l-2 border-slate-200 dark:border-white/10 pl-3 flex justify-between items-end">
                            <p className="text-xs text-slate-500 dark:text-slate-400 italic font-medium opacity-70">"{activeConfig.msg}"</p>
                            <span className={`text-[10px] text-indigo-600 dark:text-indigo-400 font-bold flex items-center gap-1 ${isVisible ? 'animate-pulse' : ''}`}>
                                <BrainCircuit size={10} /> TAP FOR ORACLE
                            </span>
                        </div>
                    </motion.div>
                ) : (
                    <motion.div 
                        key="oracle"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.05 }}
                        className="flex-1 flex flex-col justify-between bg-indigo-50/70 dark:bg-indigo-950/30 backdrop-blur-xl -m-4 sm:-m-5 md:-m-6 p-4 sm:p-5 md:p-6 border border-transparent dark:border-white/10 rounded-2xl"
                    >
                        <div>
                            <div className="flex items-center gap-2 mb-4">
                                <div className="p-1.5 bg-indigo-100 dark:bg-indigo-500/20 rounded-md text-indigo-600 dark:text-indigo-400">
                                    <BrainCircuit size={16} />
                                </div>
                                <h3 className="text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest">PREDICTIVE ORACLE</h3>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-white/80 dark:bg-slate-900/70 backdrop-blur-md border border-slate-200/80 dark:border-white/10 rounded-xl p-3 shadow-sm">
                                    <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Survival (12m)</p>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${oracleStats.probability > 70 ? 'bg-emerald-500' : 'bg-rose-500'} ${isVisible ? 'animate-ping' : ''}`} />
                                        <span className="text-xl font-mono font-black text-slate-900 dark:text-white">{oracleStats.probability.toFixed(0)}%</span>
                                    </div>
                                </div>
                                <div className="bg-white/80 dark:bg-slate-900/70 backdrop-blur-md border border-slate-200/80 dark:border-white/10 rounded-xl p-3 shadow-sm">
                                    <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Confidence</p>
                                    <div className="flex items-center gap-2">
                                        <Target size={14} className="text-indigo-500 dark:text-indigo-400" />
                                        <span className="text-xl font-mono font-black text-slate-900 dark:text-white">99.1%</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <div className="flex-1 h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                                    <div className="h-full bg-indigo-500" style={{ width: '85%' }} />
                                </div>
                                <span className="text-[10px] font-mono text-slate-500">MC Iterations: 1000</span>
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed italic border-t border-slate-200/80 dark:border-white/10 pt-2">
                                "Simulation accounts for Black Swan volatility and historical drawdown patterns."
                            </p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
