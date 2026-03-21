import React, { useState, useEffect, useRef, lazy, Suspense, useMemo } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { pageVariants } from './components/ui/animations';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './components/auth/LoginPage';
const MobilePinLogin = lazy(() => import('./components/mobile/MobilePinLogin').then(m => ({ default: m.MobilePinLogin })));
import { FamilyProvider, useFamily } from './contexts/FamilyContext';
import { PageVisibilityProvider } from './contexts/PageVisibilityContext';
// DISABLED: Supabase auth (halted per user request)
// import { SupabaseAuthProvider, useSupabaseAuth } from './contexts/SupabaseAuthContext';
import { FirebaseAuthProvider, useFirebaseAuth } from './contexts/FirebaseAuthContext';
import ProfileMenu from './components/layout/ProfileMenu';
import { PerformanceOverlay } from './components/dev/PerformanceOverlay';
import { BridgeStatusBanner } from './components/system/BridgeStatusBanner';
import { bootCoordinator, BootLane } from './lib/bootCoordinator';
import { fetchCoordinator } from './lib/fetchCoordinator';
import {
    LayoutDashboard, Wallet, Globe, Bot,
    Menu, Search, Eye, EyeOff, Moon, Sun, Target, Heart, Layers, Shield, Brain, Calendar,
    Compass, ShieldCheck, Activity, Clipboard, Zap, BookOpen, Crown, AlertTriangle, Calculator, Beaker, CreditCard,
    X, Clock, BarChart2, CheckSquare, Radio, Wrench, TrendingUp, Cpu
} from 'lucide-react';


// Security
import { applySecurityHeaders } from './utils/security';

// Components
import { CommandPalette } from './components/ui/CommandPalette';
import { KeyboardHelpOverlay } from './components/ui/KeyboardHelpOverlay';
import { QuickLookModal } from './components/ui/QuickLookModal';
import { useQuickLookStore } from './hooks/useQuickLook';
import { PsychologicalCircuitBreaker } from './components/trading/PsychologicalCircuitBreaker';
import { BiometricAppLocker } from './components/security/BiometricAppLocker';
import Sidebar from './components/layout/Sidebar';

import { DashboardSkeleton } from './components/shared/Skeleton';
import OfflineIndicator from './components/shared/OfflineIndicator';
import PwaInstallPrompt from './components/shared/PwaInstallPrompt';
import ShareIngestToast from './components/shared/ShareIngestToast';
import { useShareIngest } from './hooks/useShareIngest';
import { useDailyDigest } from './hooks/useDailyDigest';

// Layout & Routing
import { MainLayout } from './components/layout/MainLayout';
import { AppRouter } from './routes/AppRouter';
import { useUrlRouting, getInitialRouteFromUrl } from './hooks/useUrlRouting';

// Modals & Floating UI
const AddInvestmentModal = lazy(() => import('./components/AddInvestmentModal'));
const EcasImportModal = lazy(() => import('./components/portfolio/EcasImportModal'));
const AICommandHub = lazy(() => import('./components/ai/AICommandHub').then(m => ({ default: m.AICommandHub })));
const FirstRunGate = lazy(() => import('./components/Onboarding/FirstRunGate').then(m => ({ default: m.FirstRunGate })));
const WelcomeWizardModal = lazy(() => import('./components/Onboarding/WelcomeWizardModal').then(m => ({ default: m.WelcomeWizardModal })));
const DemoModePill = lazy(() => import('./components/shared/DemoModePill').then(m => ({ default: m.DemoModePill })));
const StandaloneTradeFinder = lazy(() => import('./src/modules/trade-finder/TradeFinderModule'));

// Hooks & Store
import { usePortfolioStore } from './store/portfolioStore';
import { useHotkeys } from './hooks/useHotkeys';
import { useIsMobile } from './hooks/useIsMobile';
import { useMarketSentiment } from './hooks/useMarketSentiment';
import { usePulseBridgeSync } from './hooks/usePulseBridgeSync';
import { usePortfolioEntityView } from './hooks/usePortfolioEntityView';
import { nightlyRetrainScheduler } from './services/ml/NightlyRetrainScheduler';
import { runNightlyRetrain } from './services/ml/retrain';
import { useMLModelStore } from './store/mlModelStore';
import { ASSET_CLASS_COLORS, Investment } from './types';

// Helpers
import { formatCurrency, formatCurrencyPrecise, calculatePercentage } from './utils/helpers';

// God-Tier Features
import { VoiceCommandButton, AlertsDropdown } from './components/shared/GodTierFeatures';
import { useSettingsStore } from './store/settingsStore';
import { useLiteModeStore } from './store/liteModeStore';
const MobileApp = lazy(() => import('./components/mobile/MobileApp').then(m => ({ default: m.MobileApp })));
import { computePortfolioView, selectInvestmentsForEntity } from './lib/domain/portfolio';
import { useToast } from './components/shared/ToastProvider';
import { useNavigationIntentStore } from './store/navigationIntentStore';
import { useBootstrapMarketStream } from './hooks/useBootstrapMarketStream';
import { upstoxAuthService } from './services/UpstoxAuthService';
import { CrossTabCorrelator } from './services/CrossTabCorrelator';
import { ProactiveAlertEngine } from './services/ProactiveAlertEngine';
const FirebaseLoginPage = lazy(() => import('./components/auth/FirebaseLoginPage'));
import { downloadBackupFromCloud } from './services/BackupService';

// Jarvis 2.0 — Voice-First AI Command Center (additive, non-disruptive)
import { jarvis2Service } from './services/Jarvis2Service';
const JarvisCommandCenter = lazy(() => import('./components/jarvis2/JarvisCommandCenter'));
import JarvisProactiveAlertBubble from './components/jarvis2/JarvisProactiveAlertBubble';


const SUB_TABS: Record<string, { id: string, label: string, icon: any }[]> = {
    dashboard: [],
    portfolio: [
        { id: 'portfolio', label: 'Overview', icon: Wallet },
        { id: 'gps', label: 'Goal GPS', icon: Compass },
        { id: 'compliance', label: 'Compliance', icon: ShieldCheck },
        { id: 'retirement', label: 'Retirement & FIRE', icon: Target },
        { id: 'legacy', label: 'Legacy Vault', icon: Heart }
    ],
    market: [
        { id: 'macro', label: 'Macro Pulse', icon: Globe },
        { id: 'research', label: 'Stock Research', icon: Search },
        { id: 'intel', label: 'Option Chain Intel', icon: Zap },
        { id: 'crypto-markets', label: 'Crypto & Predictions', icon: Globe },
    ],
    ipo: [],
    growth: [
        { id: 'predator', label: 'Predator Engine', icon: Zap },
        { id: 'advisor', label: 'AI Advisor', icon: Bot },
        { id: 'academy', label: 'Academy', icon: BookOpen },
        { id: 'mastery', label: 'Mastery Hub', icon: Crown },
    ],
    journal: [
        { id: 'calendar', label: 'Calendar', icon: Calendar },
        { id: 'analytics', label: 'Analytics', icon: LayoutDashboard },
        { id: 'playbook', label: 'Playbook', icon: BookOpen },
        { id: 'mirror', label: 'Mirror', icon: Shield },
        { id: 'mistakes', label: 'Mistakes', icon: AlertTriangle },
        { id: 'reports', label: 'Reports', icon: BarChart2 },
    ],
    planning: [
        { id: 'gps', label: 'Goal GPS', icon: Compass },
        { id: 'retirement', label: 'Retirement & FIRE', icon: Target },
        { id: 'legacy', label: 'Legacy Vault', icon: Heart }
    ],
    innovation: [
        { id: 'boardroom', label: 'Strategic Council', icon: Brain }, // Boardroom + Impulse
        { id: 'risk', label: 'Risk & Regret', icon: ShieldCheck }, // BlackSwan + OpportunityCost
        { id: 'liability', label: 'Sunk Cost Vault', icon: CreditCard }, // LiabilityVault
        { id: 'dynasty', label: 'Future Dynasty', icon: Crown }, // Dynasty
    ],
    analytics: [
        { id: 'mathlab', label: 'Math Lab', icon: Calculator },
        { id: 'quant', label: 'Deep Quant', icon: Layers },
        { id: 'oracle', label: 'Predictive Oracle', icon: Brain },
    ],
    fortress: [
        { id: 'fortress-center', label: 'Command Center', icon: Shield },
    ],
    alpha: [
        { id: 'intraday', label: 'Intraday Booster', icon: Zap },
        { id: 'screener', label: 'Shadow Screener', icon: Search },
        { id: 'heatmap', label: 'Market Heatmap', icon: Activity },
        { id: 'market-command', label: 'Market Command Center', icon: LayoutDashboard },
        { id: 'greeks', label: 'Options Greeks', icon: Activity }
    ],
    backtester: [
        { id: 'backtester', label: 'Apex Engine', icon: Beaker },
        { id: 'simulators', label: 'Legacy Lab', icon: Activity },
        { id: 'paper', label: 'Algo Desk', icon: Bot },
    ],



    charts: [],
    launchpad: [],
    tradefinder: [],
    signals: [],
    telegram: [],
    pool: [
        { id: 'watchlist', label: 'Watchlist', icon: Eye },
        { id: 'verdicts', label: 'Verdicts', icon: Zap },
        { id: 'sources', label: 'Sources', icon: Radio }
    ],
    settings: [],
    tools: [
        { id: 'sector-analytics', label: 'Sector Rotation', icon: Activity },
        { id: 'sectors-flow', label: 'Sectoral Flow', icon: Layers },
        { id: 'globalmarket', label: 'Global Markets', icon: Globe },
        { id: 'calculator', label: 'Position Sizer', icon: Calculator },
        { id: 'returns-calc', label: 'Returns Calc', icon: TrendingUp }
    ]
};

const CATEGORY_LABELS: Record<string, string> = {
    dashboard: 'Dashboard',
    portfolio: 'Portfolio Hub',
    tradefinder: 'TradeFinder',
    market: 'Market Intel',
    ipo: 'IPO War Room',
    journal: 'Psych Dashboard',
    growth: 'Growth Engine',
    innovation: 'Moonshot Lab',
    signals: 'Signal Intel',
    telegram: 'Telegram Intel',
    analytics: 'Analytics Center',
    fortress: 'The Fortress',
    alpha: 'Alpha Engine',
    backtester: 'Strategy Lab',
    launchpad: 'Launchpad',
    settings: 'Settings',
    pool: 'Momentum Pool',
    tools: 'Advanced Tools'
};

// FIX #2: Split into AppContent (auth gate) + AuthenticatedApp (all hooks)
const AppContent: React.FC = () => {
    const { user: firebaseUser } = useFirebaseAuth();
    const { isAuthenticated, isLocked } = useAuth();
    const isMobile = useIsMobile();

    // If user is authenticated with Firebase Google Auth, grant seamless access!
    // Only show local PIN screen if user is NOT authenticated with Firebase AND local PIN is locked.
    if (!firebaseUser && (!isAuthenticated || isLocked)) {
        if (isMobile) {
            return <MobilePinLogin />;
        }
        return <LoginPage />;
    }

    return <AuthenticatedApp />;
};

import GuardrailOverlay from './components/dashboard/GuardrailOverlay';

const exchangedCodes = new Set<string>();

import { useMasteryStore } from './store/masteryStore';
import { useKeyboardShortcuts, ShortcutDefinition } from './hooks/useKeyboardShortcuts';
import { usePrivacyMode } from './hooks/usePrivacyMode';
import { db } from './database';
import { withSoftDelete, pruneDeleted } from './utils/storeHelpers';
import { logger as bootLogger } from './utils/logger';
import { useOfflineStore } from './store/offlineStore';
import { showToast } from './components/shared/ToastProvider';
import { COPY } from './utils/appCopy';
import { OfflineBanner } from './components/shared/OfflineBanner';
import { installBridgeAuthFetch } from './services/bridgeAuthFetch';
import { syncEngine } from './services/SyncEngine';
import { recordSyncTombstone } from './services/syncTombstones';

const AuthenticatedApp: React.FC = () => {
    // --- Hooks, Stores & Toast ---
    const isMobile = useIsMobile();
    const isPortfolioLoading = usePortfolioStore(state => state.isLoading);
    const { isPrivacyMode, togglePrivacyMode } = usePrivacyMode();
    const isDarkMode = useSettingsStore(state => state.isDarkMode);
    const isHighContrast = useSettingsStore(state => state.isHighContrast);
    const isUpstoxEnabled = useSettingsStore(state => state.isUpstoxEnabled);
    const upstoxAccessToken = useSettingsStore(state => state.upstoxAccessToken);
    const updateSetting = useSettingsStore(state => state.updateSetting);
    const activeTheme = useSettingsStore(state => state.activeTheme);
    const designPreset = useSettingsStore(state => state.designPreset);
    const isLiteMode = useLiteModeStore(state => state.isLiteMode);
    const { activeEntity, setActiveEntity } = useFamily();
    const { toast } = useToast();

    // Bootstrap market ticks for Tier 1 & Tier 2 streaming
    useBootstrapMarketStream();

    // Bridge identity gate: attach Firebase ID token to every Python-bridge call
    useEffect(() => {
        installBridgeAuthFetch();
    }, []);

    // Listen for cloud state restores to refresh portfolio store
    useEffect(() => {
        const handleCloudRestore = (event: Event) => {
            const customEv = event as CustomEvent<{ count?: number }>;
            bootLogger.log('App', `Cloud restore received (${customEv.detail?.count || 0} items). Refreshing portfolio...`);
            usePortfolioStore.getState().refreshPortfolio().catch(() => {});
        };
        window.addEventListener('wealthos-cloud-restored', handleCloudRestore);
        return () => window.removeEventListener('wealthos-cloud-restored', handleCloudRestore);
    }, []);

    // P2 ML Weights: boot nightly retrain scheduler (21:30 IST)
    const mlFetchHistory = useMLModelStore(s => s.fetchHistory);
    useEffect(() => {
        nightlyRetrainScheduler.configure(async () => {
            const summary = await runNightlyRetrain();
            if (!summary.skipped) {
                toast.success(`ML weights retrained (v${summary.version}, ${summary.trainedRows} rows, ${summary.durationMs}ms)`);
            }
            await mlFetchHistory();
        });
        nightlyRetrainScheduler.start();
        void mlFetchHistory();
        return () => nightlyRetrainScheduler.stop();
    }, [mlFetchHistory, toast]);

    // SPRINT 2.E2 — Weekly Ghost-loop backfill + weight recalibration.
    // Cheap no-op when there are no unresolved scan candidates.
    useEffect(() => {
        const KEY = 'wealth_ghost_recal_last';
        const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
        const last = Number(localStorage.getItem(KEY) || '0');
        if (Date.now() - last < WEEK_MS) return;
        const timer = setTimeout(async () => {
            try {
                const { alphaEngineService } = await import('./services/AlphaEngineService');
                const res = await alphaEngineService.backfillGhostOutcomesAndRecalibrate();
                if (res.backfilled > 0 || res.weights) {
                    toast.success(`Ghost loop: ${res.backfilled} outcomes backfilled${res.weights ? ', weights recalibrated' : ''}`);
                }
                localStorage.setItem(KEY, String(Date.now()));
            } catch { /* silent - next week retries */ }
        }, 45_000); // settle after boot
        return () => clearTimeout(timer);
    }, [toast]);

    // Top-10 #2 — soft-delete lane. Patches the 3+1 tables that participate
    // in recoverable deletes + schedules the daily prune. Idempotent: the
    // patch helper short-circuits when the table is already patched.
    useEffect(() => {
        withSoftDelete(db.investments as any);
        // Patch both real trades table and sandbox trades table so active() helper works in both modes
        withSoftDelete(db.table('trades') as any);
        try {
            const sandboxTable = db.table('sandbox_trades');
            if (sandboxTable) {
                withSoftDelete(sandboxTable as any);
            }
        } catch (e) {
            // Ignore if schema hasn't upgraded yet
        }
        withSoftDelete(db.mistakes as any);
        withSoftDelete(db.realized_transactions as any);

        const pruneOnce = async () => {
            try {
                await Promise.all([
                    pruneDeleted(db.investments as any, 30),
                    pruneDeleted(db.trades as any, 30),
                    pruneDeleted(db.mistakes as any, 30),
                    pruneDeleted(db.realized_transactions as any, 30),
                ]);

                // Clean up any zero refund trades that were mistakenly logged into db.trades
                const zeroRefundTrades = await db.trades
                    .filter((t: any) => {
                        const tickerUpper = (t.ticker || '').toUpperCase();
                        const notesUpper = (t.notes || '').toUpperCase();
                        const isRefundTicker = tickerUpper.includes('REFUND');
                        const isRefundNote = notesUpper.includes('REFUND') || notesUpper.includes('CAPITAL REFUND');
                        const isRefundTag = Array.isArray(t.tags) && t.tags.some((tag: string) => (tag || '').toUpperCase().includes('REFUND'));
                        return isRefundTicker || isRefundNote || isRefundTag;
                    })
                    .toArray();
                if (zeroRefundTrades.length > 0) {
                    const ids = zeroRefundTrades.map((t: any) => t.id).filter((id): id is number => typeof id === 'number');
                    await db.trades.bulkDelete(ids);
                }

                // Tombstone and purge deleted partner Bhanudeep if lingering
                const zombieBhanu = await db.friends
                    .filter((f: any) => (f.name || '').toLowerCase() === 'bhanudeep' || f.id === 24)
                    .toArray();
                if (zombieBhanu.length > 0) {
                    for (const b of zombieBhanu) {
                        if (b.id !== undefined) {
                            recordSyncTombstone('friends', b.id);
                            await syncEngine.notifyDeleted('friends', b.id);
                            await db.friends.delete(b.id);
                        }
                    }
                }

                // Generic local trade deduplication (keep precision-timed market hours record)
                // Generic local trade deduplication (keep precision-timed market hours record)
                const allLocalTrades = await db.trades.toArray();
                const localGroups: Record<string, any[]> = {};
                for (const t of allLocalTrades) {
                    if (t.isDeleted) continue;
                    const cleanTicker = (t.ticker || '').trim().toUpperCase();
                    const key = `${t.date}_${cleanTicker}_${t.quantity}`;
                    if (!localGroups[key]) localGroups[key] = [];
                    localGroups[key].push(t);
                }
                const localDupeIds: number[] = [];
                const badBatchTimes = ['20:02', '18:51', '14:09', '14:08', '14:07', '14:06', '16:36', '16:35', '16:37'];
                for (const list of Object.values(localGroups)) {
                    if (list.length > 1) {
                        const sorted = list.sort((a, b) => {
                            const timeA = String(a.entryTime || '');
                            const timeB = String(b.entryTime || '');
                            const scoreA = (!badBatchTimes.includes(timeA) ? 20 : 0) + (a.notes?.includes('MIS') ? 10 : 0) + (Number(a.id) || 0) / 100000;
                            const scoreB = (!badBatchTimes.includes(timeB) ? 20 : 0) + (b.notes?.includes('MIS') ? 10 : 0) + (Number(b.id) || 0) / 100000;
                            return scoreB - scoreA;
                        });
                        for (let i = 1; i < sorted.length; i++) {
                            if (typeof sorted[i].id === 'number') localDupeIds.push(sorted[i].id);
                        }
                    }
                }
                if (localDupeIds.length > 0) {
                    await db.trades.bulkDelete(localDupeIds);
                }

                // Ensure active Dhoot Transmission IPO trade exists in local Dexie
                const existingDhoot = await db.trades
                    .filter((t: any) => (t.ticker || '').toUpperCase().includes('DHOOT') && !t.isDeleted)
                    .toArray();
                if (existingDhoot.length === 0) {
                    await db.trades.add({
                        ticker: 'Dhoot Transmission',
                        direction: 'Long',
                        quantity: 1,
                        entryPrice: 150,
                        exitPrice: 150,
                        date: '2026-08-18',
                        entryTime: '09:15',
                        moodEntry: 'Focused',
                        moodExit: 'Satisfied',
                        mistakes: [],
                        setup: 'Breakout',
                        pnl: 18360.68,
                        fees: 20.0,
                        assetClass: 'Equity',
                        brokerProfile: 'Delivery Equity',
                        productType: 'CNC',
                        notes: 'IPO Listing Day Realization: Dhoot Transmission',
                        isImported: true
                    });
                } else if (existingDhoot.length > 1) {
                    // Keep only the first one
                    const extraIds = existingDhoot.slice(1).map(t => t.id).filter((id): id is number => typeof id === 'number');
                    await db.trades.bulkDelete(extraIds);
                }
            } catch (err) {
                bootLogger.error(
                    'App',
                    `Soft-delete prune failed: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        };
        void pruneOnce();
        const interval = setInterval(pruneOnce, 24 * 60 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    // Top-10 #4 — offline detection. 30s background probe catches
    // captive-WiFi cases where navigator.onLine stays true. 3-failure
    // threshold to declare offline (~90s). Online transition fires
    // a one-shot "Back online" toast, debounced 2s.
    useEffect(() => {
        const onOnline = () => {
            useOfflineStore.getState().setOffline(false);
            const last = useOfflineStore.getState().lastTransitionAt;
            if (Date.now() - last < 2000) return;
            showToast(COPY.network.backOnline, 'success', { duration: 4000 });
        };
        const onOffline = () => {
            useOfflineStore.getState().setOffline(true);
        };
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);

        const probe = async () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                return; // Ignore background throttled tabs
            }
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 12000);
                const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
                const probeUrl = isLocal ? '/favicon.ico' : '/api/python-nse/api/ready';
                const res = await fetch(probeUrl, {
                    method: 'GET',
                    cache: 'no-store',
                    signal: controller.signal,
                });
                clearTimeout(timer);
                useOfflineStore.getState().recordProbe(res.ok);
            } catch {
                if (typeof navigator !== 'undefined' && !navigator.onLine) {
                    useOfflineStore.getState().recordProbe(false);
                }
            }
        };

        const onVisibilityChange = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
                void probe();
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        const probeInterval = setInterval(probe, 30_000);
        void probe();

        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            clearInterval(probeInterval);
        };
    }, []);

    // --- State ---
    const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
    const [isKeyboardHelpOpen, setIsKeyboardHelpOpen] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [isExchangingToken, setIsExchangingToken] = useState(false);
    const [showUpstoxBlocker, setShowUpstoxBlocker] = useState(false);
    const [showManualToken, setShowManualToken] = useState(false);
    const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);
    const initialRoute = useMemo(() => getInitialRouteFromUrl(), []);
    const [activeCategory, setActiveCategory] = useState<string>(initialRoute.category);
    const [activeSubTab, setActiveSubTab] = useState<string>(initialRoute.subTab);

    // Deep Linking URL Path Synchronizer (keeps address bar and browser history in sync)
    useUrlRouting(activeCategory, activeSubTab, setActiveCategory, setActiveSubTab);

    const [dashboardView, setDashboardView] = useState<'MAIN' | 'SPENDING' | 'MARKETS' | 'COMMUNITY'>('MAIN');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isEcasModalOpen, setIsEcasModalOpen] = useState(false);
    const [editingInvestment, setEditingInvestment] = useState<Investment | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchFocused, setIsSearchFocused] = useState(false);

    // --- Shortcuts ---
    const shortcuts: ShortcutDefinition[] = useMemo(() => [
        { key: 'k', ctrlKey: true, description: 'Open Command Palette', category: 'General', action: () => setIsCommandPaletteOpen(true) },
        { key: '1', ctrlKey: true, description: 'Go to Dashboard', category: 'Navigation', action: () => { setActiveCategory('dashboard'); setDashboardView('MAIN'); } },
        { key: '2', ctrlKey: true, description: 'Go to Portfolio Hub', category: 'Navigation', action: () => { setActiveCategory('portfolio'); setActiveSubTab('portfolio'); } },
        { key: '3', ctrlKey: true, description: 'Go to Alpha Engine', category: 'Navigation', action: () => setActiveCategory('alpha') },
        { key: '4', ctrlKey: true, description: 'Go to Strategy Lab', category: 'Navigation', action: () => { setActiveCategory('backtester'); setActiveSubTab('backtester'); } },
        { key: '5', ctrlKey: true, description: 'Go to Launchpad', category: 'Navigation', action: () => setActiveCategory('launchpad') },
        { key: '6', ctrlKey: true, description: 'Go to Market Intel', category: 'Navigation', action: () => { setActiveCategory('market'); setActiveSubTab('macro'); } },
        { key: '7', ctrlKey: true, description: 'Go to IPO War Room', category: 'Navigation', action: () => setActiveCategory('ipo') },
        { key: '8', ctrlKey: true, description: 'Go to Trading Journal', category: 'Navigation', action: () => { setActiveCategory('journal'); setActiveSubTab('calendar'); } },
        { key: '9', ctrlKey: true, description: 'Go to Signal Intelligence Hub', category: 'Navigation', action: () => { setActiveCategory('signals'); setActiveSubTab('signals'); } },
        { key: 't', ctrlKey: true, description: 'Go to Telegram Intelligence', category: 'Navigation', action: () => { setActiveCategory('telegram'); setActiveSubTab('telegram'); } },
        { key: '0', ctrlKey: true, description: 'Go to Growth Engine', category: 'Navigation', action: () => { setActiveCategory('growth'); setActiveSubTab('advisor'); } },
        { key: 'q', ctrlKey: true, description: 'Go to Quant Analysis (Bloomberg Terminal)', category: 'Navigation', action: () => { setActiveCategory('analytics'); setActiveSubTab('quant'); } },
        { key: 'o', ctrlKey: true, description: 'Go to Predictive Oracle', category: 'Navigation', action: () => { setActiveCategory('analytics'); setActiveSubTab('oracle'); } },
        { key: 'g', ctrlKey: true, description: 'Go to Mastery Hub', category: 'Navigation', action: () => { setActiveCategory('growth'); setActiveSubTab('mastery'); } },
        { key: 's', ctrlKey: true, description: 'Go to Settings', category: 'Navigation', action: () => setActiveCategory('settings') },
        { key: 'm', ctrlKey: true, description: 'Go to Momentum Pool', category: 'Navigation', action: () => { setActiveCategory('pool'); setActiveSubTab('watchlist'); } },
        
        // Extended Global Navigation
        { key: 'N', ctrlKey: true, shiftKey: true, description: 'Go to TradeFinder', category: 'Navigation', action: () => setActiveCategory('tradefinder') },
        { key: 'S', ctrlKey: true, shiftKey: true, description: 'Go to Spending Analytics', category: 'Navigation', action: () => { setActiveCategory('dashboard'); setDashboardView('SPENDING'); } },
        { key: 'P', ctrlKey: true, shiftKey: true, description: 'Go to Planning', category: 'Navigation', action: () => setActiveCategory('planning') },
        { key: 'I', ctrlKey: true, shiftKey: true, description: 'Go to Innovation Lab', category: 'Navigation', action: () => { setActiveCategory('innovation'); setActiveSubTab('boardroom'); } },
        { key: 'F', ctrlKey: true, shiftKey: true, description: 'Go to The Fortress', category: 'Navigation', action: () => { setActiveCategory('fortress'); setActiveSubTab('dashboard'); } },
        { key: 'T', ctrlKey: true, shiftKey: true, description: 'Go to Advanced Tools', category: 'Navigation', action: () => { setActiveCategory('tools'); setActiveSubTab('sector-analytics'); } },

        // Actions & Utilities
        { key: 'n', ctrlKey: true, description: 'Add New Trade', category: 'Actions', action: () => setIsAddModalOpen(true) },
        { key: 'b', ctrlKey: true, description: 'Toggle Privacy Mode', category: 'Actions', action: () => togglePrivacyMode() },
        { key: ' ', ctrlKey: true, description: 'Open Jarvis command center', category: 'AI', action: () => jarvis2Service.toggleOpen() },
        { key: 'f', ctrlKey: true, description: 'Focus Search Bar', category: 'General', allowInInputs: true, action: () => {
            const input = document.getElementById('global-search-input') || document.querySelector('input[type="text"]');
            if (input) (input as HTMLElement).focus();
        } },
        { key: 'D', ctrlKey: true, shiftKey: true, description: 'Toggle Dark Mode', category: 'General', action: () => {
            useSettingsStore.setState(s => ({ isDarkMode: !s.isDarkMode }));
        } },
        { key: '?', description: 'Toggle Shortcut Reference Guide', category: 'General', action: () => setIsKeyboardHelpOpen(prev => !prev) },

        // Sub-Tab Navigation (Alt+Right / Alt+Left / Alt+1..9)
        { key: 'ArrowRight', altKey: true, description: 'Next Sub-tab', category: 'Sub-Tabs', action: () => {
            const subTabs = SUB_TABS[activeCategory] || [];
            if (subTabs.length > 0) {
                const idx = subTabs.findIndex(st => st.id === activeSubTab);
                const nextIdx = idx < 0 ? 0 : (idx + 1) % subTabs.length;
                setActiveSubTab(subTabs[nextIdx].id);
            }
        } },
        { key: 'ArrowLeft', altKey: true, description: 'Previous Sub-tab', category: 'Sub-Tabs', action: () => {
            const subTabs = SUB_TABS[activeCategory] || [];
            if (subTabs.length > 0) {
                const idx = subTabs.findIndex(st => st.id === activeSubTab);
                const prevIdx = idx <= 0 ? subTabs.length - 1 : idx - 1;
                setActiveSubTab(subTabs[prevIdx].id);
            }
        } },
        ...['1','2','3','4','5','6','7','8','9'].map((digit, i) => ({
            key: digit,
            altKey: true,
            description: `Jump to Sub-tab ${digit}`,
            category: 'Sub-Tabs',
            action: () => {
                const subTabs = SUB_TABS[activeCategory] || [];
                if (subTabs[i]) {
                    setActiveSubTab(subTabs[i].id);
                }
            }
        }))
    ], [activeCategory, activeSubTab, togglePrivacyMode]);

    useKeyboardShortcuts(shortcuts);

    // Global Spacebar QuickLook Preview Listener
    useEffect(() => {
        const handleSpacebar = (e: KeyboardEvent) => {
            if (e.key === ' ' || e.code === 'Space') {
                const target = e.target as HTMLElement;
                const isInput = target.tagName === 'INPUT' || 
                                target.tagName === 'TEXTAREA' || 
                                target.tagName === 'SELECT' || 
                                target.isContentEditable;
                if (isInput) return;

                const { isOpen, closeQuickLook, openQuickLook } = useQuickLookStore.getState();
                if (isOpen) {
                    e.preventDefault();
                    closeQuickLook();
                } else {
                    // Check if focused element has quicklook metadata or fallback to sample index
                    const activeElement = document.activeElement as HTMLElement;
                    const stockSym = activeElement?.getAttribute('data-quicklook-symbol');
                    if (stockSym) {
                        e.preventDefault();
                        openQuickLook({
                            type: 'STOCK',
                            data: {
                                symbol: stockSym,
                                ltp: 24850.50,
                                pctChange: 0.85,
                                rFactor: 2.15,
                                sector: 'INDICES'
                            }
                        });
                    }
                }
            }
        };

        window.addEventListener('keydown', handleSpacebar);
        return () => window.removeEventListener('keydown', handleSpacebar);
    }, []);

    useEffect(() => {
        if (!isPortfolioLoading) {
            if (window.performance && window.performance.mark) {
                if (!window.performance.getEntriesByName('portfolio:cached-shown').length) {
                    window.performance.mark('portfolio:cached-shown');
                }
            }
        }
    }, [isPortfolioLoading]);

    useEffect(() => {
        if (window.performance && window.performance.mark) {
            if (!window.performance.getEntriesByName('active-tab:hydrated').length) {
                window.performance.mark('active-tab:hydrated');
            }
        }
    }, [activeSubTab]);

    // Custom Navigation Event Listener for interactive toasts
    useEffect(() => {
        const handleNavigate = (e: Event) => {
            const customEvent = e as CustomEvent<{ category: string; subTab?: string }>;
            if (customEvent.detail && customEvent.detail.category) {
                setActiveCategory(customEvent.detail.category);
                if (customEvent.detail.subTab) {
                    setActiveSubTab(customEvent.detail.subTab);
                } else {
                    setActiveSubTab(customEvent.detail.category);
                }
            }
        };
        window.addEventListener('navigate-to-tab', handleNavigate);

        const handleOpenAddInvestment = () => {
            setActiveCategory('portfolio');
            setActiveSubTab('portfolio');
            setEditingInvestment(null);
            setIsAddModalOpen(true);
        };
        window.addEventListener('app:open-add-investment', handleOpenAddInvestment);

        const handleAuthMessage = (e: MessageEvent) => {
            if (e.data?.type === 'UPSTOX_AUTH_SUCCESS') {
                setShowUpstoxBlocker(false);
                if (typeof window !== 'undefined') sessionStorage.setItem('upstox_blocker_dismissed', 'true');
                toast.success('Upstox Authentication Received from Popup Window!');
            }
        };
        window.addEventListener('message', handleAuthMessage);

        return () => {
            window.removeEventListener('navigate-to-tab', handleNavigate);
            window.removeEventListener('app:open-add-investment', handleOpenAddInvestment);
            window.removeEventListener('message', handleAuthMessage);
        };
    }, []);

    // A3 — Share Target API ingest hook (drives the share pipeline
    // when the page is reached via the OS share sheet, and surfaces
    // the result via the toast mounted below).
    const shareIngest = useShareIngest();

    // A4 — daily 9 AM Telegram digest. Result is consumed by the widget
    // itself; we just need to mount the hook once per session so the
    // visibility listener is registered.
    useDailyDigest();

    const SNOOZE_KEY = 'upstox_blocker_snoozed_until';
    const isSnoozeActive = () => {
        if (typeof window !== 'undefined' && sessionStorage.getItem('upstox_blocker_dismissed') === 'true') return true;
        const until = localStorage.getItem(SNOOZE_KEY);
        if (!until) return false;
        return Date.now() < Number(until);
    };
    const dismissBlocker = () => {
        if (typeof window !== 'undefined') sessionStorage.setItem('upstox_blocker_dismissed', 'true');
        setShowUpstoxBlocker(false);
    };
    const snoozeBlocker = (hours: number) => {
        localStorage.setItem(SNOOZE_KEY, String(Date.now() + hours * 60 * 60 * 1000));
        setShowUpstoxBlocker(false);
        setSnoozeMenuOpen(false);
    };

    // Upstox Blocker Modal Checker
    useEffect(() => {
        let isMounted = true;
        if (isUpstoxEnabled) {
            // Skip if user snoozed or dismissed this session
            if (isSnoozeActive()) {
                setShowUpstoxBlocker(false);
                return;
            }
            const isValid = upstoxAuthService.isTokenValid();
            if (!isValid) {
                setShowUpstoxBlocker(true);
            } else {
                setShowUpstoxBlocker(false);
                upstoxAuthService.checkHealth().then(res => {
                    if (isMounted && !res.success) {
                        // If token is locally valid but bridge health check has transient issue, log warning without trapping the user
                        console.warn('[Upstox] Health check warning:', res.message);
                    }
                }).catch(() => {});
            }
        } else {
            setShowUpstoxBlocker(false);
        }
        return () => {
            isMounted = false;
        };
    }, [isUpstoxEnabled, upstoxAccessToken]);

    // Dhan Pulse Bridge Sync (Auto-Handshake)
    usePulseBridgeSync();

    // --- Modals (state declared at top) ---

    // --- Data (FROM STORE) ---
    const initializePortfolio = usePortfolioStore(state => state.initialize);
    useEffect(() => {
        const unsubscribe = initializePortfolio();
        return () => unsubscribe();
    }, [initializePortfolio]);

    useEffect(() => {
        const correlator = CrossTabCorrelator.getInstance();
        const alertEngine = ProactiveAlertEngine.getInstance();
        correlator.startPolling();
        alertEngine.start();
        return () => {
            correlator.stopPolling();
            alertEngine.stop();
        };
    }, []);

    useEffect(() => {
        applySecurityHeaders();
    }, []);

    const navigationIntent = useNavigationIntentStore(state => state.intent);
    const clearNavigationIntent = useNavigationIntentStore(state => state.clearIntent);

    useEffect(() => {
        if (!navigationIntent) return;

        if (navigationIntent.target === 'portfolio') {
            setActiveCategory('portfolio');
            setActiveSubTab('portfolio');

            if (
                (navigationIntent.action === 'add-from-alpha' || navigationIntent.action === 'open-add-trade-modal') &&
                navigationIntent.payload
            ) {
                const { symbol, price, signal, mcsTotal } = navigationIntent.payload;
                const displayPrice = price ?? 0;
                setEditingInvestment({
                    id: 'prefill',
                    name: symbol,
                    type: 'EQUITY' as any,
                    platform: 'Zerodha',
                    investedAmount: displayPrice,
                    currentValue: displayPrice,
                    lastUpdated: new Date().toISOString(),
                    sector: '',
                    tags: ['Alpha Engine', signal || (mcsTotal ? `MCS: ${mcsTotal}` : '')].filter(Boolean),
                    isHiddenFromTotals: false,
                    owner: 'SELF',
                    recurring: {
                        isEnabled: false,
                        frequency: 'MONTHLY' as any,
                        amount: 0,
                        sipDay: 5,
                        startDate: new Date().toISOString().split('T')[0],
                        installmentsApplied: 0
                    }
                } as Investment);
                setIsAddModalOpen(true);
                clearNavigationIntent();
            }
        } else if (navigationIntent.target === 'alpha') {
            setActiveCategory('alpha');
            if (navigationIntent.action === 'screener_override') {
                setActiveSubTab('intraday');
            } else if (navigationIntent.action === 'open-mcs' && navigationIntent.payload?.symbol) {
                // Smart Watchlist "Score in Alpha" → land on the Intraday sub-tab where the MCS card lives.
                setActiveSubTab('intraday');
                window.sessionStorage.setItem('alpha_search_prefill', navigationIntent.payload.symbol);
            } else if (navigationIntent.action === 'search_stock' && navigationIntent.payload?.symbol) {
                setActiveSubTab('intraday');
                window.sessionStorage.setItem('alpha_search_prefill', navigationIntent.payload.symbol);
            }
            clearNavigationIntent();
        } else if (navigationIntent.target === 'backtester') {
            setActiveCategory('backtester');
            setActiveSubTab('backtester');
            if (navigationIntent.payload?.symbol) {
                sessionStorage.setItem('backtest_prefill_symbol', navigationIntent.payload.symbol);
            }
            clearNavigationIntent();
        }
    }, [navigationIntent, clearNavigationIntent]);

    const addInvestment = usePortfolioStore(s => s.addInvestment);
    const updateInvestment = usePortfolioStore(s => s.updateInvestment);

    const { investments, stats } = usePortfolioEntityView(activeEntity);

    const { vix, status: marketStatus } = useMarketSentiment();

    const searchResults = React.useMemo(() => {
        if (!searchQuery.trim()) return [];
        const q = searchQuery.toLowerCase();
        return (investments || []).filter(inv =>
            inv.name.toLowerCase().includes(q) ||
            inv.ticker?.toLowerCase().includes(q) ||
            inv.type.toLowerCase().includes(q)
        );
    }, [investments, searchQuery]);

    // --- Hotkeys ---
    useHotkeys('ctrl+k', (e) => {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
    });

    useHotkeys('ctrl+d', (e) => { e.preventDefault(); setActiveCategory('dashboard'); setDashboardView('MAIN'); });
    useHotkeys('ctrl+j', (e) => { e.preventDefault(); setActiveCategory('journal'); });
    useHotkeys('ctrl+p', (e) => { e.preventDefault(); setActiveCategory('portfolio'); });
    useHotkeys('ctrl+m', (e) => {
        e.preventDefault();
        setActiveCategory('pool');
        setActiveSubTab('watchlist');
    });

    useHotkeys('escape', () => {
        if (isAddModalOpen) setIsAddModalOpen(false);
        if (isSearchFocused) setIsSearchFocused(false);
    });

    // --- Jarvis 2.0 lifecycle (hotkey handled by useKeyboardShortcuts) ---

    useEffect(() => {
        // Configure Jarvis 2.0 with a stable getter over the current investments
        jarvis2Service.configure({}, () => investments);
        jarvis2Service.startProactiveLoop();
        return () => {
            jarvis2Service.stopProactiveLoop();
            jarvis2Service.close();
        };
    }, [investments]);

    // Bridge Jarvis 2.0 V1-action events back into the existing app state.
    useEffect(() => {
        const onAction = (e: Event) => {
            const action = (e as CustomEvent).detail;
            if (!action) return;
            if (action.type === 'NAVIGATE' && typeof action.payload === 'string') {
                setActiveCategory(action.payload);
            } else if (action.type === 'OPEN_MODAL' && action.payload === 'ADD_INVESTMENT') {
                setEditingInvestment(null);
                setIsAddModalOpen(true);
            }
        };
        const onPrefillTrade = (e: Event) => {
            const prefill = (e as CustomEvent).detail;
            if (!prefill) return;
            setEditingInvestment({
                ...({
                    id: 'prefill',
                    name: prefill.symbol,
                    ticker: prefill.symbol,
                    investedAmount: prefill.price * prefill.quantity,
                    currentValue: prefill.price * prefill.quantity,
                    quantity: prefill.quantity,
                    lastUpdated: new Date().toISOString(),
                } as Investment),
            });
            setIsAddModalOpen(true);
        };
        window.addEventListener('jarvis2:execute-action', onAction);
        window.addEventListener('jarvis2:prefill-trade', onPrefillTrade);
        return () => {
            window.removeEventListener('jarvis2:execute-action', onAction);
            window.removeEventListener('jarvis2:prefill-trade', onPrefillTrade);
        };
    }, [setActiveCategory, setEditingInvestment, setIsAddModalOpen]);

    // --- Category Sync ---
    useEffect(() => {
        const subTabs = SUB_TABS[activeCategory];
        if (!subTabs || subTabs.length === 0) {
            setActiveSubTab(activeCategory);
        } else {
            setActiveSubTab(subTabs[0].id);
        }
    }, [activeCategory]);

    useEffect(() => {
        const root = document.documentElement;
        if (isDarkMode) {
            root.classList.add('dark');
            root.setAttribute('data-theme', 'dark');
            root.style.colorScheme = 'dark';
        } else {
            root.classList.remove('dark');
            root.setAttribute('data-theme', 'light');
            root.style.colorScheme = 'light';
        }
    }, [isDarkMode]);

    const isAmoled = useSettingsStore(state => state.isAmoled);
    useEffect(() => {
        if (isAmoled) document.documentElement.classList.add('amoled');
        else document.documentElement.classList.remove('amoled');
    }, [isAmoled]);

    useEffect(() => {
        if (isHighContrast) document.documentElement.classList.add('high-contrast');
        else document.documentElement.classList.remove('high-contrast');
    }, [isHighContrast]);

    useEffect(() => {
        const root = document.documentElement;
        // Remove all existing theme classes dynamically
        const classesToRemove = Array.from(root.classList).filter(cls => cls.startsWith('theme-'));
        classesToRemove.forEach(cls => root.classList.remove(cls));
        // Add current active theme
        root.classList.add(`theme-${activeTheme || 'default'}`);
    }, [activeTheme]);

    useEffect(() => {
        const root = document.documentElement;
        const body = document.body;
        const preset = designPreset || 'wealthos-classic';
        root.setAttribute('data-design-preset', preset);
        if (body) {
            body.setAttribute('data-design-preset', preset);
            body.style.backgroundColor = 'var(--canvas-bg)';
        }
        if (preset === 'astryx') {
            root.setAttribute('data-astryx-theme', 'neutral');
            if (body) body.setAttribute('data-astryx-theme', 'neutral');
            root.style.setProperty('--card-radius', '12px');
            root.style.setProperty('--btn-radius', '10px');
            root.style.setProperty('--btn-primary-bg', '#ffffff');
            root.style.setProperty('--btn-primary-text', '#111111');
            root.style.setProperty('--font-heading', "'Figtree', sans-serif");
        } else if (preset === 'reui-nova' || preset === 'shadcn') {
            root.removeAttribute('data-astryx-theme');
            if (body) body.removeAttribute('data-astryx-theme');
            root.style.setProperty('--card-radius', '14px');
            root.style.setProperty('--btn-radius', '8px');
            root.style.removeProperty('--btn-primary-bg');
            root.style.removeProperty('--btn-primary-text');
            root.style.setProperty('--font-heading', "'Inter', sans-serif");
        } else {
            root.removeAttribute('data-astryx-theme');
            if (body) body.removeAttribute('data-astryx-theme');
            root.style.setProperty('--card-radius', '16px');
            root.style.setProperty('--btn-radius', '8px');
            root.style.removeProperty('--btn-primary-bg');
            root.style.removeProperty('--btn-primary-text');
            root.style.setProperty('--font-heading', "'Outfit', sans-serif");
        }
    }, [designPreset]);

    // --- Mobile Navigation Handler ---
    const handleMobileNavigate = (category: string, subTab?: string) => {
        if (category === 'settings') {
            setActiveCategory('settings');
            setActiveSubTab('settings');
            return;
        }
        if (category === 'planning') {
            setActiveCategory('planning');
            setActiveSubTab(subTab || 'gps');
            return;
        }
        if (category === 'fortress') {
            setActiveCategory('fortress');
            setActiveSubTab(subTab || 'fortress-center');
            return;
        }
        setActiveCategory(category);
        if (subTab) {
            setActiveSubTab(subTab);
        } else {
            const subTabs = SUB_TABS[category];
            if (subTabs && subTabs.length > 0) {
                setActiveSubTab(subTabs[0].id);
            } else {
                setActiveSubTab(category);
            }
        }
    };

    // Props for the Router
    const routerProps = {
        activeSubTab, isPrivacyMode, isDarkMode, vix, marketStatus,
        dashboardView, setDashboardView, setIsAddModalOpen,
        setEditingInvestment, setActiveCategory, setActiveSubTab
    };

    // --- Global Navigation Listeners ---
    useEffect(() => {
        const handlePsychNav = (e: Event) => {
            const view = (e as CustomEvent).detail;
            if (view === 'REVIEW') {
                setActiveCategory('journal');
                setActiveSubTab('review');
            } else if (view === 'ANALYTICS') {
                setActiveCategory('journal');
                setActiveSubTab('analytics');
            } else if (view === 'JOURNAL') {
                setActiveCategory('journal');
                setActiveSubTab('journal');
            } else if (view === 'PLAYBOOK') {
                setActiveCategory('journal');
                setActiveSubTab('playbook');
            } else if (view === 'MIRROR') {
                setActiveCategory('journal');
                setActiveSubTab('mirror');
            }
        };

        window.addEventListener('PSYCH_NAVIGATE', handlePsychNav);
        return () => window.removeEventListener('PSYCH_NAVIGATE', handlePsychNav);
    }, []);

    if (isExchangingToken) {
        return (
            <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-950 text-white">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-lg font-semibold tracking-wide text-indigo-400 animate-pulse">Authenticating with Upstox Pro Plus</p>
                    <p className="text-xs text-slate-500">Exchanging authorization code for secure access token...</p>
                </div>
            </div>
        );
    }

    const isStandaloneTerminal = typeof window !== 'undefined' && (
        window.location.hostname.startsWith('alpha.') ||
        window.location.hostname.startsWith('apex.') ||
        window.location.hostname.startsWith('tradefinder.') ||
        new URLSearchParams(window.location.search).get('standalone') === 'true'
    );

    if (isStandaloneTerminal) {
        return (
            <Suspense fallback={<DashboardSkeleton />}>
                <div className="w-screen h-screen overflow-hidden bg-[#080D18]">
                    <StandaloneTradeFinder />
                </div>
            </Suspense>
        );
    }

    if (isMobile) {
        return (
            <Suspense fallback={<DashboardSkeleton />}>
                <div className={isLiteMode ? 'lite-mode' : ''}>
                    <MobileApp
                        activeCategory={activeCategory}
                        activeSubTab={activeSubTab}
                        onNavigate={handleMobileNavigate}
                        subTabs={SUB_TABS[activeCategory] || []}
                        onQuickAdd={() => { setEditingInvestment(null); setIsAddModalOpen(true); }}
                        searchQuery={searchQuery}
                        setSearchQuery={setSearchQuery}
                        searchResults={searchResults}
                        onEditAsset={(inv) => { setEditingInvestment(inv); setIsAddModalOpen(true); }}
                    >
                        <AppRouter {...routerProps} />
                    </MobileApp>
                </div>
                {isAddModalOpen && (
                    <AddInvestmentModal isOpen={isAddModalOpen} onClose={() => { setIsAddModalOpen(false); setEditingInvestment(null); }} onSave={async (data: Partial<Investment>, id?: string) => { if (id && id !== 'prefill') { await updateInvestment(id, data); } else { await addInvestment(data as Investment); } setIsAddModalOpen(false); setEditingInvestment(null); }} editingInvestment={editingInvestment} />
                )}
                <CommandPalette
                    isOpen={isCommandPaletteOpen}
                    onClose={() => setIsCommandPaletteOpen(false)}
                    shortcuts={shortcuts}
                />
                <OfflineIndicator />

                {/* Mobile blocker warning if Upstox token is invalid */}
                <AnimatePresence>
                    {showUpstoxBlocker && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4"
                        >
                            <motion.div
                                initial={{ scale: 0.95, y: 20 }}
                                animate={{ scale: 1, y: 0 }}
                                exit={{ scale: 0.95, y: 20 }}
                                className="w-full max-w-sm rounded-[24px] border border-indigo-500/20 bg-slate-900/95 p-6 shadow-2xl text-white text-center"
                            >
                                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20">
                                    <AlertTriangle size={24} />
                                </div>
                                <h3 className="text-md font-bold tracking-wide">Upstox API Required</h3>
                                <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                                    A valid Upstox access token is required daily for market quotes and greeks.
                                </p>

                                <div className="mt-5 space-y-3">
                                    <button
                                        onClick={() => {
                                            const url = upstoxAuthService.buildAuthUrl();
                                            if (url) window.open(url, '_blank');
                                            else toast.error('API Key not set in settings.');
                                        }}
                                        className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-sky-500 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-500/20 active:scale-95 transition-transform"
                                    >
                                        Authorize Upstox Pro
                                    </button>

                                    <button
                                        onClick={() => setShowManualToken(prev => !prev)}
                                        className="w-full text-[10px] font-semibold text-slate-500 hover:text-slate-400 transition-colors"
                                    >
                                        {showManualToken ? 'Hide manual paste option' : 'Or paste token manually'}
                                    </button>

                                    {showManualToken && (
                                        <div className="flex gap-1.5 animate-fadeIn">
                                            <input
                                                type="password"
                                                placeholder="Access token..."
                                                id="blocker-manual-token-mobile"
                                                className="flex-1 rounded-lg border border-slate-800 bg-slate-950 p-2 text-[11px] text-white outline-none focus:border-indigo-500 font-mono"
                                            />
                                            <button
                                                onClick={async () => {
                                                    const val = (document.getElementById('blocker-manual-token-mobile') as HTMLInputElement)?.value;
                                                    if (val) {
                                                        const success = await upstoxAuthService.setToken(val);
                                                        if (success) toast.success('Saved token.');
                                                        else toast.error('Failed to sync token.');
                                                    } else {
                                                        toast.error('Token is empty.');
                                                    }
                                                }}
                                                className="rounded-lg bg-slate-800 px-3 text-xs font-bold text-white"
                                            >
                                                Save
                                            </button>
                                        </div>
                                    )}

                                    <button
                                        onClick={() => {
                                            updateSetting('isUpstoxEnabled', false);
                                            toast.info('Falling back to NSE scrapers.');
                                            setShowUpstoxBlocker(false);
                                        }}
                                        className="text-[10px] font-semibold text-slate-500 hover:text-slate-400 underline transition-colors"
                                    >
                                        Disable & Use NSE Scrapers
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </Suspense>
        );
    }

    return (
        <div className={isLiteMode ? 'lite-mode' : ''}>
            <MainLayout
                activeCategory={activeCategory}
                setActiveCategory={setActiveCategory}
                activeSubTab={activeSubTab}
                setActiveSubTab={setActiveSubTab}
                subTabs={SUB_TABS[activeCategory] || []}
                categoryLabel={CATEGORY_LABELS[activeCategory]}
                isMobileMenuOpen={isMobileMenuOpen}
                setIsMobileMenuOpen={setIsMobileMenuOpen}
                isSidebarCollapsed={isSidebarCollapsed}
                setIsSidebarCollapsed={setIsSidebarCollapsed}
                isPrivacyMode={isPrivacyMode}
                onTogglePrivacy={togglePrivacyMode}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                isSearchFocused={isSearchFocused}
                setIsSearchFocused={setIsSearchFocused}
                searchResults={searchResults}
                onAddFirstAsset={() => setIsAddModalOpen(true)}
                onImportEcas={() => setIsEcasModalOpen(true)}
                onEditAsset={(inv) => { setEditingInvestment(inv); setIsAddModalOpen(true); }}
                totalNetWorth={stats?.totalAssets || 0}
            >
                <AppRouter {...routerProps} />
            </MainLayout>

            {isAddModalOpen && (
                <Suspense fallback={null}>
                    <AddInvestmentModal isOpen={isAddModalOpen} onClose={() => { setIsAddModalOpen(false); setEditingInvestment(null); }} onSave={async (data: Partial<Investment>, id?: string) => { if (id && id !== 'prefill') { await updateInvestment(id, data); } else { await addInvestment(data as Investment); } setIsAddModalOpen(false); setEditingInvestment(null); }} editingInvestment={editingInvestment} />
                </Suspense>
            )}
            {isEcasModalOpen && (
                <Suspense fallback={null}>
                    <EcasImportModal isOpen={isEcasModalOpen} onClose={() => setIsEcasModalOpen(false)} />
                </Suspense>
            )}
            <CommandPalette
                isOpen={isCommandPaletteOpen}
                onClose={() => setIsCommandPaletteOpen(false)}
                shortcuts={shortcuts}
            />
            <KeyboardHelpOverlay
                isOpen={isKeyboardHelpOpen}
                onClose={() => setIsKeyboardHelpOpen(false)}
                shortcuts={shortcuts}
            />
            <QuickLookModal />
            <PsychologicalCircuitBreaker />
            <BiometricAppLocker />
            <Suspense fallback={null}>
                <AICommandHub
                    onNavigate={setActiveCategory}
                    currentTab={activeCategory}
                />
            </Suspense>
            <OfflineBanner />
            <OfflineIndicator />
            <PwaInstallPrompt />
            <ShareIngestToast
                result={shareIngest.result}
                onDismiss={() => shareIngest.reset()}
                onOpenAddTrade={(prefill) => {
                    // A3 — open the Add Trade modal. The prefill is held
                    // on a ref so the modal can read it on open. For v1
                    // we open the existing modal; prefill-into-fields is
                    // a follow-on task.
                    setIsAddModalOpen(true);
                    void prefill;
                }}
            />
            <GuardrailOverlay />

            {/* Jarvis 2.0 — Voice-First AI Command Center (additive layer) */}
            <JarvisCommandCenter />
            <JarvisProactiveAlertBubble />
            <FirstRunGate />
            <WelcomeWizardModal />
            <DemoModePill />


            {/* Desktop blocker warning if Upstox token is invalid */}
            <AnimatePresence>
                {showUpstoxBlocker && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.95, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.95, y: 20 }}
                            className="relative w-full max-w-md rounded-[28px] border border-indigo-500/20 bg-slate-900/95 p-8 shadow-2xl text-white text-center"
                        >
                            {/* Close button */}
                            <button
                                id="upstox-blocker-close"
                                onClick={dismissBlocker}
                                className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-slate-800/80 text-slate-400 hover:bg-slate-700 hover:text-white transition-all"
                                aria-label="Close and use app without token"
                            >
                                <X size={15} />
                            </button>

                            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20">
                                <AlertTriangle size={28} />
                            </div>
                            <h3 className="text-lg font-bold tracking-wide">Upstox API Authentication Required</h3>
                            <p className="mt-3 text-sm text-slate-400 leading-relaxed">
                                The dashboard is configured to use Upstox Pro Plus as the primary market data feed.
                                To calculate G-Factor and option chain metrics, a valid access token is required daily.
                            </p>

                            <div className="mt-6 space-y-4">
                                <button
                                    id="upstox-blocker-authorize"
                                    onClick={() => {
                                        const url = upstoxAuthService.buildAuthUrl();
                                        if (url) {
                                            // Non-blocking credential sync in background
                                            upstoxAuthService.syncCredentials().catch(() => {});
                                            // Direct full-window redirect (industry standard)
                                            window.location.href = url;
                                        } else {
                                            toast.error('Upstox API Key is missing. Please configure it in Settings.');
                                        }
                                    }}
                                    className="w-full rounded-2xl bg-gradient-to-r from-indigo-500 to-sky-500 py-3 font-bold text-white shadow-lg shadow-indigo-500/20 transition-all hover:opacity-90 active:scale-95 flex items-center justify-center gap-2"
                                >
                                    <Zap size={16} /> Authorize Upstox Pro
                                </button>

                                <button
                                    onClick={() => setShowManualToken(prev => !prev)}
                                    className="w-full text-xs font-bold text-slate-500 hover:text-slate-200 transition-colors"
                                >
                                    {showManualToken ? 'Hide manual paste option' : 'Or paste token manually'}
                                </button>

                                {showManualToken && (
                                    <div className="space-y-3 animate-fadeIn">
                                        <div className="relative flex py-1 items-center">
                                            <div className="flex-grow border-t border-slate-800"></div>
                                            <span className="flex-shrink mx-4 text-[10px] font-black uppercase tracking-widest text-slate-500">Paste Token</span>
                                            <div className="flex-grow border-t border-slate-800"></div>
                                        </div>
                                        <div className="flex gap-2">
                                            <input
                                                type="password"
                                                placeholder="Paste access token here..."
                                                id="blocker-manual-token-desktop"
                                                className="flex-grow rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs text-white outline-none focus:border-indigo-500 font-mono"
                                            />
                                            <button
                                                id="upstox-blocker-save-token"
                                                onClick={async () => {
                                                    const val = (document.getElementById('blocker-manual-token-desktop') as HTMLInputElement)?.value;
                                                    if (val) {
                                                        const success = await upstoxAuthService.setToken(val);
                                                        if (success) toast.success('Manually pasted token saved!');
                                                        else toast.error('Failed to sync manual token.');
                                                    } else {
                                                        toast.error('Token input is empty.');
                                                    }
                                                }}
                                                className="rounded-xl bg-slate-800 px-4 text-xs font-bold text-white hover:bg-slate-750 transition-colors"
                                            >
                                                Save
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Remind me later + Disable row */}
                                <div className="flex items-center justify-between pt-1 gap-3">
                                    {/* Remind me later dropdown */}
                                    <div className="relative">
                                        <button
                                            id="upstox-blocker-snooze"
                                            onClick={() => setSnoozeMenuOpen(prev => !prev)}
                                            className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
                                        >
                                            <Clock size={12} />
                                            Remind me later
                                            <span className="text-slate-600">▾</span>
                                        </button>
                                        <AnimatePresence>
                                            {snoozeMenuOpen && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                                    exit={{ opacity: 0, y: -4, scale: 0.96 }}
                                                    className="absolute bottom-7 left-0 z-10 flex flex-col gap-1 rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-xl min-w-[140px]"
                                                >
                                                    {[{ label: 'In 30 minutes', h: 0.5 }, { label: 'In 1 hour', h: 1 }, { label: 'In 2 hours', h: 2 }, { label: 'In 4 hours', h: 4 }].map(opt => (
                                                        <button
                                                            key={opt.h}
                                                            onClick={() => {
                                                                snoozeBlocker(opt.h);
                                                                toast.info(`We'll remind you ${opt.label.toLowerCase()}.`);
                                                            }}
                                                            className="rounded-lg px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                                                        >
                                                            {opt.label}
                                                        </button>
                                                    ))}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>

                                    <button
                                        id="upstox-blocker-disable"
                                        onClick={() => {
                                            if (typeof window !== 'undefined') sessionStorage.setItem('upstox_blocker_dismissed', 'true');
                                            updateSetting('isUpstoxEnabled', false);
                                            toast.info('Upstox disabled. Falling back to legacy NSE scrapers.');
                                            setShowUpstoxBlocker(false);
                                        }}
                                        className="text-xs font-semibold text-slate-500 hover:text-slate-400 underline transition-colors"
                                    >
                                        Disable &amp; Fallback to NSE
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};


const UpstoxCallbackHandler: React.FC = () => {
    const [status, setStatus] = useState<'exchanging' | 'success' | 'error'>('exchanging');
    const [errorMsg, setErrorMsg] = useState('');
    const hasRunRef = useRef(false);

    useEffect(() => {
        if (hasRunRef.current) return;
        hasRunRef.current = true;

        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        if (!code) {
            setStatus('error');
            setErrorMsg('No OAuth authorization code found in URL.');
            return;
        }

        const runExchange = async () => {
            try {
                const redirectUri = `${window.location.origin}/upstox/callback`;
                await upstoxAuthService.syncCredentials();
                const response = await fetch('/api/python-nse/api/upstox/token-exchange', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code, redirect_uri: redirectUri }),
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.access_token) {
                        localStorage.setItem('upstox_access_token', data.access_token);
                        localStorage.setItem('upstox_token_created_at', Date.now().toString());
                        sessionStorage.setItem('upstox_blocker_dismissed', 'true');
                        useSettingsStore.getState().updateSetting('upstoxAccessToken', data.access_token);
                        await upstoxAuthService.setToken(data.access_token);
                        
                        setStatus('success');
                        setTimeout(() => {
                            window.location.href = '/';
                        }, 400);
                        return;
                    }
                }
                const errData = await response.json().catch(() => ({}));
                setStatus('error');
                let msg = 'Token exchange failed.';
                if (typeof errData.detail === 'string') {
                    msg = errData.detail;
                } else if (errData.detail && typeof errData.detail === 'object') {
                    msg = errData.detail.message || errData.detail.error || JSON.stringify(errData.detail);
                } else if (errData.message) {
                    msg = errData.message;
                }
                setErrorMsg(String(msg));
            } catch (err: any) {
                setStatus('error');
                setErrorMsg(err?.message || 'Network error during token exchange.');
            }
        };

        runExchange();
    }, []);

    return (
        <div className="flex h-screen items-center justify-center bg-slate-950 text-white font-sans">
            <div className="flex flex-col items-center p-8 bg-slate-900 border border-slate-800 rounded-3xl max-w-md text-center shadow-2xl">
                {status === 'exchanging' && (
                    <>
                        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                        <h3 className="text-lg font-bold text-slate-100">Authenticating Upstox Pro...</h3>
                        <p className="text-xs text-slate-400 mt-2">Securing token & synchronizing market data feeds.</p>
                    </>
                )}
                {status === 'success' && (
                    <>
                        <div className="w-12 h-12 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center text-2xl mb-4 font-bold">✓</div>
                        <h3 className="text-lg font-bold text-emerald-400">Authentication Successful!</h3>
                        <p className="text-xs text-slate-400 mt-2">Launching your Dashboard...</p>
                    </>
                )}
                {status === 'error' && (
                    <>
                        <div className="w-12 h-12 bg-rose-500/20 text-rose-400 rounded-full flex items-center justify-center text-2xl mb-4 font-bold">✕</div>
                        <h3 className="text-lg font-bold text-rose-400">Authentication Failed</h3>
                        <p className="text-xs text-slate-400 mt-2">{errorMsg}</p>
                        <button onClick={() => window.location.href = '/'} className="mt-4 px-4 py-2 bg-indigo-600 text-xs font-bold rounded-xl hover:bg-indigo-500 transition-colors">
                            Return to Dashboard
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

const RootAuthGate: React.FC = () => {
    // 0. Intercept Upstox OAuth callback immediately, bypassing Firebase loading gate
    if (typeof window !== 'undefined' && window.location.pathname === '/upstox/callback') {
        return <UpstoxCallbackHandler />;
    }

    const { user, loading } = useFirebaseAuth();

    useEffect(() => {
        if (!loading) {
            if (window.performance && window.performance.mark) {
                if (!window.performance.getEntriesByName('auth:resolved').length) {
                    window.performance.mark('auth:resolved');
                }
            }
        }
    }, [loading]);

    if (loading) {
        return (
            <div className="min-h-screen bg-wa-canvas text-slate-400">
                <div className="h-14 border-b border-wa-border bg-wa-surface px-4 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 opacity-90 animate-pulse"></div>
                        <span className="text-sm font-bold tracking-tight text-white/90">WealthOS</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping"></span>
                            Securing Session...
                        </div>
                    </div>
                </div>
                <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
                    <DashboardSkeleton />
                </div>
            </div>
        );
    }

    if (!user) {
        return (
            <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-wa-canvas text-slate-400">Loading secure portal...</div>}>
                <FirebaseLoginPage />
            </Suspense>
        );
    }

    return <AppContent />;
};

const App: React.FC = () => {
    useEffect(() => {
        if (window.performance && window.performance.mark) {
            if (!window.performance.getEntriesByName('shell:first-render').length) {
                window.performance.mark('shell:first-render');
            }
        }
        bootCoordinator.schedule(BootLane.P3_BACKGROUND, () => {
            fetchCoordinator.startPeriodicEviction();
        });
        bootCoordinator.executeLane(BootLane.P1_VISIBLE);

        // Initialize Telegram WebApp SDK if running inside Telegram Forum / Client
        if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
            try {
                const tg = (window as any).Telegram.WebApp;
                tg.ready();
                tg.expand();
            } catch (e) {
                console.warn('Failed to initialize Telegram WebApp SDK:', e);
            }
        }
    }, []);

    return (
        <MotionConfig reducedMotion="user">
            <FirebaseAuthProvider>
                <AuthProvider>
                    <FamilyProvider>
                        <PageVisibilityProvider>
                            <RootAuthGate />
                            <BridgeStatusBanner />
                            <PerformanceOverlay />
                        </PageVisibilityProvider>
                    </FamilyProvider>
                </AuthProvider>
            </FirebaseAuthProvider>
        </MotionConfig>
    );
};

export default App;
