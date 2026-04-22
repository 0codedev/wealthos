import React from 'react';
import { formatCurrency } from '../../utils/helpers';

interface CustomTooltipProps {
    active?: boolean;
    payload?: any[];
    label?: string;
    isPrivacyMode?: boolean;
    formatter?: (value: any, name: string, entry: any) => string | number;
}

export type { CustomTooltipProps };

/**
 * Premium glassmorphic tooltip used by every Recharts chart wrapper.
 * Agent CC3 polish:
 *  - Backdrop blur + dark glass surface
 *  - Light-mode frosted-white variant
 *  - Custom color indicator dots with ring + shadow
 *  - Semibold label header with date / category text
 *  - Right-aligned monospace value column
 *  - Per-entry subtle gradient bar
 */
export const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label, isPrivacyMode, formatter }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white/95 dark:bg-[#0D0E14]/95 backdrop-blur-xl border border-slate-200/80 dark:border-white/[0.10] rounded-xl shadow-2xl dark:shadow-[0_20px_50px_rgba(0,0,0,0.8),inset_0_1px_0_0_rgba(255,255,255,0.06)] overflow-hidden min-w-[180px] animate-premium-fade-in">
                <div className="px-3.5 py-2 border-b border-slate-100 dark:border-white/[0.06] bg-slate-50/60 dark:bg-[#131620]/60">
                    <p className="font-bold text-[11px] uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                        {label}
                    </p>
                </div>
                <div className="p-3 space-y-2">
                    {payload.map((entry: any, index: number) => {
                        const dotColor = entry.color || entry.fill || '#6366f1';
                        return (
                            <div key={index} className="flex items-center justify-between gap-6 text-sm">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <span
                                        className="relative inline-flex h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_8px_currentColor]"
                                        style={{ backgroundColor: dotColor, color: dotColor }}
                                        aria-hidden="true"
                                    >
                                        <span className="absolute inset-0 rounded-full ring-2 ring-white/90 dark:ring-[#0D0E14]" />
                                    </span>
                                    <span className="text-slate-600 dark:text-slate-300 font-semibold truncate">
                                        {entry.name}
                                    </span>
                                </div>
                                <span className="font-mono font-bold text-slate-900 dark:text-white tracking-wide tabular-nums">
                                    {isPrivacyMode ? '••••••' : (
                                        formatter ? formatter(entry.value, entry.name, entry) : (
                                            typeof entry.value === 'number'
                                                ? (entry.name.includes('%')
                                                    ? `${entry.value.toFixed(1)}%`
                                                    : (['Legs Triggered', 'Sharpe Ratio', 'Trades to Recovery'].includes(entry.name)
                                                        ? entry.value.toLocaleString()
                                                        : formatCurrency(entry.value)))
                                                : entry.value
                                        )
                                    )}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }
    return null;
};
