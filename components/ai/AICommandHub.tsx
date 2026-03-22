import React, { useState, useEffect, useRef } from 'react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Brain, X, TrendingUp, AlertTriangle, ChevronRight,
    Zap, Globe, Activity, RefreshCw, Loader2, CheckCircle2, PauseCircle, XCircle, Settings,
    ShieldAlert, Quote, Send, Database, Sparkles, AlertCircle, ChevronDown, ChevronUp, ArrowRight, Info
} from 'lucide-react';
import { MarketPulseService, MarketPulse } from '../../services/MarketPulseService';
import { AmbientAIBrain, TabAIResult, AIInsight } from '../../services/AmbientAIBrain';
import { AstroPsychologyService, AstroStats } from '../../services/AstroPsychologyService';
import { AstroConfigModal } from '../modals/AstroConfigModal';
import { useCosmicGovernorStore } from '../../store/cosmicGovernorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useCrossTabStore } from '../../store/crossTabStore';
import { useAIHubStore, AIHubTab } from '../../store/aiHubStore';
import { SkeletonLine } from '../ui/Skeleton';
import { personalizedBrain } from '../../services/brain/PersonalizedBrain';
import { vectorMemoryService } from '../../services/brain/VectorMemoryService';
import { RetrievedDoc } from '../../services/brain/RAGQueryEngine';
import { db } from '../../database';
import { MotionButton } from '../ui/MotionButton';

interface AICommandHubProps {
    onNavigate: (tab: string) => void;
    currentTab: string;
}

interface Message {
    id: string;
    sender: 'user' | 'assistant';
    text: string;
    sources?: RetrievedDoc[];
}

const signalConfig = {
    go: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500', label: 'GO', ring: 'ring-emerald-500/30' },
    caution: { icon: PauseCircle, color: 'text-amber-500', bg: 'bg-amber-500', label: 'CAUTION', ring: 'ring-amber-500/30' },
    stop: { icon: XCircle, color: 'text-rose-500', bg: 'bg-rose-500', label: 'STOP', ring: 'ring-rose-500/30' },
};

const SeverityConfig = {
    critical: {
        icon: XCircle,
        bg: 'bg-rose-50/80 dark:bg-rose-950/30',
        border: 'border-rose-200/60 dark:border-rose-800/40',
        iconColor: 'text-rose-500',
        badge: 'bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400',
        label: 'CRITICAL',
    },
    warning: {
        icon: AlertTriangle,
        bg: 'bg-amber-50/80 dark:bg-amber-950/30',
        border: 'border-amber-200/60 dark:border-amber-800/40',
        iconColor: 'text-amber-500',
        badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400',
        label: 'ADVISORY',
    },
    positive: {
        icon: TrendingUp,
        bg: 'bg-emerald-50/80 dark:bg-emerald-950/30',
        border: 'border-emerald-200/60 dark:border-emerald-800/40',
        iconColor: 'text-emerald-500',
        badge: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400',
        label: 'POSITIVE',
    },
    info: {
        icon: Info,
        bg: 'bg-indigo-50/80 dark:bg-indigo-950/30',
        border: 'border-indigo-200/60 dark:border-indigo-800/40',
        iconColor: 'text-indigo-500',
        badge: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400',
        label: 'INFO',
    },
};

const niftyTrendIcon = (trend: MarketPulse['niftyTrend']) => {
    if (trend === 'bullish') return '↑';
    if (trend === 'bearish') return '↓';
    return '→';
};

export const AICommandHub: React.FC<AICommandHubProps> = ({
    onNavigate, currentTab
}) => {
    const { isOpen, activeTab, open, close, setTab } = useAIHubStore();
    const isAICoachEnabled = useSettingsStore(s => s.isAICoachEnabled);
    
    // Core portfolio/stats data
    const investments = usePortfolioStore(useShallow(s => s.investments));
    const stats = usePortfolioStore(useShallow(s => s.stats));
    const totalNetWorth = String(stats?.totalCurrent || 0);

    // Cross tab signals
    const crossTabSignals = useCrossTabStore((s) => s.signals);
    const activeCrossTabAlerts = crossTabSignals.filter((sig) =>
      sig.affectedTabs.includes(currentTab)
    );

    // State for general coach message & market flash
    const [pulse, setPulse] = useState<MarketPulse | null>(null);
    const [dashResult, setDashResult] = useState<TabAIResult | null>(null);
    const [astroStats, setAstroStats] = useState<AstroStats | null>(null);
    const [isLoadingPulse, setIsLoadingPulse] = useState(false);
    const [isAstroModalOpen, setIsAstroModalOpen] = useState(false);
    const [hasNewInsight, setHasNewInsight] = useState(false);

    // Context-aware tab insights (for Tab 2 Insights)
    const [tabResult, setTabResult] = useState<TabAIResult | null>(null);
    const [isLoadingTab, setIsLoadingTab] = useState(false);
    const [isLoadingCoach, setIsLoadingCoach] = useState(false);

    // Tab 4 Brain Chat state
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState(0);
    const [scanStatus, setScanStatus] = useState('');
    const [hasScanned, setHasScanned] = useState(false);
    const [openSourceId, setOpenSourceId] = useState<string | null>(null);

    const scrollRef = useRef<HTMLDivElement>(null);

    // Check if we already have indexed vectors for Brain Chat
    useEffect(() => {
        db.brain_vectors.count().then((count: number) => {
            setHasScanned(count > 0);
        });
    }, [isScanning]);

    // Auto scroll to bottom of chat
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isThinking, activeTab]);

    // Load market pulse on mount (with 5s delay to avoid startup 429 spam)
    useEffect(() => {
        const timer = setTimeout(() => {
            setIsLoadingPulse(true);
            MarketPulseService.getPulse((fresh) => {
                setPulse(fresh);
                setIsLoadingPulse(false);
                if (!isOpen) setHasNewInsight(true);
            }).then((initial) => {
                if (initial.fetchedAt > 0) setPulse(initial);
                setIsLoadingPulse(false);
            }).catch(() => setIsLoadingPulse(false));
        }, 5000);

        return () => clearTimeout(timer);
    }, [isOpen]);

    // Load dashboard-level insights (staggered 6s delay)
    useEffect(() => {
        const timer = setTimeout(() => {
            AmbientAIBrain.getInsights('dashboard', investments, totalNetWorth, (fresh) => {
                setDashResult(fresh);
                if (!isOpen && (fresh.tradeSignal === 'stop' || fresh.insights.some(i => i.severity === 'critical'))) {
                    setHasNewInsight(true);
                }
            });
        }, 6000);

        return () => clearTimeout(timer);
    }, [investments, totalNetWorth, isOpen]);

    // Load context-aware insights for currentTab
    const fetchTabInsights = async (force: boolean = false) => {
        setIsLoadingTab(true);
        try {
            if (force) {
                AmbientAIBrain.invalidateTab(currentTab as any);
            }
            const res = await AmbientAIBrain.getInsights(
                currentTab as any,
                investments,
                totalNetWorth,
                (updatedRes) => {
                    setTabResult(updatedRes);
                },
                0,
                force
            );
            setTabResult(res);
        } catch (e) {
            console.error("[AICommandHub] Failed to load tab insights", e);
        } finally {
            setIsLoadingTab(false);
        }
    };

    useEffect(() => {
        fetchTabInsights();
        if (isAICoachEnabled) {
            const interval = setInterval(() => {
                fetchTabInsights();
            }, 5 * 60 * 1000); // refresh every 5 min
            return () => clearInterval(interval);
        }
    }, [currentTab, investments, totalNetWorth, isAICoachEnabled]);

    // Load astro psychology stats
    useEffect(() => {
        AstroPsychologyService.getTodayAstroStats().then(setAstroStats);
    }, [dashResult]); // Refresh when AI results refresh

    const handleRefresh = () => {
        if (activeTab === 'coach') {
            setIsLoadingCoach(true);
            AmbientAIBrain.invalidateTab('dashboard');
            AmbientAIBrain.getInsights('dashboard', investments, totalNetWorth, (fresh) => {
                setDashResult(fresh);
                setIsLoadingCoach(false);
            }, 0, true);
        } else if (activeTab === 'insights') {
            fetchTabInsights(true);
        } else if (activeTab === 'market') {
            MarketPulseService.invalidateCache();
            setIsLoadingPulse(true);
            MarketPulseService.getPulse((fresh) => {
                setPulse(fresh);
                setIsLoadingPulse(false);
            }).then(() => {
                AstroPsychologyService.getTodayAstroStats().then(setAstroStats);
            }).catch(() => setIsLoadingPulse(false));
        }
    };

    const handleScan = async () => {
        setIsScanning(true);
        setScanProgress(0);
        setScanStatus('Starting deep scan...');
        
        await vectorMemoryService.runDeepScan((progress, statusText) => {
            setScanProgress(progress);
            setScanStatus(statusText);
        });

        setIsScanning(false);
        setHasScanned(true);
    };

    const handleSend = async (textToSend?: string) => {
        const queryText = (textToSend || input).trim();
        if (!queryText) return;

        if (!textToSend) setInput('');

        const userMsg: Message = {
            id: `msg-${Date.now()}-user`,
            sender: 'user',
            text: queryText
        };

        setMessages(prev => [...prev, userMsg]);
        setIsThinking(true);

        try {
            const response = await personalizedBrain.query(queryText);
            const assistantMsg: Message = {
                id: `msg-${Date.now()}-ai`,
                sender: 'assistant',
                text: response.answer,
                sources: response.sources
            };
            setMessages(prev => [...prev, assistantMsg]);
        } catch (err) {
            const errorMsg: Message = {
                id: `msg-${Date.now()}-err`,
                sender: 'assistant',
                text: 'I had trouble processing that query. Please make sure your database is indexed and try again.'
            };
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            setIsThinking(false);
        }
    };

    const tradeSignal = dashResult?.tradeSignal;
    const criticalInsight = dashResult?.insights?.find(i => i.severity === 'critical') || tabResult?.insights?.find(i => i.severity === 'critical');

    const {
        isCircuitBreakerActive,
        dailyTradeCount,
        dailyFees,
        tiltScore,
        blockReason
    } = useCosmicGovernorStore(
        useShallow(state => ({
            isCircuitBreakerActive: state.isCircuitBreakerActive,
            dailyTradeCount: state.dailyTradeCount,
            dailyFees: state.dailyFees,
            tiltScore: state.tiltScore,
            blockReason: state.blockReason,
        }))
    );

    const astroProfile = useSettingsStore(state => state.astroProfile);
    
    // Determine current day context for limits display
    const today = new Date();
    const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
    let currentLimit = astroProfile.baseMaxTrades;
    if (dayName === 'Tuesday') currentLimit = astroProfile.tuesdayMaxTrades;
    if (astroProfile.currentLifePhase?.includes('Mars-Mudda')) {
        currentLimit = Math.min(currentLimit, astroProfile.marsMuddaMaxTrades);
    }

    const tabs: { id: AIHubTab; label: string; icon: React.ComponentType<any> }[] = [
        { id: 'coach', label: 'Coach', icon: Brain },
        { id: 'insights', label: 'Insights', icon: Sparkles },
        { id: 'market', label: 'Market', icon: Activity },
        { id: 'brain', label: 'Brain', icon: Database },
    ];

    return (
        <>
            {/* Unified Floating Trigger Button */}
            <div className="fixed bottom-6 right-6 z-fixed flex flex-col items-end gap-3 group pointer-events-none">
                {/* Pop-up chip when closed — shows most critical alert */}
                {!isOpen && (criticalInsight || isCircuitBreakerActive) && (
                    <button
                        onClick={() => open()}
                        className={`flex items-center gap-2 bg-white dark:bg-slate-900 border rounded-full px-3.5 py-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none group-hover:pointer-events-auto ${
                            isCircuitBreakerActive ? 'border-rose-500 shadow-rose-500/10' : 'border-rose-200 dark:border-rose-800/50 shadow-rose-500/10'
                        }`}
                    >
                        {isCircuitBreakerActive ? <ShieldAlert size={12} className="text-rose-500" /> : <AlertTriangle size={12} className="text-rose-500" />}
                        <span className={`text-[10px] font-bold max-w-[160px] truncate ${isCircuitBreakerActive ? 'text-rose-600' : 'text-rose-600 dark:text-rose-450'}`}>
                            {isCircuitBreakerActive ? 'CIRCUIT BREAKER ACTIVE' : criticalInsight?.title}
                        </span>
                    </button>
                )}

                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => isOpen ? close() : open()}
                    className={`relative w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg backdrop-blur-md border transition-all duration-300 pointer-events-auto cursor-pointer ${
                        isCircuitBreakerActive || tradeSignal === 'stop' || astroStats?.isInsideShadow
                        ? 'bg-gradient-to-br from-rose-500/60 to-rose-700/60 shadow-rose-500/10 border-rose-500/30'
                        : tradeSignal === 'caution'
                            ? 'bg-gradient-to-br from-amber-400/60 to-amber-600/60 shadow-amber-500/10 border-amber-500/30'
                            : 'bg-gradient-to-br from-indigo-500 to-violet-600 shadow-indigo-500/20 border-indigo-400/30'
                        }`}
                    aria-label="Toggle AI Command Hub"
                >
                    <Brain size={20} className="text-white" />
                    {(hasNewInsight || astroStats?.isInsideShadow) && (
                        <span className={`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full ring-2 ring-white dark:ring-slate-900 animate-ping ${astroStats?.isInsideShadow ? 'bg-rose-500' : 'bg-indigo-500'}`} />
                    )}
                    {(hasNewInsight || astroStats?.isInsideShadow) && (
                        <span className={`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full ring-2 ring-white dark:ring-slate-900 ${astroStats?.isInsideShadow ? 'bg-rose-500' : 'bg-indigo-500'}`} />
                    )}
                </motion.button>
            </div>

            {/* Slide-Up Panel */}
            <AnimatePresence>
                {isOpen && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-fixed bg-slate-900/20 backdrop-blur-[2px]"
                            onClick={() => close()}
                        />

                        {/* Panel */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 30 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 30 }}
                            transition={{ duration: 0.25, ease: 'easeOut' }}
                            className="fixed bottom-24 right-6 w-[calc(100vw-2rem)] md:w-[580px] h-[72vh] max-h-[680px] rounded-3xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl shadow-2xl overflow-hidden z-popover flex flex-col text-slate-900 dark:text-white"
                        >
                            {/* Panel Header */}
                            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800/80 shrink-0">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-700 flex items-center justify-center shrink-0">
                                        <Brain size={18} className="text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">AI Command Hub</h3>
                                        <div className="flex items-center gap-1">
                                            <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Unified AI System</p>
                                            {(dashResult?.model || tabResult?.model) && (
                                                <>
                                                    <span className="text-[8px] text-slate-300 dark:text-slate-700">•</span>
                                                    <span className="text-[8px] font-black text-indigo-500 dark:text-indigo-400 uppercase tracking-wider">
                                                        {activeTab === 'insights' ? tabResult?.model : dashResult?.model || 'Gemini'}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    {activeTab !== 'brain' && (
                                        <button
                                            onClick={handleRefresh}
                                            className="p-2 rounded-xl text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                                            title="Refresh AI Insights"
                                        >
                                            <RefreshCw size={14} className={(isLoadingPulse || isLoadingTab || isLoadingCoach) ? 'animate-spin' : ''} />
                                        </button>
                                    )}
                                    <button
                                        onClick={() => setIsAstroModalOpen(true)}
                                        className="p-2 rounded-xl text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                                        title="Astro Config Rules"
                                    >
                                        <Settings size={14} />
                                    </button>
                                    <button
                                        onClick={() => close()}
                                        className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                        title="Close Panel"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            </div>

                            {/* Tab Bar */}
                            <div className="flex bg-slate-100 dark:bg-slate-950/65 p-1 rounded-2xl border border-slate-200/50 dark:border-slate-850 mx-4 my-2.5 shrink-0">
                                {tabs.map((tab) => {
                                    const Icon = tab.icon;
                                    const isActive = activeTab === tab.id;
                                    return (
                                        <button
                                            key={tab.id}
                                            onClick={() => setTab(tab.id)}
                                            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold transition-all relative cursor-pointer ${
                                                isActive
                                                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm border border-slate-200/50 dark:border-slate-800'
                                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900/40'
                                            }`}
                                        >
                                            <Icon size={14} className={isActive ? 'text-indigo-500' : 'text-slate-450'} />
                                            <span>{tab.label}</span>
                                            {tab.id === 'insights' && (tabResult?.insights?.some(i => i.severity === 'critical') || activeCrossTabAlerts.length > 0) && (
                                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 absolute top-1 right-1" />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Tab Content Panes */}
                            <div className="flex-1 flex flex-col overflow-hidden">
                                {activeTab === 'coach' && (
                                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                        {/* Circuit Breaker Warning */}
                                        {isCircuitBreakerActive && (
                                            <div className="p-3.5 rounded-2xl bg-rose-500 border border-rose-450 shadow-[0_0_20px_rgba(244,63,94,0.3)] animate-pulse">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <ShieldAlert size={14} className="text-white" />
                                                    <p className="text-[10px] font-black text-white uppercase tracking-widest">Circuit Breaker Active</p>
                                                </div>
                                                <p className="text-[11px] font-bold text-rose-50 leading-tight">
                                                    {blockReason || 'Trading suspended. Rahu-Saturn balance critical.'}
                                                </p>
                                            </div>
                                        )}

                                        {/* Trade Signal */}
                                        {tradeSignal && (
                                            <div className={`p-4 rounded-2xl border flex items-center gap-4 ${
                                                tradeSignal === 'go'
                                                    ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-800/40'
                                                    : tradeSignal === 'caution'
                                                        ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-800/40'
                                                        : 'bg-rose-50 dark:bg-rose-950/20 border-rose-200/60 dark:border-rose-800/40'
                                            }`}>
                                                <div className={`w-2.5 h-2.5 rounded-full shrink-0 animate-pulse ${signalConfig[tradeSignal].bg}`} />
                                                <div className="flex-1">
                                                    <p className={`text-[10px] font-black tracking-widest ${signalConfig[tradeSignal].color}`}>
                                                        TODAY'S SIGNAL: {signalConfig[tradeSignal].label}
                                                    </p>
                                                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                                                        {dashResult?.tradeSignalReason || 'Based on your behavior + market conditions.'}
                                                    </p>
                                                </div>
                                                {React.createElement(signalConfig[tradeSignal].icon, {
                                                    size: 20,
                                                    className: `${signalConfig[tradeSignal].color} shrink-0`
                                                })}
                                            </div>
                                        )}

                                        {/* Daily Directive & Identity Anchor */}
                                        <div className="p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-800/40 space-y-3">
                                            <div>
                                                <div className="flex items-center gap-1.5 mb-1.5">
                                                    <Quote size={12} className="text-indigo-400" />
                                                    <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">Identity Anchor</p>
                                                </div>
                                                <p className="text-xs font-bold text-slate-800 dark:text-slate-100 italic leading-relaxed">
                                                    "I am an Aquarian architect with a Mercury-sharp mind... I rely on architecture, not willpower."
                                                </p>
                                            </div>
                                            <div className="h-px bg-indigo-200/40 dark:bg-indigo-800/40" />
                                            <div>
                                                <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-1.5">Daily Directive</p>
                                                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-relaxed">
                                                    {dashResult?.coachMessage || "Maintain Saturnian discipline in this Rahu-dominant window."}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Caching/Timestamp info */}
                                        <div className="flex items-center justify-between px-1 text-[10px] text-slate-400 dark:text-slate-500 select-none">
                                            <span>
                                                {dashResult?.fetchedAt 
                                                    ? `Last updated: ${new Date(dashResult.fetchedAt).toLocaleDateString()} ${new Date(dashResult.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                                    : 'No cached response'}
                                            </span>
                                            {!isAICoachEnabled && (
                                                <span className="text-[8px] font-black text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 rounded uppercase tracking-wider">
                                                    Auto-Polling Off
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'insights' && (
                                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                        {/* Cross-Tab Correlation Alerts */}
                                        {activeCrossTabAlerts.length > 0 && (
                                            <div className="space-y-2">
                                                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-500 dark:text-rose-400 flex items-center gap-1.5">
                                                    <AlertTriangle size={12} /> Unified Cross-Tab Signals
                                                </h4>
                                                <div className="grid gap-2">
                                                    {activeCrossTabAlerts.map((alert, idx) => (
                                                        <div
                                                            key={idx}
                                                            className={`rounded-2xl border p-3.5 ${
                                                                alert.severity === 'critical'
                                                                    ? 'bg-rose-50/80 dark:bg-rose-950/30 border-rose-200/60 dark:border-rose-800/40 text-rose-800 dark:text-rose-200'
                                                                    : 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200/60 dark:border-amber-800/40 text-amber-800 dark:text-amber-200'
                                                            }`}
                                                        >
                                                            <p className="text-xs font-semibold leading-relaxed">
                                                                {alert.message}
                                                            </p>
                                                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                                                                {alert.affectedTabs.map((t) => (
                                                                    <span
                                                                        key={t}
                                                                        className="rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                                                                    >
                                                                        {t}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Tab Insights */}
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between">
                                                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 dark:text-indigo-400 flex items-center gap-1.5">
                                                    <Sparkles size={12} /> Tab Insights & Actions ({currentTab})
                                                </h4>
                                            </div>

                                            {isLoadingTab && (!tabResult?.insights || tabResult.insights.length === 0) ? (
                                                <div className="space-y-3 p-1">
                                                    {[1, 2, 3].map(i => (
                                                        <div key={i} className="space-y-2">
                                                            <SkeletonLine width="30%" height={8} rounded />
                                                            <SkeletonLine width="100%" height={12} />
                                                            <SkeletonLine width="80%" height={12} />
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : tabResult?.insights && tabResult.insights.length > 0 ? (
                                                <div className="space-y-2.5">
                                                    {tabResult.insights.map((insight) => {
                                                        const config = SeverityConfig[insight.severity] || SeverityConfig.info;
                                                        const Icon = config.icon;
                                                        return (
                                                            <div key={insight.id} className={`rounded-2xl border p-4 transition-all hover:scale-[1.01] duration-200 ${config.bg} ${config.border}`}>
                                                                <div className="flex items-start gap-3">
                                                                    <Icon size={16} className={`${config.iconColor} shrink-0 mt-0.5`} />
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center gap-2 mb-1.5">
                                                                            <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${config.badge}`}>
                                                                                {config.label}
                                                                            </span>
                                                                            <span className="text-xs font-bold text-slate-800 dark:text-white">
                                                                                {insight.title}
                                                                            </span>
                                                                        </div>
                                                                        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                                                                            {insight.body}
                                                                        </p>
                                                                        {insight.action && (
                                                                            <button
                                                                                onClick={() => {
                                                                                    if (insight.actionTab) {
                                                                                        onNavigate(insight.actionTab);
                                                                                        close();
                                                                                    }
                                                                                }}
                                                                                className={`mt-2.5 flex items-center gap-1 text-[10px] font-bold ${config.iconColor} hover:underline cursor-pointer`}
                                                                            >
                                                                                {insight.action}
                                                                                <ArrowRight size={10} />
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 py-8 text-slate-500">
                                                    <CheckCircle2 size={24} className="mb-2 text-slate-400 dark:text-slate-600" />
                                                    <p className="text-xs font-medium">No active alerts. Tab status is healthy.</p>
                                                </div>
                                            )}

                                            {/* Footer */}
                                            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/60 text-slate-400">
                                                <div className="flex flex-col gap-0.5">
                                                    <p className="text-[9px] flex items-center gap-1">
                                                        <Sparkles size={9} />
                                                        Powered by AmbientAIBrain
                                                    </p>
                                                    <p className="text-[8px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5 select-none">
                                                        <span>
                                                            {tabResult?.fetchedAt 
                                                                ? `Last updated: ${new Date(tabResult.fetchedAt).toLocaleDateString()} ${new Date(tabResult.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                                                : 'No cached response'}
                                                        </span>
                                                        {!isAICoachEnabled && (
                                                            <span className="text-[7px] font-black text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1 rounded uppercase">
                                                                Off
                                                            </span>
                                                        )}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => fetchTabInsights(true)}
                                                    disabled={isLoadingTab}
                                                    className="text-[10px] font-bold text-indigo-550 dark:text-indigo-400 hover:text-indigo-700 flex items-center gap-1 hover:underline disabled:opacity-50 cursor-pointer"
                                                >
                                                    <RefreshCw size={10} className={isLoadingTab ? 'animate-spin' : ''} /> Force Recalculate
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'market' && (
                                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                        {/* Market Flash */}
                                        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/30 border border-slate-200/60 dark:border-slate-800 space-y-2">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-1.5">
                                                    <Globe size={12} className="text-slate-400" />
                                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Market Flash</p>
                                                </div>
                                                {isLoadingPulse && <Loader2 size={10} className="animate-spin text-slate-400" />}
                                            </div>
                                            {pulse ? (
                                                <div className="space-y-2.5">
                                                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 leading-relaxed">
                                                        {pulse.headline}
                                                    </p>
                                                    <div className="flex flex-wrap gap-1.5 mt-1">
                                                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                                                            pulse.niftyTrend === 'bullish'
                                                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                                                : pulse.niftyTrend === 'bearish'
                                                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                                                                    : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                                                        }`}>
                                                            Nifty {niftyTrendIcon(pulse.niftyTrend)} {pulse.niftyTrend}
                                                        </span>
                                                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                                                            pulse.fiiFlow === 'buying'
                                                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                                                : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                                                        }`}>
                                                            FII {pulse.fiiFlow}
                                                        </span>
                                                        {pulse.hotSectors.slice(0, 3).map(s => (
                                                            <span key={s} className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-indigo-105 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                                                                🔥 {s}
                                                            </span>
                                                        ))}
                                                    </div>

                                                    {/* Caching/Timestamp info */}
                                                    <div className="text-[9px] text-slate-400 dark:text-slate-500 pt-1 flex items-center gap-1.5 select-none">
                                                        <span>
                                                            {pulse.fetchedAt 
                                                                ? `Last updated: ${new Date(pulse.fetchedAt).toLocaleDateString()} ${new Date(pulse.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                                                : 'No cached response'}
                                                        </span>
                                                        {!isAICoachEnabled && (
                                                            <span className="text-[7px] font-black text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1 rounded uppercase">
                                                                Off
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            ) : (
                                                <p className="text-[10px] text-slate-400">Loading market data...</p>
                                            )}
                                        </div>

                                        {/* Astro Posture */}
                                        <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-500/5 to-purple-500/5 border border-indigo-200/40 dark:border-indigo-800/20 backdrop-blur-sm space-y-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-1.5">
                                                    <Zap size={12} className="text-indigo-400" />
                                                    <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Astro Posture</p>
                                                </div>
                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${isCircuitBreakerActive ? 'bg-rose-500/10 text-rose-500 animate-pulse' : 'bg-emerald-500/10 text-emerald-500'}`}>
                                                    {isCircuitBreakerActive ? 'Rahu Dominant (Locked)' : 'Saturn Disciplined'}
                                                </span>
                                            </div>
                                            
                                            <div className="space-y-2">
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="flex flex-col bg-slate-50 dark:bg-slate-900/40 p-2.5 rounded-xl border border-slate-200/50 dark:border-slate-800">
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-[8px] text-slate-500 font-bold uppercase">Trades Today</span>
                                                            {dayName === 'Tuesday' && <span className="text-[7px] text-rose-500 font-black uppercase">TUE LAW</span>}
                                                        </div>
                                                        <span className={`text-xs font-black ${dailyTradeCount >= currentLimit ? 'text-rose-500' : 'text-slate-700 dark:text-slate-200'}`}>
                                                            {dailyTradeCount} / {currentLimit}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col bg-slate-50 dark:bg-slate-900/40 p-2.5 rounded-xl border border-slate-200/50 dark:border-slate-800">
                                                        <span className="text-[8px] text-slate-500 font-bold uppercase">Today's Fees</span>
                                                        <span className={`text-xs font-black ${dailyFees >= (astroProfile.currentLifePhase?.includes('Mars-Mudda') ? astroProfile.marsRahuMuddaMaxFees : astroProfile.baseMaxFees) ? 'text-rose-500' : 'text-slate-700 dark:text-slate-200'}`}>
                                                            ₹{Math.round(dailyFees)}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between text-[10px]">
                                                    <span className="text-slate-500 font-bold uppercase tracking-tighter">Psychological Tilt</span>
                                                    <span className={`font-black ${tiltScore >= 70 ? 'text-rose-500' : 'text-emerald-500'}`}>{tiltScore}%</span>
                                                </div>
                                                
                                                {/* Progress Bar */}
                                                <div className="h-2 w-full bg-slate-100 dark:bg-slate-900 rounded-full overflow-hidden flex border border-slate-200/50 dark:border-slate-800">
                                                    <div 
                                                        className="h-full bg-rose-500 transition-all duration-500" 
                                                        style={{ width: `${Math.max(tiltScore, astroStats?.rahuIntensity || 0)}%` }} 
                                                    />
                                                    <div 
                                                        className="h-full bg-emerald-500 transition-all duration-500 flex-1" 
                                                    />
                                                </div>
                                                <div className="flex justify-between text-[8px] font-bold uppercase tracking-tighter">
                                                    <span className="text-rose-500">Impulsivity (Rahu)</span>
                                                    <span className="text-emerald-500">Discipline (Saturn)</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Quick Actions */}
                                        <div className="grid grid-cols-2 gap-2">
                                            {[
                                                { label: 'View Journal', tab: 'Trading Journal', icon: Activity },
                                                { label: 'Open Advisor', tab: 'Growth Engine', icon: Brain },
                                            ].map(({ label, tab, icon: Icon }) => (
                                                <button
                                                    key={tab}
                                                    onClick={() => { onNavigate(tab); close(); }}
                                                    className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <Icon size={13} className="text-indigo-500" />
                                                        <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200">{label}</span>
                                                    </div>
                                                    <ChevronRight size={11} className="text-slate-400" />
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'brain' && (
                                    <div className="flex-1 flex flex-col overflow-hidden">
                                        {/* Scan Progress Bar */}
                                        {isScanning && (
                                            <div className="bg-indigo-950/20 border-b border-indigo-500/20 px-5 py-2.5 space-y-1.5 shrink-0">
                                                <div className="flex items-center justify-between text-[9px] text-indigo-300">
                                                    <span className="font-mono">{scanStatus}</span>
                                                    <span className="font-bold">{scanProgress}%</span>
                                                </div>
                                                <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-300"
                                                        style={{ width: `${scanProgress}%` }}
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {/* Database Scan Banner */}
                                        <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/40 flex items-center justify-between shrink-0">
                                            <div className="flex items-center gap-2">
                                                <Database size={13} className="text-indigo-400" />
                                                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-450 uppercase tracking-wider">
                                                    {hasScanned ? 'Local RAG Database Indexed' : 'Database Needs Deep Scan'}
                                                </span>
                                            </div>
                                            <button
                                                onClick={handleScan}
                                                disabled={isScanning}
                                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 transition-colors disabled:opacity-40 cursor-pointer"
                                            >
                                                <RefreshCw size={10} className={isScanning ? 'animate-spin' : ''} />
                                                <span>{isScanning ? 'Scanning...' : 'Scan DB'}</span>
                                            </button>
                                        </div>

                                        {/* Chat Body */}
                                        <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto space-y-4">
                                            {messages.length === 0 && (
                                                <div className="h-full flex flex-col items-center justify-center text-center p-5 space-y-3 my-auto">
                                                    <div className="w-10 h-10 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                                                        <Sparkles size={16} className="text-indigo-400" />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-xs font-bold text-slate-805 dark:text-white mb-1">On-Device Intelligence</h4>
                                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed max-w-[240px]">
                                                            {!hasScanned
                                                                ? 'Trigger a deep scan of your database using the scan button above to index your trading history.'
                                                                : 'Ask me anything about your past trades, signal win rates, or mood triggers. Fully local and secure.'}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}

                                            {messages.map((m) => (
                                                <div
                                                    key={m.id}
                                                    className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
                                                >
                                                    <div
                                                        className={`max-w-[85%] text-xs px-3.5 py-2.5 rounded-2xl shadow-sm leading-relaxed ${
                                                            m.sender === 'user'
                                                                ? 'bg-indigo-600 text-white rounded-tr-none'
                                                                : 'bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-none'
                                                        }`}
                                                    >
                                                        <p className="whitespace-pre-wrap">{m.text}</p>
                                                    </div>

                                                    {/* Collapsible Sources Section */}
                                                    {m.sources && m.sources.length > 0 && (
                                                        <div className="w-[85%] mt-1.5 bg-slate-55 dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-800/60 overflow-hidden">
                                                            <button
                                                                type="button"
                                                                onClick={() => setOpenSourceId(openSourceId === m.id ? null : m.id)}
                                                                className="w-full px-3 py-1.5 flex items-center justify-between text-[9px] text-indigo-605 dark:text-indigo-400 font-bold hover:bg-slate-100 dark:hover:bg-slate-800/20 transition-colors cursor-pointer"
                                                            >
                                                                <span className="flex items-center gap-1">
                                                                    <Database size={9} /> Sources Referenced ({m.sources.length})
                                                                </span>
                                                                {openSourceId === m.id ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                                            </button>
                                                            
                                                            <AnimatePresence>
                                                                {openSourceId === m.id && (
                                                                    <motion.div
                                                                        initial={{ height: 0 }}
                                                                        animate={{ height: 'auto' }}
                                                                        exit={{ height: 0 }}
                                                                        className="overflow-hidden border-t border-slate-200 dark:border-slate-800"
                                                                    >
                                                                        <div className="p-2 space-y-1.5 max-h-40 overflow-y-auto">
                                                                            {m.sources.map((s, idx) => (
                                                                                <div key={idx} className="bg-white dark:bg-slate-950 p-2 rounded-lg border border-slate-100 dark:border-slate-900 space-y-1">
                                                                                    <div className="flex items-center justify-between text-[8px] font-black uppercase tracking-wider text-slate-405">
                                                                                        <span>{s.docType}</span>
                                                                                        <span>Ref: #{s.docId}</span>
                                                                                    </div>
                                                                                    <p className="text-[9.5px] text-slate-600 dark:text-slate-300 italic leading-normal font-mono">
                                                                                        &ldquo;{s.text.length > 120 ? s.text.substring(0, 120) + '...' : s.text}&rdquo;
                                                                                    </p>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </motion.div>
                                                                )}
                                                            </AnimatePresence>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}

                                            {isThinking && (
                                                <div className="flex items-center gap-1 text-[10px] text-indigo-500 dark:text-indigo-400 italic">
                                                    <Brain size={12} className="animate-spin" /> Analyzing trading records...
                                                </div>
                                            )}
                                        </div>

                                        {/* Quick Suggestion Chips */}
                                        {messages.length === 0 && hasScanned && (
                                            <div className="px-4 py-2 border-t border-slate-105 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/20 shrink-0">
                                                <p className="text-[8px] font-bold text-slate-450 dark:text-slate-550 uppercase tracking-widest mb-1.5">Suggested Queries</p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {[
                                                        'What is my win rate on BANKNIFTY?',
                                                        'Which setup gives me best returns?',
                                                        'Summarize my main mistakes.'
                                                    ].map((q) => (
                                                        <button
                                                            key={q}
                                                            onClick={() => handleSend(q)}
                                                            className="text-[9px] px-2.5 py-1 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-650 dark:text-slate-300 hover:border-indigo-500/50 hover:text-indigo-500 dark:hover:text-white transition-colors cursor-pointer"
                                                        >
                                                            {q}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Input Footer */}
                                        <div className="p-4 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/45 shrink-0">
                                            <form
                                                onSubmit={(e) => {
                                                    e.preventDefault();
                                                    handleSend();
                                                }}
                                                className="flex items-center gap-2"
                                            >
                                                <input
                                                    type="text"
                                                    value={input}
                                                    onChange={(e) => setInput(e.target.value)}
                                                    placeholder={
                                                        !hasScanned
                                                            ? 'Index database first...'
                                                            : 'Ask about your trading history...'
                                                    }
                                                    disabled={!hasScanned || isScanning}
                                                    className="flex-1 bg-white dark:bg-slate-905 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all disabled:opacity-40"
                                                />
                                                <MotionButton
                                                    type="submit"
                                                    size="sm"
                                                    disabled={!input.trim() || isScanning || !hasScanned}
                                                    loading={isScanning}
                                                    variant="primary"
                                                    icon={<Send size={12} aria-hidden="true" />}
                                                    className="p-2 rounded-xl"
                                                />
                                            </form>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Astro Config Modal */}
            <AstroConfigModal 
                isOpen={isAstroModalOpen}
                onClose={() => setIsAstroModalOpen(false)}
            />
        </>
    );
};
