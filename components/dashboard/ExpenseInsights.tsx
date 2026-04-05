import React, { useMemo } from 'react';
import { useTransactions } from '../../contexts/TransactionContext';
import { TrendingUp, TrendingDown, Lightbulb, AlertTriangle, DollarSign } from 'lucide-react';

interface InsightItem {
    icon: React.ReactNode;
    title: string;
    description: string;
    color: string;
}

/**
 * ExpenseInsights - Displays AI-generated spending insights
 */
export const ExpenseInsights: React.FC = () => {
    const { transactions, spendingByCategory, totalSpending } = useTransactions();

    const insights = useMemo((): InsightItem[] => {
        const result: InsightItem[] = [];

        // Top Category Insight
        if (spendingByCategory.length > 0) {
            const topCat = spendingByCategory[0];
            const percent = totalSpending > 0 ? Math.round((topCat.amount / totalSpending) * 100) : 0;
            result.push({
                icon: <TrendingUp size={18} />,
                title: `${topCat.category} dominates your spending`,
                description: `${percent}% of your total expenses go to ${topCat.category.toLowerCase()}.`,
                color: 'text-indigo-600'
            });
        }

        // Frequency Insight
        const dayMap = new Map<string, number>();
        transactions.forEach(t => {
            const day = new Date(t.date).toLocaleDateString('en', { weekday: 'long' });
            dayMap.set(day, (dayMap.get(day) || 0) + 1);
        });
        const busyDay = Array.from(dayMap.entries()).sort((a, b) => b[1] - a[1])[0];
        if (busyDay) {
            result.push({
                icon: <Lightbulb size={18} />,
                title: `${busyDay[0]}s are your spending days`,
                description: `You make the most transactions on ${busyDay[0]}s.`,
                color: 'text-amber-600'
            });
        }

        return result.slice(0, 3);
    }, [transactions, spendingByCategory, totalSpending]);

    if (insights.length === 0) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
                <div className="flex items-center gap-2 mb-3">
                    <DollarSign className="text-emerald-500" size={18} />
                    <h3 className="font-bold text-slate-900 dark:text-white">Expense Insights</h3>
                </div>
                <p className="text-slate-500 text-sm">Import transactions to see personalized insights.</p>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
            <div className="flex items-center gap-2 mb-4">
                <DollarSign className="text-emerald-500" size={18} />
                <h3 className="font-bold text-slate-900 dark:text-white">Expense Insights</h3>
            </div>
            <div className="space-y-4">
                {insights.map((insight, idx) => (
                    <div key={idx} className="flex gap-3">
                        <div className={`w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 ${insight.color}`}>
                            {insight.icon}
                        </div>
                        <div>
                            <p className="font-medium text-slate-900 dark:text-white text-sm">{insight.title}</p>
                            <p className="text-xs text-slate-500">{insight.description}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ExpenseInsights;
