import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    Activity, ShieldAlert, Target, TrendingUp, 
    TrendingDown, Zap, RefreshCw, ChevronUp, ChevronDown, 
    Share2, Info
} from 'lucide-react';
import { usePageVisibility } from '../../../contexts/PageVisibilityContext';
import { usePausedInterval } from '../../../hooks/usePausedInterval';
import { optionChainService, OptionChainSnapshot } from '../../../services/OptionChainService';
import { notificationService } from '../../../services/NotificationService';
import { useGlobalTickStore } from '../../../store/globalTickStore';
import { useOptionChainStream } from '../../../hooks/useOptionChainStream';
import { SkeletonLine } from '../../ui/Skeleton';
import { formatCurrency } from '../../../utils/helpers';
import { LiveConnectionBadge } from '../../shared/LiveConnectionBadge';

const SYMBOL_TO_UNDERLYING_KEY: Record<string, string> = {
    NIFTY: 'NSE_INDEX|Nifty 50',
    BANKNIFTY: 'NSE_INDEX|Nifty Bank'
};


interface OptionChainWidgetProps {
    symbol?: 'NIFTY' | 'BANKNIFTY';
}

const OptionChainWidget: React.FC<OptionChainWidgetProps> = ({ symbol = 'NIFTY' }) => {
    const [data, setData] = useState<OptionChainSnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
    const [isFallback, setIsFallback] = useState(false);
    const [isOiSummaryCollapsed, setIsOiSummaryCollapsed] = useState(true);
    const isVisible = usePageVisibility();

    // Active displayed strikes keys for websocket subscriptions
    const activeOptionKeys = useMemo(() => {
        if (!data || !data.strikes.length) return [];
        const keys: string[] = [];
        data.strikes.forEach(s => {
            if (s.CE?.instrumentKey) keys.push(s.CE.instrumentKey);
            if (s.PE?.instrumentKey) keys.push(s.PE.instrumentKey);
        });
        return keys;
    }, [data?.strikes]);

    const activeKeys = useMemo(() => {
        const keys = [...activeOptionKeys];
        const underlyingKey = SYMBOL_TO_UNDERLYING_KEY[symbol];
        if (underlyingKey) {
            keys.push(underlyingKey);
        }
        return keys;
    }, [activeOptionKeys, symbol]);

    const ticks = useGlobalTickStore((s) => s.ticks);
    useOptionChainStream(activeKeys);
    const isConnected = useGlobalTickStore((s) => s.isConnected);

    // Merge live ticks into option chain data structure
    useEffect(() => {
        if (Object.keys(ticks).length === 0 || !data) return;

        setData((prev) => {
            if (!prev) return null;
            const updated = { ...prev };
            let changed = false;

            const underlyingKey = SYMBOL_TO_UNDERLYING_KEY[symbol];
            if (underlyingKey && ticks[underlyingKey]) {
                const tick = ticks[underlyingKey];
                if (tick.ltp !== null && tick.ltp !== updated.underlyingValue) {
                    updated.underlyingValue = tick.ltp;
                    changed = true;
                }
            }

            const updatedStrikes = updated.strikes.map(s => {
                let strikeChanged = false;
                const newCE = s.CE ? { ...s.CE } : null;
                const newPE = s.PE ? { ...s.PE } : null;

                if (newCE?.instrumentKey && ticks[newCE.instrumentKey]) {
                    const tick = ticks[newCE.instrumentKey];
                    if (tick.ltp !== null && tick.ltp !== newCE.ltp) {
                        newCE.ltp = tick.ltp;
                        strikeChanged = true;
                    }
                    if (tick.volume !== null && tick.volume !== newCE.volume) {
                        newCE.volume = tick.volume;
                        strikeChanged = true;
                    }
                    if (tick.oi !== null && tick.oi !== newCE.oi) {
                        newCE.oi = tick.oi;
                        strikeChanged = true;
                    }
                    if (tick.iv !== null && tick.iv !== newCE.iv) {
                        newCE.iv = tick.iv;
                        strikeChanged = true;
                    }
                    if (tick.greeks) {
                        if (tick.greeks.delta !== undefined) newCE.delta = tick.greeks.delta;
                        if (tick.greeks.theta !== undefined) newCE.theta = tick.greeks.theta;
                        if (tick.greeks.gamma !== undefined) newCE.gamma = tick.greeks.gamma;
                        if (tick.greeks.vega !== undefined) newCE.vega = tick.greeks.vega;
                        strikeChanged = true;
                    }
                }

                if (newPE?.instrumentKey && ticks[newPE.instrumentKey]) {
                    const tick = ticks[newPE.instrumentKey];
                    if (tick.ltp !== null && tick.ltp !== newPE.ltp) {
                        newPE.ltp = tick.ltp;
                        strikeChanged = true;
                    }
                    if (tick.volume !== null && tick.volume !== newPE.volume) {
                        newPE.volume = tick.volume;
                        strikeChanged = true;
                    }
                    if (tick.oi !== null && tick.oi !== newPE.oi) {
                        newPE.oi = tick.oi;
                        strikeChanged = true;
                    }
                    if (tick.iv !== null && tick.iv !== newPE.iv) {
                        newPE.iv = tick.iv;
                        strikeChanged = true;
                    }
                    if (tick.greeks) {
                        if (tick.greeks.delta !== undefined) newPE.delta = tick.greeks.delta;
                        if (tick.greeks.theta !== undefined) newPE.theta = tick.greeks.theta;
                        if (tick.greeks.gamma !== undefined) newPE.gamma = tick.greeks.gamma;
                        if (tick.greeks.vega !== undefined) newPE.vega = tick.greeks.vega;
                        strikeChanged = true;
                    }
                }

                if (strikeChanged) {
                    changed = true;
                    return { ...s, CE: newCE, PE: newPE };
                }
                return s;
            });

            if (changed) {
                updated.strikes = updatedStrikes;
                let totalPutOI = 0;
                let totalCallOI = 0;
                updatedStrikes.forEach(s => {
                    if (s.CE) totalCallOI += s.CE.oi;
                    if (s.PE) totalPutOI += s.PE.oi;
                });
                updated.totalCallOI = totalCallOI;
                updated.totalPutOI = totalPutOI;
                updated.pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;
                updated.timestamp = new Date().toISOString();
                return updated;
            }
            return prev;
        });
    }, [ticks]);

    const refreshData = async () => {
        setLoading(true);
        const result = await optionChainService.fetchOptionChain(symbol);
        if (result) {
            setData(result);
            setLastRefresh(new Date());
            setIsFallback(optionChainService.getFallbackStatus());
        }
        setLoading(false);
    };

    const pushToN8N = async () => {
        if (!data) return;
        
        await notificationService.sendToNervousSystem('MARKET_SNAPSHOT', {
            source: 'OptionChainIntelligence',
            symbol: data.symbol,
            underlying: data.underlyingValue,
            pcr: data.pcr,
            maxPain: data.maxPain,
            timestamp: data.timestamp
        });
    };

    useEffect(() => {
        if (!isVisible) return;
        refreshData();
    }, [symbol, isVisible]);

    usePausedInterval(refreshData, isVisible ? 3 * 60 * 1000 : null, { runImmediately: false });

    // --- SMART SENTINEL: Auto-Sync to n8n every 10 mins ---
    usePausedInterval(() => {
        if (data && !loading && isVisible) {
            pushToN8N();
        }
    }, isVisible ? 10 * 60 * 1000 : null, { runImmediately: false });

    const pcrColor = useMemo(() => {
        if (!data) return 'text-slate-400';
        if (data.pcr > 1.2) return 'text-emerald-400';
        if (data.pcr < 0.7) return 'text-rose-400';
        return 'text-amber-400';
    }, [data]);

    // Get max OI for scaling the bars
    const maxOI = useMemo(() => {
        if (!data) return 0;
        let max = 0;
        data.strikes.forEach(s => {
            if (s.CE && s.CE.oi > max) max = s.CE.oi;
            if (s.PE && s.PE.oi > max) max = s.PE.oi;
        });
        return max;
    }, [data]);

    const oiSummary = useMemo(() => {
        if (!data || !data.strikes.length) return { maxPain: 0, dominantWall: 'Neutral', topStory: 'No data' };
        
        let maxCallOI = 0;
        let maxCallStrike = 0;
        let maxPutOI = 0;
        let maxPutStrike = 0;
        
        data.strikes.forEach(s => {
            if (s.CE && s.CE.oi > maxCallOI) {
                maxCallOI = s.CE.oi;
                maxCallStrike = s.strikePrice;
            }
            if (s.PE && s.PE.oi > maxPutOI) {
                maxPutOI = s.PE.oi;
                maxPutStrike = s.strikePrice;
            }
        });
        
        const dominantWall = maxCallOI > maxPutOI 
            ? `Call Wall at ₹${maxCallStrike} (Resistance)` 
            : `Put Wall at ₹${maxPutStrike} (Support)`;
            
        // Top story sentence
        let topStory = '';
        if (data.underlyingValue > maxCallStrike) {
            topStory = 'Spot has breached Call Wall — massive short covering risk.';
        } else if (data.underlyingValue < maxPutStrike) {
            topStory = 'Spot has breached Put Wall — panic selling / breakdown risk.';
        } else {
            topStory = `Trading inside walls: ₹${maxPutStrike} Support to ₹${maxCallStrike} Resistance.`;
        }
        
        return {
            maxPain: data.maxPain,
            dominantWall,
            topStory
        };
    }, [data]);

    if (!data && loading) {
        return (
            <div className="flex h-full min-h-[400px] items-center justify-center rounded-3xl border border-slate-800 bg-slate-900/50 flex-col gap-3">
                <SkeletonLine width="180px" height={16} rounded />
                <SkeletonLine width="120px" height={16} rounded />
            </div>
        );
    }

    return (
        <div className="group relative flex h-full flex-col overflow-hidden rounded-[24px] border border-slate-800 bg-slate-900/95 p-4 shadow-2xl">
            {/* Header / Stats Bar */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-indigo-500/10 p-2 text-indigo-400">
                        <Activity size={20} />
                    </div>
                    <div>
                        <h3 className="text-sm font-black uppercase tracking-widest text-white">{symbol} Option Chain</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Live Intel • {lastRefresh.toLocaleTimeString()}</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <p className="text-[9px] font-black uppercase text-slate-500 tracking-widest">PCR (OI)</p>
                        <p className={`text-lg font-black leading-none ${pcrColor}`}>{data?.pcr.toFixed(2)}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Max Pain</p>
                        <p className="text-lg font-black leading-none text-white">{data?.maxPain}</p>
                    </div>
                </div>
            </div>

            {/* Fallback Active warning banner */}
            <AnimatePresence>
                {isFallback && (
                    <motion.div
                        initial={{ height: 0, opacity: 0, marginBottom: 0 }}
                        animate={{ height: 'auto', opacity: 1, marginBottom: 16 }}
                        exit={{ height: 0, opacity: 0, marginBottom: 0 }}
                        transition={{ duration: 0.3, ease: 'easeInOut' }}
                        className="overflow-hidden"
                    >
                        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300">
                            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-400" />
                            <div className="text-[11px] leading-relaxed">
                                <span className="font-black uppercase tracking-wider block mb-0.5 text-amber-200">Stealth Fallback Active</span>
                                Primary NSE proxy failed. Routed options data query through the local FastAPI bridge (PNSEA fallback engine) to preserve data streams.
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Sub-Header: Price Info */}
            <div className="flex items-center justify-between mb-4 px-2 py-2 rounded-xl bg-slate-800/50 border border-slate-700/50">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400">SPOT</span>
                    <span className="text-xs font-black text-indigo-300">{formatCurrency(data?.underlyingValue || 0)}</span>
                </div>
                <div className="flex items-center gap-3">
                    <LiveConnectionBadge size="xs" />
                    <div className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${isFallback ? 'bg-amber-500' : 'bg-emerald-500'} ${isVisible ? 'animate-pulse' : ''}`}></span>
                        <span className="text-[9px] font-bold text-slate-500 uppercase">
                            {isFallback ? 'Stealth Fallback (PNSEA)' : 'Live Market Data'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Column Headers */}
            <div className="grid grid-cols-9 gap-1 mb-2 px-1 text-center">
                <div className="col-span-1 text-[8px] font-black uppercase text-slate-500">θ (Theta)</div>
                <div className="col-span-3 text-[9px] font-black uppercase text-rose-500/70 text-left pl-2">Call OI (Res)</div>
                <div className="text-[9px] font-black uppercase text-slate-400">Strike</div>
                <div className="col-span-3 text-[9px] font-black uppercase text-emerald-500/70 text-right pr-2">Put OI (Sup)</div>
                <div className="col-span-1 text-[8px] font-black uppercase text-slate-500">Δ (Delta)</div>
            </div>

            {/* The Chain Heatmap */}
            <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                {data?.strikes.map((s) => {
                    const isATM = Math.abs(s.strikePrice - (data.underlyingValue || 0)) < 25;
                    const isMaxPain = s.strikePrice === data.maxPain;
                    
                    return (
                        <div key={s.strikePrice} className={`grid grid-cols-9 gap-1 items-center py-1.5 px-1 rounded-lg transition-colors ${isATM ? 'bg-indigo-500/10 border border-indigo-500/20' : 'hover:bg-slate-800/40 border border-transparent'}`}>
                            {/* CALL THETA */}
                            <div className="col-span-1 text-[9px] font-bold text-rose-400/60 text-center">
                                {s.CE?.theta?.toFixed(1) || '-'}
                            </div>

                            {/* CALLS */}
                            <div className="col-span-3 h-4 flex items-center justify-end relative">
                                <div 
                                    className="h-full bg-gradient-to-l from-rose-500/40 to-rose-500/5 rounded-l-sm" 
                                    style={{ width: `${(s.CE?.oi || 0) / maxOI * 100}%` }}
                                />
                                <div className="absolute left-1 flex items-center gap-1">
                                    <span className="text-[10px] font-mono font-bold text-slate-300">
                                        {(s.CE?.oi || 0).toLocaleString()}
                                    </span>
                                    {s.CE?.oiVelocity !== undefined && s.CE.oiVelocity !== 0 && (
                                        <span className={`text-[8px] font-black ${s.CE.oiVelocity > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {s.CE.oiVelocity > 2 ? <Zap size={8} className="inline" /> : null}
                                            {s.CE.oiVelocity > 0 ? '+' : ''}{s.CE.oiVelocity.toFixed(0)}%
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* STRIKE */}
                            <div className="text-center">
                                <span className={`text-[11px] font-black ${isATM ? 'text-indigo-400' : isMaxPain ? 'text-amber-400 underline underline-offset-4' : 'text-slate-400'}`}>
                                    {s.strikePrice}
                                </span>
                            </div>

                            {/* PUTS */}
                            <div className="col-span-3 h-4 flex items-center justify-start relative">
                                <div 
                                    className="h-full bg-gradient-to-r from-emerald-500/40 to-emerald-500/5 rounded-r-sm" 
                                    style={{ width: `${(s.PE?.oi || 0) / maxOI * 100}%` }}
                                />
                                <div className="absolute right-1 flex items-center gap-1">
                                    {s.PE?.oiVelocity !== undefined && s.PE.oiVelocity !== 0 && (
                                        <span className={`text-[8px] font-black ${s.PE.oiVelocity > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {s.PE.oiVelocity > 0 ? '+' : ''}{s.PE.oiVelocity.toFixed(0)}%
                                            {s.PE.oiVelocity > 2 ? <Zap size={8} className="inline" /> : null}
                                        </span>
                                    )}
                                    <span className="text-[10px] font-mono font-bold text-slate-300">
                                        {(s.PE?.oi || 0).toLocaleString()}
                                    </span>
                                </div>
                            </div>

                            {/* PUT DELTA */}
                            <div className="col-span-1 text-[9px] font-bold text-emerald-400/60 text-center">
                                {s.PE?.delta?.toFixed(2) || '-'}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Collapsible OI Summary Footer */}
            <div className="mt-3 bg-slate-950/40 border border-slate-850 rounded-xl overflow-hidden">
                <button 
                    onClick={() => setIsOiSummaryCollapsed(!isOiSummaryCollapsed)}
                    className="w-full flex justify-between items-center px-3 py-2 text-[9px] font-black uppercase text-slate-400 hover:bg-slate-800/40 transition-colors"
                >
                    <span className="tracking-wider flex items-center gap-1">
                        OI Summary Radar
                    </span>
                    <div className="flex items-center gap-2 font-mono">
                        <span className="text-indigo-400">Max Pain: {formatCurrency(oiSummary.maxPain || 0)}</span>
                        {isOiSummaryCollapsed ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
                    </div>
                </button>
                <AnimatePresence>
                    {!isOiSummaryCollapsed && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="px-3 pb-3 border-t border-slate-900/60 pt-2 space-y-1 text-left"
                        >
                            <div className="text-[10px] text-slate-300 font-bold">
                                {oiSummary.dominantWall}
                            </div>
                            <p className="text-[9px] text-slate-500 font-medium italic">
                                {oiSummary.topStory}
                            </p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Bottom Insight */}
            <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button 
                        onClick={pushToN8N}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 transition-colors border border-indigo-500/20"
                        title="Push to n8n Nervous System"
                    >
                        <Share2 size={12} />
                        <span className="text-[10px] font-black uppercase">Sync n8n</span>
                    </button>
                    <button 
                        onClick={refreshData}
                        className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 transition-colors"
                    >
                        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>

            </div>
        </div>
    );
};

export default OptionChainWidget;
