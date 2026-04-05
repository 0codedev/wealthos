import React, { useMemo } from 'react';
import { Flame, TrendingUp, Target, Zap, Award, Calendar } from 'lucide-react';

interface FinancialIndependenceScoreProps {
    totalAssets: number;
    monthlyExpenses: number;
    monthlyIncome: number;
    age?: number;
    formatCurrency?: (val: number) => string;
}

export const FinancialIndependenceScore: React.FC<FinancialIndependenceScoreProps> = ({
    totalAssets,
    monthlyExpenses,
    monthlyIncome,
    age = 30,
    formatCurrency = (v) => `₹${v.toLocaleString('en-IN')}`
}) => {
    const stats = useMemo(() => {
        // Calculate months of runway (how long you can survive without income)
        const monthsRunway = monthlyExpenses > 0 ? Math.floor(totalAssets / monthlyExpenses) : 0;

        // Calculate savings rate
        const savingsRate = monthlyIncome > 0 ? ((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100 : 0;

        // Calculate FIRE number (25x annual expenses)
        const annualExpenses = monthlyExpenses * 12;
        const fireNumber = annualExpenses * 25;

        // Calculate progress to FIRE
        const fireProgress = fireNumber > 0 ? (totalAssets / fireNumber) * 100 : 0;

        // Estimate years to FIRE (simplified)
        const monthlySavings = monthlyIncome - monthlyExpenses;
        const yearsToFire = monthlySavings > 0 && fireNumber > totalAssets
            ? Math.ceil((fireNumber - totalAssets) / (monthlySavings * 12))
            : 0;

        // Calculate FI Score (0-100)
        // Factors: savings rate, runway, FIRE progress
        const fiScore = Math.min(100, Math.round(
            (savingsRate * 0.3) + // 30% weight on savings rate
            (Math.min(monthsRunway, 24) / 24 * 30) + // 30% weight on runway (max 24 months)
            (fireProgress * 0.4) // 40% weight on FIRE progress
        ));

        // Determine level
        const level = fiScore >= 80 ? 'Coast FIRE'
            : fiScore >= 60 ? 'On Track'
                : fiScore >= 40 ? 'Building'
                    : fiScore >= 20 ? 'Starting'
                        : 'Beginner';

        return {
            monthsRunway,
            savingsRate,
            fireNumber,
            fireProgress,
            yearsToFire,
            fiScore,
            level
        };
    }, [totalAssets, monthlyExpenses, monthlyIncome]);

    const getScoreColor = (score: number) => {
        if (score >= 80) return 'from-emerald-400 to-teal-500';
        if (score >= 60) return 'from-cyan-400 to-blue-500';
        if (score >= 40) return 'from-amber-400 to-orange-500';
        return 'from-rose-400 to-pink-500';
    };

    return (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-4 sm:p-5 md:p-6 text-white shadow-xl relative overflow-hidden">
            {/* Background decoration */}
            <div className="absolute top-0 right-0 opacity-5">
                <Flame size={150} />
            </div>

            <div className="relative z-10">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg">
                            <Flame size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold">FIRE Score</h3>
                            <p className="text-xs text-slate-400">Financial Independence Progress</p>
                        </div>
                    </div>
                    <div className={`px-3 py-1 rounded-full bg-gradient-to-r ${getScoreColor(stats.fiScore)} text-xs font-bold`}>
                        {stats.level}
                    </div>
                </div>

                {/* Main Score */}
                <div className="text-center mb-6">
                    <div className={`inline-flex items-baseline gap-1 text-5xl font-black bg-gradient-to-r ${getScoreColor(stats.fiScore)} bg-clip-text text-transparent`}>
                        {stats.fiScore}
                        <span className="text-lg text-slate-400">/100</span>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-white/5 p-3 rounded-xl">
                        <div className="flex items-center gap-2 mb-1">
                            <Calendar size={14} className="text-cyan-400" />
                            <span className="text-xs text-slate-400">Runway</span>
                        </div>
                        <p className="text-lg font-bold">{stats.monthsRunway} months</p>
                    </div>
                    <div className="bg-white/5 p-3 rounded-xl">
                        <div className="flex items-center gap-2 mb-1">
                            <TrendingUp size={14} className="text-emerald-400" />
                            <span className="text-xs text-slate-400">Savings Rate</span>
                        </div>
                        <p className="text-lg font-bold">{stats.savingsRate.toFixed(0)}%</p>
                    </div>
                    <div className="bg-white/5 p-3 rounded-xl">
                        <div className="flex items-center gap-2 mb-1">
                            <Target size={14} className="text-amber-400" />
                            <span className="text-xs text-slate-400">FIRE Number</span>
                        </div>
                        <p className="text-lg font-bold">{formatCurrency(stats.fireNumber)}</p>
                    </div>
                    <div className="bg-white/5 p-3 rounded-xl">
                        <div className="flex items-center gap-2 mb-1">
                            <Zap size={14} className="text-purple-400" />
                            <span className="text-xs text-slate-400">Years to FIRE</span>
                        </div>
                        <p className="text-lg font-bold">{stats.yearsToFire > 0 ? `${stats.yearsToFire} yrs` : '∞'}</p>
                    </div>
                </div>

                {/* Progress Bar */}
                <div>
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                        <span>FIRE Progress</span>
                        <span>{stats.fireProgress.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                        <div
                            className={`h-full bg-gradient-to-r ${getScoreColor(stats.fiScore)} transition-all duration-1000`}
                            style={{ width: `${Math.min(100, stats.fireProgress)}%` }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FinancialIndependenceScore;
