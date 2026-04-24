import React from 'react';
import { LucideIcon } from 'lucide-react';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const toneMap: Record<Tone, { shell: string; icon: string; badge: string }> = {
    neutral: {
        shell: 'border-wa-border bg-wa-card text-slate-200',
        icon: 'bg-white/[0.05] text-slate-300',
        badge: 'border-wa-border bg-white/[0.04] text-slate-300',
    },
    info: {
        shell: 'border-indigo-500/20 bg-indigo-950/20 text-indigo-200',
        icon: 'bg-indigo-500/20 text-indigo-300',
        badge: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
    },
    success: {
        shell: 'border-emerald-500/20 bg-emerald-950/20 text-emerald-200',
        icon: 'bg-emerald-500/20 text-emerald-300',
        badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    },
    warning: {
        shell: 'border-amber-500/20 bg-amber-950/20 text-amber-200',
        icon: 'bg-amber-500/20 text-amber-300',
        badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    },
    danger: {
        shell: 'border-rose-500/20 bg-rose-950/20 text-rose-200',
        icon: 'bg-rose-500/20 text-rose-300',
        badge: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    },
};

/**
 * Institutional Master Card Shell (Single Source of Truth)
 * Enforces #0D0F17 card depth, 24px curvature, and translucent hairline border.
 */
export const CardShell: React.FC<{
    children: React.ReactNode;
    className?: string;
    hoverable?: boolean;
    onClick?: () => void;
}> = ({ children, className = '', hoverable = false, onClick }) => (
    <div
        onClick={onClick}
        className={cx(
            'bg-wa-card border border-wa-border rounded-wa-lg p-4 sm:p-6 shadow-sm transition-all duration-200',
            hoverable && 'hover:border-wa-border-hover hover:shadow-md cursor-pointer',
            className
        )}
    >
        {children}
    </div>
);

/**
 * Elevated Card Shell for Modals, Drawers & Popovers
 * Enforces #131624 elevated depth, 24px curvature, and backdrop blur.
 */
export const ElevatedCardShell: React.FC<{
    children: React.ReactNode;
    className?: string;
}> = ({ children, className = '' }) => (
    <div
        className={cx(
            'bg-wa-card-elevated border border-white/[0.1] rounded-wa-lg p-5 sm:p-7 shadow-2xl backdrop-blur-xl',
            className
        )}
    >
        {children}
    </div>
);

/**
 * Locked Badge with strict nowrap and minimum width
 * Eliminates the 2-line badge wrapping bug across financial tables.
 */
export const LockedBadge: React.FC<{
    label: string;
    variant?: 'bullish' | 'bearish' | 'neutral' | 'accent';
    icon?: string;
    className?: string;
}> = ({ label, variant = 'neutral', icon, className = '' }) => {
    const variantStyles = {
        bullish: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
        bearish: 'bg-rose-500/10 text-rose-400 border-rose-500/25',
        neutral: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
        accent: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/25',
    };

    return (
        <span
            className={cx(
                'inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-wa-sm border text-[10px] font-bold uppercase tracking-wider min-w-[85px] whitespace-nowrap select-none',
                variantStyles[variant],
                className
            )}
        >
            {icon && <span>{icon}</span>}
            <span>{label}</span>
        </span>
    );
};

interface SectionHeaderProps {
    eyebrow?: string;
    title: string;
    description?: string;
    infoTooltip?: string;
    icon?: LucideIcon;
    tone?: Tone;
    badge?: string;
    chips?: string[];
    actions?: React.ReactNode;
    className?: string;
    onClick?: () => void;
    isCollapsed?: boolean;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
    eyebrow,
    title,
    description,
    infoTooltip,
    icon: Icon,
    tone = 'neutral',
    badge,
    chips = [],
    actions,
    className,
    onClick,
    isCollapsed = false,
}) => (
    <div className={cx('flex items-start justify-between gap-3', className)}>
        <div 
            className={cx('min-w-0 flex-1', onClick && 'cursor-pointer select-none group/header')}
            onClick={onClick}
        >
            <div className="flex items-center gap-2.5 sm:gap-3">
                {Icon && (
                    <span className={cx(
                        'inline-flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-xl border border-white/50 shadow-sm dark:border-white/5 transition-transform active:scale-95 group-hover/header:scale-[1.03]', 
                        toneMap[tone].icon
                    )}>
                        <Icon size={14} />
                    </span>
                )}
                <div className="min-w-0 flex-1">
                    {eyebrow && (
                        <p className="hidden sm:block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{eyebrow}</p>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <h3 className="text-[14px] sm:text-[15px] font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                            {title}
                            {onClick && (
                                <span className="text-[10px] text-slate-450 dark:text-slate-500 group-hover/header:text-indigo-400 transition-colors">
                                    {isCollapsed ? '▼' : '▲'}
                                </span>
                            )}
                        </h3>
                        {badge && (
                            <span className={cx('rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em]', toneMap[tone].badge)}>
                                {badge}
                            </span>
                        )}
                        {(infoTooltip || description) && (
                            <span 
                                className="inline-flex sm:hidden items-center justify-center w-4 h-4 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-[9px] font-bold cursor-help"
                                title={infoTooltip || description}
                                aria-label="More information"
                            >
                                ⓘ
                            </span>
                        )}
                    </div>
                </div>
            </div>
            {!isCollapsed && description && (
                <p className="hidden md:block mt-1 text-[11px] leading-[1.4] text-slate-500 dark:text-slate-400 line-clamp-1" title={description}>{description}</p>
            )}
            {!isCollapsed && chips.length > 0 && (
                <div className="hidden sm:flex mt-2 flex-wrap gap-1.5">
                    {chips.map((chip) => (
                        <span key={chip} className="rounded-full border border-slate-200 bg-white/85 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300">
                            {chip}
                        </span>
                    ))}
                </div>
            )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2 self-center">{actions}</div>}
    </div>
);

interface MetricTileProps {
    label: string;
    value: React.ReactNode;
    meta?: React.ReactNode;
    icon?: LucideIcon;
    tone?: Tone;
    className?: string;
}

export const MetricTile: React.FC<MetricTileProps> = ({
    label,
    value,
    meta,
    icon: Icon,
    tone = 'neutral',
    className,
}) => (
    <div className={cx('rounded-2xl border p-3', toneMap[tone].shell, className)}>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            {Icon && <Icon size={12} />}
            <span>{label}</span>
        </div>
        <div className="mt-2 text-[15px] font-black text-slate-900 dark:text-white">{value}</div>
        {meta && <div className="mt-1 text-[11px] leading-[1.35] text-slate-500 dark:text-slate-400">{meta}</div>}
    </div>
);

interface StateSurfaceProps {
    title: string;
    description?: React.ReactNode;
    icon?: LucideIcon;
    tone?: Tone;
    badge?: string;
    actions?: React.ReactNode;
    compact?: boolean;
    className?: string;
}

export const StateSurface: React.FC<StateSurfaceProps> = ({
    title,
    description,
    icon: Icon,
    tone = 'neutral',
    badge,
    actions,
    compact = false,
    className,
}) => (
    <div className={cx('rounded-2xl sm:rounded-[22px] border p-3.5 sm:p-4', toneMap[tone].shell, compact && 'p-3', className)}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
                {Icon && (
                    <span className={cx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', toneMap[tone].icon)}>
                        <Icon size={14} />
                    </span>
                )}
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-bold text-slate-900 dark:text-white">{title}</p>
                        {badge && (
                            <span className={cx('rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em]', toneMap[tone].badge)}>
                                {badge}
                            </span>
                        )}
                    </div>
                    {description && (
                        <div className="mt-1 text-[11px] leading-[1.45] text-current/80">{description}</div>
                    )}
                </div>
            </div>
            {actions && <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-center shrink-0">{actions}</div>}
        </div>
    </div>
);

interface StatusPillProps {
    label: string;
    tone?: Tone;
    className?: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({ label, tone = 'neutral', className }) => (
    <span
        className={cx(
            'inline-flex min-h-[24px] items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em]',
            toneMap[tone].badge,
            className
        )}
    >
        {label}
    </span>
);

interface CompactActionGroupProps {
    children: React.ReactNode;
    className?: string;
}

export const CompactActionGroup: React.FC<CompactActionGroupProps> = ({ children, className }) => (
    <div
        className={cx(
            'inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-slate-200 bg-white/85 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900/70',
            className
        )}
    >
        {children}
    </div>
);

interface FreshnessBadgeProps {
    lastUpdated?: string | Date | null;
    staleAfterMinutes?: number;
    sourceLabel?: string;
    className?: string;
}

export const FreshnessBadge: React.FC<FreshnessBadgeProps> = ({
    lastUpdated,
    staleAfterMinutes = 10,
    sourceLabel = 'local',
    className,
}) => {
    if (!lastUpdated) {
        return <StatusPill label={`${sourceLabel} · no sync yet`} tone="warning" className={className} />;
    }

    const parsed = typeof lastUpdated === 'string' ? new Date(lastUpdated) : lastUpdated;
    const ageMinutes = Math.max(0, Math.round((Date.now() - parsed.getTime()) / 60000));
    const tone: Tone = ageMinutes > staleAfterMinutes ? 'warning' : 'success';
    const ageLabel = ageMinutes < 1 ? 'just now' : `${ageMinutes}m ago`;

    return <StatusPill label={`${sourceLabel} · ${ageLabel}`} tone={tone} className={className} />;
};
