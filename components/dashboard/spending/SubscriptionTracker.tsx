import React, { useMemo } from 'react';
import { useTransactions } from '../../../contexts/TransactionContext';
import { Calendar, RefreshCcw, Bell } from 'lucide-react';

interface SubscriptionTrackerProps {
    formatCurrency: (val: number) => string;
}

export const SubscriptionTracker: React.FC<SubscriptionTrackerProps> = ({ formatCurrency }) => {
    const { transactions } = useTransactions();

    // Mock logic to identify subscriptions (recurring same-amount transactions or specific keywords)
    const subscriptions = useMemo(() => {
        const potentialSubs: any[] = [];
        const seen = new Set();

        // Keywords for common subs
        const subsKeywords = ['netflix', 'spotify', 'prime', 'hotstar', 'apple', 'youtube', 'google storage', 'icloud', 'jio', 'airtel', 'rent'];

        transactions.forEach(t => {
            const lowerDesc = (t.merchant || t.description).toLowerCase();
            const isSub = subsKeywords.some(k => lowerDesc.includes(k));

            if (isSub && !seen.has(lowerDesc)) {
                seen.add(lowerDesc);
                potentialSubs.push({
                    id: t.id,
                    name: t.merchant || t.description,
                    amount: t.amount,
                    date: t.date,
                    frequency: 'Monthly' // Mock frequency
                });
            }
        });

        return potentialSubs;
    }, [transactions]);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 md:p-6 border border-slate-200 dark:border-slate-800 h-[400px] flex flex-col">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <RefreshCcw size={18} className="text-indigo-500" /> Recurring & Subs
                </h3>
                <span className="text-xs font-bold bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded-full">
                    {subscriptions.length} Active
                </span>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide pr-1 -mr-1">
                {subscriptions.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 h-full flex flex-col items-center justify-center">
                        <Bell size={32} className="mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No subscriptions detected</p>
                    </div>
                ) : (
                    <div className="space-y-3 pb-2">
                        {subscriptions.map(sub => (
                            <div key={sub.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-white dark:bg-slate-900 flex items-center justify-center text-slate-500 shadow-sm border border-slate-200 dark:border-slate-700 font-bold text-xs uppercase flex-shrink-0">
                                        {sub.name.slice(0, 2)}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-bold text-slate-900 dark:text-white text-sm truncate max-w-[120px]">{sub.name}</p>
                                        <p className="text-xs text-slate-500 flex items-center gap-1">
                                            <Calendar size={10} /> {sub.frequency}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <p className="font-bold text-slate-900 dark:text-white text-sm">{formatCurrency(sub.amount)}</p>
                                    <p className="text-[10px] text-slate-400">Due {new Date(sub.date).getDate()}th</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex-shrink-0">
                <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">Total Monthly</span>
                    <span className="font-bold text-slate-900 dark:text-white">
                        {formatCurrency(subscriptions.reduce((sum, s) => sum + s.amount, 0))}
                    </span>
                </div>
            </div>
        </div>
    );
};
