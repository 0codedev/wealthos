import React, { ReactNode, useState, useEffect } from 'react';
import { Menu, Search, EyeOff, Eye, Moon, Sun, RefreshCw, HelpCircle, Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from '../layout/Sidebar';
import LiveTickerBar from './LiveTickerBar';
import ProfileMenu from '../layout/ProfileMenu';
import { VoiceCommandButton, AlertsDropdown } from '../shared/GodTierFeatures';
import { Tabs } from '../ui/AnimatedTabs';
import { useSettingsStore } from '../../store/settingsStore';
import { useToast } from '../shared/ToastProvider';
import { upstoxCacheService } from '../../services/UpstoxCacheService';
import { ASSET_CLASS_COLORS } from '../../types';
import { formatCurrency } from '../../utils/helpers';
import { pageVariants } from '../ui/animations';
import { instrumentService } from '../../services/InstrumentService';
import { useDhanStore } from '../../store/dhanStore';
import { useShallow } from 'zustand/react/shallow';
import { SniperOrderModal } from '../modals/SniperOrderModal';
import { dhanBackgroundSync } from '../../services/DhanBackgroundSyncService';
import { dhanBrokerService } from '../../services/DhanBrokerService';
import VoiceConsole from '../journal/VoiceConsole';
import { useVoiceStore } from '../../store/voiceStore';
import { GuardrailOverlay } from '../shared/GuardrailOverlay';
import { LiveEngineDock } from './LiveEngineDock';
import { SystemPulseWidget } from '../shared/SystemPulseWidget';
import { NetworkHeartbeatMeter } from '../shared/NetworkHeartbeatMeter';
import { AccessibleButton } from '../shared/AccessibleComponents';
import HelpDrawer from '../shared/HelpDrawer';
import { useOnboarding } from '../../hooks/useOnboarding';
import { notificationPersistenceService } from '../../services/NotificationPersistenceService';
import { useSandboxStore } from '../../store/sandboxStore';
import { db } from '../../database';
import { NotificationCenterDrawer } from '../notifications/NotificationCenterDrawer';
import { RefreshProgressOverlay } from '../ui/RefreshProgressOverlay';
import { resilientFetch } from '../../lib/circuitBreaker';
import { ExecutionClockBanner } from '../execution/ExecutionClockBanner';


interface MainLayoutProps {
    children: ReactNode;
    activeCategory: string;
    setActiveCategory: (cat: string) => void;
    activeSubTab: string;
    setActiveSubTab: (tab: string) => void;
    subTabs: any[];
    categoryLabel: string;
    isMobileMenuOpen: boolean;
    setIsMobileMenuOpen: (isOpen: boolean) => void;
    isSidebarCollapsed: boolean;
    setIsSidebarCollapsed: (isCollapsed: boolean) => void;
    isPrivacyMode: boolean;
    onTogglePrivacy: () => void;
    searchQuery: string;
    setSearchQuery: (q: string) => void;
    isSearchFocused: boolean;
    setIsSearchFocused: (focused: boolean) => void;
    searchResults: any[];
    onAddFirstAsset: () => void;
    onImportEcas?: () => void;
    onEditAsset: (inv: any) => void;
    totalNetWorth: number;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
    children,
    activeCategory,
    setActiveCategory,
    activeSubTab,
    setActiveSubTab,
    subTabs,
    categoryLabel,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    isPrivacyMode,
    onTogglePrivacy,
    searchQuery,
    setSearchQuery,
    isSearchFocused,
    setIsSearchFocused,
    searchResults,
    onEditAsset,
    totalNetWorth
}) => {
    const isDarkMode = useSettingsStore(state => state.isDarkMode);
    const isUpstoxEnabled = useSettingsStore(state => state.isUpstoxEnabled);
    const updateSetting = useSettingsStore(state => state.updateSetting);
    const designPreset = useSettingsStore(state => state.designPreset) || 'wealthos-classic';
    const { toast } = useToast();
    const [isSyncingInstruments, setIsSyncingInstruments] = useState(false);
    const [syncStatusText, setSyncStatusText] = useState('Syncing DhanHQ...');
    const searchInputRef = React.useRef<HTMLInputElement>(null);
    const isSearchExpanded = isSearchFocused || searchQuery.length > 0;

    const isSandboxMode = useSandboxStore(state => state.isSandboxMode);
    const toggleSandboxModeStore = useSandboxStore(state => state.toggleSandboxMode);
    const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);
    const [unreadNotifCount, setUnreadNotifCount] = useState(0);

    useEffect(() => {
        return notificationPersistenceService.subscribe((items) => {
            setUnreadNotifCount(items.filter(n => !n.read).length);
        });
    }, []);

    const toggleSandboxMode = () => {
        toggleSandboxModeStore();
        const nextState = !isSandboxMode;
        toast.success(nextState ? 'Sandbox Analytics Active' : 'Live Portfolio Analytics Active');
    };

    useEffect(() => {
        if (isSearchFocused && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [isSearchFocused]);

    // Upstox Integration Health State
    const [upstoxHealth, setUpstoxHealth] = useState<{
        status: 'green' | 'yellow' | 'red' | 'disabled';
        token_active: boolean;
        interactive_token_active?: boolean;
        analytics_token_active?: boolean;
        rate_limit?: {
            minute_usage: number;
            minute_limit: number;
        };
    } | null>(null);

    useEffect(() => {
        if (!isUpstoxEnabled) {
            setUpstoxHealth({ status: 'disabled', token_active: false, interactive_token_active: false, analytics_token_active: false });
            return;
        }

        const fetchHealth = async () => {
            try {
                const response = await resilientFetch('/api/python-nse/api/upstox/health-summary');
                if (response.ok) {
                    const data = await response.json();
                    setUpstoxHealth(data);
                }
            } catch {
                // Silently mark degraded without flooding DevTools console
                setUpstoxHealth({ status: 'red', token_active: false, interactive_token_active: false, analytics_token_active: false });
            }
        };

        fetchHealth();
        let upstoxTimer: ReturnType<typeof setInterval> | null = null;
        const startUpstoxTimer = () => {
            if (upstoxTimer) clearInterval(upstoxTimer);
            upstoxTimer = setInterval(fetchHealth, 300000);
        };
        if (typeof document !== 'undefined' && !document.hidden) {
            startUpstoxTimer();
        }
        const onUpstoxVisibility = () => {
            if (typeof document !== 'undefined' && !document.hidden) {
                void fetchHealth();
                startUpstoxTimer();
            } else if (upstoxTimer) {
                clearInterval(upstoxTimer);
                upstoxTimer = null;
            }
        };
        document.addEventListener('visibilitychange', onUpstoxVisibility);
        return () => {
            document.removeEventListener('visibilitychange', onUpstoxVisibility);
            if (upstoxTimer) clearInterval(upstoxTimer);
        };
    }, [isUpstoxEnabled]);

    // OpenAlgo Connection Status
    const [openalgoStatus, setOpenalgoStatus] = useState<{
        status: 'online' | 'offline';
        broker: string;
        message?: string;
    } | null>(null);

    useEffect(() => {
        let isBackoff = false;
        let interval: ReturnType<typeof setInterval> | null = null;

        const fetchOpenalgoStatus = async () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            try {
                const response = await resilientFetch('/api/python-nse/api/openalgo/status');
                if (response.ok) {
                    const data = await response.json();
                    setOpenalgoStatus(data);
                    if (isBackoff) {
                        isBackoff = false;
                        startOpenalgoTimer(60000);
                    }
                } else {
                    setOpenalgoStatus({ status: 'offline', broker: 'none' });
                    if (!isBackoff) {
                        isBackoff = true;
                        startOpenalgoTimer(300000); // 5m backoff on offline
                    }
                }
            } catch {
                setOpenalgoStatus({ status: 'offline', broker: 'none' });
                if (!isBackoff) {
                    isBackoff = true;
                    startOpenalgoTimer(300000); // 5m backoff on error
                }
            }
        };

        const startOpenalgoTimer = (delayMs: number = 60000) => {
            if (interval) clearInterval(interval);
            interval = setInterval(fetchOpenalgoStatus, delayMs);
        };

        fetchOpenalgoStatus();
        if (typeof document !== 'undefined' && !document.hidden) {
            startOpenalgoTimer(60000);
        }
        const onOpenalgoVisibility = () => {
            if (typeof document !== 'undefined' && !document.hidden) {
                void fetchOpenalgoStatus();
                startOpenalgoTimer(isBackoff ? 300000 : 60000);
            } else if (interval) {
                clearInterval(interval);
                interval = null;
            }
        };
        document.addEventListener('visibilitychange', onOpenalgoVisibility);
        return () => {
            document.removeEventListener('visibilitychange', onOpenalgoVisibility);
            if (interval) clearInterval(interval);
        };
    }, []);

    // DhanHQ Global State
    const { fundLimit, positions } = useDhanStore(
        useShallow(state => ({
            fundLimit: state.fundLimit,
            positions: state.positions
        }))
    );
    const [isGlobalSniperOpen, setIsGlobalSniperOpen] = useState(false);
    const { logs, addLog } = useVoiceStore();
    const [voiceInsight, setVoiceInsight] = useState<any>(null);
    const [voiceState, setVoiceState] = useState({ isRecording: false, isProcessing: false, volume: 0 });

    // CC50: Help drawer state - opens from the "?" icon in the header.
    const [isHelpOpen, setIsHelpOpen] = useState(false);
    const { restartOnboarding } = useOnboarding();

    // CC50: "?" key opens the help drawer; "Escape" closes it.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const tag = target?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
            if (e.key === '?') {
                e.preventDefault();
                setIsHelpOpen((v) => !v);
            } else if (e.key === 'Escape' && isHelpOpen) {
                setIsHelpOpen(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isHelpOpen]);

    const handleVoiceInsight = (insight: any) => {
        setVoiceInsight(insight);
        // Save to memory if it's a valid transcript
        if (insight && insight.transcript && !insight.transcript.includes("Unable to hear")) {
            addLog(insight);
        }
    };


    useEffect(() => {
        const unsubscribe = instrumentService.subscribe((isSyncing, statusText) => {
            setIsSyncingInstruments(isSyncing);
            if (statusText) setSyncStatusText(statusText);
        });

        // Auto-initialize background DB sync
        instrumentService.initialize().catch(console.error);

        const handleKeyDown = (e: KeyboardEvent) => {
            // Shift + S for Global Sniper
            if (e.shiftKey && e.key.toLowerCase() === 's') {
                e.preventDefault();
                setIsGlobalSniperOpen(true);
            }
        };
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            unsubscribe();
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    // Floating PnL Document Title
    useEffect(() => {
        if (positions && positions.length > 0) {
            const totalM2M = positions.reduce((sum, p) => sum + (p.realizedProfit + p.unrealizedProfit), 0);
            if (totalM2M === 0) {
                document.title = 'Wealth Aggregator';
            } else {
                const prefix = totalM2M > 0 ? '🟢 +' : '🔴 ';
                document.title = `${prefix}₹${Math.abs(totalM2M).toLocaleString('en-IN', { maximumFractionDigits: 0 })} | Wealth App`;
            }
        } else {
            document.title = 'Wealth Aggregator MAX';
        }
    }, [positions]);

    return (
        <div 
            className="flex h-screen text-slate-900 dark:text-slate-100 font-sans overflow-hidden selections:bg-indigo-500/30 relative transition-colors duration-200"
            style={{ 
                backgroundColor: 'var(--canvas-bg, var(--bg-base, #0F172A))',
                fontFamily: 'var(--font-body, Outfit, sans-serif)'
            }}
        >
            <Sidebar
                activeCategory={activeCategory}
                setActiveCategory={setActiveCategory}
                isMobileMenuOpen={isMobileMenuOpen}
                setIsMobileMenuOpen={setIsMobileMenuOpen}
                onOpenSettings={() => { setActiveCategory('settings'); }}
                totalNetWorth={formatCurrency(totalNetWorth)}
                isPrivacyMode={isPrivacyMode}
                onTogglePrivacy={onTogglePrivacy}
                isCollapsed={isSidebarCollapsed}
                onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            />

            <main className="flex-1 min-w-0 flex flex-col h-full overflow-hidden relative transition-all duration-300">
                <div onClick={() => setIsSearchFocused(false)} className={`flex-1 ${activeCategory === 'telegram' ? 'overflow-hidden' : 'overflow-y-auto'} overflow-x-hidden scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-transparent flex flex-col relative z-10`}>

                    {/* Top Live Ticker Bar & Execution Clock Banner - strictly visible on Dashboard tab only */}
                    {activeCategory === 'dashboard' && (
                        <div className="shrink-0 flex flex-col">
                            <LiveTickerBar />
                            <div className="hidden md:block">
                                <ExecutionClockBanner />
                            </div>
                        </div>
                    )}

                    {/* Header */}
                    <header 
                        className="mobile-sticky-header h-16 border-b backdrop-blur-2xl flex items-center justify-between px-4 md:px-6 shrink-0 z-header transition-colors duration-200"
                        style={{
                            backgroundColor: 'var(--header-bg, rgba(15, 23, 42, 0.6))',
                            borderColor: 'var(--header-border, rgba(255, 255, 255, 0.08))'
                        }}
                    >
                        <div className="flex-1 flex min-w-0 items-center gap-4 mr-4">
                            <AccessibleButton
                                type="button"
                                variant="ghost"
                                aria-label="Toggle navigation menu"
                                className="md:hidden p-2 -ml-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
                                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                            >
                                <Menu size={24} />
                            </AccessibleButton>
                            <div className="flex-1 flex min-w-0 items-center overflow-x-auto no-scrollbar py-1">
                                {subTabs?.length > 0 ? (
                                    <Tabs.Root value={activeSubTab} onValueChange={setActiveSubTab} layoutId="app-global-nav">
                                        <Tabs.List>
                                            {subTabs.map(tab => (
                                                <Tabs.Trigger key={tab.id} value={tab.id} icon={<tab.icon size={14} />}>
                                                    {tab.label}
                                                </Tabs.Trigger>
                                            ))}
                                        </Tabs.List>
                                    </Tabs.Root>
                                ) : (
                                    <div className="inline-flex shrink-0 whitespace-nowrap min-h-[36px] items-center gap-2 px-3 py-1.5 bg-slate-800/60 dark:bg-wa-card rounded-xl border border-slate-700/60 dark:border-wa-border">
                                        <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse"></span>
                                        <span className="text-sm font-bold text-slate-200 dark:text-slate-200">
                                            {categoryLabel || 'Dashboard'}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-3">
                            <NetworkHeartbeatMeter className="hidden sm:inline-flex" />

                            {/* Search bar */}
                            <div
                                onClick={(e) => e.stopPropagation()}
                                className={`relative hidden md:flex items-center justify-end transition-all duration-300 ease-out z-fixed ${isSearchExpanded ? 'w-52 md:w-64' : 'w-9 h-9'}`}
                            >
                                <input
                                    ref={searchInputRef}
                                    id="global-search-input"
                                    type="text"
                                    aria-label="Search assets or features"
                                    placeholder="Search assets... (Ctrl+K)"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onFocus={() => setIsSearchFocused(true)}
                                    onBlur={() => {
                                        setTimeout(() => setIsSearchFocused(false), 200);
                                    }}
                                    className={`w-full bg-slate-100 dark:bg-[#0D0E14] border border-slate-200 dark:border-white/[0.08] focus:border-indigo-500/60 rounded-xl py-1.5 pl-9 pr-3 text-xs text-slate-900 dark:text-slate-200 outline-none transition-all duration-300 ${isSearchExpanded
                                        ? 'opacity-100 pointer-events-auto shadow-sm'
                                        : 'opacity-0 pointer-events-none'
                                        }`}
                                />
                                <AccessibleButton
                                    type="button"
                                    variant="ghost"
                                    aria-label="Open search"
                                    onClick={(e) => {
                                        if (!isSearchExpanded) {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setIsSearchFocused(true);
                                        }
                                    }}
                                    className={`absolute left-0 top-0 bottom-0 flex items-center justify-center rounded-xl transition-all duration-300 z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 ${isSearchExpanded
                                        ? 'w-9 pl-2.5 pointer-events-none text-slate-400'
                                        : 'w-9 h-9 bg-slate-100 dark:bg-[#0D0E14] border border-transparent dark:border-white/[0.08] hover:bg-slate-200 dark:hover:bg-[#131620] cursor-pointer text-slate-500 dark:text-slate-400 hover:text-indigo-400'
                                        }`}
                                >
                                    <Search size={15} />
                                </AccessibleButton>
                                {(isSearchFocused && searchResults.length > 0) && (
                                    <div className="absolute top-11 right-0 w-80 bg-white dark:bg-[#0D0E14] rounded-2xl shadow-2xl border border-slate-200 dark:border-white/[0.10] overflow-hidden max-h-96 overflow-y-auto animate-in fade-in slide-in-from-top-2 z-dropdown">
                                        {searchResults.map(inv => (
                                            <AccessibleButton
                                                type="button"
                                                variant="ghost"
                                                key={inv.id}
                                                onMouseDown={() => { onEditAsset(inv); setSearchQuery(''); }}
                                                className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/[0.04] flex items-center justify-between border-b border-slate-100 dark:border-white/[0.05] last:border-0 focus:outline-none focus-visible:bg-indigo-50 dark:focus-visible:bg-indigo-900/20"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm opacity-80`} style={{ backgroundColor: ASSET_CLASS_COLORS[inv.type as keyof typeof ASSET_CLASS_COLORS] || '#6366f1' }}>{inv.name.substring(0, 2).toUpperCase()}</div>
                                                    <div><p className="text-sm font-bold text-slate-800 dark:text-white line-clamp-1">{inv.name}</p><p className="text-xs text-slate-500">{inv.ticker || inv.type}</p></div>
                                                </div>
                                                <div className="text-right"><p className="text-sm font-mono font-bold text-slate-700 dark:text-slate-300">{formatCurrency(inv.currentValue || 0)}</p></div>
                                            </AccessibleButton>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Consolidated Live Engine Dock (Hidden per user request, kept for future activation) */}
                            {/* 
                            <div className="hidden md:flex items-center self-center">
                                <LiveEngineDock
                                    upstoxHealth={upstoxHealth}
                                    openalgoStatus={openalgoStatus}
                                    fundLimit={fundLimit}
                                    isSyncingInstruments={isSyncingInstruments}
                                    syncStatusText={syncStatusText}
                                    onOpenSettings={() => setActiveCategory('settings')}
                                />
                            </div>
                            */}

                            {/* Dashboard-Specific Direct Telemetry Badges */}
                            {activeCategory === 'dashboard' && (
                                <div className="hidden lg:flex items-center gap-2 self-center">
                                    <SystemPulseWidget />
                                    {isSyncingInstruments && (
                                        <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full text-xs font-medium border border-indigo-100 dark:border-indigo-800/50 shadow-sm transition-all shadow-indigo-500/10">
                                            <div className="flex items-center justify-center w-3 h-3">
                                                <span className="absolute w-2 h-2 rounded-full bg-indigo-500 animate-ping opacity-75"></span>
                                                <span className="relative w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                                            </div>
                                            {syncStatusText}
                                        </div>
                                    )}

                                    {upstoxHealth && (
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            aria-label={`Upstox Data Health: ${upstoxHealth.status}. Click to open settings.`}
                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border shadow-sm transition-all cursor-pointer select-none group relative focus:outline-none focus:ring-2 focus:ring-indigo-500/60 ${upstoxHealth.status === 'green'
                                                ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-400 font-bold'
                                                : upstoxHealth.status === 'yellow'
                                                    ? 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-400 font-bold'
                                                    : upstoxHealth.status === 'disabled'
                                                        ? 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-800 font-medium'
                                                        : 'bg-rose-500/10 text-rose-600 border-rose-500/20 dark:bg-rose-500/15 dark:text-rose-400 font-bold'
                                                }`}
                                            onClick={() => setActiveCategory('settings')}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    setActiveCategory('settings');
                                                }
                                            }}
                                            title="Upstox Data Health Status (Click to open settings)"
                                        >
                                            <div className="flex items-center justify-center w-2.5 h-2.5">
                                                {upstoxHealth.status === 'green' && (
                                                    <span className="absolute w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping opacity-75"></span>
                                                )}
                                                <span className={`relative w-1.5 h-1.5 rounded-full ${upstoxHealth.status === 'green' ? 'bg-emerald-500' :
                                                    upstoxHealth.status === 'yellow' ? 'bg-amber-500 animate-pulse' :
                                                        upstoxHealth.status === 'disabled' ? 'bg-slate-400 dark:bg-slate-600' : 'bg-rose-500'
                                                    }`}></span>
                                            </div>
                                            <span>
                                                {upstoxHealth.status === 'green' ? 'Upstox Active' :
                                                    upstoxHealth.status === 'yellow' ? 'Backup Active' :
                                                        upstoxHealth.status === 'disabled' ? 'Feed Disabled (Cached)' : 'Upstox Offline'}
                                            </span>

                                            <AccessibleButton
                                                type="button"
                                                variant="ghost"
                                                aria-label="Refresh Upstox Data"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toast.success('Clearing cache & reloading Upstox...');
                                                    upstoxCacheService.clear();
                                                    setTimeout(() => {
                                                        window.location.reload();
                                                    }, 1000);
                                                }}
                                                className="ml-0.5 p-0.5 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 rounded-full transition-colors flex items-center justify-center"
                                                title="Clear cache and reload Upstox data"
                                            >
                                                <RefreshCw size={10} className="text-slate-500 dark:text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400" />
                                            </AccessibleButton>
                                        </div>
                                    )}

                                    {openalgoStatus && (
                                        <div
                                            onClick={() => {
                                                const hostname = window.location.hostname;
                                                const isTunnelAccess = hostname.includes('wealthos-sudhanshu.xyz');
                                                const targetUrl = (hostname === 'localhost' || hostname === '127.0.0.1')
                                                    ? 'http://127.0.0.1:5000/auth/mock-upstox-login'
                                                    : isTunnelAccess
                                                        ? (hostname.includes('local')
                                                            ? 'https://local-openalgo.wealthos-sudhanshu.xyz/auth/mock-upstox-login'
                                                            : 'https://openalgo.wealthos-sudhanshu.xyz/auth/mock-upstox-login')
                                                        : 'http://127.0.0.1:5000/auth/mock-upstox-login';
                                                window.open(targetUrl, '_blank');
                                            }}
                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border shadow-sm transition-all select-none group relative cursor-pointer hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 ${
                                                openalgoStatus.status === 'online'
                                                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:hover:bg-emerald-500/25 font-bold'
                                                    : 'bg-rose-500/10 text-rose-600 border-rose-500/20 hover:bg-rose-500/20 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-500/25 font-bold'
                                            }`}
                                            title={`OpenAlgo Connection: ${openalgoStatus.status === 'online' ? 'Connected to ' + openalgoStatus.broker : 'Disconnected'} (Click to open OpenAlgo Dashboard)`}
                                        >
                                            <div className="flex items-center justify-center w-2.5 h-2.5">
                                                {openalgoStatus.status === 'online' && (
                                                    <span className="absolute w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping opacity-75"></span>
                                                )}
                                                <span className={`relative w-1.5 h-1.5 rounded-full ${
                                                    openalgoStatus.status === 'online' ? 'bg-emerald-500' : 'bg-rose-500'
                                                }`}></span>
                                            </div>
                                            <span>
                                                {openalgoStatus.status === 'online'
                                                    ? `OpenAlgo: ${openalgoStatus.broker.replace('_', ' ').toUpperCase()}`
                                                    : 'OpenAlgo Offline'}
                                            </span>
                                        </div>
                                    )}

                                    {dhanBrokerService.isConfigured() && (
                                        <div className={`inline-flex min-h-[38px] items-center gap-2 px-3 py-1.5 rounded-full border ${fundLimit ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700' : 'bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-900/50'}`}>
                                            <div className="flex flex-col items-end leading-none">
                                                <span className={`text-[9px] font-bold uppercase tracking-wider ${fundLimit ? 'text-slate-500 dark:text-slate-400' : 'text-rose-500'}`}>Runway</span>
                                                <span className={`text-xs font-mono font-bold financial-value ${fundLimit ? 'text-slate-800 dark:text-white' : 'text-rose-400'}`}>
                                                    {fundLimit ? `₹${fundLimit.availabelBalance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : 'Disconnected'}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Sandbox Mode Toggle (Visible in Journal) */}
                            {activeCategory === 'journal' && (
                                <button
                                    onClick={toggleSandboxMode}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border shadow-sm transition-all select-none hover:scale-105 active:scale-95 ${
                                        isSandboxMode
                                            ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-400 font-bold animate-pulse'
                                            : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-[#0D0E14] dark:text-slate-400 dark:border-white/[0.08] font-medium'
                                    }`}
                                    title={isSandboxMode ? "Sandbox Mode is Active. Click to switch to Production Mode." : "Sandbox Mode is Inactive. Click to switch to Sandbox Mode."}
                                >
                                    <span className={`relative w-1.5 h-1.5 rounded-full ${isSandboxMode ? 'bg-amber-500 animate-pulse' : 'bg-slate-400 dark:bg-slate-600'}`}></span>
                                    <span>{isSandboxMode ? 'Sandbox Active' : 'Sandbox Off'}</span>
                                </button>
                            )}


                            {/* Utility Actions */}
                            <div className="flex items-center gap-1.5 self-center">
                                <AccessibleButton
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setIsNotifDrawerOpen(true)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] border border-transparent hover:border-slate-200 dark:hover:border-white/[0.08] transition-all relative"
                                    aria-label="Open 7-Day Notification Center"
                                >
                                    <Bell size={17} />
                                    {unreadNotifCount > 0 && (
                                        <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-indigo-500 rounded-full animate-pulse ring-2 ring-white dark:ring-[#08090C]" />
                                    )}
                                </AccessibleButton>

                                <AccessibleButton
                                    type="button"
                                    variant="ghost"
                                    onClick={onTogglePrivacy}
                                    className={`inline-flex h-9 w-9 items-center justify-center rounded-xl transition-all border ${
                                        isPrivacyMode
                                            ? 'text-indigo-400 bg-indigo-500/15 border-indigo-500/30'
                                            : 'text-slate-400 hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] border-transparent hover:border-slate-200 dark:hover:border-white/[0.08]'
                                    }`}
                                    aria-label="Toggle privacy mode"
                                    aria-pressed={isPrivacyMode}
                                    title={isPrivacyMode ? "Privacy Mode Active (Values Masked) - Click to reveal" : "Hide Values (Privacy Mode)"}
                                >
                                    {isPrivacyMode ? <EyeOff size={18} className="stroke-[2.2]" /> : <Eye size={18} className="stroke-[2.2]" />}
                                </AccessibleButton>

                                {activeCategory === 'dashboard' && (
                                    <AccessibleButton
                                        type="button"
                                        variant="ghost"
                                        onClick={() => updateSetting('isDarkMode', !isDarkMode)}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] border border-transparent hover:border-slate-200 dark:hover:border-white/[0.08] transition-all"
                                        aria-label="Toggle dark mode"
                                        aria-pressed={isDarkMode}
                                    >
                                        {isDarkMode ? <Moon size={17} /> : <Sun size={17} />}
                                    </AccessibleButton>
                                )}

                                {activeCategory === 'dashboard' && (
                                    <VoiceCommandButton
                                        onNavigate={(path) => setActiveCategory(path)}
                                        onInsight={handleVoiceInsight}
                                        onStateChange={setVoiceState}
                                    />
                                )}

                                {activeCategory === 'dashboard' && (
                                    <>
                                        <AlertsDropdown investments={searchResults} />
                                        <ProfileMenu />
                                        <AccessibleButton
                                            type="button"
                                            variant="ghost"
                                            onClick={() => setIsHelpOpen(true)}
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] border border-transparent hover:border-slate-200 dark:hover:border-white/[0.08] transition-all"
                                            aria-label="Open help and resources"
                                            aria-expanded={isHelpOpen}
                                            aria-haspopup="dialog"
                                        >
                                            <HelpCircle size={17} />
                                        </AccessibleButton>
                                    </>
                                )}
                            </div>
                        </div>
                    </header>

                    <AnimatePresence mode="wait">
                        <motion.div
                            key={`${activeCategory}-${activeSubTab}`}
                            variants={pageVariants}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className={`p-3 sm:p-5 md:p-6 ${(activeCategory === 'telegram' || activeCategory === 'tradefinder' || activeCategory === 'advisor') ? 'max-w-none !p-0 h-[calc(100vh-4rem)] flex flex-col' : 'max-w-[1800px]'} mx-auto w-full`}
                        >
                            {children}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </main>

            {/* Global Modals */}
            <VoiceConsole
                isOpen={!!voiceInsight || voiceState.isRecording || voiceState.isProcessing}
                isRecording={voiceState.isRecording}
                isProcessing={voiceState.isProcessing}
                insight={voiceInsight}
                volume={voiceState.volume}
                onClose={() => setVoiceInsight(null)}
            />

            <GuardrailOverlay />

            <SniperOrderModal

                isOpen={isGlobalSniperOpen}
                onClose={() => setIsGlobalSniperOpen(false)}
                ticker=""
                currentPrice={0}
            />

            {/* CC50 - Help / About drawer opened from the "?" icon. */}
            <HelpDrawer
                isOpen={isHelpOpen}
                onClose={() => setIsHelpOpen(false)}
                onRestartTour={restartOnboarding}
            />

            <NotificationCenterDrawer
                isOpen={isNotifDrawerOpen}
                onClose={() => setIsNotifDrawerOpen(false)}
            />

            <RefreshProgressOverlay />
        </div>
    );
};
