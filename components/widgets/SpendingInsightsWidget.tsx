import React, { useState, useMemo } from 'react';
import { Brain, Sparkles, TrendingUp, TrendingDown, ArrowRight, RefreshCw } from 'lucide-react';
import { useTransactions } from '../../contexts/TransactionContext';

interface SpendingInsightsWidgetProps {
    formatCurrency?: (val: number) => string;
}

interface Insight {
    type: 'warning' | 'tip' | 'achievement';
    title: string;
    description: string;
    icon: string;
}

export const SpendingInsightsWidget: React.FC<SpendingInsightsWidgetProps> = ({
    formatCurrency = (v) => `₹${v.toLocaleString('en-IN')}`
}) => {
    const { transactions, spendingByCategory } = useTransactions();
    const [showDemo, setShowDemo] = useState(false);

    const insights = useMemo((): Insight[] => {
        if (transactions.length === 0) return [];

        const result: Insight[] = [];

        // Find top spending category
        const topCategory = spendingByCategory.sort((a, b) => b.amount - a.amount)[0];
        if (topCategory) {
            result.push({
                type: 'warning',
                title: `High ${topCategory.category} expenses`,
                description: `You spent ${formatCurrency(topCategory.amount)} on ${topCategory.category} this month. Consider setting a limit.`,
                icon: '⚠️'
            });
        }

        // Check for investment transactions
        const investmentSpend = spendingByCategory.find(c => c.category.toLowerCase().includes('investment'));
        if (investmentSpend && investmentSpend.amount > 0) {
            result.push({
                type: 'achievement',
                title: 'Great investing habit!',
                description: `You invested ${formatCurrency(investmentSpend.amount)} this month. Money saved = Money invested 🎯`,
                icon: '🚀'
            });
        }

        // Tip for food spending
        const foodSpend = spendingByCategory.find(c =>
            c.category.toLowerCase().includes('food') || c.category.toLowerCase().includes('dining')
        );
        if (foodSpend && foodSpend.amount > 5000) {
            result.push({
                type: 'tip',
                title: 'Food spending tip',
                description: `Try meal prepping to save up to 40% on food expenses. You could save ${formatCurrency(foodSpend.amount * 0.4)}/month.`,
                icon: '💡'
            });
        }

        return result;
    }, [transactions, spendingByCategory, formatCurrency]);

    const demoInsights: Insight[] = [
        {
            type: 'warning',
            title: 'Unusual spending detected',
            description: 'Your shopping expenses are 45% higher than your monthly average.',
            icon: '⚠️'
        },
        {
            type: 'achievement',
            title: 'Savings streak!',
            description: 'You\'ve saved more than 30% of income for 3 consecutive months.',
            icon: '🏆'
        },
        {
            type: 'tip',
            title: 'Switch to annual plans',
            description: 'For Netflix, Spotify subscriptions - save ₹1,200/year with annual billing.',
            icon: '💡'
        }
    ];

    const displayInsights = showDemo ? demoInsights : insights;

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg">
                        <Sparkles size={18} className="text-white" />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900 dark:text-white">AI Insights</h3>
                        <p className="text-xs text-slate-500">Smart spending analysis</p>
                    </div>
                </div>
                {transactions.length === 0 && (
                    <button
                        onClick={() => setShowDemo(!showDemo)}
                        className="text-xs text-indigo-600 dark:text-indigo-400 flex items-center gap-1 hover:underline"
                    >
                        {showDemo ? 'Hide' : '+ Demo'}
                    </button>
                )}
            </div>

            {displayInsights.length === 0 ? (
                <div className="text-center py-8">
                    <Brain size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm text-slate-500 font-medium">No Insights Yet</p>
                    <p className="text-xs text-slate-400 mb-4">We will analyze your spending patterns and provide tips</p>
                    <button
                        onClick={() => setShowDemo(true)}
                        className="px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-xl text-sm font-medium flex items-center gap-2 mx-auto hover:opacity-90 transition-opacity"
                    >
                        <Sparkles size={14} /> See Demo Insight
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    {displayInsights.map((insight, idx) => (
                        <div
                            key={idx}
                            className={`p-4 rounded-xl ${insight.type === 'warning'
                                    ? 'bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20'
                                    : insight.type === 'achievement'
                                        ? 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20'
                                        : 'bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20'
                                }`}
                        >
                            <div className="flex items-start gap-3">
                                <span className="text-xl">{insight.icon}</span>
                                <div className="flex-1">
                                    <p className={`text-sm font-bold ${insight.type === 'warning'
                                            ? 'text-amber-700 dark:text-amber-400'
                                            : insight.type === 'achievement'
                                                ? 'text-emerald-700 dark:text-emerald-400'
                                                : 'text-indigo-700 dark:text-indigo-400'
                                        }`}>
                                        {insight.title}
                                    </p>
                                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                                        {insight.description}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SpendingInsightsWidget;
