
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { Trash2, TrendingUp, TrendingDown, Shield, Target, Droplets, Sparkles, PartyPopper, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip } from 'recharts';
import { usePageVisibility } from '../../contexts/PageVisibilityContext';
import { PortfolioStats } from '../../types';
import { useLiteModeStore } from '../../store/liteModeStore';
import { formatINR } from '../../utils/indianFormatter';
import { SkeletonNumber, SkeletonLine } from '../ui/Skeleton';
import { ValueFlash } from '../shared/ValueFlash';
import { Badge } from '../ui/badge';
import { ToggleGroup } from '../ui/toggle-group';
import { useSettingsStore } from '../../store/settingsStore';

interface HeroSectionProps {
    stats: PortfolioStats;
    isPrivacyMode: boolean;
    dynamicHealthScore: number;
    formatCurrency: (val: number) => string;
    lifeEvents?: any[];
    addLifeEvent?: any;
    deleteLifeEvent?: any;
    // Global Toggle Props
    showLiability: boolean;
    setShowLiability: (val: boolean) => void;
}

// ===================== COUNT-UP ANIMATION HOOK =====================
const useCountUp = (targetValue: number, duration: number = 1500, isLiteMode: boolean = false) => {
    const [displayValue, setDisplayValue] = useState(0);
    const previousValue = useRef(0);
    const hasAnimatedOnce = useRef(false);

    useEffect(() => {
        // If Lite Mode is active and we've already animated once, update instantly
        if (isLiteMode && hasAnimatedOnce.current) {
            setDisplayValue(targetValue);
            previousValue.current = targetValue;
            return;
        }

        if (targetValue === previousValue.current) return;

        // If we've already animated once, and the user said "nothing else", we should probably update instantly
        // but for now let's respect the initial load requirement.
        if (hasAnimatedOnce.current) {
            setDisplayValue(targetValue);
            previousValue.current = targetValue;
            return;
        }

        const startValue = 0; // Always start from 0 for the "Initial Load" feel
        const diff = targetValue - startValue;
        const startTime = Date.now();

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing function for smooth animation
            const easeOutQuart = 1 - Math.pow(1 - progress, 4);
            const currentValue = startValue + (diff * easeOutQuart);

            setDisplayValue(Math.round(currentValue));

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                previousValue.current = targetValue;
                hasAnimatedOnce.current = true;
            }
        };

        requestAnimationFrame(animate);
    }, [targetValue, duration, isLiteMode]);

    return displayValue;
};

// ===================== PRIVACY SCRAMBLER HOOK =====================
const useScrambleText = (text: string, isActive: boolean, isLiteMode: boolean = false) => {
    const [scrambled, setScrambled] = useState(text);
    const chars = '!<>-_\\/[]{}-=+*^?#________';
    const hasScrambledOnce = useRef(false);

    useEffect(() => {
        if (!isActive || isLiteMode || hasScrambledOnce.current) {
            setScrambled(text);
            return;
        }

        let interval: NodeJS.Timeout;
        let iteration = 0;

        interval = setInterval(() => {
            setScrambled(text.split('').map((char, index) => {
                if (index < iteration) return text[index];
                return chars[Math.floor(Math.random() * chars.length)];
            }).join(''));

            if (iteration >= text.length) {
                clearInterval(interval);
                hasScrambledOnce.current = true;
            }
            iteration += 1 / 3;
        }, 30);

        return () => clearInterval(interval);
    }, [text, isActive, isLiteMode]);

    return isActive ? '••••••••' : scrambled; 
};

// ===================== MULTI-FACTOR HEALTH SCORES =====================
interface HealthScores {
    liquidity: number;
    growth: number;
    risk: number;
    goal: number;
    overall: number;
}

const calculateHealthScores = (stats: PortfolioStats, dynamicHealthScore: number): HealthScores => {
    // Liquidity Score: Emergency fund coverage (assume 6 months expenses = 100%)
    // Simple approximation: if total assets > 500k, assume decent liquidity
    const liquidityScore = Math.min(100, Math.round((stats?.totalAssets || 0) / 5000));

    // Growth Score: Based on P/L percentage
    const plPercent = parseFloat(stats?.totalPLPercent || '0');
    const growthScore = Math.min(100, Math.max(0, Math.round(50 + (plPercent * 2))));

    // Risk Score: Inverted - lower concentration = higher score
    const diversityScore = stats?.diversityScore || 50;
    const riskScore = Math.round(diversityScore);

    // Goal Score: Use progress toward target
    const goalScore = Math.min(100, Math.round(dynamicHealthScore || 0));

    // Overall: Weighted average
    const overall = Math.round(
        (liquidityScore * 0.2) +
        (growthScore * 0.3) +
        (riskScore * 0.25) +
        (goalScore * 0.25)
    );

    return { liquidity: liquidityScore, growth: growthScore, risk: riskScore, goal: goalScore, overall };
};

// ===================== SCORE RING COMPONENT =====================
const ScoreRing: React.FC<{
    score: number;
    label: string;
    icon: React.ReactNode;
    color: string;
    size?: 'sm' | 'md';
}> = ({ score, label, icon, color, size = 'sm' }) => {
    const circumference = 2 * Math.PI * 18;
    const roundedScore = typeof score === 'number' ? Math.round(score) : 0;
    const offset = circumference - (roundedScore / 100) * circumference;

    return (
        <div className="flex flex-col items-center gap-1">
            <div className={`relative ${size === 'md' ? 'w-14 h-14' : 'w-10 h-10'}`}>
                <svg className="w-full h-full -rotate-90" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r="18" fill="none"
                        className="stroke-slate-200 dark:stroke-white/[0.08]" strokeWidth="3" />
                    <circle cx="20" cy="20" r="18" fill="none"
                        className={color} strokeWidth="3"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                    />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                    {icon}
                </div>
            </div>
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">{label}</span>
            <span className={`text-xs font-mono font-bold ${color.replace('stroke-', 'text-')}`}>{roundedScore}</span>
        </div>
    );
};

// ===================== CELEBRATION OVERLAY =====================
const CelebrationOverlay: React.FC<{ show: boolean; milestone: string }> = ({ show, milestone }) => {
    if (!show) return null;

    return (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-gradient-to-br from-amber-500/15 via-indigo-500/10 to-emerald-500/15 backdrop-blur-md rounded-2xl animate-in fade-in zoom-in-95 duration-500">
            <div className="text-center p-6 bg-white/90 dark:bg-slate-900/90 border border-slate-200/80 dark:border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl">
                <PartyPopper className="w-10 h-10 text-amber-400 mx-auto mb-2 animate-bounce" />
                <p className="text-2xl font-black text-slate-900 dark:text-white font-mono">{milestone}</p>
                <p className="text-sm text-emerald-500 dark:text-emerald-400 font-bold">Milestone Reached! 🎉</p>
            </div>
        </div>
    );
};

const HeroSection: React.FC<HeroSectionProps> = ({
    stats, isPrivacyMode, dynamicHealthScore, formatCurrency,
    showLiability, setShowLiability,
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [showCelebration, setShowCelebration] = useState(false);
    const [celebrationMilestone, setCelebrationMilestone] = useState('');
    const previousMilestone = useRef(0);
    const isVisible = usePageVisibility();
    const isLiteMode = useLiteModeStore(state => state.isLiteMode);

    // Animated Net Worth Display
    const displayAmount = showLiability
        ? (stats?.totalValue || 0) // Net Worth (Assets - Liabilities)
        : (stats?.totalAssets || 0); // Gross Assets

    const animatedAmount = useCountUp(displayAmount, 1500, isLiteMode);

    // Privacy Scramble
    // Logic: We show scrambled text if privacy mode is ON.
    // Ideally we'd actually animate the scramble, but for now simple swap is safer for React render cycles.

    // Multi-factor Health Scores
    const healthScores = useMemo(() =>
        calculateHealthScores(stats, dynamicHealthScore),
        [stats, dynamicHealthScore]
    );

    // Dynamic gradient based on overall health
    const getGradientClass = () => {
        if (healthScores.overall > 75) return 'from-emerald-500/10 via-transparent to-cyan-500/10';
        if (healthScores.overall > 50) return 'from-amber-500/10 via-transparent to-orange-500/10';
        return 'from-rose-500/10 via-transparent to-pink-500/10';
    };

    // Milestone celebration detection
    useEffect(() => {
        if (!isVisible) return;
        const currentValue = stats?.totalAssets || 0;
        if (currentValue <= 0) return;

        // On initial mount/load, initialize milestone without flashing celebration
        if (previousMilestone.current === 0) {
            previousMilestone.current = currentValue;
            return;
        }

        const milestones = [100000, 500000, 1000000, 2500000, 5000000, 10000000];
        for (const milestone of milestones) {
            if (currentValue >= milestone && previousMilestone.current < milestone) {
                setCelebrationMilestone(formatINR(milestone, { compact: true }));
                setShowCelebration(true);
                setTimeout(() => setShowCelebration(false), 3000);
                break;
            }
        }
        previousMilestone.current = currentValue;
    }, [stats?.totalAssets, isVisible]);

    const designPreset = useSettingsStore((s) => s.designPreset) || 'wealthos-classic';
    const isAstryx = designPreset === 'astryx';
    const isReui = designPreset === 'reui-nova' || designPreset === 'shadcn';

    const cardShapeClass = isAstryx
        ? 'rounded-[12px] bg-[#262626] border border-[rgba(255,255,255,0.102)] text-white shadow-none p-3.5 sm:p-6 md:p-8'
        : isReui
        ? 'rounded-xl bg-card border border-border text-card-foreground shadow-sm p-3.5 sm:p-6 md:p-8'
        : `rounded-wa-lg bg-gradient-to-br ${getGradientClass()} bg-slate-900/80 dark:bg-wa-card backdrop-blur-2xl p-3.5 sm:p-6 md:p-8 border border-slate-800/80 dark:border-wa-border shadow-2xl`;

    return (
        <div className={`mb-8 relative group ${isAstryx ? 'rounded-[12px]' : isReui ? 'rounded-xl' : 'card-glow rounded-wa-lg'}`}>
            {/* NET WORTH CARD (Full Width) */}
            <div 
                className={`hero-net-worth-card relative overflow-hidden transition-all duration-500 ${cardShapeClass}`}
                style={isAstryx ? { fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' } : undefined}
            >

                {/* Celebration Overlay */}
                <CelebrationOverlay show={showCelebration} milestone={celebrationMilestone} />

                {/* Radiant Ambient Glass Orbs - disabled for clean Astryx / ReUI baselines */}
                {!isAstryx && !isReui && (
                    <div 
                        className="absolute inset-0 overflow-hidden pointer-events-none"
                        style={{ display: 'var(--hero-orbs, block)' }}
                    >
                        <div className="absolute top-6 right-16 w-80 h-80 bg-indigo-500/20 dark:bg-indigo-500/15 rounded-full blur-[100px] animate-pulse" />
                        <div className="absolute bottom-6 left-8 w-72 h-72 bg-emerald-500/20 dark:bg-emerald-500/15 rounded-full blur-[90px] animate-pulse delay-700" />
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-24 bg-indigo-500/10 blur-3xl rounded-full" />
                    </div>
                )}

                <div className="relative z-10">
                    {/* Header Row: Title & Top Right Controls */}
                    <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 mb-2">
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                {showLiability ? <Target size={14} className="text-indigo-400" /> : <Shield size={14} className="text-emerald-400" />}
                                <span>{showLiability ? 'Net Worth' : 'Gross Assets'}</span>
                            </p>
                            {stats?.totalPLPercent && (
                                <Badge
                                    variant={parseFloat(stats.totalPLPercent) >= 0 ? 'gain' : 'loss'}
                                    size="sm"
                                    className="text-[10px] font-black tracking-wide"
                                >
                                    {parseFloat(stats.totalPLPercent) >= 0 ? (
                                        <TrendingUp size={10} className="mr-0.5 shrink-0" />
                                    ) : (
                                        <TrendingDown size={10} className="mr-0.5 shrink-0" />
                                    )}
                                    {stats.totalPLPercent}%
                                </Badge>
                            )}

                            {stats?.totalPL !== undefined && (
                                <Badge
                                    variant={stats.totalPL >= 0 ? 'gain' : 'loss'}
                                    size="sm"
                                    className="text-[10px] font-black tracking-wide"
                                >
                                    {formatINR(stats.totalPL, { showSign: true })}
                                </Badge>
                            )}
                        </div>

                        {/* Top Right Controls: Segmented Toggle & Expand */}
                        <div className="flex items-center gap-2 sm:gap-3">
                            <ToggleGroup
                                size="xs"
                                value={showLiability ? 'net' : 'gross'}
                                onChange={(val) => setShowLiability(val === 'net')}
                                options={[
                                    { value: 'gross', label: 'Gross' },
                                    { value: 'net', label: 'Net' }
                                ]}
                                layoutId="hero-gross-net-toggle"
                                ariaLabel="Asset Valuation Mode"
                            />

                            <button
                                type="button"
                                onClick={() => setIsExpanded(!isExpanded)}
                                className="p-1.5 sm:p-2 text-slate-400 hover:text-white transition-colors rounded-xl bg-white/[0.06] border border-white/[0.08] hover:border-white/20 h-7 sm:h-8 w-7 sm:w-8 flex items-center justify-center shrink-0"
                                title={isExpanded ? "Collapse" : "Expand Details"}
                            >
                                <TrendingDown size={14} className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>
                        </div>
                    </div>

                    {/* Centered Amount */}
                    <div className="flex flex-col justify-center items-center py-3 sm:py-5 md:py-7 relative px-2 text-center">
                        {/* Subtle ambient glow behind text */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-20 bg-indigo-500/[0.03] blur-3xl rounded-full pointer-events-none" />

                        <div className="flex items-baseline gap-2 sm:gap-3 relative z-10 max-w-full overflow-hidden">
                            {(!stats || (animatedAmount === 0 && !stats?.totalAssets)) ? (
                                <div className="flex flex-col items-center gap-4">
                                    <SkeletonNumber size="xl" />
                                    <SkeletonLine width="120px" height={12} rounded />
                                </div>
                            ) : (
                                <AnimatePresence mode="wait">
                                    {isPrivacyMode ? (
                                        <motion.h1
                                            key="privacy"
                                            initial={{ opacity: 0, filter: "blur(10px)" }}
                                            animate={{ opacity: 1, filter: "blur(0px)" }}
                                            exit={{ opacity: 0, filter: "blur(10px)" }}
                                            className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-slate-400 dark:text-slate-500 font-mono select-none"
                                        >
                                            ••••••••
                                        </motion.h1>
                                    ) : (
                                        <ValueFlash value={displayAmount} className="inline-block max-w-full" epsilon={1}>
                                            <motion.div
                                                key="value"
                                                initial={{ opacity: 0, y: 15 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="flex items-baseline justify-center tracking-tight"
                                            >
                                                <span className="text-xl sm:text-3xl md:text-4xl lg:text-5xl font-semibold text-slate-400 select-none mr-1">₹</span>
                                                <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold text-white font-mono tabular-nums financial-value break-words drop-shadow-sm">
                                                    {formatINR(animatedAmount).replace(/^₹\s?/, '')}
                                                </h1>
                                            </motion.div>
                                        </ValueFlash>
                                    )}
                                </AnimatePresence>
                            )}

                            {!isPrivacyMode && healthScores.overall > 75 && stats?.totalAssets > 0 && (
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: "spring", delay: 0.5 }}
                                    className="shrink-0"
                                >
                                    <Sparkles className="w-5 h-5 sm:w-7 sm:h-7 md:w-8 md:h-8 text-amber-400 animate-pulse drop-shadow-[0_0_10px_rgba(251,191,36,0.5)]" />
                                </motion.div>
                            )}
                        </div>
                        <p className="text-[11px] font-mono text-slate-400 mt-2">
                            Consolidated Real-Time Value · Last synced moments ago
                        </p>
                    </div>

                    {/* Always-Visible Compact Summary Strip (Health Ring + 4 Asset Breakdown Chips) */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-4 border-t border-white/[0.08]">
                        {/* Dynamic Circular Health Ring */}
                        {(() => {
                            const chipShapeClass = isAstryx
                                ? 'rounded-[6px] bg-[#1e1e1e] border border-[rgba(255,255,255,0.06)]'
                                : isReui
                                ? 'rounded-lg bg-muted/40 border border-border'
                                : 'rounded-xl bg-slate-900/50 dark:bg-wa-surface/80 border border-slate-800/80 dark:border-wa-border';

                            return (
                                <div className={`md:col-span-1 flex items-center gap-3 p-3 ${chipShapeClass}`}>
                                    <div className="relative w-11 h-11 flex items-center justify-center shrink-0">
                                        <svg className="w-11 h-11 transform -rotate-90">
                                            <circle cx="22" cy="22" r="18" stroke="currentColor" strokeWidth="3.5" className="text-white/10" fill="none" />
                                            <circle
                                                cx="22" cy="22" r="18" stroke="currentColor" strokeWidth="3.5" className="text-emerald-400" fill="none"
                                                strokeDasharray="113.1"
                                                strokeDashoffset={Math.max(0, 113.1 - (113.1 * Math.min(100, Math.max(0, dynamicHealthScore || 90))) / 100)}
                                                strokeLinecap="round"
                                            />
                                        </svg>
                                        <span className="absolute font-mono font-bold text-xs text-white">
                                            {Math.round(dynamicHealthScore || 90)}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block font-bold">Health Score</span>
                                        <span className="text-xs font-bold text-emerald-400">
                                            {(dynamicHealthScore || 90) >= 80 ? 'Optimized' : 'Balanced'}
                                        </span>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* 4 Asset Class Breakdown Chips */}
                        <div className="md:col-span-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {(() => {
                                const total = (stats?.totalAssets && stats.totalAssets > 0) ? stats.totalAssets : 0;
                                const eq = stats?.byCategory?.['Equity'] ?? 0;
                                const hasFixedIncome = (stats?.byCategory?.['Fixed Income'] || stats?.byCategory?.['Debt'] || 0) > 0;
                                const debt = hasFixedIncome
                                    ? (stats?.byCategory?.['Fixed Income'] ?? stats?.byCategory?.['Debt'] ?? 0)
                                    : (stats?.totalLiability ?? 0);
                                const isLiabilityDebt = !hasFixedIncome && (stats?.totalLiability || 0) > 0;
                                const gold = (stats?.byCategory?.['Gold'] ?? stats?.byCategory?.['Commodities']) ?? 0;
                                const cash = (stats?.byCategory?.['Cash'] ?? stats?.byCategory?.['Other']) ?? 0;
                                const toPct = (val: number) => total > 0 ? ((val / total) * 100).toFixed(0) : '0';

                                const chipShapeClass = isAstryx
                                    ? 'rounded-[6px] bg-[#1e1e1e] border border-[rgba(255,255,255,0.06)]'
                                    : isReui
                                    ? 'rounded-lg bg-muted/40 border border-border'
                                    : 'rounded-xl bg-slate-900/50 dark:bg-wa-surface/80 border border-slate-800/80 dark:border-wa-border';

                                return (
                                    <>
                                        <div className={`p-2.5 ${chipShapeClass}`}>
                                            <span className="text-[10px] font-mono text-slate-400 uppercase block font-semibold">Equity ({toPct(eq)}%)</span>
                                            <span className="text-xs sm:text-sm font-mono font-bold text-white mt-0.5 block truncate">
                                                {isPrivacyMode ? '••••' : formatINR(eq, { compact: true })}
                                            </span>
                                        </div>
                                        <div className={`p-2.5 ${chipShapeClass}`}>
                                            <span className="text-[10px] font-mono text-slate-400 uppercase block font-semibold">
                                                {isLiabilityDebt ? 'Debt (Liab)' : `Debt (${toPct(debt)}%)`}
                                            </span>
                                            <span className={`text-xs sm:text-sm font-mono font-bold mt-0.5 block truncate ${isLiabilityDebt ? 'text-rose-400' : 'text-white'}`}>
                                                {isPrivacyMode ? '••••' : (isLiabilityDebt ? `-${formatINR(debt, { compact: true })}` : formatINR(debt, { compact: true }))}
                                            </span>
                                        </div>
                                        <div className={`p-2.5 ${chipShapeClass}`}>
                                            <span className="text-[10px] font-mono text-slate-400 uppercase block font-semibold">Gold ({toPct(gold)}%)</span>
                                            <span className="text-xs sm:text-sm font-mono font-bold text-white mt-0.5 block truncate">
                                                {isPrivacyMode ? '••••' : formatINR(gold, { compact: true })}
                                            </span>
                                        </div>
                                        <div className={`p-2.5 ${chipShapeClass}`}>
                                            <span className="text-[10px] font-mono text-slate-400 uppercase block font-semibold">Cash ({toPct(cash)}%)</span>
                                            <span className="text-xs sm:text-sm font-mono font-bold text-white mt-0.5 block truncate">
                                                {isPrivacyMode ? '••••' : formatINR(cash, { compact: true })}
                                            </span>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Expandable Section */}
                    <AnimatePresence>
                        {isExpanded && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ type: "spring", damping: 20, stiffness: 100 }}
                                className="overflow-hidden"
                            >
                                <div className="mt-6 pt-6 border-t border-slate-200 dark:border-white/[0.06]">
                                    {/* Multi-Factor Health Scores */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-50/80 dark:bg-white/[0.04] rounded-xl border border-slate-200/80 dark:border-white/[0.08] mb-6 backdrop-blur-sm">
                                        <ScoreRing
                                            score={healthScores.liquidity}
                                            label="Liquidity"
                                            icon={<Droplets size={12} className="text-blue-400" />}
                                            color="stroke-blue-400"
                                        />
                                        <ScoreRing
                                            score={healthScores.growth}
                                            label="Growth"
                                            icon={<TrendingUp size={12} className="text-emerald-400" />}
                                            color="stroke-emerald-400"
                                        />
                                        <ScoreRing
                                            score={healthScores.risk}
                                            label="Risk"
                                            icon={<Shield size={12} className="text-amber-400" />}
                                            color="stroke-amber-400"
                                        />
                                        <ScoreRing
                                            score={healthScores.goal}
                                            label="Goal"
                                            icon={<Target size={12} className="text-indigo-400" />}
                                            color="stroke-indigo-400"
                                        />
                                    </div>

                                    {/* Portfolio Composition Donut */}
                                    {stats?.totalAssets > 0 && !isLiteMode && isVisible && (() => {
                                        const catData = stats.byCategory || {
                                            'Equity': stats.totalAssets * 0.6,
                                            'Fixed Income': stats.totalAssets * 0.2,
                                            'Commodities': stats.totalAssets * 0.15,
                                            'Other': stats.totalAssets * 0.05,
                                        };
                                        const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#64748b', '#f43f5e', '#0ea5e9'];
                                        const pieData = Object.entries(catData)
                                            .filter(([, v]) => v > 0)
                                            .map(([name, value]) => ({ name, value: value as number }));
                                        const total = pieData.reduce((s, d) => s + d.value, 0);
                                        return (
                                            <>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 mt-6">Portfolio Composition</p>
                                                <div className="flex items-center gap-6 mb-6">
                                                    <div style={{ width: 130, height: 130 }}>
                                                        <SafeChartContainer>
                                                            <PieChart>
                                                                <Pie
                                                                    data={pieData}
                                                                    cx="50%"
                                                                    cy="50%"
                                                                    innerRadius={35}
                                                                    outerRadius={55}
                                                                    dataKey="value"
                                                                    isAnimationActive={!isLiteMode}
                                                                >
                                                                    {pieData.map((_, i) => (
                                                                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                                                    ))}
                                                                </Pie>
                                                                <RechartsTooltip
                                                                    content={({ active, payload }) => {
                                                                        if (active && payload && payload.length) {
                                                                            const d = payload[0].payload as any;
                                                                            const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0';
                                                                            return (
                                                                                <div className="bg-white dark:bg-[#0D0E14]/95 backdrop-blur-xl border border-slate-200 dark:border-white/[0.10] p-2.5 rounded-xl shadow-2xl">
                                                                                    <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{d.name}</p>
                                                                                    <p className="text-xs font-black text-slate-900 dark:text-white">{formatINR(d.value)} <span className="text-slate-500">({pct}%)</span></p>
                                                                                </div>
                                                                            );
                                                                        }
                                                                        return null;
                                                                    }}
                                                                />
                                                            </PieChart>
                                                        </SafeChartContainer>
                                                    </div>
                                                    <div className="flex flex-col gap-1.5">
                                                        {pieData.map((d, i) => {
                                                            const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0';
                                                            return (
                                                                <div key={d.name} className="flex items-center gap-2">
                                                                    <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                                                                    <span className="text-[10px] text-slate-400">{d.name}</span>
                                                                    <span className="text-[10px] font-bold text-right ml-auto">{pct}%</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </>
                                        );
                                    })()}

                                    {isLiteMode && stats?.totalAssets > 0 && (
                                        <div className="mt-6 p-4 bg-slate-100 dark:bg-[#131620]/60 rounded-xl border border-slate-200 dark:border-white/[0.06] text-center">
                                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Analytics Hidden in Lite Mode</p>
                                        </div>
                                    )}

                                    {/* Bottom Stats Row */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center md:text-left">
                                        <div>
                                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Assets</p>
                                            <ValueFlash value={stats?.totalAssets || 0} className="inline-block" epsilon={1}>
                                                <p className="text-slate-600 dark:text-slate-200 font-mono font-tabular text-lg font-semibold tabular-nums">
                                                    {isPrivacyMode ? '••••' : formatINR(stats?.totalAssets || 0)}
                                                </p>
                                            </ValueFlash>
                                        </div>
                                        <div className={`transition-opacity duration-300 ${!showLiability ? 'opacity-40 grayscale' : 'opacity-100'}`}>
                                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-1">Liabilities</p>
                                            <ValueFlash value={stats?.totalLiability || 0} className="inline-block" epsilon={1}>
                                                <p className="text-rose-400 font-mono font-tabular text-lg font-semibold tabular-nums">
                                                    -{isPrivacyMode ? '••••' : formatINR(stats?.totalLiability || 0)}
                                                </p>
                                            </ValueFlash>
                                        </div>
                                        <div>
                                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-1">Overall Score</p>
                                            <div className="flex items-center gap-2 justify-center md:justify-start">
                                                <div className="flex-1 max-w-[100px] h-2 bg-slate-200 dark:bg-[#181C2A] rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full transition-all duration-1000 ${healthScores.overall > 75 ? 'bg-emerald-500' :
                                                            healthScores.overall > 50 ? 'bg-amber-500' : 'bg-rose-500'
                                                            }`}
                                                        style={{ width: `${healthScores.overall}%` }}
                                                    />
                                                </div>
                                                {healthScores.overall > 75 && (
                                                    <span className="relative flex h-2.5 w-2.5 ml-1">
                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                                    </span>
                                                )}
                                                <span className={`font-mono text-sm font-bold ${healthScores.overall > 75 ? 'text-emerald-400' :
                                                    healthScores.overall > 50 ? 'text-amber-400' : 'text-rose-400'
                                                    }`}>
                                                    {healthScores.overall}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
};

export default HeroSection;
