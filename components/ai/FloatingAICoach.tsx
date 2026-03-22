import React, { useState, useEffect } from 'react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useShallow } from 'zustand/react/shallow';
import {
    Brain, X, TrendingUp, AlertTriangle, ChevronRight,
    Zap, Globe, Activity, RefreshCw, Loader2, CheckCircle2, PauseCircle, XCircle, Settings
} from 'lucide-react';
import { MarketPulseService, MarketPulse } from '../../services/MarketPulseService';
import { AmbientAIBrain, TabAIResult } from '../../services/AmbientAIBrain';
import { AstroPsychologyService, AstroStats } from '../../services/AstroPsychologyService';
import { Investment } from '../../types';
import { AstroConfigModal } from '../modals/AstroConfigModal';
import { useCosmicGovernorStore } from '../../store/cosmicGovernorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { ShieldAlert, IndianRupee, Quote } from 'lucide-react';

interface FloatingAICoachProps {
    onNavigate: (tab: string) => void;
    currentTab: string;
}

const signalConfig = {
    go: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500', label: 'GO', ring: 'ring-emerald-500/30' },
    caution: { icon: PauseCircle, color: 'text-amber-500', bg: 'bg-amber-500', label: 'CAUTION', ring: 'ring-amber-500/30' },
    stop: { icon: XCircle, color: 'text-rose-500', bg: 'bg-rose-500', label: 'STOP', ring: 'ring-rose-500/30' },
};

const niftyTrendIcon = (trend: MarketPulse['niftyTrend']) => {
    if (trend === 'bullish') return '↑';
    if (trend === 'bearish') return '↓';
    return '→';
};

export const FloatingAICoach: React.FC<FloatingAICoachProps> = ({
    onNavigate, currentTab
}) => {
    const investments = usePortfolioStore(useShallow(s => s.investments));
    const stats = usePortfolioStore(useShallow(s => s.stats));
    const totalNetWorth = String(stats?.totalCurrent || 0);
    const [isOpen, setIsOpen] = useState(false);
    const [pulse, setPulse] = useState<MarketPulse | null>(null);
    const [dashResult, setDashResult] = useState<TabAIResult | null>(null);
    const [astroStats, setAstroStats] = useState<AstroStats | null>(null);
    const [isLoadingPulse, setIsLoadingPulse] = useState(false);
    const [isAstroModalOpen, setIsAstroModalOpen] = useState(false);
    const [hasNewInsight, setHasNewInsight] = useState(false);

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
    }, []);

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
    }, [investments, totalNetWorth]);

    // Load astro psychology stats
    useEffect(() => {
        AstroPsychologyService.getTodayAstroStats().then(setAstroStats);
    }, [dashResult]); // Refresh when AI results refresh

    const handleOpen = () => {
        setIsOpen(true);
        setHasNewInsight(false);
    };

    const handleRefresh = () => {
        MarketPulseService.invalidateCache();
        AmbientAIBrain.invalidateTab('dashboard');
        setIsLoadingPulse(true);
        MarketPulseService.getPulse((fresh) => {
            setPulse(fresh);
            setIsLoadingPulse(false);
        });
        AmbientAIBrain.getInsights('dashboard', investments, totalNetWorth, setDashResult);
    };

    const tradeSignal = dashResult?.tradeSignal;
    const criticalInsight = dashResult?.insights.find(i => i.severity === 'critical');

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

    return (
        <>
            {/* Floating Button */}
            <div className="fixed bottom-6 right-6 z-[200] flex flex-col items-end gap-3 group pointer-events-none">
                {/* Pop-up chip when closed — shows most critical alert */}
                {!isOpen && (criticalInsight || isCircuitBreakerActive) && (
                    <button
                        onClick={handleOpen}
                        className={`flex items-center gap-2 bg-white dark:bg-slate-900 border rounded-full px-3 py-1.5 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none group-hover:pointer-events-auto ${
                            isCircuitBreakerActive ? 'border-rose-500 shadow-rose-500/10' : 'border-rose-200 dark:border-rose-800/50 shadow-rose-500/10'
                        }`}
                    >
                        {isCircuitBreakerActive ? <ShieldAlert size={12} className="text-rose-500" /> : <AlertTriangle size={12} className="text-rose-500" />}
                        <span className={`text-[10px] font-bold max-w-[160px] truncate ${isCircuitBreakerActive ? 'text-rose-600' : 'text-rose-600 dark:text-rose-400'}`}>
                            {isCircuitBreakerActive ? 'CIRCUIT BREAKER ACTIVE' : criticalInsight?.title}
                        </span>
                    </button>
                )}

                <button
                    onClick={handleOpen}
                    className={`relative w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg backdrop-blur-md border transition-all duration-300 hover:scale-110 active:scale-95 pointer-events-auto ${
                        isCircuitBreakerActive || tradeSignal === 'stop' || astroStats?.isInsideShadow
                        ? 'bg-gradient-to-br from-rose-500/60 to-rose-700/60 shadow-rose-500/10 border-rose-500/30'
                        : tradeSignal === 'caution'
                            ? 'bg-gradient-to-br from-amber-400/60 to-amber-600/60 shadow-amber-500/10 border-amber-500/30'
                            : 'bg-gradient-to-br from-slate-700/60 to-slate-900/60 shadow-slate-900/10 border-white/10'
                        }`}
                >
                    <Brain size={20} className="text-white" />
                    {(hasNewInsight || astroStats?.isInsideShadow) && (
                        <span className={`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full ring-2 ring-white dark:ring-slate-900 animate-ping opacity-0 group-hover:opacity-100 transition-opacity ${astroStats?.isInsideShadow ? 'bg-rose-500' : 'bg-indigo-500'}`} />
                    )}
                    {(hasNewInsight || astroStats?.isInsideShadow) && (
                        <span className={`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full ring-2 ring-white dark:ring-slate-900 opacity-0 group-hover:opacity-100 transition-opacity ${astroStats?.isInsideShadow ? 'bg-rose-500' : 'bg-indigo-500'}`} />
                    )}
                </button>
            </div>

            {/* Slide-Up Panel */}
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-[190] bg-slate-900/20 backdrop-blur-[2px]"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Panel */}
                    <div className="fixed bottom-24 right-6 z-[200] w-80 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl shadow-2xl shadow-slate-900/20 overflow-hidden animate-in slide-in-from-bottom-4 zoom-in-95 duration-300">

                        {/* Panel Header */}
                        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2.5">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-700 flex items-center justify-center">
                                    <Brain size={18} className="text-white" />
                                </div>
                                <div>
                                    <p className="text-sm font-black text-slate-900 dark:text-white"></p>
                                    <div className="flex items-center gap-1">
                                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider"></p>
                                        {dashResult?.model && (
                                            <>
                                                <span className="text-[8px] text-slate-300">•</span>
                                                <span className="text-[8px] font-black text-indigo-400/80 uppercase">{dashResult.model}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={handleRefresh}
                                    className="p-2 rounded-xl text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                                >
                                    <RefreshCw size={14} className={isLoadingPulse ? 'animate-spin' : ''} />
                                </button>
                                <button
                                    onClick={() => setIsAstroModalOpen(true)}
                                    className="p-2 rounded-xl text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                                >
                                    <Settings size={14} />
                                </button>
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        </div>

                        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">

                            {/* Circuit Breaker Active Warning */}
                            {isCircuitBreakerActive && (
                                <div className="p-3 rounded-2xl bg-rose-500 border border-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.3)] animate-pulse">
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
                                <div className={`p-3 rounded-2xl border flex items-center gap-3 ${tradeSignal === 'go'
                                    ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200/60 dark:border-emerald-800/40'
                                    : tradeSignal === 'caution'
                                        ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200/60 dark:border-amber-800/40'
                                        : 'bg-rose-50 dark:bg-rose-900/20 border-rose-200/60 dark:border-rose-800/40'
                                    }`}>
                                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 animate-pulse ${signalConfig[tradeSignal].bg}`} />
                                    <div>
                                        <p className={`text-[10px] font-black ${signalConfig[tradeSignal].color}`}>
                                            TODAY'S SIGNAL: {signalConfig[tradeSignal].label}
                                        </p>
                                        <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                                            {dashResult?.tradeSignalReason || 'Based on your behavior + market conditions.'}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Daily Directive & Identity Anchor */}
                            <div className="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200/60 dark:border-indigo-800/40">
                                <div className="flex items-center gap-1.5 mb-2">
                                    <Quote size={12} className="text-indigo-400" />
                                    <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">Identity Anchor</p>
                                </div>
                                <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100 italic leading-relaxed mb-2">
                                    "I am an Aquarian architect with a Mercury-sharp mind... I rely on architecture, not willpower."
                                </p>
                                <div className="h-px bg-indigo-200/40 dark:bg-indigo-800/40 my-2" />
                                <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-1">Daily Directive</p>
                                <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-100 leading-relaxed">
                                    {dashResult?.coachMessage || "Maintain Saturnian discipline in this Rahu-dominant window."}
                                </p>
                            </div>

                            {/* Market Flash */}
                            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/50">
                                <div className="flex items-center gap-1.5 mb-2">
                                    <Globe size={12} className="text-slate-400" />
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Market Flash</p>
                                    {isLoadingPulse && <Loader2 size={10} className="animate-spin text-slate-400" />}
                                </div>
                                {pulse ? (
                                    <div className="space-y-1.5">
                                        <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                                            {pulse.headline}
                                        </p>
                                        <div className="flex flex-wrap gap-1.5 mt-1">
                                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${pulse.niftyTrend === 'bullish'
                                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                                : pulse.niftyTrend === 'bearish'
                                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                                                    : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                                                }`}>
                                                Nifty {niftyTrendIcon(pulse.niftyTrend)} {pulse.niftyTrend}
                                            </span>
                                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${pulse.fiiFlow === 'buying'
                                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                                : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                                                }`}>
                                                FII {pulse.fiiFlow}
                                            </span>
                                            {pulse.hotSectors.slice(0, 2).map(s => (
                                                <span key={s} className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                                                    🔥 {s}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-[10px] text-slate-400">Loading market data...</p>
                                )}
                            </div>
                            
                            {/* Astro Posture */}
                            <div className="p-3 rounded-2xl bg-gradient-to-br from-indigo-500/5 to-purple-500/5 border border-indigo-200/40 dark:border-indigo-800/20 backdrop-blur-sm">
                                <div className="flex items-center justify-between mb-2">
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
                                        <div className="flex flex-col bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl">
                                            <div className="flex justify-between items-center">
                                                <span className="text-[8px] text-slate-500 font-bold uppercase">Trades Today</span>
                                                {dayName === 'Tuesday' && <span className="text-[7px] text-rose-500 font-black uppercase">TUE LAW</span>}
                                            </div>
                                            <span className={`text-xs font-black ${dailyTradeCount >= currentLimit ? 'text-rose-500' : 'text-slate-700 dark:text-slate-200'}`}>
                                                {dailyTradeCount} / {currentLimit}
                                            </span>
                                        </div>
                                        <div className="flex flex-col bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl">
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
                                    <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
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

                            {/* Top Insights */}
                            {dashResult?.insights.filter(i => i.severity !== 'info').slice(0, 2).map(insight => (
                                <div key={insight.id} className={`p-3 rounded-2xl border ${insight.severity === 'critical'
                                    ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200/60 dark:border-rose-800/40'
                                    : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200/60 dark:border-amber-800/40'
                                    }`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        <AlertTriangle size={12} className={insight.severity === 'critical' ? 'text-rose-500' : 'text-amber-500'} />
                                        <p className="text-[10px] font-black text-slate-700 dark:text-slate-200">{insight.title}</p>
                                    </div>
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">{insight.body}</p>
                                </div>
                            ))}

                            {/* Quick Actions */}
                            <div className="grid grid-cols-2 gap-2">
                                {[
                                    { label: 'View Journal', tab: 'Trading Journal', icon: Activity },
                                    { label: 'Open Advisor', tab: 'Growth Engine', icon: Brain },
                                ].map(({ label, tab, icon: Icon }) => (
                                    <button
                                        key={tab}
                                        onClick={() => { onNavigate(tab); setIsOpen(false); }}
                                        className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
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
                    </div>
                </>
            )}
            {/* Astro Config Modal */}
            <AstroConfigModal 
                isOpen={isAstroModalOpen}
                onClose={() => setIsAstroModalOpen(false)}
            />
        </>
    );
};
