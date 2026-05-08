import React, { useMemo } from 'react';
import { Wallet, TrendingUp, TrendingDown, PiggyBank, AlertTriangle } from 'lucide-react';
import { useTransactions } from '../../contexts/TransactionContext';

interface MonthlyBudgetSummaryProps {
    formatCurrency?: (val: number) => string;
}

export const MonthlyBudgetSummary: React.FC<MonthlyBudgetSummaryProps> = ({
    formatCurrency = (v) => `₹${v.toLocaleString('en-IN')}`
}) => {
    const { transactions } = useTransactions();

    const stats = useMemo(() => {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        const monthTransactions = transactions.filter(t => {
            const txDate = new Date(t.date);
            return txDate.getMonth() === currentMonth && txDate.getFullYear() === currentYear;
        });

        const income = monthTransactions
            .filter(t => t.type === 'credit')
            .reduce((sum, t) => sum + t.amount, 0);

        const spent = monthTransactions
            .filter(t => t.type === 'debit' && !t.excluded)
            .reduce((sum, t) => sum + t.amount, 0);

        const investable = income - spent;
        const savingsRate = income > 0 ? ((income - spent) / income * 100) : 0;

        return { income, spent, investable, savingsRate };
    }, [transactions]);

    const monthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm transition-shadow duration-300 hover:shadow-lg hover:shadow-indigo-500/5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-indigo-100 dark:bg-indigo-500/20 rounded-lg">
                        <Wallet size={18} className="text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900 dark:text-white">Monthly Budget</h3>
                        <p className="text-xs text-slate-500">{monthName}</p>
                    </div>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-3 mb-4">
                {/* Income */}
                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl text-center transition-transform duration-200 hover:-translate-y-0.5">
                    <TrendingUp size={16} className="mx-auto mb-1 text-emerald-500" />
                    <p className="text-lg font-bold text-slate-900 dark:text-white font-tabular">
                        {formatCurrency(stats.income)}
                    </p>
                    <p className="text-[10px] text-slate-500 uppercase">Income</p>
                </div>

                {/* Spent */}
                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl text-center transition-transform duration-200 hover:-translate-y-0.5">
                    <Wallet size={16} className="mx-auto mb-1 text-rose-500" />
                    <p className="text-lg font-bold text-slate-900 dark:text-white font-tabular">
                        {formatCurrency(stats.spent)}
                    </p>
                    <p className="text-[10px] text-slate-500 uppercase">Spent</p>
                </div>

                {/* Investable */}
                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl text-center transition-transform duration-200 hover:-translate-y-0.5">
                    <PiggyBank size={16} className="mx-auto mb-1 text-cyan-500" />
                    <p className={`text-lg font-bold font-tabular ${stats.investable >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {stats.investable >= 0 ? '' : '-'}{formatCurrency(Math.abs(stats.investable))}
                    </p>
                    <p className="text-[10px] text-slate-500 uppercase">Investable</p>
                </div>
            </div>

            {/* Savings Rate */}
            <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-600 dark:text-slate-400">Savings Rate</span>
                    <span className={`text-sm font-bold ${stats.savingsRate >= 30 ? 'text-emerald-500' : stats.savingsRate >= 0 ? 'text-amber-500' : 'text-rose-500'}`}>
                        {stats.savingsRate >= 0 ? '' : ''}{stats.savingsRate.toFixed(0)}%
                    </span>
                </div>
                <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all ${stats.savingsRate >= 30 ? 'bg-emerald-500' : stats.savingsRate >= 0 ? 'bg-amber-500' : 'bg-rose-500'}`}
                        style={{ width: `${Math.min(100, Math.max(0, stats.savingsRate))}%` }}
                    />
                </div>
                {stats.savingsRate < 30 && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                        <AlertTriangle size={10} /> Try to save at least 30% of income
                    </p>
                )}
            </div>
        </div>
    );
};

export default MonthlyBudgetSummary;
