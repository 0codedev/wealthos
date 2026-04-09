import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Flame, Target, TrendingUp, Calendar, Wallet, Calculator, Gauge, ChevronRight, Settings2, Plus } from 'lucide-react';
import { tactileHover } from '../../ui/animations';
import JargonTooltip from '../../shared/JargonTooltip';
import LegalDisclaimer from '../../shared/LegalDisclaimer';
import { EmptyState } from '../../shared/EmptyState';
import { formatCurrency } from '../../../utils/helpers';

interface FIREDashboardWidgetProps {
    stats?: { totalCurrent?: number; totalInvested?: number };
    formatCurrency?: (val: number) => string;
}

const FIREDashboardWidget: React.FC<FIREDashboardWidgetProps> = ({
    stats,
    formatCurrency = (v) => `₹${v.toLocaleString()}`
}) => {
    // FIRE parameters
    const [annualExpenses, setAnnualExpenses] = useState(600000); // ₹6L/year
    const [currentAge, setCurrentAge] = useState(30);
    const [targetAge, setTargetAge] = useState(45);
    const [expectedReturn, setExpectedReturn] = useState(12);
    const [withdrawalRate, setWithdrawalRate] = useState(4);
    const [monthlyContribution, setMonthlyContribution] = useState(25000);

    const currentWealth = stats?.totalCurrent || 0;

    // Calculate FIRE number and progress
    const fireMetrics = useMemo(() => {
        const fireNumber = annualExpenses / (withdrawalRate / 100);
        const progress = Math.min(100, (currentWealth / fireNumber) * 100);

        // Years to FIRE calculation (simplified)
        const monthlyReturn = expectedReturn / 100 / 12;
        const months = Math.log((fireNumber * monthlyReturn + monthlyContribution) /
            (currentWealth * monthlyReturn + monthlyContribution)) / Math.log(1 + monthlyReturn);
        const yearsToFire = Math.max(0, months / 12);

        const fireAge = currentAge + yearsToFire;
        const onTrack = fireAge <= targetAge;

        return { fireNumber, progress, yearsToFire, fireAge, onTrack };
    }, [annualExpenses, currentWealth, expectedReturn, withdrawalRate, currentAge, targetAge, monthlyContribution]);

    if (currentWealth <= 0) {
        return (
            <div className="bg-white/60 dark:bg-slate-950/50 backdrop-blur-xl rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xl relative overflow-hidden h-full flex flex-col">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center">
                        <Flame size={20} className="text-white fill-white" />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">FIRE Control</h3>
                        <p className="text-[10px] text-orange-600 dark:text-orange-400/80 font-mono">Freedom Flight Deck</p>
                    </div>
                </div>
                <EmptyState
                    variant="card"
                    icon={Flame}
                    title="No wealth tracked"
                    description="Add investments or set your net worth to see your path to financial freedom."
                    actionLabel="Add Investment"
                    onAction={() => window.dispatchEvent(new CustomEvent('app:open-add-investment'))}
                />
            </div>
        );
    }
    // Format Compact
    const formatCompact = (value: number): string => {
        if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)}Cr`;
        if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
        return `₹${(value / 1000).toFixed(0)}k`;
    };

    return (
        <motion.div
            {...tactileHover}
            className="bg-white/60 dark:bg-slate-950/50 backdrop-blur-xl rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xl relative overflow-hidden h-full flex flex-col group hover:border-orange-500/30 transition-colors duration-500 hover:shadow-2xl hover:shadow-orange-500/5"
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-6 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-600/20">
                        <Flame size={20} className="text-white fill-white animate-pulse" />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider inline-flex items-center">
                            FIRE Control<JargonTooltip term="Freedom Number" />
                        </h3>
                        <p className="text-[10px] text-orange-600 dark:text-orange-400/80 font-mono">Freedom Flight Deck</p>
                    </div>
                </div>
                <div className={`px-2 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wide flex items-center gap-1.5 ${fireMetrics.onTrack
                    ? 'bg-emerald-100/50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                    : 'bg-rose-100/50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-400'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${fireMetrics.onTrack ? 'bg-emerald-500' : 'bg-rose-500'} animate-pulse`} />
                    {fireMetrics.onTrack ? 'On Trajectory' : 'Deviation'}
                </div>
            </div>

            {/* Main Gauge & KPI */}
            <div className="grid grid-cols-2 gap-4 mb-6 relative z-10">
                {/* Progress Gauge */}
                <div className="bg-white/60 dark:bg-slate-900/50 backdrop-blur-sm rounded-xl p-4 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-transparent pointer-events-none" />

                    {/* Semi Circle Gauge Background */}
                    <div className="relative w-32 h-16 overflow-hidden mb-2">
                        <div className="w-32 h-32 rounded-full border-[10px] border-slate-200 dark:border-slate-800 absolute top-0 left-0" />
                        <motion.div
                            className="w-32 h-32 rounded-full border-[10px] border-transparent border-t-orange-500 border-r-orange-500 absolute top-0 left-0"
                            style={{
                                rotate: -45 + (fireMetrics.progress * 1.8), // Map 0-100 to rotation
                            }}
                            initial={{ rotate: -135 }}
                            animate={{ rotate: -135 + (Math.min(100, fireMetrics.progress) * 1.8) }}
                            transition={{ duration: 1.5, ease: "circOut" }}
                        />
                    </div>

                    <div className="text-center -mt-8 relative z-10">
                        <span className="text-2xl font-black text-slate-900 dark:text-white">{fireMetrics.progress.toFixed(1)}%</span>
                        <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Freedom Loading</p>
                    </div>
                </div>

                {/* Key Metric: FIRE Number */}
                <div className="flex flex-col gap-2">
                    <div className="flex-1 bg-white/60 dark:bg-slate-900/50 backdrop-blur-sm rounded-xl p-3 border border-slate-200 dark:border-slate-800 flex flex-col justify-center">
                        <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Target Corpus</p>
                        <p className="text-xl font-bold text-orange-600 dark:text-orange-400 font-mono tracking-tight">{formatCompact(fireMetrics.fireNumber)}</p>
                    </div>
                    <div className="flex-1 bg-white/60 dark:bg-slate-900/50 backdrop-blur-sm rounded-xl p-3 border border-slate-200 dark:border-slate-800 flex flex-col justify-center">
                        <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Est. Freedom Date</p>
                        <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            {Math.round(fireMetrics.yearsToFire)} Years
                            <span className="text-[10px] text-slate-600 dark:text-slate-500 font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">Age {Math.round(fireMetrics.fireAge)}</span>
                        </p>
                    </div>
                </div>
            </div>

            {/* Control Panel (Sliders) */}
            <div className="bg-white/60 dark:bg-slate-900 backdrop-blur-sm rounded-xl p-4 border border-slate-200 dark:border-slate-800 relative z-10 space-y-4">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                        <Settings2 size={12} />
                        <span className="text-[10px] font-bold uppercase">Flight Parameters</span>
                    </div>
                </div>

                {/* Monthly Expenses Slider */}
                <div className="space-y-1 group/slider">
                    <div className="flex justify-between text-[10px]">
                        <span className="text-slate-600 dark:text-slate-400">Monthly Expenses</span>
                        <span className="text-orange-600 dark:text-orange-400 font-mono font-bold">{formatCompact(annualExpenses / 12)}/mo</span>
                    </div>
                    <input
                        type="range"
                        min="20000" max="200000" step="505"
                        value={annualExpenses / 12}
                        onChange={(e) => setAnnualExpenses(Number(e.target.value) * 12)}
                        className="w-full h-1 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                    />
                </div>

                {/* Withdrawal Rate Slider */}
                <div className="space-y-1 group/slider">
                    <div className="flex justify-between text-[10px]">
                        <span className="text-slate-600 dark:text-slate-400 inline-flex items-center">Safe Withdrawal Rate<JargonTooltip term="Safe Withdrawal Rate" /></span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-mono font-bold">{withdrawalRate}%</span>
                    </div>
                    <input
                        type="range"
                        min="2" max="6" step="0.1"
                        value={withdrawalRate}
                        onChange={(e) => setWithdrawalRate(Number(e.target.value))}
                        className="w-full h-1 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                </div>
            </div>

            <LegalDisclaimer variant="simulation" compact className="relative z-10" />

            {/* Background Decor */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-[radial-gradient(circle_at_center,rgba(249,115,22,0.03),transparent_70%)] pointer-events-none" />
        </motion.div>
    );
};

export default FIREDashboardWidget;
