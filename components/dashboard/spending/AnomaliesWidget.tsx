import React, { useMemo } from 'react';
import { useTransactions } from '../../../contexts/TransactionContext';
import { detectAnomalies, getCategoryTrends } from '../../../utils/transactionPatterns';
import { AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';

export const AnomaliesWidget: React.FC = () => {
    const { transactions } = useTransactions();

    const { anomalies, trends } = useMemo(() => {
        return {
            anomalies: detectAnomalies(transactions),
            trends: getCategoryTrends(transactions)
        };
    }, [transactions]);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 md:p-6 border border-slate-200 dark:border-slate-800 h-[400px] flex flex-col">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex-shrink-0 flex items-center gap-2">
                <AlertTriangle className="text-orange-500" size={18} /> Anomalies & Trends
            </h3>

            <div className="flex-1 overflow-y-auto scrollbar-hide space-y-6 pr-1">
                {/* Anomalies Section */}
                {anomalies.length > 0 && (
                    <div className="space-y-2">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Unusual Spend</h4>
                        {anomalies.slice(0, 5).map((anomaly, idx) => (
                            <div key={idx} className={`p-2 rounded-lg border ${anomaly.severity === 'high' ? 'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30' :
                                'bg-orange-50 dark:bg-orange-900/10 border-orange-100 dark:border-orange-900/30'
                                }`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-slate-900 dark:text-white truncate">
                                            {anomaly.transaction.description}
                                        </div>
                                        <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5">
                                            {anomaly.reason}
                                        </div>
                                    </div>
                                    <div className="text-right ml-2">
                                        <div className="font-bold text-slate-900 dark:text-white text-xs">₹{anomaly.transaction.amount?.toLocaleString() || '0'}</div>
                                        <div className="text-[10px] text-slate-500">vs ₹{anomaly.avgAmount?.toLocaleString() || '0'}</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Trends Section */}
                <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Category Shifts</h4>
                    {trends
                        .filter(trend => Math.abs(trend.changePercent) > 10)
                        .sort((a, b) => b.currentAmount - a.currentAmount)
                        .slice(0, 5)
                        .map((trend) => (
                            <div key={trend.category} className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800">
                                <div className="flex-1">
                                    <div className="text-xs font-medium text-slate-900 dark:text-white">{trend.category}</div>
                                    <div className="text-[10px] text-slate-500">
                                        ₹{trend.currentAmount?.toLocaleString() || '0'}
                                    </div>
                                </div>
                                <div className={`flex items-center gap-1 text-xs font-medium ${trend.change > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                                    }`}>
                                    {trend.change > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                    {Math.abs(trend.changePercent).toFixed(1)}%
                                </div>
                            </div>
                        ))}
                </div>
            </div>
        </div>
    );
};
