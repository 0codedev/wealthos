import React, { useState, useRef } from 'react';
import { motion, useScroll, useMotionValueEvent, AnimatePresence } from 'framer-motion';
import {
    Home, PieChart, Activity, Zap, Grid, Bell,
    Eye, EyeOff, Moon, Sun, LogOut, Lock, Search, Plus, X, Gauge
} from 'lucide-react';
import { useSettingsStore } from '../../store/settingsStore';
import { useLiteModeStore } from '../../store/liteModeStore';
import { usePrivacyMode } from '../../hooks/usePrivacyMode';
import { useAuth } from '../../contexts/AuthContext';
import { Tabs } from '../ui/AnimatedTabs';
import { ToggleGroup } from '../ui/toggle-group';
import { AccessibleButton } from '../shared/AccessibleComponents';
import { MobileMoreDrawer } from './MobileMoreDrawer';
import LiveTickerBar from '../layout/LiveTickerBar';
import { NotificationCenterDrawer } from '../notifications/NotificationCenterDrawer';
import { notificationPersistenceService } from '../../services/NotificationPersistenceService';
import { ASSET_CLASS_COLORS } from '../../types';
import { formatCurrency } from '../../utils/helpers';

interface MobileAppProps {
    activeCategory: string;
    activeSubTab: string;
    onNavigate: (category: string, subTab?: string) => void;
    subTabs?: { id: string; label: string; icon: any }[];
    children: React.ReactNode;
    onQuickAdd?: () => void;
    searchQuery?: string;
    setSearchQuery?: (q: string) => void;
    searchResults?: any[];
    onEditAsset?: (inv: any) => void;
}

export const MobileApp: React.FC<MobileAppProps> = ({
    activeCategory,
    activeSubTab,
    onNavigate,
    subTabs = [],
    children,
    onQuickAdd,
    searchQuery = '',
    setSearchQuery,
    searchResults = [],
    onEditAsset
}) => {
    const [showHeader, setShowHeader] = useState(true);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isNotifOpen, setIsNotifOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [unreadNotifCount, setUnreadNotifCount] = useState(0);
    const lastScrollY = useRef(0);
    const mainRef = useRef<HTMLElement>(null);
    const headerRef = useRef<HTMLElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const { isPrivacyMode, togglePrivacyMode } = usePrivacyMode();
    const isDarkMode = useSettingsStore(state => state.isDarkMode);
    const isAmoled = useSettingsStore(state => state.isAmoled);
    const updateSetting = useSettingsStore(state => state.updateSetting);
    const designPreset = useSettingsStore(state => state.designPreset) || 'wealthos-classic';
    const { isLiteMode, toggleLiteMode } = useLiteModeStore();
    const { logout, lock } = useAuth();
    const activeTheme = useSettingsStore(state => state.activeTheme);

    React.useEffect(() => {
        return notificationPersistenceService.subscribe((items) => {
            setUnreadNotifCount(items.filter(n => !n.read).length);
        });
    }, []);

    React.useEffect(() => {
        if (isSearchOpen && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [isSearchOpen]);

    // MEASURED HEADER OFFSET: pad <main> by the live header height instead of
    // magic numbers, and hide by exactly that height so tall headers fully exit.
    const [headerHeight, setHeaderHeight] = useState(110);

    React.useEffect(() => {
        const el = headerRef.current;
        if (!el) return;
        const measure = () => setHeaderHeight(Math.ceil(el.getBoundingClientRect().height));
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [subTabs.length]);

    const { scrollY } = useScroll({
        container: mainRef
    });

    useMotionValueEvent(scrollY, "change", (latest) => {
        const direction = latest > lastScrollY.current ? "down" : "up";
        if (latest > 50 && direction === "down" && showHeader) {
            setShowHeader(false);
        } else if (direction === "up" && !showHeader) {
            setShowHeader(true);
        }
        lastScrollY.current = latest;
    });

    // Primary Bottom Navigation Items
    const navItems = [
        { id: 'dashboard', icon: Home, label: 'Home' },
        { id: 'portfolio', icon: PieChart, label: 'Portfolio' },
        { id: 'market', icon: Activity, label: 'Markets' },
        { id: 'alpha', icon: Zap, label: 'Alpha' },
        { id: 'more', icon: Grid, label: 'More' }
    ];

    // Determine which primary tab is active based on current activeCategory
    const getActiveTab = () => {
        if (['dashboard', 'portfolio', 'market', 'alpha'].includes(activeCategory)) {
            return activeCategory;
        }
        return 'more';
    };

    const activeTab = getActiveTab();

    const categoryTitle = () => {
        const titles: Record<string, string> = {
            dashboard: 'Dashboard',
            portfolio: 'Portfolio Hub',
            market: 'Market Intel',
            alpha: 'Alpha Engine',
            ipo: 'IPO War Room',
            journal: 'Psych Dashboard',
            growth: 'Growth Engine',
            planning: 'Goal GPS',
            innovation: 'Moonshot Lab',
            fortress: 'The Fortress',
            backtester: 'Strategy Lab',
            pool: 'Momentum Pool',
            tools: 'Advanced Tools',
            settings: 'Settings',
            analytics: 'Analytics Center',
            signals: 'Signals Intel',
            telegram: 'Telegram Intel',
            launchpad: 'Launchpad'
        };
        return titles[activeCategory] || activeCategory.toUpperCase();
    };

    // Light haptic tick - native feel on OnePlus/OLED Android devices.
    // Silently no-ops on desktop/iOS Safari where Vibration API is absent.
    const haptic = (ms: number = 8) => {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try { navigator.vibrate(ms); } catch { /* unsupported */ }
        }
    };

    const handleTabClick = (itemId: string) => {
        haptic();
        if (itemId === 'more') {
            setIsDrawerOpen(true);
        } else {
            onNavigate(itemId);
        }
    };

    return (
        <div className="flex flex-col h-[100dvh] w-full bg-slate-950 text-slate-50 font-sans overflow-hidden">
            {/* Header section with auto-hide feature */}
            <motion.header
                ref={headerRef}
                initial={false}
                animate={{ y: showHeader ? 0 : -(headerHeight + 12) }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="fixed top-0 left-0 right-0 flex flex-col bg-slate-950/80 backdrop-blur-2xl border-b border-slate-900/60 z-40 shrink-0 shadow-lg"
            >
                {/* Safe area spacer for iOS top notch/island */}
                <div className="pt-safe w-full" />

                <div className="flex items-center justify-between px-4 py-3 h-[56px]">
                    <div className="flex items-center gap-3 min-w-0">
                        <AccessibleButton
                            variant="ghost"
                            onClick={() => { haptic(); setIsProfileOpen(true); }}
                            className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-xs shadow-inner shrink-0"
                            aria-label="Open profile menu"
                        >
                            U
                        </AccessibleButton>
                        <h1 className="text-sm font-bold tracking-wider text-white uppercase truncate max-w-[160px]">
                            {categoryTitle()}
                        </h1>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Search -> full-screen overlay (production pattern) */}
                        <button
                            onClick={() => setIsSearchOpen(true)}
                            className="p-2.5 text-slate-400 hover:text-white hover:bg-slate-900/50 rounded-xl transition-colors"
                            aria-label="Search assets"
                        >
                            <Search className="w-[18px] h-[18px]" />
                        </button>

                        {/* Privacy Blurring Toggle */}
                        <button
                            onClick={togglePrivacyMode}
                            className={`p-2.5 rounded-xl transition-all duration-200 ${
                                isPrivacyMode
                                    ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-900/50'
                            }`}
                            aria-label="Toggle Privacy Mode"
                        >
                            {isPrivacyMode ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
                        </button>

                        {/* Notifications -> real drawer with unread badge */}
                        <button
                            onClick={() => setIsNotifOpen(true)}
                            className="p-2.5 text-slate-400 hover:text-white hover:bg-slate-900/50 rounded-xl transition-colors relative"
                            aria-label={`Notifications${unreadNotifCount > 0 ? ` (${unreadNotifCount} unread)` : ''}`}
                        >
                            <Bell className="w-[18px] h-[18px]" />
                            {unreadNotifCount > 0 && (
                                <span className="absolute top-[2px] right-[2px] min-w-[15px] h-[15px] px-1 bg-rose-500 rounded-full text-[9px] font-black text-white flex items-center justify-center border border-slate-950">
                                    {unreadNotifCount > 99 ? '99+' : unreadNotifCount}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                {/* Sub-Tabs horizontal scrolling strip (Compact and Premium) */}
                {subTabs && subTabs.length > 0 && (
                    <div className="w-full px-3.5 pt-2 pb-2.5 relative z-10 border-t border-slate-800/60 bg-slate-950/40">
                        <Tabs.Root
                            value={activeSubTab}
                            onValueChange={(val) => onNavigate(activeCategory, val)}
                            layoutId={`mobile-sub-nav-${activeCategory}`}
                        >
                            <Tabs.List className="w-full overflow-x-auto no-scrollbar justify-start gap-1.5 flex-nowrap whitespace-nowrap min-h-[34px] items-center">
                                {subTabs.map(tab => {
                                    const TabIcon = tab.icon;
                                    const isActiveObj = activeSubTab === tab.id || (activeSubTab === activeCategory && tab.id === activeCategory);
                                    const effectiveValue = isActiveObj ? activeSubTab : tab.id;
                                    return (
                                        <Tabs.Trigger
                                            key={tab.id}
                                            value={effectiveValue}
                                            icon={TabIcon ? <TabIcon size={12} className="shrink-0" /> : undefined}
                                            className="px-3 py-1 text-[11px] font-semibold tracking-wide shrink-0 flex-none min-h-[30px] flex items-center justify-center"
                                        >
                                            {tab.label}
                                        </Tabs.Trigger>
                                    );
                                })}
                            </Tabs.List>
                        </Tabs.Root>
                    </div>
                )}

                {/* Live index ticker — slim swipeable strip, strictly shown on dashboard only */}
                {activeCategory === 'dashboard' && (
                    <div className="border-t border-slate-900/40 bg-slate-950/60">
                        <LiveTickerBar />
                    </div>
                )}
            </motion.header>

            {/* Main Content Area - padded by the LIVE measured header height */}
            <main
                ref={mainRef}
                className={`flex-1 overflow-y-auto overflow-x-hidden relative bg-slate-950 scrollbar-hide transition-all duration-300 ${
                    showHeader ? '' : 'pt-[max(24px,env(safe-area-inset-top))]'
                }`}
                style={showHeader ? { paddingTop: `${headerHeight}px` } : undefined}
            >
                {/* Embedded scroll area safe spacer at bottom.
                    px gutter is owned by each screen (.page-shell) - adding it
                    here too double-padded every hardened screen on phones.
                    Bottom spacer clears the 56px FAB (top edge ~132px + safe area). */}
                <div className="w-full pb-[150px]">
                    {children}
                </div>
            </main>

            {/* Bottom Glassmorphic Navigation */}
            <nav className="shrink-0 bg-slate-900/50 backdrop-blur-2xl border-t border-slate-800/50 pb-safe pt-1.5 px-3 shadow-2xl z-40 relative">
                <div className="flex justify-between items-center max-w-md mx-auto">
                    {navItems.map(item => {
                        const isActive = activeTab === item.id;
                        const Icon = item.icon;
                        return (
                            <AccessibleButton
                                key={item.id}
                                variant="ghost"
                                onClick={() => handleTabClick(item.id)}
                                className={`flex flex-col items-center justify-center py-1 w-16 relative transition-all duration-200 ${
                                    isActive
                                        ? 'text-indigo-400'
                                        : 'text-slate-500 hover:text-slate-300'
                                }`}
                                aria-label={`Navigate to ${item.label}`}
                                aria-pressed={isActive}
                            >
                                <div className={`relative z-10 transition-transform duration-300 ${
                                    isActive ? '-translate-y-1.5 scale-110' : ''
                                }`}>
                                    <Icon className="w-[18px] h-[18px]" />
                                </div>
                                <span className={`text-[9px] font-semibold tracking-wider mt-1 transition-all duration-200 ${
                                    isActive ? 'opacity-100 font-bold scale-105' : 'opacity-70'
                                }`}>
                                    {item.label}
                                </span>

                                {isActive && (
                                    <motion.div
                                        layoutId="mobile-active-glow"
                                        className="absolute bottom-0 w-5 h-[3px] bg-gradient-to-r from-indigo-500 to-indigo-400 rounded-full shadow-[0_0_12px_1px_rgba(99,102,241,0.6)]"
                                    />
                                )}
                            </AccessibleButton>
                        );
                    })}
                </div>
            </nav>

            {/* Slide-up "More" Drawer for remaining modules */}
            <MobileMoreDrawer
                isOpen={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                activeCategory={activeCategory}
                onNavigate={(cat) => onNavigate(cat)}
            />

            {/* Full-screen Search Overlay */}
            <AnimatePresence>
                {isSearchOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="fixed inset-0 z-[170] bg-slate-950 flex flex-col"
                    >
                        <div className="pt-safe shrink-0" />
                        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800/60 shrink-0">
                            <div className="flex-1 flex items-center gap-2 bg-slate-900/80 border border-slate-800 rounded-xl px-3 h-11">
                                <Search size={16} className="text-slate-500 shrink-0" />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery?.(e.target.value)}
                                    placeholder="Search assets..."
                                    className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-slate-500 min-w-0"
                                />
                                {searchQuery && (
                                    <button onClick={() => setSearchQuery?.('')} className="text-slate-500 p-1" aria-label="Clear search">
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                            <button
                                onClick={() => { setIsSearchOpen(false); setSearchQuery?.(''); }}
                                className="px-3 h-11 text-sm font-semibold text-indigo-400 shrink-0"
                            >
                                Cancel
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto px-4 py-2 pb-safe">
                            {!searchQuery && (
                                <p className="text-center text-slate-500 text-sm mt-16">Start typing to search your assets</p>
                            )}
                            {searchQuery && searchResults.length === 0 && (
                                <p className="text-center text-slate-500 text-sm mt-16">No assets match "{searchQuery}"</p>
                            )}
                            {searchResults.map(inv => (
                                <button
                                    key={inv.id}
                                    onClick={() => {
                                        setIsSearchOpen(false);
                                        setSearchQuery?.('');
                                        onEditAsset?.(inv);
                                    }}
                                    className="w-full text-left px-3 py-3 rounded-xl hover:bg-slate-900 flex items-center justify-between gap-3 border-b border-slate-900/60 last:border-0"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div
                                            className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                                            style={{ backgroundColor: ASSET_CLASS_COLORS[inv.type as keyof typeof ASSET_CLASS_COLORS] || '#6366f1' }}
                                        >
                                            {String(inv.name || '').substring(0, 2).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-white line-clamp-1">{inv.name}</p>
                                            <p className="text-xs text-slate-500">{inv.ticker || inv.type}</p>
                                        </div>
                                    </div>
                                    <p className="text-sm font-mono font-bold text-slate-300 shrink-0">{formatCurrency(inv.currentValue || 0)}</p>
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Profile Sheet */}
            <AnimatePresence>
                {isProfileOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsProfileOpen(false)}
                            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[150]"
                        />
                        <motion.div
                            role="dialog"
                            aria-label="Profile menu"
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
                            className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-2xl border-t border-slate-800/80 rounded-t-[28px] p-6 z-[160] pb-safe shadow-2xl"
                        >
                            <div className="w-12 h-1.5 bg-slate-700/60 rounded-full mx-auto mb-5" />
                            <h3 className="text-base font-bold text-white mb-5">Account</h3>
                            <div className="space-y-1">
                                <button
                                    onClick={() => updateSetting('isDarkMode', !isDarkMode)}
                                    className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-slate-800/60 text-left"
                                >
                                    {isDarkMode ? <Sun size={18} className="text-amber-400" /> : <Moon size={18} className="text-indigo-400" />}
                                    <span className="text-sm font-semibold text-slate-200 flex-1">{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
                                    <span className={`p-0.5 rounded-full transition-colors flex items-center ${isDarkMode ? 'bg-indigo-600 justify-end' : 'bg-slate-700 justify-start'}`} style={{ width: 40, height: 22 }}>
                                        <span className="w-4 h-4 rounded-full bg-white shadow" />
                                    </span>
                                </button>

                                {isDarkMode && (
                                    <button
                                        onClick={() => updateSetting('isAmoled', !isAmoled)}
                                        className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-slate-800/60 text-left"
                                    >
                                        <Zap size={18} className={isAmoled ? 'text-emerald-400' : 'text-slate-400'} />
                                        <span className="text-sm font-semibold text-slate-200 flex-1">
                                            AMOLED True Black
                                            <span className="block text-[10px] font-medium text-slate-500">Pure black canvas · saves battery</span>
                                        </span>
                                        <span className={`p-0.5 rounded-full transition-colors flex items-center ${isAmoled ? 'bg-emerald-600 justify-end' : 'bg-slate-700 justify-start'}`} style={{ width: 40, height: 22 }}>
                                            <span className="w-4 h-4 rounded-full bg-white shadow" />
                                        </span>
                                    </button>
                                )}

                                <button
                                    onClick={() => toggleLiteMode()}
                                    className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-slate-800/60 text-left"
                                >
                                    <Gauge size={18} className={isLiteMode ? 'text-emerald-400' : 'text-slate-400'} />
                                    <span className="text-sm font-semibold text-slate-200 flex-1">Performance Lite Mode</span>
                                    <span className={`p-0.5 rounded-full transition-colors flex items-center ${isLiteMode ? 'bg-emerald-600 justify-end' : 'bg-slate-700 justify-start'}`} style={{ width: 40, height: 22 }}>
                                        <span className="w-4 h-4 rounded-full bg-white shadow" />
                                    </span>
                                </button>

                                <button
                                    onClick={() => togglePrivacyMode()}
                                    className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-slate-800/60 text-left"
                                >
                                    {isPrivacyMode ? <EyeOff size={18} className="text-indigo-400" /> : <Eye size={18} className="text-slate-400" />}
                                    <span className="text-sm font-semibold text-slate-200 flex-1">Privacy Blur</span>
                                    <span className={`p-0.5 rounded-full transition-colors flex items-center ${isPrivacyMode ? 'bg-indigo-600 justify-end' : 'bg-slate-700 justify-start'}`} style={{ width: 40, height: 22 }}>
                                        <span className="w-4 h-4 rounded-full bg-white shadow" />
                                    </span>
                                </button>

                                {/* Design Preset Segmented Control */}
                                <div className="pt-2 pb-3 px-3 border-t border-slate-800/60 mt-1">
                                    <span className="text-xs font-semibold text-slate-400 block mb-2">Design Preset</span>
                                    <ToggleGroup
                                        fullWidth
                                        size="sm"
                                        value={designPreset}
                                        onChange={(newVal) => updateSetting('designPreset', newVal as any)}
                                        options={[
                                            { value: 'wealthos-classic', label: 'Classic' },
                                            { value: 'astryx', label: 'Astryx' },
                                            { value: 'reui-nova', label: 'ReUI' },
                                            { value: 'shadcn', label: 'Shadcn' }
                                        ]}
                                        layoutId="mobile-profile-preset-toggle"
                                        ariaLabel="Design Preset"
                                    />
                                </div>

                                <button
                                    onClick={() => { lock(); setIsProfileOpen(false); }}
                                    className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-slate-800/60 text-left"
                                >
                                    <Lock size={18} className="text-slate-400" />
                                    <span className="text-sm font-semibold text-slate-200">Lock App</span>
                                </button>

                                <button
                                    onClick={() => logout()}
                                    className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-rose-500/10 text-left mt-2 border-t border-slate-800/60"
                                >
                                    <LogOut size={18} className="text-rose-400" />
                                    <span className="text-sm font-semibold text-rose-400">Sign Out</span>
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Notification Center (same component as desktop) */}
            <NotificationCenterDrawer isOpen={isNotifOpen} onClose={() => setIsNotifOpen(false)} />
        </div>
    );
};
