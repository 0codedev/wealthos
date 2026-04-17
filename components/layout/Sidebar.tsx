import React, { useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    TrendingUp,
    LayoutDashboard,
    Wallet,
    Globe,
    Bot,
    Settings,
    X,
    Target,
    Zap,
    Brain,
    Lightbulb,
    Layers,
    Sun,
    Moon,
    Eye,
    EyeOff,
    Rocket,
    Grid,
    Beaker,
    Activity,
    MessageSquare,
    Waves,
    Wrench,
    Cpu,
    CandlestickChart,
    ChevronDown,
    ShieldCheck
} from 'lucide-react';
import { useSettingsStore, TIER_CATEGORIES, ExperienceTier } from '../../store/settingsStore';
import { slideFromLeft } from '../ui/motion/variants';
import { useShallow } from 'zustand/react/shallow';

interface SidebarProps {
    activeCategory: string;
    setActiveCategory: (id: string) => void;
    isMobileMenuOpen: boolean;
    setIsMobileMenuOpen: (isOpen: boolean) => void;
    onOpenSettings: () => void;
    totalNetWorth: string;
    isPrivacyMode: boolean;
    onTogglePrivacy?: () => void;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
}

export interface NavItemConfig {
    id: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    label: string;
    badge?: string;
    badgeColor?: string;
    description?: string;
}

export interface NavPillarConfig {
    id: string;
    label: string;
    shortLabel: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    items: NavItemConfig[];
}

export const NAV_PILLARS: NavPillarConfig[] = [
    {
        id: 'wealth',
        label: 'Wealth & Core',
        shortLabel: 'Core',
        icon: Wallet,
        items: [
            { id: 'dashboard', icon: LayoutDashboard, label: 'Command Center', description: 'Real-time overview & routines' },
            { id: 'portfolio', icon: Wallet, label: 'Portfolio Hub', description: 'Holdings, vaults & VaR' },
            { id: 'growth', icon: TrendingUp, label: 'Growth Engine', description: 'Compounding & FIRE goals' },
        ],
    },
    {
        id: 'trading',
        label: 'Execution & Radar',
        shortLabel: 'Radar',
        icon: CandlestickChart,
        items: [
            { id: 'charts', icon: CandlestickChart, label: 'Pro Charts', badge: 'Live', badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', description: 'OpenAlgo Canvas terminal' },
            { id: 'tradefinder', icon: Target, label: 'TradeFinder', description: 'Breakout & pattern scanner' },
            { id: 'alpha', icon: Rocket, label: 'Alpha Engine', description: 'Momentum continuation radar' },
            { id: 'pool', icon: Waves, label: 'Momentum Pool', description: 'Relative strength & liquidity' },
            { id: 'vibe-trading', icon: Cpu, label: 'Vibe-Trading AI', badge: 'AI', badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30', description: 'Voice trading & agent bridge' },
        ],
    },
    {
        id: 'intel',
        label: 'Market & Intel',
        shortLabel: 'Intel',
        icon: Globe,
        items: [
            { id: 'market', icon: Globe, label: 'Market Intel', description: 'Option chains & F&O heatmaps' },
            { id: 'signals', icon: Activity, label: 'Signal Intel', description: 'Multi-timeframe alert engine' },
            { id: 'telegram', icon: MessageSquare, label: 'Telegram Intel', badge: 'Ear', badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30', description: 'Channel feeds & audio signals' },
            { id: 'ipo', icon: Zap, label: 'IPO War Room', description: 'GMP radar & allotment trends' },
        ],
    },
    {
        id: 'quant',
        label: 'Quant & Strategy',
        shortLabel: 'Quant',
        icon: Bot,
        items: [
            { id: 'algo-bots', icon: Bot, label: 'Algo Bots', badge: 'Auto', badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30', description: 'Execution daemons & paper bridge' },
            { id: 'backtester', icon: Beaker, label: 'Strategy Lab', description: 'Apex backtester & 7 engines' },
            { id: 'ai-research', icon: Brain, label: 'AI Research Lab', description: 'LLM quant thesis engine' },
            { id: 'innovation', icon: Lightbulb, label: 'Moonshot Lab', description: 'Boardroom incubation concepts' },
        ],
    },
    {
        id: 'desk',
        label: 'Desk & Operations',
        shortLabel: 'Desk',
        icon: Wrench,
        items: [
            { id: 'journal', icon: Brain, label: 'Trading Journal', description: 'Trade logs & psycho-analytics' },
            { id: 'tools', icon: Wrench, label: 'Advanced Tools', description: 'Sector rotation & correlation' },
            { id: 'launchpad', icon: Grid, label: 'Launchpad', description: 'Command terminal & utility matrix' },
            { id: 'analytics', icon: Layers, label: 'Analytics Hub', description: 'Math lab & Monte Carlo models' },
        ],
    },
];

const prefetchCategory = (id: string) => {
    switch (id) {
        case 'charts':
            import('../tabs/ProChartsTab').catch(() => { });
            break;
        case 'tools':
            import('../tools/SectorRotationTab').catch(() => { });
            break;
        case 'alpha':
            import('../tabs/AlphaEngineTab').catch(() => { });
            break;
        case 'analytics':
            import('../calculators/MathLabHub').catch(() => { });
            break;
        case 'backtester':
            import('../tabs/ApexBacktesterTab').catch(() => { });
            break;
        case 'market':
            import('../market/OptionChainIntel').catch(() => { });
            import('../tabs/market/StockResearch').catch(() => { });
            break;
        case 'ipo':
            import('../tabs/IPOWarRoom').catch(() => { });
            break;
        case 'growth':
            import('../growth/AlphaPredator').catch(() => { });
            break;
        case 'innovation':
            import('../innovation/Boardroom').catch(() => { });
            break;
        case 'telegram':
            import('../tabs/TelegramIntelHub').catch(() => { });
            break;
        case 'pool':
            import('../pool/PoolCategoryPage').catch(() => { });
            break;
        case 'launchpad':
            import('../tabs/LaunchpadTab').catch(() => { });
            break;
        case 'journal':
            import('../journal/ExecutionDesk').catch(() => { });
            break;
    }
};

const Sidebar: React.FC<SidebarProps> = ({
    activeCategory,
    setActiveCategory,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    onOpenSettings,
    totalNetWorth,
    isPrivacyMode,
    onTogglePrivacy,
    isCollapsed,
    onToggleCollapse
}) => {
    const experienceTier = useSettingsStore(useShallow(state => state.experienceTier || (state.expertMode ? 'QUANT' : 'INVESTOR')));
    const customEnabledCategories = useSettingsStore(useShallow(state => state.customEnabledCategories));
    const designPreset = useSettingsStore(useShallow(state => state.designPreset)) || 'wealthos-classic';
    const isAstryx = designPreset === 'astryx';
    const isReui = designPreset === 'reui-nova' || designPreset === 'shadcn';

    // Find which pillar owns the activeCategory
    const activePillarId = useMemo(() => {
        const found = NAV_PILLARS.find(p => p.items.some(i => i.id === activeCategory));
        return found ? found.id : 'wealth';
    }, [activeCategory]);

    // Accordion expand/pin state
    const [pinnedPillars, setPinnedPillars] = useState<Set<string>>(() => new Set([activePillarId]));
    const [hoveredPillar, setHoveredPillar] = useState<string | null>(null);
    const flyoutCloseTimer = useRef<NodeJS.Timeout | null>(null);
    const pillarHoverTimer = useRef<NodeJS.Timeout | null>(null);
    const dismissedPillarRef = useRef<string | null>(null);

    // Cleanup timers on unmount
    useEffect(() => {
        return () => {
            if (flyoutCloseTimer.current) clearTimeout(flyoutCloseTimer.current);
            if (pillarHoverTimer.current) clearTimeout(pillarHoverTimer.current);
        };
    }, []);

    // Auto-pin active pillar whenever activeCategory changes
    useEffect(() => {
        setPinnedPillars(prev => {
            if (prev.has(activePillarId)) return prev;
            const next = new Set(prev);
            next.add(activePillarId);
            return next;
        });
    }, [activePillarId]);

    // Close mobile menu on route change
    useEffect(() => {
        setIsMobileMenuOpen(false);
    }, [activeCategory, setIsMobileMenuOpen]);

    const activeCategoryIds = useMemo(() => {
        let ids: string[];
        if (customEnabledCategories && customEnabledCategories.length > 0) {
            ids = customEnabledCategories;
        } else {
            ids = TIER_CATEGORIES[experienceTier] || TIER_CATEGORIES.QUANT;
        }
        return ids.includes('dashboard') ? ids : ['dashboard', ...ids];
    }, [experienceTier, customEnabledCategories]);

    // Fallback to dashboard if active category gets hidden by tier change
    useEffect(() => {
        if (activeCategory && activeCategory !== 'settings' && !activeCategoryIds.includes(activeCategory)) {
            setActiveCategory('dashboard');
        }
    }, [activeCategory, activeCategoryIds, setActiveCategory]);

    const togglePillarPin = (pillarId: string) => {
        if (pillarHoverTimer.current) {
            clearTimeout(pillarHoverTimer.current);
            pillarHoverTimer.current = null;
        }
        setPinnedPillars(prev => {
            const next = new Set(prev);
            if (next.has(pillarId)) {
                next.delete(pillarId);
                // Explicitly unpinned/collapsed -> dismiss hover so it collapses immediately without waiting for cursor to leave
                dismissedPillarRef.current = pillarId;
                setHoveredPillar(null);
            } else {
                next.add(pillarId);
                dismissedPillarRef.current = null;
            }
            return next;
        });
    };

    const handlePillarMouseEnter = (pillarId: string) => {
        if (dismissedPillarRef.current === pillarId) return;
        if (pillarHoverTimer.current) {
            clearTimeout(pillarHoverTimer.current);
            pillarHoverTimer.current = null;
        }
        setHoveredPillar(pillarId);
    };

    const handlePillarMouseLeave = (pillarId: string) => {
        if (dismissedPillarRef.current === pillarId) {
            dismissedPillarRef.current = null;
        }
        if (pillarHoverTimer.current) {
            clearTimeout(pillarHoverTimer.current);
        }
        pillarHoverTimer.current = setTimeout(() => {
            setHoveredPillar(curr => (curr === pillarId ? null : curr));
            pillarHoverTimer.current = null;
        }, 130);
    };

    const handleRailMouseEnter = (pillarId: string) => {
        if (flyoutCloseTimer.current) {
            clearTimeout(flyoutCloseTimer.current);
            flyoutCloseTimer.current = null;
        }
        setHoveredPillar(pillarId);
    };

    const handleRailMouseLeave = () => {
        flyoutCloseTimer.current = setTimeout(() => {
            setHoveredPillar(null);
        }, 180);
    };

    const handleTierChange = (tier: ExperienceTier) => {
        useSettingsStore.getState().updateSetting('experienceTier', tier);
    };

    // Filter pillars based on activeCategoryIds
    const visiblePillars = useMemo(() => {
        return NAV_PILLARS.map(pillar => ({
            ...pillar,
            items: pillar.items.filter(item => activeCategoryIds.includes(item.id))
        })).filter(pillar => pillar.items.length > 0);
    }, [activeCategoryIds]);

    const renderSidebarContent = (prefix = 'desktop', forceExpanded = false) => {
        const collapsed = isCollapsed && !forceExpanded;

        return (
            <div className="flex flex-col h-full select-none">
                {/* Header / Brand Logo */}
                <div className={`w-full px-3 sm:px-4 flex items-center justify-between h-[56px] border-b shrink-0 ${
                    isAstryx 
                        ? 'border-[rgba(255,255,255,0.08)] bg-[#1b1b1b]' 
                        : isReui 
                        ? 'border-white/[0.07] bg-[#090A10]' 
                        : 'border-slate-200 dark:border-white/[0.06] bg-slate-900/60 dark:bg-wa-card/60'
                } ${collapsed ? 'justify-center px-2' : ''}`}>
                    <button
                        type="button"
                        className="flex items-center gap-2.5 focus:outline-none group"
                        onClick={onToggleCollapse}
                        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    >
                        {isAstryx ? (
                            <div className="w-8 h-8 rounded-[8px] bg-white text-[#111111] flex items-center justify-center font-bold text-xs font-mono shadow-sm group-hover:scale-105 transition-transform">
                                A
                            </div>
                        ) : isReui ? (
                            <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 flex items-center justify-center shadow-sm font-bold text-xs font-mono group-hover:scale-105 transition-transform">
                                R
                            </div>
                        ) : (
                            <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] flex items-center justify-center shadow-lg shadow-blue-500/20 ring-1 ring-white/10 group-hover:scale-105 transition-transform">
                                <TrendingUp className="text-white relative z-10" size={16} />
                            </div>
                        )}

                        {!collapsed && (
                            isAstryx ? (
                                <div className="text-left font-['Figtree']">
                                    <h1 className="text-sm font-bold text-white tracking-wide">ASTRYX</h1>
                                    <p className="text-[9px] uppercase tracking-widest text-[#9e9e9e] font-semibold">Meta Terminal</p>
                                </div>
                            ) : isReui ? (
                                <div className="text-left font-['Inter'] flex items-center gap-2">
                                    <h1 className="text-sm font-bold text-zinc-100 tracking-tight">WealthOS</h1>
                                    <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300">REUI</span>
                                </div>
                            ) : (
                                <div>
                                    <h1 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight leading-none">
                                        Wealth<span className="text-[#3b82f6]">OS</span>
                                    </h1>
                                    <p className="text-[9px] uppercase tracking-widest text-slate-400 font-bold mt-0.5">Enterprise</p>
                                </div>
                            )
                        )}
                    </button>

                    <button
                        type="button"
                        aria-label="Close navigation menu"
                        onClick={(e) => { e.stopPropagation(); setIsMobileMenuOpen(false); }}
                        className="md:hidden p-2 text-slate-400 hover:text-rose-400 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Top Tier Segmented Switcher */}
                {!collapsed ? (
                    <div className="px-3 pt-3 pb-1 shrink-0">
                        <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-slate-950/70 border border-white/[0.08] text-[10px] font-mono font-bold shadow-inner">
                            {(['INVESTOR', 'TRADER', 'QUANT'] as ExperienceTier[]).map(tier => {
                                const isActive = experienceTier === tier;
                                return (
                                    <button
                                        key={tier}
                                        type="button"
                                        onClick={() => handleTierChange(tier)}
                                        className={`py-1 rounded text-center transition-all uppercase tracking-wider ${
                                            isActive
                                                ? 'bg-indigo-600 text-white font-extrabold shadow-sm'
                                                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                                        }`}
                                    >
                                        {tier === 'INVESTOR' ? 'Inv' : tier === 'TRADER' ? 'Trd' : 'Qnt'}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <div className="flex justify-center pt-2.5 pb-1 shrink-0">
                        <button
                            type="button"
                            onClick={() => {
                                const cycle: Record<ExperienceTier, ExperienceTier> = {
                                    INVESTOR: 'TRADER',
                                    TRADER: 'QUANT',
                                    QUANT: 'INVESTOR',
                                };
                                handleTierChange(cycle[experienceTier] || 'INVESTOR');
                            }}
                            title={`Current Tier: ${experienceTier} (Click to cycle)`}
                            className="w-10 h-6 rounded-md bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 font-mono text-[10px] font-extrabold flex items-center justify-center hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
                        >
                            {experienceTier === 'INVESTOR' ? 'INV' : experienceTier === 'TRADER' ? 'TRD' : 'QNT'}
                        </button>
                    </div>
                )}

                {/* Main Navigation Area */}
                <nav
                    id={`${prefix}-sidebar-nav`}
                    className={`flex-1 px-2 mt-2 select-none overscroll-contain ${
                        collapsed ? 'overflow-visible relative space-y-1.5' : 'overflow-y-auto no-scrollbar space-y-2'
                    } ${isAstryx ? "font-['Figtree']" : isReui ? "font-['Inter']" : ""}`}
                >
                    {visiblePillars.map(pillar => {
                        const isPillarActive = pillar.items.some(i => i.id === activeCategory);
                        const isPinned = pinnedPillars.has(pillar.id);
                        const isHovered = hoveredPillar === pillar.id;
                        const isExpanded = isPinned || isHovered;

                        // Collapsed Rail Mode: Centered icon button with floating popout flyout
                        if (collapsed) {
                            return (
                                <div
                                    key={pillar.id}
                                    className="relative flex justify-center group/rail"
                                    onMouseEnter={() => handleRailMouseEnter(pillar.id)}
                                    onMouseLeave={handleRailMouseLeave}
                                >
                                    <button
                                        type="button"
                                        onClick={() => togglePillarPin(pillar.id)}
                                        aria-label={pillar.label}
                                        className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
                                            isPillarActive
                                                ? 'bg-indigo-600/90 text-white shadow-md shadow-indigo-900/30'
                                                : isHovered
                                                ? 'bg-white/[0.08] text-white'
                                                : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                                        }`}
                                    >
                                        <pillar.icon size={18} />
                                        {isPillarActive && (
                                            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-slate-900" />
                                        )}
                                    </button>

                                    {/* Floating Popout Flyout (Silky Smooth Micro-Slide) */}
                                    <AnimatePresence>
                                        {isHovered && (
                                            <motion.div
                                                initial={{ opacity: 0, scale: 0.95, x: -6 }}
                                                animate={{ opacity: 1, scale: 1, x: 0 }}
                                                exit={{ opacity: 0, scale: 0.95, x: -6 }}
                                                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                                                className="absolute left-[54px] top-0 w-60 rounded-xl bg-slate-900/95 dark:bg-[#0c1017]/95 border border-slate-700/80 dark:border-white/10 shadow-2xl p-2 z-50 backdrop-blur-xl"
                                                onMouseEnter={() => handleRailMouseEnter(pillar.id)}
                                                onMouseLeave={handleRailMouseLeave}
                                            >
                                            <div className="px-2.5 py-1.5 mb-1.5 border-b border-white/[0.08] flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <pillar.icon size={14} className="text-indigo-400" />
                                                    <span className="text-xs font-bold text-white uppercase tracking-wider">{pillar.label}</span>
                                                </div>
                                                <span className="text-[10px] font-mono text-slate-400">{pillar.items.length}</span>
                                            </div>
                                            <div className="space-y-0.5">
                                                {pillar.items.map(item => {
                                                    const isItemActive = activeCategory === item.id;
                                                    return (
                                                        <button
                                                            key={item.id}
                                                            type="button"
                                                            onClick={() => {
                                                                setActiveCategory(item.id);
                                                                setHoveredPillar(null);
                                                            }}
                                                            onMouseEnter={() => prefetchCategory(item.id)}
                                                            className={`flex items-center justify-between w-full px-2.5 py-2 rounded-lg text-xs font-medium transition-all ${
                                                                isItemActive
                                                                    ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                                                                    : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
                                                            }`}
                                                        >
                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                <item.icon size={15} className={isItemActive ? 'text-white' : 'text-slate-400'} />
                                                                <span className="truncate">{item.label}</span>
                                                            </div>
                                                            {item.badge && (
                                                                <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border shrink-0 ${item.badgeColor || 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'}`}>
                                                                    {item.badge}
                                                                </span>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                                </div>
                            );
                        }

                        // Expanded Accordion Mode
                        return (
                            <div
                                key={pillar.id}
                                className="w-full mb-1"
                                onMouseEnter={() => handlePillarMouseEnter(pillar.id)}
                                onMouseLeave={() => handlePillarMouseLeave(pillar.id)}
                            >
                                {/* Pillar Accordion Header */}
                                <button
                                    type="button"
                                    onClick={() => togglePillarPin(pillar.id)}
                                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors group ${
                                        isPillarActive
                                            ? 'text-indigo-400 dark:text-indigo-300'
                                            : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <pillar.icon size={14} className={isPillarActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'} />
                                        <span className="truncate">{pillar.label}</span>
                                        <span className="text-[10px] font-mono text-slate-500 font-normal">
                                            ({pillar.items.length})
                                        </span>
                                    </div>
                                    <ChevronDown
                                        size={14}
                                        className={`text-slate-500 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] shrink-0 ${isExpanded ? 'rotate-180 text-indigo-400' : ''}`}
                                    />
                                </button>

                                {/* Velvety Smooth Fluid Accordion (Hardware Accelerated) */}
                                <AnimatePresence initial={false}>
                                    {isExpanded && (
                                        <motion.div
                                            key={`pillar-content-${pillar.id}`}
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{
                                                height: 'auto',
                                                opacity: 1,
                                                transition: {
                                                    height: { duration: 0.26, ease: [0.16, 1, 0.3, 1] },
                                                    opacity: { duration: 0.2, ease: 'easeOut' }
                                                }
                                            }}
                                            exit={{
                                                height: 0,
                                                opacity: 0,
                                                transition: {
                                                    height: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
                                                    opacity: { duration: 0.14, ease: 'easeIn' }
                                                }
                                            }}
                                            className="overflow-hidden"
                                        >
                                            <div className="space-y-0.5 pt-1 pl-2 border-l border-white/[0.06] ml-3.5 mt-0.5">
                                        {pillar.items.map(item => {
                                            const isActive = activeCategory === item.id;

                                            if (isAstryx) {
                                                return (
                                                    <button
                                                        key={item.id}
                                                        type="button"
                                                        onClick={() => setActiveCategory(item.id)}
                                                        onMouseEnter={() => prefetchCategory(item.id)}
                                                        onFocus={() => prefetchCategory(item.id)}
                                                        className={`flex items-center justify-between w-full px-2.5 py-2 rounded-[8px] text-xs transition-colors ${
                                                            isActive
                                                                ? 'bg-[#262626] border border-[#525252] text-white font-semibold'
                                                                : 'text-[#9e9e9e] hover:text-white hover:bg-[#262626]/50 border border-transparent'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                            {isActive && <span className="size-1.5 rounded-full bg-white shrink-0" />}
                                                            <item.icon size={15} className={isActive ? 'text-white' : 'text-[#9e9e9e]'} />
                                                            <span className="truncate">{item.label}</span>
                                                        </div>
                                                        {item.badge && (
                                                            <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-white/10 text-white/80">
                                                                {item.badge}
                                                            </span>
                                                        )}
                                                    </button>
                                                );
                                            }

                                            if (isReui) {
                                                return (
                                                    <button
                                                        key={item.id}
                                                        type="button"
                                                        onClick={() => setActiveCategory(item.id)}
                                                        onMouseEnter={() => prefetchCategory(item.id)}
                                                        onFocus={() => prefetchCategory(item.id)}
                                                        className={`flex items-center justify-between w-full px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                                                            isActive
                                                                ? 'bg-zinc-800 border border-zinc-700 text-zinc-100 shadow-sm'
                                                                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 border border-transparent'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                            <item.icon size={15} className={isActive ? 'text-zinc-100' : 'text-zinc-400'} />
                                                            <span className="truncate">{item.label}</span>
                                                        </div>
                                                        {item.badge && (
                                                            <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border ${item.badgeColor || 'bg-zinc-700 text-zinc-200 border-zinc-600'}`}>
                                                                {item.badge}
                                                            </span>
                                                        )}
                                                    </button>
                                                );
                                            }

                                            // Default WealthOS Classic
                                            return (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    onClick={() => setActiveCategory(item.id)}
                                                    onMouseEnter={() => prefetchCategory(item.id)}
                                                    onFocus={() => prefetchCategory(item.id)}
                                                    className={`relative flex items-center justify-between w-full px-2.5 py-2 rounded-xl text-xs transition-all duration-150 group ${
                                                        isActive
                                                            ? 'bg-indigo-50/80 dark:bg-white/[0.08] text-indigo-600 dark:text-white font-bold shadow-sm border border-indigo-500/20 dark:border-white/10'
                                                            : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04] hover:text-slate-900 dark:hover:text-slate-200'
                                                    }`}
                                                >
                                                    {isActive && (
                                                        <div className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
                                                    )}
                                                    <div className="relative z-10 flex items-center gap-2.5 min-w-0">
                                                        <item.icon
                                                            size={16}
                                                            className={`transition-colors shrink-0 ${
                                                                isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'
                                                            }`}
                                                        />
                                                        <span className="truncate">{item.label}</span>
                                                    </div>
                                                    {item.badge && (
                                                        <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border shrink-0 ${item.badgeColor || 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'}`}>
                                                            {item.badge}
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                        );
                    })}
                </nav>

                {/* Sidebar Footer */}
                <div className={`p-2.5 border-t shrink-0 ${
                    isAstryx 
                        ? 'border-[rgba(255,255,255,0.08)] font-[\'Figtree\']' 
                        : isReui 
                        ? 'border-white/[0.07] font-[\'Inter\']' 
                        : 'border-slate-200 dark:border-white/[0.06] bg-slate-900/40'
                } space-y-1.5`}>
                    <button
                        type="button"
                        aria-label="Open settings"
                        onClick={onOpenSettings}
                        title="Settings"
                        className={`flex items-center gap-2.5 w-full px-2.5 h-[36px] transition-all font-medium ${
                            isAstryx
                                ? `rounded-[8px] text-xs ${
                                    activeCategory === 'settings'
                                        ? 'bg-[#262626] border border-[#525252] text-white font-semibold'
                                        : 'text-[#9e9e9e] hover:text-white hover:bg-[#262626]/50 border border-transparent'
                                }`
                                : isReui
                                ? `rounded-lg text-xs ${
                                    activeCategory === 'settings'
                                        ? 'bg-zinc-800 border border-zinc-700 text-zinc-100 shadow-sm'
                                        : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 border border-transparent'
                                }`
                                : `rounded-xl text-xs ${
                                    activeCategory === 'settings'
                                        ? 'bg-indigo-50/80 dark:bg-white/[0.08] text-indigo-600 dark:text-white font-semibold shadow-sm'
                                        : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04] hover:text-slate-200'
                                }`
                        } ${collapsed ? 'justify-center px-0' : ''}`}
                    >
                        <Settings size={17} className={activeCategory === 'settings' ? 'text-indigo-400' : ''} />
                        {!collapsed && <span>Settings</span>}
                    </button>

                    {!collapsed ? (
                        <div
                            onClick={() => setActiveCategory('settings')}
                            className={`p-2.5 transition-all cursor-pointer group relative overflow-hidden ${
                                isAstryx
                                    ? 'rounded-[8px] bg-[#262626] border border-[#525252]'
                                    : isReui
                                    ? 'rounded-lg bg-zinc-900 border border-zinc-800 shadow-sm hover:border-zinc-700'
                                    : 'rounded-xl bg-slate-800/60 dark:bg-white/[0.04] border border-slate-700/60 dark:border-white/[0.06] hover:border-indigo-500/30'
                            }`}
                        >
                            {!isAstryx && !isReui && (
                                <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-emerald-500/10 to-transparent blur-xl pointer-events-none" />
                            )}
                            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Gross Assets</p>
                            <p className="text-xs font-mono font-bold text-white group-hover:text-emerald-400 transition-colors truncate">
                                {isPrivacyMode ? '••••••' : totalNetWorth}
                            </p>
                        </div>
                    ) : (
                        <div
                            onClick={() => setActiveCategory('settings')}
                            title={`Gross Assets: ${isPrivacyMode ? '••••••' : totalNetWorth}`}
                            className="flex justify-center cursor-pointer py-1"
                        >
                            <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-emerald-400 hover:bg-emerald-500/20 transition-all">
                                <ShieldCheck size={16} />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <>
            {/* Desktop Sidebar (Static / Collapsible Mini-Rail) */}
            <aside
                className={`hidden md:flex flex-col ${isCollapsed ? 'w-[68px]' : 'w-[220px]'} backdrop-blur-2xl border-r h-full z-40 transition-all duration-300 relative select-none`}
                style={{
                    backgroundColor: 'var(--sidebar-bg, rgba(15, 23, 42, 0.88))',
                    borderColor: 'var(--sidebar-border, rgba(255, 255, 255, 0.06))'
                }}
            >
                {renderSidebarContent('desktop')}
            </aside>

            {/* Mobile Sidebar (Drawer with Full Accordion View) */}
            <AnimatePresence>
                {isMobileMenuOpen && (
                    <div className="md:hidden fixed inset-0 z-50 pointer-events-auto">
                        {/* Backdrop */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.18, ease: 'easeOut' }}
                            className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm"
                            onClick={() => setIsMobileMenuOpen(false)}
                        />

                        {/* Drawer */}
                        <motion.aside
                            variants={slideFromLeft}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="absolute top-0 left-0 bottom-0 w-72 backdrop-blur-2xl border-r flex flex-col"
                            style={{
                                backgroundColor: 'var(--sidebar-bg, rgba(15, 23, 42, 0.96))',
                                borderColor: 'var(--sidebar-border, rgba(255, 255, 255, 0.1))'
                            }}
                        >
                            <div className="flex-1 overflow-y-auto">
                                {renderSidebarContent('mobile', true)}
                            </div>

                            {/* Mobile Drawer Footer Utilities */}
                            <div className="p-3 border-t border-white/[0.08] bg-slate-950/40 flex items-center justify-around shrink-0">
                                <button
                                    type="button"
                                    aria-label="Toggle privacy mode"
                                    onClick={onTogglePrivacy}
                                    className={`p-2.5 rounded-full transition-colors flex flex-col items-center gap-1 ${
                                        isPrivacyMode ? 'text-[#3b82f6] bg-[#3b82f6]/10' : 'text-slate-400 hover:text-white'
                                    }`}
                                >
                                    {isPrivacyMode ? <EyeOff size={18} /> : <Eye size={18} />}
                                    <span className="text-[9px] uppercase font-bold tracking-wider">Privacy</span>
                                </button>

                                <button
                                    type="button"
                                    aria-label="Toggle dark mode"
                                    onClick={() => useSettingsStore.getState().updateSetting('isDarkMode', !useSettingsStore.getState().isDarkMode)}
                                    className="p-2.5 rounded-full text-slate-400 hover:text-white transition-colors flex flex-col items-center gap-1"
                                >
                                    {useSettingsStore.getState().isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
                                    <span className="text-[9px] uppercase font-bold tracking-wider">Theme</span>
                                </button>
                            </div>
                        </motion.aside>
                    </div>
                )}
            </AnimatePresence>
        </>
    );
};

export default Sidebar;
