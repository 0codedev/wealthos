import React, { useMemo } from 'react';
import { AlertTriangle, PieChart, TrendingUp, Shield, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Investment } from '../../types';
import { formatCurrency } from '../../utils/helpers';

interface ConcentrationAlertsProps {
    investments: Investment[];
    threshold?: number; // Default 20%
}

interface ConcentrationRisk {
    investment: Investment;
    percentage: number;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

export const ConcentrationAlerts: React.FC<ConcentrationAlertsProps> = ({
    investments,
    threshold = 20
}) => {
    const totalValue = useMemo(() =>
        investments.reduce((acc, inv) => acc + (inv.currentValue || 0), 0),
        [investments]);

    const concentrationRisks = useMemo<ConcentrationRisk[]>(() => {
        if (totalValue <= 0) return [];

        return investments
            .map(inv => {
                const percentage = ((inv.currentValue || 0) / totalValue) * 100;
                let severity: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';

                if (percentage >= threshold * 1.5) severity = 'HIGH';
                else if (percentage >= threshold) severity = 'MEDIUM';
                else if (percentage >= threshold * 0.8) severity = 'LOW';
                else return null;

                return { investment: inv, percentage, severity };
            })
            .filter((r): r is ConcentrationRisk => r !== null && r.percentage >= threshold * 0.8)
            .sort((a, b) => b.percentage - a.percentage);
    }, [investments, totalValue, threshold]);

    const getSeverityStyles = (severity: 'HIGH' | 'MEDIUM' | 'LOW') => {
        switch (severity) {
            case 'HIGH':
                return {
                    bg: 'bg-rose-50 dark:bg-rose-900/10',
                    innerBg: 'bg-rose-100 dark:bg-rose-900/20',
                    border: 'border-rose-200 dark:border-rose-500/30',
                    text: 'text-rose-600 dark:text-rose-400',
                    label: 'CRITICAL'
                };
            case 'MEDIUM':
                return {
                    bg: 'bg-amber-50 dark:bg-amber-900/10',
                    innerBg: 'bg-amber-100 dark:bg-amber-900/20',
                    border: 'border-amber-200 dark:border-amber-500/30',
                    text: 'text-amber-600 dark:text-amber-500',
                    label: 'WARNING'
                };
            case 'LOW':
                return {
                    bg: 'bg-blue-50 dark:bg-blue-900/10',
                    innerBg: 'bg-blue-100 dark:bg-blue-900/20',
                    border: 'border-blue-200 dark:border-blue-500/30',
                    text: 'text-blue-600 dark:text-blue-500',
                    label: 'WATCH'
                };
        }
    };

    if (concentrationRisks.length === 0) {
        return (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center gap-4 shadow-inner">
                <div className="p-2.5 bg-emerald-100 dark:bg-emerald-900/30 rounded-full border border-emerald-200 dark:border-emerald-700">
                    <Shield className="text-emerald-600 dark:text-emerald-500" size={20} />
                </div>
                <div>
                    <p className="text-sm font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-tight">
                        Portfolio Well Diversified
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                        No single holding exceeds {threshold}% of your portfolio
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                    <AlertTriangle className="text-amber-600 dark:text-amber-500" size={18} />
                    <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">
                        Concentration Risk ({concentrationRisks.length})
                    </h4>
                </div>
                <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                    Threshold: {threshold}%
                </span>
            </div>

            {/* Risk Cards */}
            <div className="space-y-3 list-rise">
                {concentrationRisks.map((risk, idx) => {
                    const styles = getSeverityStyles(risk.severity);
                    return (
                        <motion.div
                            key={risk.investment.id || idx}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.25, delay: idx * 0.05 }}
                            className={`p-4 rounded-2xl border ${styles.bg} ${styles.border} transition-all hover:scale-[1.01] hover:shadow-md relative overflow-hidden group shadow-sm`}
                        >
                            <div className="flex items-center justify-between relative z-10">
                                <div className="flex items-center gap-4">
                                    {/* Percentage Badge */}
                                    <div className={`w-14 h-14 rounded-2xl ${styles.innerBg} border ${styles.border} flex items-center justify-center shadow-inner`}>
                                        <span className={`text-xl font-black ${styles.text} tabular-nums`}>
                                            {risk.percentage.toFixed(0)}%
                                        </span>
                                    </div>

                                    {/* Details */}
                                    <div>
                                        <p className="text-base font-black text-slate-900 dark:text-white tracking-tight line-clamp-1">
                                            {risk.investment.name}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400">
                                                {formatCurrency(risk.investment.currentValue || 0)}
                                            </span>
                                            <span className={`text-[9px] font-black tracking-widest px-2 py-0.5 rounded-lg border ${styles.innerBg} ${styles.border} ${styles.text}`}>
                                                {styles.label}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Action */}
                                <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 cursor-pointer transition-colors px-3 py-2 rounded-xl hover:bg-white dark:hover:bg-slate-800">
                                    <span className="text-[10px] font-black uppercase tracking-widest">Rebalance</span>
                                    <ChevronRight size={14} />
                                </div>
                            </div>

                            {/* Progress Bar */}
                            <div className="mt-4 h-1.5 bg-slate-100 dark:bg-slate-800/80 rounded-full overflow-hidden border border-slate-200 dark:border-transparent shadow-inner">
                                <div
                                    className={`h-full ${risk.severity === 'HIGH' ? 'bg-rose-500' : risk.severity === 'MEDIUM' ? 'bg-amber-500' : 'bg-blue-500'} transition-all duration-700 ease-out`}
                                    style={{ width: `${Math.min(risk.percentage, 100)}%` }}
                                />
                            </div>
                        </motion.div>
                    );
                })}
            </div>

            {/* Recommendation */}
            <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-inner">
                <p className="text-[11px] text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
                    <span className="font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest mr-1">💡 Strategic Insight:</span> 
                    Consider trimming positions above {threshold}% to mitigate single-stock tail risk. 
                    Portfolio diversification is the only free lunch in investing—it reduces variance and protects capital from localized shocks.
                </p>
            </div>
        </div>
    );
};

export default ConcentrationAlerts;
