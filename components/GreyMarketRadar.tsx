import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react';

interface GreyMarketRadarProps {
    currentGmp: number;
    subscription: number;
}

export const GreyMarketRadar: React.FC<GreyMarketRadarProps> = ({
    currentGmp,
    subscription
}) => {
    // Calculate signal strength based on GMP and subscription
    const getSignalStrength = (): { label: string; color: string; score: number } => {
        if (subscription >= 100 && currentGmp > 50) {
            return { label: 'Very Strong', color: 'text-emerald-500', score: 90 };
        } else if (subscription >= 50 && currentGmp > 30) {
            return { label: 'Strong', color: 'text-emerald-400', score: 75 };
        } else if (subscription >= 20 && currentGmp > 15) {
            return { label: 'Moderate', color: 'text-amber-500', score: 60 };
        } else if (subscription >= 5 && currentGmp > 5) {
            return { label: 'Weak', color: 'text-orange-500', score: 40 };
        } else {
            return { label: 'Very Weak', color: 'text-red-500', score: 20 };
        }
    };

    const signal = getSignalStrength();
    const isPositive = currentGmp > 0;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-700"
        >
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Grey Market Signal
                </h4>
                <div className={`flex items-center gap-1 ${signal.color}`}>
                    {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    <span className="text-xs font-medium">{signal.label}</span>
                </div>
            </div>

            {/* Signal Meter */}
            <div className="relative h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-3">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${signal.score}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className={`h-full rounded-full ${
                        signal.score >= 75 ? 'bg-emerald-500' :
                        signal.score >= 50 ? 'bg-amber-500' :
                        signal.score >= 30 ? 'bg-orange-500' : 'bg-red-500'
                    }`}
                />
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-white dark:bg-slate-800 rounded-lg p-2.5 border border-slate-200 dark:border-slate-700">
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">GMP</div>
                    <div className={`text-lg font-bold ${isPositive ? 'text-emerald-500' : 'text-red-500'}`}>
                        {isPositive ? '+' : ''}{currentGmp}%
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-lg p-2.5 border border-slate-200 dark:border-slate-700">
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Subscription</div>
                    <div className="text-lg font-bold text-indigo-500">
                        {subscription.toFixed(1)}x
                    </div>
                </div>
            </div>

            {/* Disclaimer */}
            <div className="mt-3 flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
                <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                <span>
                    Grey market premiums are unofficial and for reference only.
                    Actual listing gains may vary significantly.
                </span>
            </div>
        </motion.div>
    );
};

export default GreyMarketRadar;
