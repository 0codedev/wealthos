import React, { useMemo, useState, useEffect } from 'react';
import {
    Flag, Target, TrendingUp, ChevronRight,
    Trophy, Sparkles, Timer, Star, Flame, Gift, ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CountUp } from '../../shared/CountUp';
import { ValueFlash } from '../../shared/ValueFlash';

interface Project5LWidgetProps {
    currentWealth?: number;
    targetWealth?: number;
    monthlyContribution?: number;
    expectedReturn?: number;
    isNetWorth?: boolean;
}

// Milestone configuration
const MILESTONES = [
    { value: 100000, label: '1L', icon: Flag, color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
    { value: 500000, label: '5L', icon: Star, color: 'text-purple-400', bgColor: 'bg-purple-500/20' },
    { value: 1000000, label: '10L', icon: Flame, color: 'text-amber-400', bgColor: 'bg-amber-500/20' },
    { value: 2500000, label: '25L', icon: Trophy, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20' },
    { value: 5000000, label: '50L', icon: Gift, color: 'text-rose-400', bgColor: 'bg-rose-500/20' },
];

const formatCompact = (value: number): string => {
    if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)}Cr`;
    if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
    return `₹${value.toLocaleString('en-IN')}`;
};

const calculateDaysToGoal = (current: number, target: number, monthly: number, returnRate: number): number => {
    if (current >= target) return 0;
    if (monthly <= 0) return Infinity;
    const monthlyRate = returnRate / 100 / 12;
    let months = 0;
    let wealth = current;
    while (wealth < target && months < 600) {
        wealth = wealth * (1 + monthlyRate) + monthly;
        months++;
    }
    return months * 30;
};

const Project5LWidget: React.FC<Project5LWidgetProps> = ({
    currentWealth = 0,
    targetWealth = 5000000,
    monthlyContribution = 0,
    expectedReturn = 12,
    isNetWorth = false
}) => {
    const [animatedProgress, setAnimatedProgress] = useState(0);

    const progress = useMemo(() => {
        return Math.min(100, Math.max(0, (currentWealth / targetWealth) * 100));
    }, [currentWealth, targetWealth]);

    useEffect(() => {
        const timer = setTimeout(() => setAnimatedProgress(progress), 300);
        return () => clearTimeout(timer);
    }, [progress]);

    const daysToGoal = useMemo(() => calculateDaysToGoal(currentWealth, targetWealth, monthlyContribution, expectedReturn), [currentWealth, targetWealth, monthlyContribution, expectedReturn]);
    const yearsToGoal = Math.floor(daysToGoal / 365);
    const monthsRemaining = Math.floor((daysToGoal % 365) / 30);

    const nextMilestone = MILESTONES.find(m => currentWealth < m.value);
    // Find the next upcoming milestone for the progress bar calculation (optional, or just use linear)

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 md:p-6 shadow-sm relative overflow-hidden flex flex-col h-full">
            {/* Context Badge */}
            <div className="flex justify-between items-start mb-6">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <div className="p-1.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg">
                            <TrendingUp size={16} className="text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Project 5L</h3>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${isNetWorth
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
                        }`}>
                        {isNetWorth ? 'Net Worth Track' : 'Gross Asset Track'}
                    </span>
                </div>

                <div className="text-right">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Current Status</p>
                    <p className="text-2xl font-black text-slate-900 dark:text-white font-mono tracking-tight">
                        <ValueFlash value={progress} className="inline-block">
                            <CountUp
                                value={progress}
                                startFromZero
                                decimals={1}
                                format={(n) => n.toFixed(1)}
                            />
                        </ValueFlash>
                        %
                    </p>
                </div>
            </div>

            {/* Progress Bar Container */}
            <div className="relative h-12 mb-8 select-none">
                {/* Track */}
                <div className="absolute top-1/2 -translate-y-1/2 left-0 w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    {/* Fill */}
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${animatedProgress}%` }}
                        transition={{ duration: 1.2, ease: "easeOut" }}
                        className={`h-full ${isNetWorth ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-gradient-to-r from-indigo-500 to-purple-500'}`}
                    />
                </div>

                {/* Milestones Ticks */}
                <div className="absolute top-1/2 -translate-y-1/2 left-0 w-full h-full pointer-events-none">
                    {MILESTONES.map((m) => {
                        const mPosition = (m.value / targetWealth) * 100;
                        const isPassed = currentWealth >= m.value;

                        return (
                            <div
                                key={m.label}
                                className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center group"
                                style={{ left: `${mPosition}%`, transform: 'translateX(-50%)' }}
                            >
                                {/* Tick Marker */}
                                <div className={`w-1 h-3 mb-1 rounded-full transition-colors duration-300 ${isPassed
                                    ? (isNetWorth ? 'bg-emerald-500' : 'bg-indigo-500')
                                    : 'bg-slate-300 dark:bg-slate-700'}`}
                                />

                                {/* Label Bubble */}
                                <div className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all duration-300 ${isPassed
                                    ? (isNetWorth
                                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                                        : 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-400')
                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
                                    }`}>
                                    {m.label}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-4 mt-auto">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2 mb-1">
                        <Target size={12} className="text-slate-400" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Target Goal</span>
                    </div>
                    <p className="text-lg font-bold text-slate-700 dark:text-slate-200 font-mono">
                        <ValueFlash value={targetWealth} className="inline-block">
                            <CountUp value={targetWealth} format={formatCompact} />
                        </ValueFlash>
                    </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2 mb-1">
                        <Timer size={12} className="text-slate-400" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Est. Completion</span>
                    </div>
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                        {daysToGoal === Infinity ? 'N/A' : (
                            yearsToGoal > 0 ? `${yearsToGoal} Yrs ${monthsRemaining} Mos` : `${monthsRemaining} Months`
                        )}
                    </p>
                </div>
            </div>

            {/* Next Milestone Message */}
            {nextMilestone && (
                <div className="mt-4 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <span>Next: <span className="font-bold text-slate-700 dark:text-slate-300">{nextMilestone.label}</span></span>
                    <span className="font-mono">
                        <ValueFlash value={nextMilestone.value - currentWealth} className="inline-block">
                            <CountUp value={nextMilestone.value - currentWealth} format={formatCompact} />
                        </ValueFlash>
                        {' '}to go
                    </span>
                </div>
            )}
        </div>
    );
};

export default Project5LWidget;
