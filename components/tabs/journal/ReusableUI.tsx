import React from 'react';
import { motion } from 'framer-motion';
import { LucideIcon, ChevronLeft, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react';

// ==========================================
// T3.1 MetricCard Component
// ==========================================
interface MetricCardProps {
    label: string;
    value: string | number;
    icon: LucideIcon;
    iconColor?: string; // hex or tailwind text class
    iconBg?: string; // rgba or tailwind bg class
    change?: number; // percentage change e.g. +5.4
    changeLabel?: string; // "vs last 30 days"
    progressColor?: string; // e.g. "#3b82f6" or "#00d4aa"
}

export const MetricCard: React.FC<MetricCardProps> = ({
    label,
    value,
    icon: Icon,
    iconColor = '#3b82f6',
    iconBg = 'rgba(59,130,246,0.12)',
    change,
    changeLabel = 'vs last 30 days',
    progressColor = '#3b82f6'
}) => {
    const isPositive = change !== undefined && change >= 0;

    return (
        <motion.div
            whileHover={{ y: -2 }}
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-[18px] flex flex-col justify-between relative overflow-hidden group shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-all duration-200"
        >
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">
                    {label}
                </span>
                <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 duration-200"
                    style={{ backgroundColor: iconBg, color: iconColor }}
                >
                    <Icon size={18} />
                </div>
            </div>

            <div className="mt-2.5">
                <h3 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
                    {value}
                </h3>
            </div>

            <div className="mt-2 flex items-center gap-1.5 text-xs">
                {change !== undefined && (
                    <span className={`font-semibold flex items-center gap-0.5 ${isPositive ? 'text-[#00d4aa]' : 'text-[#ef4444]'}`}>
                        {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {isPositive ? '+' : ''}{change}%
                    </span>
                )}
                <span className="text-[#64748b] text-[11px]">
                    {changeLabel}
                </span>
            </div>

            {/* Bottom Accent line */}
            <div
                className="absolute bottom-0 left-0 right-0 h-[3px]"
                style={{ backgroundColor: progressColor }}
            />
        </motion.div>
    );
};

// ==========================================
// T3.2 SectionCard Component
// ==========================================
interface SectionCardProps {
    title: string;
    icon?: LucideIcon;
    iconBg?: string;
    iconColor?: string;
    headerAction?: React.ReactNode;
    children: React.ReactNode;
}

export const SectionCard: React.FC<SectionCardProps> = ({
    title,
    icon: Icon,
    iconBg = 'rgba(59,130,246,0.1)',
    iconColor = '#3b82f6',
    headerAction,
    children
}) => {
    return (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-[18px] flex flex-col shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-all duration-200 hover:border-[var(--border)]/80">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/[0.03]">
                <div className="flex items-center gap-2">
                    {Icon && (
                        <div
                            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                            style={{ backgroundColor: iconBg, color: iconColor }}
                        >
                            <Icon size={14} />
                        </div>
                    )}
                    <h3 className="text-sm font-semibold text-[#e2e8f0] tracking-wide">
                        {title}
                    </h3>
                </div>
                {headerAction && <div>{headerAction}</div>}
            </div>
            <div className="flex-1">
                {children}
            </div>
        </div>
    );
};

// ==========================================
// T3.3 CategoryBadge Component
// ==========================================
interface CategoryBadgeProps {
    category: string;
}

export const CategoryBadge: React.FC<CategoryBadgeProps> = ({ category }) => {
    const getStyles = (cat: string) => {
        const c = cat.toLowerCase();
        if (c.includes('psychology') || c.includes('mindset')) {
            return { bg: 'rgba(139,92,246,0.15)', text: '#8b5cf6' };
        } else if (c.includes('risk') || c.includes('money')) {
            return { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' };
        } else if (c.includes('entry') || c.includes('exit') || c.includes('execution')) {
            return { bg: 'rgba(16,185,129,0.15)', text: '#10b981' };
        } else if (c.includes('analysis') || c.includes('prep') || c.includes('technical')) {
            return { bg: 'rgba(59,130,246,0.15)', text: '#3b82f6' };
        } else if (c.includes('behavioral') || c.includes('discipline')) {
            return { bg: 'rgba(245,158,11,0.15)', text: '#f59e0b' };
        } else if (c.includes('cognitive') || c.includes('bias')) {
            return { bg: 'rgba(20,184,166,0.15)', text: '#14b8a6' };
        }
        return { bg: 'rgba(100,116,139,0.15)', text: '#94a3b8' };
    };

    const styles = getStyles(category);

    return (
        <span
            className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide whitespace-nowrap"
            style={{ backgroundColor: styles.bg, color: styles.text }}
        >
            {category}
        </span>
    );
};

// ==========================================
// T3.4 SeverityBadge Component
// ==========================================
interface SeverityBadgeProps {
    severity: string;
}

export const SeverityBadge: React.FC<SeverityBadgeProps> = ({ severity }) => {
    const getStyles = (sev: string) => {
        const s = sev.toLowerCase();
        if (s.includes('high') || s.includes('critical')) {
            return { bg: 'rgba(239,68,68,0.15)', text: '#ef4444', border: 'rgba(239,68,68,0.2)' };
        } else if (s.includes('medium') || s.includes('warning')) {
            return { bg: 'rgba(245,158,11,0.15)', text: '#f59e0b', border: 'rgba(245,158,11,0.2)' };
        }
        return { bg: 'rgba(16,185,129,0.15)', text: '#10b981', border: 'rgba(16,185,129,0.2)' };
    };

    const styles = getStyles(severity);

    return (
        <span
            className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide border whitespace-nowrap"
            style={{ backgroundColor: styles.bg, color: styles.text, borderColor: styles.border }}
        >
            {severity}
        </span>
    );
};

// ==========================================
// T3.5 DirectionBadge Component
// ==========================================
interface DirectionBadgeProps {
    direction: string;
}

export const DirectionBadge: React.FC<DirectionBadgeProps> = ({ direction }) => {
    const isLong = direction.toLowerCase() === 'long' || direction.toLowerCase() === 'buy';

    return (
        <span
            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-wide border whitespace-nowrap ${
                isLong
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}
        >
            {direction.toUpperCase()}
        </span>
    );
};

// ==========================================
// T3.6 EmptyState Component
// ==========================================
interface EmptyStateProps {
    icon: LucideIcon;
    title: string;
    subtitle: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, title, subtitle }) => {
    return (
        <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-white/[0.02] border border-white/[0.05] flex items-center justify-center text-[#334155] mb-3">
                <Icon size={22} />
            </div>
            <h4 className="text-sm font-semibold text-[#64748b]">
                {title}
            </h4>
            <p className="text-xs text-[#475569] mt-1 max-w-xs">
                {subtitle}
            </p>
        </div>
    );
};

// ==========================================
// T3.7 DataTable Component
// ==========================================
interface DataTableProps {
    headers: string[];
    children: React.ReactNode;
    currentPage?: number;
    totalPages?: number;
    onPageChange?: (page: number) => void;
    totalCount?: number;
    itemsPerPage?: number;
}

export const DataTable: React.FC<DataTableProps> = ({
    headers,
    children,
    currentPage = 1,
    totalPages = 1,
    onPageChange,
    totalCount = 0,
    itemsPerPage = 10
}) => {
    const startItem = (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(currentPage * itemsPerPage, totalCount);

    return (
        <div className="w-full flex flex-col">
            <div className="overflow-x-auto w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]">
                <table className="w-full border-collapse text-left text-sm text-[#e2e8f0]">
                    <thead>
                        <tr className="bg-white/[0.02] border-b border-white/[0.05]">
                            {headers.map((h, i) => (
                                <th key={i} className="px-4 py-2.5 text-[11px] uppercase tracking-wider font-semibold text-[#475569]">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                        {children}
                    </tbody>
                </table>
            </div>

            {totalCount > 0 && onPageChange && totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 px-1">
                    <span className="text-xs text-[#64748b]">
                        Showing <span className="font-mono text-white">{startItem}</span> to <span className="font-mono text-white">{endItem}</span> of <span className="font-mono text-white">{totalCount}</span> entries
                    </span>
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                            disabled={currentPage === 1}
                            className="p-1.5 rounded-lg bg-[#1c2333] border border-white/[0.05] text-[#64748b] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        {[...Array(totalPages)].map((_, i) => {
                            const page = i + 1;
                            const isActive = page === currentPage;
                            return (
                                <button
                                    key={page}
                                    onClick={() => onPageChange(page)}
                                    className={`px-3 py-1 text-xs font-mono font-bold rounded-lg transition-colors ${
                                        isActive
                                            ? 'bg-[#3b82f6] text-white'
                                            : 'bg-transparent text-[#64748b] hover:bg-white/[0.03] hover:text-[#e2e8f0]'
                                    }`}
                                >
                                    {page}
                                </button>
                            );
                        })}
                        <button
                            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                            disabled={currentPage === totalPages}
                            className="p-1.5 rounded-lg bg-[#1c2333] border border-white/[0.05] text-[#64748b] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// ==========================================
// T3.8 PageHeader Component
// ==========================================
interface PageHeaderProps {
    title: string;
    subtitle: string;
    rightControls?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, rightControls }) => {
    return (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <div>
                <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">
                    {title}
                </h2>
                <p className="text-xs text-[#64748b] mt-0.5">
                    {subtitle}
                </p>
            </div>
            {rightControls && (
                <div className="flex items-center gap-2 shrink-0">
                    {rightControls}
                </div>
            )}
        </div>
    );
};

// ==========================================
// T3.9 TimeframePills Component
// ==========================================
interface TimeframePillsProps {
    active: string;
    onChange: (timeframe: string) => void;
    options?: { id: string; label: string }[];
}

export const TimeframePills: React.FC<TimeframePillsProps> = ({
    active,
    onChange,
    options = [
        { id: '30D', label: '30D' },
        { id: '90D', label: '90D' },
        { id: '1Y', label: '1Y' }
    ]
}) => {
    return (
        <div className="flex items-center p-0.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg">
            {options.map((opt) => {
                const isActive = opt.id === active;
                return (
                    <button
                        key={opt.id}
                        onClick={() => onChange(opt.id)}
                        className={`px-3 py-1 text-[11px] font-bold uppercase tracking-wider rounded-md transition-all ${
                            isActive
                                ? 'bg-[#3b82f6] text-white shadow-sm'
                                : 'text-[#64748b] hover:text-[#e2e8f0]'
                        }`}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
};

// ==========================================
// T3.10 UnderlineTabBar Component
// ==========================================
interface UnderlineTabBarProps {
    tabs: { id: string; label: string }[];
    active: string;
    onChange: (id: string) => void;
}

export const UnderlineTabBar: React.FC<UnderlineTabBarProps> = ({ tabs, active, onChange }) => {
    return (
        <div className="flex border-b border-white/[0.05] overflow-x-auto no-scrollbar mb-6">
            {tabs.map((tab) => {
                const isActive = tab.id === active;
                return (
                    <button
                        key={tab.id}
                        onClick={() => onChange(tab.id)}
                        className={`relative px-4 py-3 text-xs md:text-sm font-semibold tracking-wide transition-all ${
                            isActive
                                ? 'text-[#3b82f6]'
                                : 'text-[#64748b] hover:text-[#e2e8f0]'
                        }`}
                    >
                        <span>{tab.label}</span>
                        {isActive && (
                            <motion.div
                                layoutId="underline-active-indicator"
                                className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#3b82f6]"
                            />
                        )}
                    </button>
                );
            })}
        </div>
    );
};

// ==========================================
// T3.11 GradientProgressBar Component
// ==========================================
interface GradientProgressBarProps {
    value: number; // 0 to 100
    label?: string;
}

export const GradientProgressBar: React.FC<GradientProgressBarProps> = ({ value, label }) => {
    // Clamp value between 0 and 100
    const clampedValue = Math.min(Math.max(value, 0), 100);

    return (
        <div className="w-full flex flex-col gap-1.5">
            {label && (
                <div className="flex items-center justify-between text-xs text-[#64748b] font-medium">
                    <span>{label}</span>
                    <span className="font-mono text-white font-bold">{clampedValue}%</span>
                </div>
            )}
            <div className="w-full h-2 bg-[#1c2333] rounded-full overflow-hidden">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${clampedValue}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className="h-full rounded-full bg-gradient-to-r from-[#ef4444] via-[#f59e0b] to-[#10b981]"
                />
            </div>
        </div>
    );
};
