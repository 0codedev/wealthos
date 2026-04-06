import React from 'react';
import { useTransactions } from '../../../contexts/TransactionContext';
import { Target, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface BudgetWidgetProps {
    formatCurrency: (val: number) => string;
}

export const BudgetWidget: React.FC<BudgetWidgetProps> = ({ formatCurrency }) => {
    const { spendingByCategory } = useTransactions();

    // Mock Budget Limits for generic categories
    const BUDGET_LIMITS: Record<string, number> = {
        'Food & Dining': 15000,
        'Groceries': 10000,
        'Transport': 5000,
        'Shopping': 8000,
        'Entertainment': 3000
    };

    const topCategories = spendingByCategory.slice(0, 4);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 md:p-6 border border-slate-200 dark:border-slate-800 h-[400px] flex flex-col">
            <div className="flex items-center justify-between mb-6 flex-shrink-0">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Target size={18} className="text-emerald-500" /> Monthly Budgets
                </h3>
                <button className="text-xs font-bold text-indigo-600 hover:text-indigo-500">Edit Limits</button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide space-y-5 pr-1 -mr-1">
                {topCategories.map(cat => {
                    const limit = BUDGET_LIMITS[cat.category] || 10000; // Default fallback
                    const percent = Math.min(100, Math.round((cat.amount / limit) * 100));
                    const isOver = percent >= 100;
                    const isNear = percent >= 80 && percent < 100;

                    let barColor = "bg-emerald-500";
                    if (isNear) barColor = "bg-amber-500";
                    if (isOver) barColor = "bg-rose-500";

                    return (
                        <div key={cat.category}>
                            <div className="flex justify-between items-end mb-1">
                                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{cat.category}</p>
                                <div className="text-right">
                                    <p className="text-xs font-bold text-slate-900 dark:text-white">
                                        {formatCurrency(cat.amount)} <span className="text-slate-400 font-normal">/ {formatCurrency(limit)}</span>
                                    </p>
                                </div>
                            </div>
                            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all duration-1000 ${barColor}`} style={{ width: `${percent}%` }}></div>
                            </div>
                            {isOver && <p className="text-[10px] text-rose-500 mt-1 flex items-center gap-1 font-bold"><AlertTriangle size={10} /> Over Budget</p>}
                            {!isOver && isNear && <p className="text-[10px] text-amber-500 mt-1 flex items-center gap-1 font-bold"><AlertTriangle size={10} /> Near Limit</p>}
                        </div>
                    );
                })}
            </div>

            <div className="mt-6 p-3 bg-emerald-50 dark:bg-emerald-900/10 rounded-xl border border-emerald-100 dark:border-emerald-900/30 flex items-start gap-3 flex-shrink-0">
                <CheckCircle2 size={16} className="text-emerald-500 mt-0.5" />
                <div>
                    <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">On Track</p>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-500/80 leading-snug">
                        You're within budget for {topCategories.filter(c => (c.amount / (BUDGET_LIMITS[c.category] || 10000)) < 1).length} categories this month. Keep it up!
                    </p>
                </div>
            </div>
        </div>
    );
};
