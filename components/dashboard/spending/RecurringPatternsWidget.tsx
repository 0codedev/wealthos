import React from 'react';
import { useTransactions } from '../../../contexts/TransactionContext';
import { detectRecurringPatterns } from '../../../utils/transactionPatterns';
import { RefreshCw, Calendar } from 'lucide-react';

export const RecurringPatternsWidget: React.FC = () => {
    const { transactions } = useTransactions();
    const patterns = detectRecurringPatterns(transactions);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 md:p-6 border border-slate-200 dark:border-slate-800 h-[400px] flex flex-col">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex-shrink-0 flex items-center gap-2">
                <RefreshCw className="text-blue-500" size={18} /> Recurring
            </h3>

            <div className="flex-1 overflow-y-auto scrollbar-hide space-y-2 pr-1">
                {patterns.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                        <RefreshCw size={32} className="mb-2" />
                        <p className="text-sm">No recurring patterns detected yet.</p>
                    </div>
                ) : (
                    patterns.map((pattern) => (
                        <div key={pattern.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-slate-900 dark:text-white text-sm truncate max-w-[120px]">
                                        {pattern.merchant}
                                    </span>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${pattern.patternType === 'SIP' ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' :
                                        pattern.patternType === 'Subscription' ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300' :
                                            'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                                        }`}>
                                        {pattern.patternType}
                                    </span>
                                </div>
                                <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                                    <span>{pattern.frequency}</span>
                                    {pattern.nextExpectedDate && (
                                        <span className="flex items-center gap-1">
                                            <Calendar size={10} />
                                            {new Date(pattern.nextExpectedDate).toLocaleDateString()}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="font-bold text-slate-900 dark:text-white text-sm">₹{pattern.avgAmount?.toLocaleString() || '0'}</div>
                                <div className="text-[10px] text-slate-500">avg</div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
