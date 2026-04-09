import React, { useMemo } from 'react';
import { Flame, Activity } from 'lucide-react';
import JargonTooltip from '../../shared/JargonTooltip';
import { EmptyState } from '../../shared/EmptyState';

interface HeatmapWidgetProps {
    history: { date: string, value: number }[];
    isDarkMode: boolean;
}

const HeatmapWidgetBase: React.FC<HeatmapWidgetProps> = ({ history, isDarkMode }) => {
    // Generate last 14 days of data (or use history)
    // For visual appeal, if history is small, we mock or pad
    const dataPoints = useMemo(() => {
        if (!history || history.length === 0) {
            // Return 14 days of flatline 0 change if no data
            return Array.from({ length: 14 }).map((_, i) => ({
                date: new Date(Date.now() - (i * 86400000)).toISOString(),
                value: 0,
                change: 0,
                percent: 0
            })).reverse();
        }

        const paddedHistory = [...history]; // Clone
        // Ensure at least 2 points for change calc
        if (paddedHistory.length < 2) {
            paddedHistory.unshift({ date: 'Start', value: paddedHistory[0]?.value || 0 });
        }

        return paddedHistory.slice(-14).map((h, i, arr) => {
            const prev = arr[i - 1]?.value || h.value;
            const change = h.value - prev;
            const percent = prev !== 0 ? (change / prev) * 100 : 0;
            return { ...h, change, percent };
        }).slice(-14); // Ensure max 14
    }, [history]); // Wrap in useMemo for perf

    const getColor = (percent: number) => {
        if (percent > 0.5) return 'bg-emerald-500';
        if (percent > 0) return 'bg-emerald-400/60';
        if (percent === 0) return 'bg-slate-200 dark:bg-slate-700';
        if (percent > -0.5) return 'bg-rose-400/60';
        return 'bg-rose-500';
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 md:p-6 shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col h-full transition-shadow duration-300 hover:shadow-lg hover:shadow-indigo-500/5">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-base font-bold text-slate-800 dark:text-white flex items-center gap-2">
                    <Flame size={16} className="text-orange-500" />
                    Portfolio Heat<JargonTooltip term="Drawdown" />
                </h3>
                <span className="text-[10px] font-bold text-slate-400 uppercase">Last 14 Days</span>
            </div>

            <div className="flex-1 flex items-end justify-between gap-1">
                {dataPoints.map((pt) => (
                    <div
                        key={pt.date}
                        title={`${new Date(pt.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} — ${pt.percent.toFixed(2)}%`}
                        className="flex flex-col items-center gap-1 group w-full"
                    >
                        <div
                            className={`w-full rounded-md transition-all duration-200 group-hover:scale-110 group-hover:ring-2 group-hover:ring-indigo-400/50 ${getColor(pt.percent)}`}
                            style={{ height: `${Math.min(100, Math.max(20, Math.abs(pt.percent) * 50))}%` }}
                        ></div>
                    </div>
                ))}
            </div>

            <div className="mt-2 flex justify-between text-[10px] text-slate-400 font-mono">
                <span>14d ago</span>
                <span>Today</span>
            </div>
        </div>
    );
};

// Wrap with React.memo to prevent unnecessary re-renders on parent state changes
export default React.memo(HeatmapWidgetBase);
