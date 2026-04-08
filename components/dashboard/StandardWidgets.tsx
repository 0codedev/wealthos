import React, { useMemo } from 'react';
import {
    TrendingUp, TrendingDown, Activity, Users,
    ArrowRight, Layers, Trophy, ArrowUpRight,
    Landmark, AlertTriangle, Droplet
} from 'lucide-react';
import { useSettingsStore } from '../../store/settingsStore';
import { useLiteModeStore } from '../../store/liteModeStore';
import { usePageVisibility } from '../../contexts/PageVisibilityContext';
import { formatCurrency } from '../../utils/helpers';
import { Investment, PortfolioStats } from '../../types';

// ==========================================
// Types
// ==========================================

interface CommonWidgetProps {
    id?: string;
    dragHandle?: boolean;
    onClick?: () => void;
}

// Safe percentage return helper guarding against zero or null cost basis
const getGainPct = (inv?: Investment | null): number => {
    if (!inv) return 0;
    const invested = Number(inv.investedAmount) || 0;
    const current = Number(inv.currentValue) || 0;
    if (invested <= 0) return 0;
    const gain = ((current - invested) / invested) * 100;
    return Number.isFinite(gain) ? gain : 0;
};

// Helper to calculate top performer
const getTopPerformer = (investments: Investment[]) => {
    if (!investments || !investments.length) return null;
    const withCost = investments.filter(i => (Number(i.investedAmount) || 0) > 0);
    const pool = withCost.length > 0 ? withCost : investments;
    return pool.reduce((prev, current) => {
        const prevGain = getGainPct(prev);
        const currentGain = getGainPct(current);
        return prevGain >= currentGain ? prev : current;
    });
};

const getWorstPerformer = (investments: Investment[]) => {
    if (!investments || !investments.length) return null;
    const withCost = investments.filter(i => (Number(i.investedAmount) || 0) > 0);
    const pool = withCost.length > 0 ? withCost : investments;
    return pool.reduce((prev, current) => {
        const prevGain = getGainPct(prev);
        const currentGain = getGainPct(current);
        return prevGain <= currentGain ? prev : current;
    });
};

// ==========================================
// 1. Total P&L Widget (Refined)
// ==========================================

export const TotalPLWidget: React.FC<CommonWidgetProps & {
    stats: PortfolioStats;
    isPrivacyMode: boolean;
    formatCurrency: (val: number) => string;
    formatCurrencyPrecise: (val: number) => string;
}> = ({ stats, isPrivacyMode, formatCurrency }) => {
    const isPositive = stats.totalPL >= 0;

    return (
        <div className="preset-card kpi-lift card-premium-lift alpha-cursor-card group relative flex h-full flex-col justify-between overflow-hidden rounded-[24px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 p-4 sm:p-5 shadow-[0_10px_30px_rgba(15,23,42,0.08)] dark:shadow-[0_10px_30px_rgba(15,23,42,0.28)]">
            <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-r from-emerald-500/10 via-transparent to-sky-500/10" />
            <div className="absolute top-0 right-0 p-4 opacity-5 transition-opacity group-hover:opacity-10">
                <TrendingUp size={100} className={isPositive ? 'text-emerald-500' : 'text-rose-500'} />
            </div>

            <div className="relative z-10">
                <div className="mb-2 flex items-start justify-between">
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/90 p-2 text-slate-750 dark:text-slate-300 shadow-sm">
                        <TrendingUp size={20} />
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${isPositive ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border border-rose-500/20 bg-rose-500/10 text-rose-400'}`}>
                        {stats.totalPLPercent}%
                    </span>
                </div>

                <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Total Profit/Loss</p>
                <div className="mt-1 flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white font-tabular">
                    {isPrivacyMode ? '******' : formatCurrency(stats.totalPL)}
                </div>
            </div>

            <div className="preset-subcard relative z-10 mt-4 rounded-xl p-3 sm:p-3.5 border border-slate-200/80 dark:border-white/[0.08]">
                <div className="grid grid-cols-2 gap-3">
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Invested</p>
                        <p className="font-mono font-tabular text-[13px] font-bold text-slate-800 dark:text-slate-200 truncate">{isPrivacyMode ? '***' : formatCurrency(stats.totalInvested)}</p>
                    </div>
                    <div className="text-right min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Current</p>
                        <p className="font-mono font-tabular text-[13px] font-bold text-slate-900 dark:text-white truncate">{isPrivacyMode ? '***' : formatCurrency(stats.totalCurrent)}</p>
                    </div>
                </div>
                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.08]">
                    <div
                        className={`h-full rounded-full transition-all duration-500 ${isPositive ? 'bg-emerald-500' : 'bg-rose-500'}`}
                        style={{ width: `${Math.min(100, Math.max(3, Math.abs(parseFloat(String(stats.totalPLPercent || 0)))))}%` }}
                    />
                </div>
            </div>
        </div>
    );
};

// ==========================================
// 1b. Total Holdings Widget (NEW KPI)
// ==========================================

export const TotalHoldingsWidget: React.FC<CommonWidgetProps & {
    investments: Investment[];
    stats: PortfolioStats;
    isPrivacyMode: boolean;
}> = ({ investments, stats, isPrivacyMode }) => {
    const holdingsCount = investments?.length || 0;
    const diversityScore = stats?.diversityScore || 0;

    const uniquePlatforms = useMemo(() => {
        if (!investments?.length) return 0;
        return new Set(investments.map(i => i.platform)).size;
    }, [investments]);

    const uniqueAssetClasses = useMemo(() => {
        if (!investments?.length) return 0;
        return new Set(investments.map(i => i.type)).size;
    }, [investments]);

    return (
        <div className="preset-card kpi-lift card-premium-lift alpha-cursor-card group relative flex h-full flex-col justify-between overflow-hidden rounded-[24px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 p-4 sm:p-5 shadow-[0_10px_30px_rgba(15,23,42,0.08)] dark:shadow-[0_10px_30px_rgba(15,23,42,0.28)]">
            <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-r from-cyan-500/10 via-transparent to-indigo-500/10" />
            <div className="absolute top-0 right-0 p-4 opacity-5 transition-opacity group-hover:opacity-10">
                <Layers size={100} className="text-cyan-500" />
            </div>

            <div className="relative z-10">
                <div className="mb-2 flex items-start justify-between">
                    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-2 text-cyan-400 shadow-sm">
                        <Layers size={20} />
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${diversityScore >= 70 ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : diversityScore >= 40 ? 'border border-amber-500/20 bg-amber-500/10 text-amber-400' : 'border border-rose-500/20 bg-rose-500/10 text-rose-400'}`}>
                        {diversityScore}% Diverse
                    </span>
                </div>

                <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Total Holdings</p>
                <div className="mt-1 flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                    {isPrivacyMode ? '**' : holdingsCount}
                    <span className="text-[13px] font-medium text-slate-500">investments</span>
                </div>
            </div>

            <div className="preset-subcard relative z-10 mt-4 rounded-xl p-3 sm:p-3.5 border border-slate-200/80 dark:border-white/[0.08]">
                <div className="grid grid-cols-2 gap-3">
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Platforms</p>
                        <p className="font-mono font-tabular text-[13px] font-bold text-slate-800 dark:text-slate-200 truncate">{isPrivacyMode ? '*' : uniquePlatforms}</p>
                    </div>
                    <div className="text-right min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Asset Classes</p>
                        <p className="font-mono font-tabular text-[13px] font-bold text-slate-900 dark:text-white truncate">{isPrivacyMode ? '*' : uniqueAssetClasses}</p>
                    </div>
                </div>
                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.08]">
                    <div
                        className={`h-full rounded-full transition-all duration-500 ${diversityScore >= 70 ? 'bg-emerald-500' : diversityScore >= 40 ? 'bg-amber-500' : 'bg-rose-500'}`}
                        style={{ width: `${Math.min(100, Math.max(3, diversityScore))}%` }}
                    />
                </div>
            </div>
        </div>
    );
};

export const TopPerformerWidget: React.FC<CommonWidgetProps & {
    stats: PortfolioStats;
    investments?: Investment[];
    calculatePercentage: (a: number, b: number) => string;
}> = ({ investments }) => {
    const topPerformer = useMemo(() => {
        if (!investments || investments.length === 0) return null;
        return getTopPerformer(investments);
    }, [investments]);

    const name = topPerformer ? topPerformer.name : 'No Investments';
    const returnPct = useMemo(() => {
        if (!topPerformer) return 0;
        return getGainPct(topPerformer);
    }, [topPerformer]);

    const returnVal = Number.isFinite(returnPct) ? returnPct.toFixed(1) : '0.0';
    const isPositive = returnPct >= 0;

    return (
        <div className="preset-card kpi-lift group relative flex h-full flex-col justify-between overflow-hidden rounded-[24px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 p-4 sm:p-5 shadow-[0_10px_30px_rgba(15,23,42,0.08)] dark:shadow-[0_10px_30px_rgba(15,23,42,0.28)]">
            <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-r from-amber-500/10 via-transparent to-orange-500/10" />
            <div className="absolute top-0 right-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
                <Trophy size={100} className="text-amber-500" />
            </div>

            <div className="relative z-10 flex flex-1 flex-col justify-between">
                <div>
                    <div className="flex items-start justify-between">
                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2 text-amber-400 shadow-sm">
                            <Trophy size={20} />
                        </div>
                        <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/60">All-Time High</span>
                    </div>

                    <div className="mt-3">
                        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-amber-500">Top Performer</p>
                        <h3 className="truncate pr-2 text-[15px] font-bold text-slate-900 dark:text-white" title={name}>{name}</h3>
                    </div>
                </div>

                <div className="preset-subcard mt-4 rounded-xl p-3 sm:p-3.5 flex items-center justify-between border border-slate-200/80 dark:border-white/[0.08]">
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Total Return</p>
                        <p className={`flex items-center gap-1 text-lg font-black font-tabular tracking-tight ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                            <ArrowUpRight size={18} className="shrink-0" /> {isPositive ? '+' : ''}{returnVal}%
                        </p>
                    </div>
                    <div className="text-right shrink-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-0.5">Impact</p>
                        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/25">
                            High
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ==========================================
// 3. Shortcuts (Spending, Market, Community) - Enhanced UI
// ==========================================

export const SpendingWidget: React.FC<CommonWidgetProps> = ({ onClick }) => (
    <div onClick={onClick} className="preset-card card-premium-lift group relative flex h-full min-h-[156px] cursor-pointer flex-col justify-between overflow-hidden rounded-[24px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 p-3 transition-all hover:border-emerald-500/50 hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:p-4">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="relative z-10 flex items-start justify-between">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-emerald-450 dark:text-emerald-400 shadow-sm">
                <Activity size={18} />
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-650 dark:text-slate-300 transition-all group-hover:bg-emerald-500 group-hover:text-white">
                <ArrowRight size={14} />
            </div>
        </div>
        <div className="relative z-10">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Utility Lane</p>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white transition-colors group-hover:text-emerald-555 dark:group-hover:text-emerald-400">Spending Analytics</h3>
            <p className="hidden md:block mt-1 text-[11px] text-slate-500">Track expenses and budgeting.</p>
        </div>
    </div>
);

export const MarketWidget: React.FC<CommonWidgetProps> = ({ onClick }) => (
    <div onClick={onClick} className="preset-card card-premium-lift group relative flex h-full min-h-[156px] cursor-pointer flex-col justify-between overflow-hidden rounded-[24px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 p-3 transition-all hover:border-amber-500/50 hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:p-4">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="relative z-10 flex items-start justify-between">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2.5 text-amber-500 dark:text-amber-400 shadow-sm">
                <Activity size={18} />
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-650 dark:text-slate-300 transition-all group-hover:bg-amber-500 group-hover:text-white">
                <ArrowRight size={14} />
            </div>
        </div>
        <div className="relative z-10">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Intel Lane</p>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white transition-colors group-hover:text-amber-555 dark:group-hover:text-amber-400">Market Insights</h3>
            <p className="hidden md:block mt-1 text-[11px] text-slate-500">Trends, news and sentiment.</p>
        </div>
    </div>
);

export const CommunityWidget: React.FC<CommonWidgetProps> = ({ onClick }) => (
    <div onClick={onClick} className="preset-card card-premium-lift group relative flex h-full min-h-[156px] cursor-pointer flex-col justify-between overflow-hidden rounded-[24px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 p-3 transition-all hover:border-blue-500/50 hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:p-4">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="relative z-10 flex items-start justify-between">
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-2.5 text-blue-500 dark:text-blue-400 shadow-sm">
                <Users size={18} />
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-650 dark:text-slate-300 transition-all group-hover:bg-blue-500 group-hover:text-white">
                <ArrowRight size={14} />
            </div>
        </div>
        <div className="relative z-10">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Network Lane</p>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white transition-colors group-hover:text-blue-555 dark:group-hover:text-blue-400">Community</h3>
            <p className="hidden md:block mt-1 text-[11px] text-slate-500">Connect with investors.</p>
        </div>
    </div>
);

// ==========================================
// 4. Loan Widget Wrapper (Enhanced)
// ==========================================

export const LoanWidgetWrapper: React.FC<CommonWidgetProps & { showNetWorth?: boolean }> = ({ showNetWorth = true }) => {
    const loanPrincipal = useSettingsStore(state => state.loanPrincipal);
    const loanInterest = useSettingsStore(state => state.loanInterest);
    const [sessionInterest, setSessionInterest] = React.useState(0.0);

    const dailyInterest = useMemo(() => {
        return (loanPrincipal * (loanInterest / 100)) / 365;
    }, [loanPrincipal, loanInterest]);

    const isVisible = usePageVisibility();
    const isLiteMode = useLiteModeStore(state => state.isLiteMode);

    React.useEffect(() => {
        if (!isVisible || isLiteMode) return;

        const interestPerSecond = dailyInterest / 86400;
        const interval = setInterval(() => {
            setSessionInterest(prev => prev + interestPerSecond * 0.1);
        }, 100);
        return () => clearInterval(interval);
    }, [dailyInterest, isVisible, isLiteMode]);

    return (
        <div className={`preset-card kpi-lift group relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 md:p-6 ${!showNetWorth ? 'opacity-50 grayscale hover:grayscale-0 hover:opacity-100' : ''}`}>

            <div className="pointer-events-none absolute top-0 right-0 -mr-32 -mt-32 h-64 w-64 rounded-full bg-rose-500/5 blur-3xl" />

            <div className="relative z-10 mb-6 flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-rose-500">
                        <Landmark size={24} />
                    </div>
                    <div>
                        <h3 className="leading-tight text-lg font-bold text-slate-900 dark:text-white">Active Liability</h3>
                        <p className="text-xs font-medium text-slate-500">Debt Manager</p>
                    </div>
                </div>
                <span className="rounded border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-xs font-bold text-rose-500 shadow-sm shadow-rose-900/20">
                    {loanInterest}% APR
                </span>
            </div>

            <div className="relative z-10 mb-6">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">Outstanding Principal</p>
                <h2 className={`text-3xl font-black tracking-tight transition-colors ${!showNetWorth ? 'text-slate-400' : 'text-rose-450 dark:text-rose-400'}`}>
                    -INR {loanPrincipal.toLocaleString('en-IN')}
                </h2>
            </div>

            <div className={`preset-subcard relative mt-4 flex flex-col justify-center overflow-hidden rounded-xl border border-rose-500/20 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-950/20 p-3 transition-opacity ${!showNetWorth ? 'opacity-40' : 'opacity-100'}`}>
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-rose-500/50" />

                <div className="mb-1 flex items-start justify-between">
                    <div className="flex items-center gap-2 text-rose-500">
                        <TrendingDown size={14} />
                        <span className="text-xs font-bold uppercase tracking-wider">The Bleed</span>
                    </div>
                    <span className="text-[10px] font-bold uppercase text-slate-500">Interest Cost</span>
                </div>

                <div className="relative z-10 mt-1 flex items-end justify-between">
                    <div className="flex items-center gap-2">
                        {!isLiteMode && (
                            <div className="animate-drip text-rose-500">
                                <Droplet size={16} fill="currentColor" />
                            </div>
                        )}
                        <p className="text-xl font-bold text-slate-900 dark:text-white">INR {dailyInterest.toFixed(2)} <span className="text-sm font-normal text-slate-500 dark:text-slate-400">/ day</span></p>
                    </div>

                    <p className="mb-1 font-mono text-[10px] text-rose-400 opacity-80">
                        {isLiteMode ? 'Drip paused in Lite Mode' : `+${sessionInterest.toFixed(5)} since session`}
                    </p>
                </div>
            </div>

            <div className="relative z-10 mt-4 flex items-center gap-2 text-xs text-slate-500">
                <AlertTriangle size={12} className="text-rose-500/70" />
                <span className="font-medium italic opacity-70">
                    {showNetWorth ? "This debt reduces your real net worth." : "Liability impact hidden in Gross mode."}
                </span>
            </div>
        </div>
    );
};

export const Project5LWidget: React.FC = () => null;
