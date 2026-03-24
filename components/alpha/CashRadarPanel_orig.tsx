import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { StockData, AdvancedFilters } from '../../hooks/alpha/useAlphaEngineState';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, TrendingDown, Clock, ShieldAlert, CheckCircle2, XCircle, Info, ArrowUpRight, Award, ShieldCheck, Landmark } from 'lucide-react';
import { formatINR, formatPercentage } from '../../utils/indianFormatter';
import { openTradingView } from '../../utils/navigation';
import { upstoxMarketDataService } from '../../services/UpstoxMarketDataService';
import { ShadowScreenerService } from '../../services/alpha/ShadowScreenerService';
import { AlphaVerdictPanel } from './AlphaVerdictPanel';
import { formatNumberIndian } from '../../utils/helpers';
import { VerdictEngine } from '../../services/alpha/VerdictEngine';
import { score as convictionScore, buildInputsFromStock, type ConvictionScore } from '../../services/alpha/ConvictionEngine';
import { evaluateStrategyScore, detectBestStrategy, STRATEGY_CONFIGS, type StrategyId } from '../../services/alpha/StrategyEngine';
import { mceOrchestrator } from '../../services/mce/orchestrator';
import { ConvictionCardPanel, type ConvictionCard } from './ConvictionCardPanel';
import { CONDITIONS } from './indicator_constants';

interface CashRadarPanelProps {
    pulseStocks: StockData[];
    autoRefresh?: boolean;
    refreshTrigger?: number;
    isVisible?: boolean;
    openLowStocks?: StockData[];
    stockezeeToken?: string;
    orbDataCache?: Record<string, any[]>;
    dailyCandleData?: any;
    valuationDataCache?: Record<string, any[]>;
    shareholdingDataCache?: Record<string, any[]>;
    qualityDataCache?: Record<string, any[]>;
    boosterStocksList?: any[];
    historicalDataCache?: Record<string, any[]>;
    fiiDiiPulseData?: any[];
    derivativeSummaryData?: any[];
    advancedFilters?: AdvancedFilters;
    setAdvancedFilters?: React.Dispatch<React.SetStateAction<AdvancedFilters>>;
    volumeAverages?: Record<string, number>;
    setVolumeAverages?: React.Dispatch<React.SetStateAction<Record<string, number>>>;
    searchTerm?: string;
    oreMap?: Record<string, any>;
    cvdMap?: Record<string, number>;
    rsMap?: Record<string, any>;
    shareholdingMap?: Record<string, any>;
    oiSignalMap?: Record<string, any>;
    indicatorMatches?: Record<string, string[]>;
}

interface UCCandidate {
    stock: StockData;
    score: number;
    passingChecks: number;
    ucPrice: number;
    ucDistance: number;
    o2c: number;
    openingGap: number;
    dayExtreme: number;
    isSmall: boolean;
    isExhausted: boolean;
    isTrapRisk: boolean;
    isORBLowPreservedProxy: boolean;
    flags: {
        changeOk: boolean;
        o2cOk: boolean;
        atHOD: boolean;
        orbLowOk: boolean;
        notExhausted: boolean;
        noTrap: boolean;
        strengthOk: boolean;
        smallCapBonus: boolean;
        gapBonus: boolean;
    };
}

interface SnapbackCandidate {
    stock: StockData;
    score: number;
    passingChecks: number;
    emaTarget: number;
    potentialReturn: number;
    stopLoss: number;
    o2c: number;
    openingGap: number;
    dayExtreme: number;
    isExhausted: boolean;
    flags: {
        changeOk: boolean;
        atHOD: boolean;
        gapOk: boolean;
        o2cOk: boolean;
        exhausted: boolean;
    };
}

interface InstitutionalCandidate {
    stock: StockData;
    score: number;
    signals: {
        isOpenLow: boolean;
        isOrbBullish: boolean;
        isVolumeSurge: boolean;
        isVwapAboveOpen: boolean;
        isMidLarge: boolean;
        isMarketCapLimit: boolean;
        isChangeAbove5: boolean;
    };
    rvol: number;
    vwapDistance: number;
}

const SCORE_THEMES = {
    high: {
        bg: 'from-indigo-950/40 to-slate-900/40 border-indigo-500/30 hover:border-indigo-500/60 hover:shadow-[0_0_20px_rgba(99,102,241,0.25)]',
        badgeBg: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400',
        text: 'text-indigo-400',
        progress: 'from-indigo-500 via-purple-500 to-indigo-400',
    },
    medium: {
        bg: 'from-emerald-950/30 to-slate-900/40 border-emerald-500/30 hover:border-emerald-500/60 hover:shadow-[0_0_20px_rgba(16,185,129,0.25)]',
        badgeBg: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
        text: 'text-emerald-400',
        progress: 'from-emerald-500 via-teal-500 to-emerald-400',
    },
    low: {
        bg: 'from-slate-900/40 to-slate-950/40 border-slate-800 hover:border-slate-700 hover:shadow-none',
        badgeBg: 'bg-slate-800 border-slate-700 text-slate-400',
        text: 'text-slate-400',
        progress: 'from-slate-600 to-slate-400',
    },
};

const MetricBadge = ({ label, value, valueClass = 'text-white' }: { label: string; value: string | number; valueClass?: string }) => (
    <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-1.5 flex flex-col justify-between h-full min-h-[52px] items-center text-center">
        <span className="text-[7.5px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5 leading-tight truncate w-full">{label}</span>
        <span className={`text-[16px] font-mono font-bold ${valueClass} truncate w-full`}>{value}</span>
    </div>
);

const ChecklistBadge = ({ label, pass }: { label: string; pass: boolean }) => (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[8.5px] font-black uppercase tracking-wider transition-all ${pass
            ? 'bg-emerald-500/5 border-emerald-500/15 text-emerald-400'
            : 'bg-slate-950/50 border-slate-900 text-slate-700'
        }`}>
        {pass ? <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" /> : <XCircle className="w-3 h-3 text-slate-750 shrink-0" />}
        <span className="truncate">{label}</span>
    </div>
);

const getRvolColorClass = (rvol: number, vol: number, ltp: number) => {
    const turnover = ltp * vol;
    if (vol < 50000 || turnover < 2500000) {
        return 'text-rose-450 font-bold';
    }
    if (rvol >= 2.0 && vol >= 100000) {
        return 'text-emerald-400 font-bold';
    }
    if (rvol >= 1.0) {
        return 'text-amber-400 font-bold';
    }
    return 'text-white';
};

export const CashRadarPanel: React.FC<CashRadarPanelProps> = ({
    pulseStocks = [],
    autoRefresh = false,
    refreshTrigger = 0,
    isVisible = true,
    openLowStocks = [],
    stockezeeToken = '',
    orbDataCache = {},
    dailyCandleData = null,
    valuationDataCache = {},
    shareholdingDataCache = {},
    qualityDataCache = {},
    boosterStocksList = [],
    historicalDataCache = {},
    fiiDiiPulseData = [],
    derivativeSummaryData = [],
    advancedFilters,
    setAdvancedFilters,
    volumeAverages = {},
    setVolumeAverages,
    searchTerm = '',
    oreMap = {},
    cvdMap = {},
    rsMap = {},
    shareholdingMap = {},
    oiSignalMap = {},
    indicatorMatches = {}
}) => {
     const [activeTab, setActiveTab] = useState<'circuit' | 'snapback' | 'pre_uc_setup' | 'ema_snapback_scalp' | 'morning_continuation' | 'institutional' | 'conviction'>('circuit');
    const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
    const [verdictSymbol, setVerdictSymbol] = useState<string | null>(null);
    // CC68: conviction cards computed alongside the existing pipeline.
    const [convictionCards, setConvictionCards] = useState<ConvictionCard[]>([]);

    // --- Advanced Live Feeds State ---
    const [liveQuotes, setLiveQuotes] = useState<Record<string, any>>({});
    const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);

    const strategyCache = React.useRef<Record<string, { result: any; expiresAt: number }>>({});
    const getCachedBestStrategy = React.useCallback((stock: any, inputs: any) => {
        const now = Date.now();
        const cached = strategyCache.current[stock.Symbol || stock.symbol];
        if (cached && now < cached.expiresAt) {
            return cached.result;
        }
        const result = evaluateStrategyScore(stock, inputs.strategyId, inputs);
        strategyCache.current[stock.Symbol || stock.symbol] = {
            result,
            expiresAt: now + 30000 // 30-second TTL
        };
        return result;
    }, []);

    // Local helper to map a cash pulse stock to standard StockData structure
    const pulseToStockData = React.useCallback((pulse: any): import('../../services/AlphaEngineService').StockData => {
        return {
            symbol: pulse.Symbol || '',
            companyName: pulse.CompanyName || '',
            sector: pulse.Sector || '',
            previousClose: pulse.prevClose || 0,
            openPrice: pulse.Open || pulse.todayOpen || 0,
            high: pulse.High || 0,
            low: pulse.Low || 0,
            lastPrice: pulse.LTP || 0,
            percentChange: pulse.Change || 0,
            volume: pulse.Volume || 0,
            value: pulse.Value || 0,
            gFactor: pulse.gFactor || 0,
            rFactor: pulse.rFactor || 0,
            upperCircuit: pulse.upperCircuit,
            lowerCircuit: pulse.lowerCircuit,
            isTrapRisk: pulse.isTrapRisk || false,
            isExhausted: pulse.isExhausted || false,
            dailyPattern: pulse.dailyPattern,
            weeklyPattern: pulse.weeklyPattern,
            candleBuffer: pulse.candleBuffer
        } as any;
    }, []);

    const StrategyCandidateCard = ({
        cand,
        idx,
        isExpanded,
        onToggleExpand
    }: {
        cand: { stock: any; res: any };
        idx: number;
        isExpanded: boolean;
        onToggleExpand: () => void;
    }) => {
        const stopLossVal = cand.res.stopLoss;
        const targetVal = cand.res.target;
        const entryTriggerVal = cand.res.entryTrigger;
        const strategyConfig = STRATEGY_CONFIGS[cand.res.strategy as StrategyId];
        const badgeLabel = strategyConfig?.badgeLabel || 'STRATEGY';
        const color = strategyConfig?.color || '#6366F1';
        const adv = volumeAverages[cand.stock.Symbol] || 0;
        const todayVol = liveQuotes[cand.stock.Symbol]?.volume || cand.stock.Volume || 0;
        const rvol = adv > 0 ? todayVol / adv : 1.0;
        const theme = getScoreTheme(cand.res.score, 100);

        // Helper to check if a condition matches in indicatorMatches (supports both Symbol->Cond[] and Cond->Symbol[] formats)
        const isConditionMatched = (symbol: string, conditionId: string): boolean => {
            const symUpper = symbol.toUpperCase();
            const condLower = conditionId;
            
            const symMatch = indicatorMatches[symUpper];
            if (Array.isArray(symMatch) && symMatch.includes(condLower)) {
                return true;
            }
            
            const condMatch = indicatorMatches[condLower];
            if (Array.isArray(condMatch) && condMatch.map(s => s.toUpperCase()).includes(symUpper)) {
                return true;
            }
            
            return false;
        };

        return (
            <div
                className="rounded-2xl border bg-gradient-to-br from-slate-900/90 to-slate-950/95 border-slate-800/80 overflow-hidden shadow-lg hover:shadow-indigo-500/5 transition-all duration-300 cursor-pointer"
                onClick={onToggleExpand}
            >
                {/* Header Row */}
                <div className="p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="text-slate-500 font-bold text-sm w-6 font-mono">#{String(idx + 1).padStart(2, '0')}</div>
                        <div>
                            <span className="text-[14.5px] font-bold text-white tracking-normal">{cand.stock.Symbol}</span>
                            <span className="text-[11px] font-medium text-slate-400 truncate block max-w-[145px] mt-0.5">
                                {cand.stock.CompanyName || 'Cash Segment'}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-700/50 bg-slate-800/80 shrink-0 shadow-inner">
                            <span className="text-[14px] font-black text-indigo-400">{cand.res.score}</span>
                        </div>

                        <div className="text-right">
                            <div className="text-[13px] font-mono font-bold text-white">{formatINR(cand.stock.LTP || 0)}</div>
                            <div className={`text-[11.5px] font-bold ${cand.stock.Change >= 0 ? 'text-emerald-400' : 'text-rose-450'} flex items-center justify-end`}>
                                <ArrowUpRight className={`w-3.5 h-3.5 ${cand.stock.Change >= 0 ? 'text-emerald-400' : 'text-rose-450'} mr-0.5 shrink-0`} />
                                {formatPercentage(cand.stock.Change)}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Badges Row */}
                <div className="px-4 pb-2.5 flex items-center gap-1.5 flex-wrap">
                    <AlphaVerdictPanel
                        symbol={cand.stock.Symbol}
                        result={getVerdictResult(cand.stock.Symbol, cand.res.strategy === 'ema_snapback')}
                        variant="badge"
                        onOpenDetail={() => setVerdictSymbol(cand.stock.Symbol)}
                    />
                    <span
                        className="text-[9.5px] font-black px-2 py-0.5 rounded border uppercase tracking-wide"
                        style={{ backgroundColor: `${color}15`, borderColor: `${color}30`, color: color }}
                    >
                        {badgeLabel}
                    </span>
                    <span className="text-[9.5px] font-bold px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 uppercase tracking-wide">
                        P0 PASS Γ£ô
                    </span>
                </div>

                {/* Mini Details Grid - Reduced title size, increased value size */}
                <div className="px-4 py-3 grid grid-cols-3 gap-2 border-t border-slate-900/60 bg-slate-950/40 text-[10px]">
                    <div className="bg-slate-900/80 p-1.5 rounded-lg border border-slate-850 flex flex-col justify-between items-center text-center min-h-[52px]">
                        <span className="text-[7.5px] text-slate-500 uppercase font-black block mb-0.5 leading-tight w-full">Target</span>
                        <span className="text-emerald-400 font-bold font-mono text-[15px] truncate block leading-none w-full">{targetVal}</span>
                    </div>
                    <div className="bg-slate-900/80 p-1.5 rounded-lg border border-slate-850 flex flex-col justify-between items-center text-center min-h-[52px]">
                        <span className="text-[7.5px] text-slate-500 uppercase font-black block mb-0.5 leading-tight w-full">Stop Loss</span>
                        <span className="text-rose-400 font-bold font-mono text-[15px] truncate block leading-none w-full">{stopLossVal}</span>
                    </div>
                    <div className="bg-slate-900/80 p-1.5 rounded-lg border border-slate-850 flex flex-col justify-between items-center text-center min-h-[52px]">
                        <span className="text-[7.5px] text-slate-500 uppercase font-black block mb-0.5 leading-tight w-full">RVOL</span>
                        <span className={`font-bold font-mono text-[15px] truncate block leading-none w-full ${getRvolColorClass(rvol, todayVol, cand.stock.LTP)}`}>{rvol.toFixed(1)}x</span>
                    </div>
                </div>

                {/* Expanded Content */}
                <AnimatePresence>
                    {isExpanded && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="border-t border-slate-900 bg-slate-950/60 overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="p-4 space-y-3 text-[11px]">
                                {/* Trigger */}
                                <div className="bg-slate-900/40 p-2.5 rounded-xl border border-slate-900/85">
                                    <span className="text-[8px] text-slate-500 font-black uppercase tracking-wider block mb-1">Entry Trigger Condition</span>
                                    <p className="text-white font-semibold text-xs leading-normal">{entryTriggerVal}</p>
                                </div>

                                {/* P0 Checklist */}
                                <div className="space-y-1">
                                    <span className="text-[8px] text-slate-500 font-black uppercase tracking-wider">P0 Gates Verification</span>
                                    <div className="grid grid-cols-2 gap-1.5">
                                        {strategyConfig?.p0Checks.map((check: any) => {
                                            const pass = !cand.res.p0Failures?.some((f: string) => f.toLowerCase().includes(check.id.toLowerCase()));
                                            return (
                                                <ChecklistBadge key={check.id} label={check.label} pass={pass} />
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Power-20 Technical Indicators checklist using indicatorMatches */}
                                <div className="space-y-1">
                                    <span className="text-[8px] text-slate-500 font-black uppercase tracking-wider">Warmed Technical Indicators (Power-20)</span>
                                    <div className="grid grid-cols-2 gap-1.5">
                                        {strategyConfig?.power20.slice(0, 8).map((condId: string) => {
                                            const pass = isConditionMatched(cand.stock.Symbol, condId);
                                            let label = condId.replace(/_/g, ' ');
                                            for (const groups of Object.values(CONDITIONS)) {
                                                for (const conds of Object.values(groups)) {
                                                    const found = conds.find(c => c.id === condId);
                                                    if (found) {
                                                        label = found.label;
                                                        break;
                                                    }
                                                }
                                            }
                                            return (
                                                <ChecklistBadge key={condId} label={label} pass={pass} />
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Learning Section */}
                                <div className="p-3 bg-indigo-500/5 border border-indigo-500/15 rounded-xl space-y-1.5">
                                    <span className="text-[8.5px] text-indigo-400 font-black uppercase tracking-wider block">Why does this setup fire?</span>
                                    <ul className="list-disc pl-4 text-slate-450 space-y-1 text-[10px] leading-relaxed font-sans">
                                        {strategyConfig?.learningNotes.map((note: any, nIdx: any) => (
                                            <li key={nIdx}>{note}</li>
                                        ))}
                                    </ul>
                                </div>

                                <button
                                    onClick={() => openTradingView(cand.stock.Symbol)}
                                    className="w-full py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-[10px] font-black text-indigo-400 hover:text-white uppercase tracking-widest transition-all"
                                >
                                    Open TradingView Chart
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        );
    };

    // CC68.17: Two paths so the panel is NEVER stuck on the empty message.
    //
    //  (A) Synchronous fall-back ΓÇö runs the lightweight ConvictionEngine
    //      over the cash hook fields (RVOL, G, R, O2C, day-extreme, sector
    //      score). NO network calls. Returns a usable ENTRY/WATCH/SKIP
    //      verdict in <1 frame. This is what the user sees first.
    //
    //  (B) Async MCS upgrade ΓÇö kicks off the MCE orchestrator (3s dedupe)
    //      to enrich the synchronous verdict with MCS sub-scores (Group F).
    //      Catches every error so one bad symbol can't kill the whole panel.
    //
    // CC68.12: cash-only stocks (CEMPRO, BSL, AARON, ΓÇª) have no option
    // chain. /api/upstox/option-chain returns 404, the orchestrator returns
    // null, the ConvictionEngine marks Group F as "data unavailable" but
    // does NOT kill the card.
    useEffect(() => {
        if (pulseStocks.length === 0) {
            setConvictionCards([]);
            return;
        }

        // ΓöÇΓöÇ (A) Synchronous pass ΓÇö instant verdict, no network ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
        const syncCards: ConvictionCard[] = pulseStocks.slice(0, 30).map((ps) => {
            const sym = (ps as any).Symbol ?? (ps as any).symbol ?? '';
            const mapped = {
                symbol: sym,
                sector: (ps as any).Sector ?? (ps as any).sector ?? '',
                lastPrice: (ps as any).LTP ?? (ps as any).lastPrice ?? 0,
                previousClose: (ps as any).prevClose ?? 0,
                openPrice: (ps as any).Open ?? (ps as any).openPrice ?? 0,
                high: (ps as any).High ?? (ps as any).high ?? 0,
                low: (ps as any).Low ?? (ps as any).low ?? 0,
                percentChange: (ps as any).Change ?? (ps as any).percentChange ?? 0,
                volume: (ps as any).Volume ?? (ps as any).volume ?? 0,
                value: (ps as any).Value ?? (ps as any).value ?? 0,
                gFactor: (ps as any).gFactor ?? 0,
                rFactor: (ps as any).rFactor ?? 0,
                apexSignal: (ps as any).apexSignal,
                signal: (ps as any).signal ?? ((ps as any).Change >= 0 ? 'Up' : 'Down') as 'Up' | 'Down',
                openingGapPct: (ps as any).openingGapPct ?? 0,
                dayExtremeScore: (ps as any).dayExtremeScore ?? 0,
                isORBLowPreservedProxy: (ps as any).isORBLowPreservedProxy ?? false,
                isORBHighPreservedProxy: (ps as any).isORBHighPreservedProxy ?? false,
                openChangePct: (ps as any).openChangePct ?? 0,
                isExhausted: (ps as any).isExhausted,
                isTrapRisk: (ps as any).isTrapRisk,
            } as import('../../services/AlphaEngineService').StockData;
            // CC68.21: per-stock signals that ACTUALLY vary by symbol.
            // Without these, every card looks identical because all the
            // upstream data is `null` and the score collapses to the
            // neutral baseline of ~25-30/100. Volume / change / direction
            // come straight from the StockeZee row. ORB / RVOL proxy come
            // from the live row's open-vs-LTP and volume vs market-cap.
            const ltp = mapped.lastPrice || 0;
            const op = mapped.openPrice || 0;
            const dirSign = mapped.signal === 'Up' ? 1 : -1;
            const o2cPct = op > 0 ? ((ltp - op) / op) * 100 * dirSign : 0;
            // RVOL proxy: % of avg daily volume (assumed avg = marketCap * 0.001
            // is a known false; we use a simpler proxy ΓÇö turnover in Cr).
            const turnoverCr = (ltp * (mapped.volume || 0)) / 1e7;
            const rvolProxy = Math.min(3, Math.max(0.5, turnoverCr / 50));
            // ORB proxy: |open - LTP| / open > 0.4% within 15m of open
            const orbProxy = op > 0 && ltp > 0 && Math.abs((ltp - op) / op) * 100 < 0.4;
            // Synchronous score with mcs=null ΓÇö the engine handles it
            // (Group F = 5 unavailable sub-scores, no kill).
            const cs = convictionScore(buildInputsFromStock(mapped, {
                mcs: null,
                direction: mapped.signal === 'Up' ? 'CALL' : 'PUT',
                rvol: rvolProxy,
                o2cOverride: o2cPct,
                orbPreserved: orbProxy ? true : null,
            } as any));
            return {
                symbol: sym,
                companyName: '',
                ltp: mapped.lastPrice,
                change: mapped.percentChange,
                sector: mapped.sector,
                conviction: cs,
            };
        });
        setConvictionCards(syncCards);

        // ΓöÇΓöÇ (B) Async MCS upgrade ΓÇö re-render with Group F enriched ΓöÇΓöÇΓöÇΓöÇ
        let cancelled = false;
        (async () => {
            const enriched: ConvictionCard[] = [];
            await Promise.all(
                syncCards.map(async (card) => {
                    let mcsSnap: Awaited<ReturnType<typeof mceOrchestrator.score>> = null;
                    try {
                        mcsSnap = await mceOrchestrator.score(card.symbol, 'PRE_ENTRY');
                    } catch {
                        mcsSnap = null;
                    }
                    if (cancelled) return;
                    // Rebuild inputs with MCS now; re-score. The first
                    // synchronous pass already established the verdict ΓÇö
                    // this only fills in Group F sub-scores.
                    const mapped = {
                        symbol: card.symbol,
                        sector: card.sector ?? '',
                        lastPrice: card.ltp ?? 0,
                        percentChange: card.change ?? 0,
                        signal: (card.change ?? 0) >= 0 ? 'Up' : 'Down',
                    } as any;
                    const cs = convictionScore(buildInputsFromStock(mapped as any, {
                        mcs: mcsSnap,
                        direction: mapped.signal === 'Up' ? 'CALL' : 'PUT',
                    }));
                    enriched.push({ ...card, conviction: cs });
                })
            );
            if (!cancelled) setConvictionCards(enriched);
        })();
        return () => { cancelled = true; };
    }, [pulseStocks, refreshTrigger]);

    // --- Institutional Radar State ---
    const [orbData, setOrbData] = useState<Record<string, boolean>>({});
    const [isFetchingOrb, setIsFetchingOrb] = useState(false);

    // --- Unified Verdict Computation Helper ---
    const getVerdictResult = (symbol: string, isBearishSetup: boolean) => {
        const sym = symbol.toUpperCase();
        return VerdictEngine.compute(
            sym,
            {
                orbDataCache,
                dailyCandleData,
                valuationDataCache,
                shareholdingDataCache,
                qualityDataCache,
                boosterStocksList,
                historicalDataCache,
                fiiDiiPulseData,
                derivativeSummaryData
            },
            liveQuotes,
            volumeAverages,
            isBearishSetup,
            {
                oreScore: oreMap?.[sym]?.ore_score,
                oreDirection: oreMap?.[sym]?.direction,
                cvd: cvdMap?.[sym],
                oiSignal: oiSignalMap?.[sym],
                rsRank: rsMap?.[sym]?.rs_rank,
                rsCategory: rsMap?.[sym]?.category,
                fiiVelocity: shareholdingMap?.[sym]?.fii_velocity,
                valueZoneFlag: shareholdingMap?.[sym]?.accumulation_flag === 'ACCUMULATING'
            }
        );
    };

    // --- Liquidity & Advanced Filters ---
    const filteredStocks = useMemo(() => {
        if (!pulseStocks || pulseStocks.length === 0) return [];
        const isTargetActive = advancedFilters?.applyToCardView ?? true;
        if (!isTargetActive) return [...pulseStocks];

        return pulseStocks.filter(stock => {
            const ltp = stock.LTP || 0;
            const vol = stock.Volume || 0;
            const change = stock.Change || 0;
            const score = stock["Strength Factor"] || 0;
            const mcap = stock.MarketCap || 0;
            const sector = stock.Sector || '';
            const cap = stock.CapCategory || '';
            const adv = volumeAverages[stock.Symbol] || 0;
            const rvol = adv > 0 ? vol / adv : null;

            // 1. Exclude Penny Traps & Extremely Illiquid/New Listings
            if (advancedFilters?.excludePennyTraps) {
                const turnover = ltp * vol;
                const isSmall = cap === 'Small' || (!['Large', 'Mid'].includes(cap));
                if (vol > 0 && vol < 50000) return false;
                if (turnover > 0 && turnover < 2500000) return false;
                if (isSmall && vol > 0 && vol < 100000) return false;
                if (stock.Symbol.includes('-BE') || stock.Symbol.includes('-BZ') || stock.Symbol.includes('-Z')) return false;
                
                // Exclude if ADV is extremely low (< 20,000) once averages are loaded
                if (Object.keys(volumeAverages).length > 0 && stock.Symbol in volumeAverages) {
                    if (adv < 20000) return false;
                }
            }

            // 2. Numeric Ranges
            if (advancedFilters?.minPrice !== null && advancedFilters?.minPrice !== undefined && ltp < advancedFilters.minPrice) return false;
            if (advancedFilters?.maxPrice !== null && advancedFilters?.maxPrice !== undefined && ltp > advancedFilters.maxPrice) return false;
            
            if (advancedFilters?.minVolume !== null && advancedFilters?.minVolume !== undefined && vol < advancedFilters.minVolume) return false;
            if (advancedFilters?.maxVolume !== null && advancedFilters?.maxVolume !== undefined && vol > advancedFilters.maxVolume) return false;

            if (advancedFilters?.minChange !== null && advancedFilters?.minChange !== undefined && change < advancedFilters.minChange) return false;
            if (advancedFilters?.maxChange !== null && advancedFilters?.maxChange !== undefined && change > advancedFilters.maxChange) return false;

            if (advancedFilters?.minScore !== null && advancedFilters?.minScore !== undefined && score < advancedFilters.minScore) return false;
            if (advancedFilters?.maxScore !== null && advancedFilters?.maxScore !== undefined && score > advancedFilters.maxScore) return false;

            if (advancedFilters?.minMcap !== null && advancedFilters?.minMcap !== undefined && mcap < advancedFilters.minMcap) return false;
            if (advancedFilters?.maxMcap !== null && advancedFilters?.maxMcap !== undefined && mcap > advancedFilters.maxMcap) return false;

            if (advancedFilters?.minRvol !== null && advancedFilters?.minRvol !== undefined) {
                if (rvol === null || rvol < advancedFilters.minRvol) return false;
            }
            if (advancedFilters?.maxRvol !== null && advancedFilters?.maxRvol !== undefined) {
                if (rvol === null || rvol > advancedFilters.maxRvol) return false;
            }

            // Turnover (LTP * Volume) / 100,000 to get in Lakhs
            const turnoverLakhs = (ltp * vol) / 100000;
            if (advancedFilters?.minTurnover !== null && advancedFilters?.minTurnover !== undefined && turnoverLakhs < advancedFilters.minTurnover) return false;
            if (advancedFilters?.maxTurnover !== null && advancedFilters?.maxTurnover !== undefined && turnoverLakhs > advancedFilters.maxTurnover) return false;

            // Intraday Spread / Range ((High - Low) / Low * 100)
            const high = stock.High || 0;
            const low = stock.Low || 0;
            const intradayRange = low > 0 ? ((high - low) / low) * 100 : 0;
            if (advancedFilters?.minIntradayRange !== null && advancedFilters?.minIntradayRange !== undefined && (low <= 0 || intradayRange < advancedFilters.minIntradayRange)) return false;
            if (advancedFilters?.maxIntradayRange !== null && advancedFilters?.maxIntradayRange !== undefined && (low <= 0 || intradayRange > advancedFilters.maxIntradayRange)) return false;

            // Open-to-LTP change ((LTP - Open) / Open * 100)
            const open = stock.Open || stock.todayOpen || 0;
            const openToLtp = open > 0 ? ((ltp - open) / open) * 100 : 0;
            if (advancedFilters?.minOpenToLtp !== null && advancedFilters?.minOpenToLtp !== undefined && (open <= 0 || openToLtp < advancedFilters.minOpenToLtp)) return false;
            if (advancedFilters?.maxOpenToLtp !== null && advancedFilters?.maxOpenToLtp !== undefined && (open <= 0 || openToLtp > advancedFilters.maxOpenToLtp)) return false;

            // Opening Gap ((Open - prevClose) / prevClose * 100)
            const prevClose = stock.prevClose || 0;
            const openingGap = prevClose > 0 ? ((open - prevClose) / prevClose) * 100 : 0;
            if (advancedFilters?.minOpeningGap !== null && advancedFilters?.minOpeningGap !== undefined && (prevClose <= 0 || openingGap < advancedFilters.minOpeningGap)) return false;
            if (advancedFilters?.maxOpeningGap !== null && advancedFilters?.maxOpeningGap !== undefined && (prevClose <= 0 || openingGap > advancedFilters.maxOpeningGap)) return false;

            // Day Extreme Proximity (%)
            // Distance to Day High: (High - LTP) / LTP * 100
            const distToHOD = ltp > 0 ? ((high - ltp) / ltp) * 100 : 0;
            if (advancedFilters?.maxDistanceToHOD !== null && advancedFilters?.maxDistanceToHOD !== undefined && (ltp <= 0 || high <= 0 || distToHOD > advancedFilters.maxDistanceToHOD)) return false;

            // Distance to Day Low: (LTP - Low) / Low * 100
            const distToLOD = low > 0 ? ((ltp - low) / low) * 100 : 0;
            if (advancedFilters?.maxDistanceToLOD !== null && advancedFilters?.maxDistanceToLOD !== undefined && (ltp <= 0 || low <= 0 || distToLOD > advancedFilters.maxDistanceToLOD)) return false;

            // 3. Category selectors
            if (advancedFilters?.sectors && advancedFilters.sectors.length > 0) {
                if (!sector || !advancedFilters.sectors.includes(sector.toUpperCase())) return false;
            }
            if (advancedFilters?.capCategories && advancedFilters.capCategories.length > 0) {
                if (!cap || !advancedFilters.capCategories.includes(cap)) return false;
            }

            // 4. Custom Toggles
            if (advancedFilters?.showOnlyPositiveOwnership) {
                if ((stock.ownership_momentum_score || 0) <= 0) return false;
            }

            if (advancedFilters?.nearUpperCircuit) {
                const prevCloseVal = stock.prevClose || stock.Open || ltp;
                const ucPrice = prevCloseVal * 1.20;
                const ucDistance = ((ucPrice - ltp) / ltp) * 100;
                if (ucDistance > 2.0) return false;
            }

            if (advancedFilters?.openEqualsLow) {
                const openVal = stock.Open || stock.todayOpen || 0;
                const lowVal = stock.Low || 0;
                if (openVal <= 0 || openVal !== lowVal) return false;
            }

            if (advancedFilters?.openEqualsHigh) {
                const openVal = stock.Open || stock.todayOpen || 0;
                const highVal = stock.High || 0;
                if (openVal <= 0 || openVal !== highVal) return false;
            }

            return true;
        });
    }, [pulseStocks, advancedFilters, volumeAverages]);

    // --- Upper Circuit Scans ---
    const ucCandidates = useMemo(() => {
        if (!filteredStocks || filteredStocks.length === 0) return [];
        const candidates: UCCandidate[] = [];

        filteredStocks.forEach(stock => {
            const open = stock.Open || stock.todayOpen || 0;
            const ltp = stock.LTP || 0;
            const low = stock.Low || 0;
            const high = stock.High || 0;
            const prevClose = stock.prevClose || 0;

            if (ltp <= 0) return;

            const o2c = open > 0 ? ((ltp - open) / open) * 100 : 0;
            const dayExtreme = (high > low) ? (ltp - low) / (high - low) : 1.0;
            const openingGap = prevClose > 0 ? ((open - prevClose) / prevClose) * 100 : 0;
            const isORBLowPreservedProxy = (low > 0 && open > 0) ? (low >= open * 0.995) : (ltp > open);

            // Fix: remove exhaustion filter for bullish breakouts
            const isExhausted = false;
            const isTrapRisk = (high > low) ? (high - ltp) / (high - low) > 0.25 : false;

            // Kill filters ΓÇö only apply when penny trap exclusion is active
            if (advancedFilters?.excludePennyTraps) {
                if (stock.Change < 3.0) return;
                if (o2c < -1.5) return;      // Allow mild intraday pullbacks below open price
                if (dayExtreme < 0.40) return; // Allow deeper pullbacks down to 40% of the daily range (perfect for entries)
            }

            // Score logic
            const changeOk = stock.Change > 4.0;
            const o2cOk = o2c > 0.5;
            const atHOD = dayExtreme > 0.85;
            const orbLowOk = isORBLowPreservedProxy || ltp > open;
            const notExhausted = true;
            const noTrap = !isTrapRisk;
            const strengthOk = (stock["Strength Factor"] || 0) > 0;

            const isSmall = stock.CapCategory === 'Small' || (!['Large', 'Mid'].includes(stock.CapCategory || ''));
            const smallCapBonus = isSmall;
            const gapBonus = openingGap < 2.0;

            let score = 0;
            let passingChecks = 0;

            if (changeOk) { score += 1; passingChecks++; }
            if (o2cOk) { score += 1; passingChecks++; }
            if (atHOD) { score += 1; passingChecks++; }
            if (orbLowOk) { score += 1; passingChecks++; }
            if (notExhausted) { score += 1; passingChecks++; }
            if (noTrap) { score += 1; passingChecks++; }
            if (strengthOk) { score += 1; passingChecks++; }

            if (smallCapBonus) score += 0.5;
            if (gapBonus) score += 0.5;

            const prevCloseVal = prevClose || (open ? open / (1 + stock.Change / 100) : ltp / (1 + stock.Change / 100));

            // Enrich with live quotes if available
            const quote = liveQuotes[stock.Symbol];
            const ucPrice = quote?.upper_circuit_limit || prevCloseVal * 1.20;
            const ucDistance = quote?.upper_circuit_limit ? ((quote.upper_circuit_limit - ltp) / ltp) * 100 : ((ucPrice - ltp) / ltp) * 100;

            candidates.push({
                stock,
                score,
                passingChecks,
                ucPrice,
                ucDistance,
                o2c,
                openingGap,
                dayExtreme,
                isSmall,
                isExhausted,
                isTrapRisk,
                isORBLowPreservedProxy,
                flags: {
                    changeOk,
                    o2cOk,
                    atHOD,
                    orbLowOk,
                    notExhausted,
                    noTrap,
                    strengthOk,
                    smallCapBonus,
                    gapBonus
                }
            });
        });

        const filtered = candidates.filter(c => c.stock.Symbol.toLowerCase().includes(searchTerm.toLowerCase()));
        return filtered.sort((a, b) => b.score - a.score || b.stock.Change - a.stock.Change);
    }, [filteredStocks, searchTerm, liveQuotes, advancedFilters]);

    // --- EMA Snapback Scans ---
    const snapbackCandidates = useMemo(() => {
        if (!filteredStocks || filteredStocks.length === 0) return [];
        const candidates: SnapbackCandidate[] = [];

        filteredStocks.forEach(stock => {
            const open = stock.Open || stock.todayOpen || 0;
            const ltp = stock.LTP || 0;
            const low = stock.Low || 0;
            const high = stock.High || 0;
            const prevClose = stock.prevClose || 0;

            if (ltp <= 0) return;

            const o2c = open > 0 ? ((ltp - open) / open) * 100 : 0;
            const dayExtreme = (high > low) ? (ltp - low) / (high - low) : 1.0;
            const openingGap = prevClose > 0 ? ((open - prevClose) / prevClose) * 100 : 0;
            const isExhausted = dayExtreme > 0.92 && stock.Change > 4.0;

            // Kill filters ΓÇö only apply when penny trap exclusion is active
            if (advancedFilters?.excludePennyTraps) {
                if (stock.Change < 2.5) return;
                if (dayExtreme < 0.75) return;
                if (o2c < 0) return;
            }

            const changeOk = stock.Change > 3.0;
            const atHOD = dayExtreme > 0.88;
            const gapOk = openingGap > 1.5;
            const o2cOk = o2c > 1.5;

            let score = 0;
            let passingChecks = 0;

            if (changeOk) { score += 1; passingChecks++; }
            if (atHOD) { score += 1; passingChecks++; }
            if (gapOk) { score += 1; passingChecks++; }
            if (o2cOk) { score += 1; passingChecks++; }
            if (isExhausted) { score += 1; passingChecks++; }

            const emaTarget = open;
            const potentialReturn = ltp > 0 ? ((ltp - open) / ltp) * 100 : 0;
            const stopLoss = high * 1.005;

            candidates.push({
                stock,
                score,
                passingChecks,
                emaTarget,
                potentialReturn,
                stopLoss,
                o2c,
                openingGap,
                dayExtreme,
                isExhausted,
                flags: {
                    changeOk,
                    atHOD,
                    gapOk,
                    o2cOk,
                    exhausted: isExhausted
                }
            });
        });

        const filtered = candidates.filter(c => c.stock.Symbol.toLowerCase().includes(searchTerm.toLowerCase()));
        return filtered.sort((a, b) => b.score - a.score || b.potentialReturn - a.potentialReturn);
    }, [filteredStocks, searchTerm, advancedFilters]);

    // --- Institutional Radar Scans ---
    const institutionalCandidates = useMemo(() => {
        if (!filteredStocks || filteredStocks.length === 0) return [];
        const candidates: InstitutionalCandidate[] = [];

        filteredStocks.forEach(stock => {
            const isMidLarge = ['Mid', 'Large', 'Mid Cap', 'Large Cap'].includes(stock.CapCategory || '');
            if (!isMidLarge) return;

            const open = stock.Open || stock.todayOpen || 0;
            const ltp = stock.LTP || 0;
            const low = stock.Low || 0;
            const high = stock.High || 0;

            if (ltp <= 0) return;

            const isOpenLow = openLowStocks.some(s => s.Symbol === stock.Symbol) || (open > 0 && open === low);
            const isOrbBullish = orbData[stock.Symbol] === true;

            const quote = liveQuotes[stock.Symbol];
            const adv = volumeAverages[stock.Symbol];
            const todayVol = quote?.volume || stock.Volume || 0;
            const rvol = adv > 0 ? todayVol / adv : 1.0;
            const isVolumeSurge = rvol >= 2.0;

            const vwap = quote?.average_price || 0;
            const isVwapAboveOpen = vwap > 0 && open > 0 && vwap > open;
            const isMarketCapLimit = (stock.MarketCap || 0) >= 2000;
            const isChangeAbove5 = stock.Change >= 5.0;

            let score = 0;
            if (isOpenLow) score += 3;
            if (isOrbBullish) score += 2;
            if (isVolumeSurge) score += 2;
            if (isVwapAboveOpen) score += 1;
            if (isMidLarge) score += 1;
            if (isMarketCapLimit) score += 1;
            if (isChangeAbove5) score += 1;

            if (score < 2) return;

            const vwapDistance = vwap > 0 ? ((ltp - vwap) / vwap) * 100 : 0;

            candidates.push({
                stock,
                score,
                signals: {
                    isOpenLow,
                    isOrbBullish,
                    isVolumeSurge,
                    isVwapAboveOpen,
                    isMidLarge,
                    isMarketCapLimit,
                    isChangeAbove5
                },
                rvol,
                vwapDistance
            });
        });

        const filtered = candidates.filter(c => c.stock.Symbol.toLowerCase().includes(searchTerm.toLowerCase()));
        return filtered.sort((a, b) => b.score - a.score || b.stock.Change - a.stock.Change);
    }, [filteredStocks, openLowStocks, orbData, liveQuotes, volumeAverages, searchTerm]);

    // --- Strategy Engine Candidate Lists ---
    const emaSnapbackCandidates = useMemo(() => {
        if (!filteredStocks || filteredStocks.length === 0) return [];
        return filteredStocks.map(stock => {
            const sd = pulseToStockData(stock);
            const adv = volumeAverages[stock.Symbol] || 0;
            const rvolVal = adv > 0 ? (stock.Volume || 0) / adv : 1.0;
            const inputs = buildInputsFromStock(sd, {
                rvol: rvolVal,
                direction: (sd as any).direction ?? (sd.signal === 'Down' ? 'PUT' : 'CALL')
            });
            const res = getCachedBestStrategy(sd, { ...inputs, strategyId: 'ema_snapback' });
            return { stock, res };
        }).filter(item => item.res.p0Passed)
          .sort((a, b) => b.res.score - a.res.score);
    }, [filteredStocks, volumeAverages, pulseToStockData, getCachedBestStrategy]);

    const morningContinuationCandidates = useMemo(() => {
        if (!filteredStocks || filteredStocks.length === 0) return [];
        return filteredStocks.map(stock => {
            const sd = pulseToStockData(stock);
            const adv = volumeAverages[stock.Symbol] || 0;
            const rvolVal = adv > 0 ? (stock.Volume || 0) / adv : 1.0;
            const inputs = buildInputsFromStock(sd, {
                rvol: rvolVal,
                direction: (sd as any).direction ?? (sd.signal === 'Down' ? 'PUT' : 'CALL')
            });
            const res = getCachedBestStrategy(sd, { ...inputs, strategyId: 'morning_snapback' });
            return { stock, res };
        }).filter(item => {
            if (!item.res.p0Passed) return false;
            // Check time 09:15 to 10:30
            const now = new Date();
            const istTimeStr = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
            const [hours, minutes] = istTimeStr.split(':').map(Number);
            const timeVal = hours * 100 + minutes;
            return timeVal >= 915 && timeVal <= 1030;
        }).sort((a, b) => b.res.score - a.res.score);
    }, [filteredStocks, volumeAverages, pulseToStockData, getCachedBestStrategy]);

    const preUcSetupCandidates = useMemo(() => {
        if (!filteredStocks || filteredStocks.length === 0) return [];
        return filteredStocks.map(stock => {
            const sd = pulseToStockData(stock);
            const adv = volumeAverages[stock.Symbol] || 0;
            const rvolVal = adv > 0 ? (stock.Volume || 0) / adv : 1.0;
            const inputs = buildInputsFromStock(sd, {
                rvol: rvolVal,
                direction: (sd as any).direction ?? (sd.signal === 'Down' ? 'PUT' : 'CALL')
            });
            const res = getCachedBestStrategy(sd, { ...inputs, strategyId: 'upper_circuit' });
            return { stock, res };
        }).filter(item => item.res.p0Passed)
          .sort((a, b) => b.res.score - a.res.score);
    }, [filteredStocks, volumeAverages, pulseToStockData, getCachedBestStrategy]);

    // --- Fetch ORB on Tab Activation ---
    useEffect(() => {
        if (activeTab !== 'institutional' || !stockezeeToken) return;
        setIsFetchingOrb(true);
        ShadowScreenerService.fetchORB(stockezeeToken, 15)
            .then(json => {
                const map: Record<string, boolean> = {};
                (json.resultData || []).forEach((item: any) => {
                    if (item.breakout === 'Bullish') {
                        map[item.symbol_name] = true;
                    }
                });
                setOrbData(map);
            })
            .catch((err) => {
                console.error('Error fetching ORB for Institutional Radar:', err);
            })
            .finally(() => {
                setIsFetchingOrb(false);
            });
    }, [activeTab, stockezeeToken]);

    // --- Bulk Fetch Live Quotes & Averages Effect ---
    useEffect(() => {
        if (!isVisible || filteredStocks.length === 0) return;

        const loadMarketData = async () => {
            setIsLoadingQuotes(true);
            try {
                // 1. Fetch cached averages once from db
                if (Object.keys(volumeAverages).length === 0) {
                    const avgRes = await fetch('/api/python-nse/api/upstox/historical/volume-avg/all');
                    if (avgRes.ok) {
                        const data = await avgRes.json();
                        setVolumeAverages?.(data || {});
                    }
                }

                // 2. Identify top 15 symbols to sync quotes
                let candidates: any[] = [];
                if (activeTab === 'circuit') candidates = ucCandidates;
                else if (activeTab === 'snapback') candidates = snapbackCandidates;
                else if (activeTab === 'institutional') candidates = institutionalCandidates;
                else if (activeTab === 'pre_uc_setup') candidates = preUcSetupCandidates;
                else if (activeTab === 'ema_snapback_scalp') candidates = emaSnapbackCandidates;
                else if (activeTab === 'morning_continuation') candidates = morningContinuationCandidates;
                
                const topSymbols = candidates.slice(0, 15).map(c => c.stock.Symbol || c.stock.symbol);

                if (topSymbols.length > 0) {
                    const quotes = await upstoxMarketDataService.getFullQuotes(topSymbols);
                    if (quotes) {
                        setLiveQuotes(prev => ({ ...prev, ...quotes }));
                    }

                    // Dynamically resolve missing averages on demand
                    for (const sym of topSymbols) {
                        if (!volumeAverages[sym]) {
                            const avgData = await upstoxMarketDataService.getVolumeAvg20Day(sym);
                            if (avgData) {
                                setVolumeAverages?.((prev: Record<string, number>) => ({ ...prev, [sym]: avgData.avg_volume_20d }));
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('Error syncing real-time quote feeds:', err);
            } finally {
                setIsLoadingQuotes(false);
            }
        };

        loadMarketData();
    }, [activeTab, filteredStocks, refreshTrigger, isVisible]);

    const getScoreTheme = (score: number, maxScore: number) => {
        const ratio = score / maxScore;
        if (ratio >= 0.8) return SCORE_THEMES.high;
        if (ratio >= 0.55) return SCORE_THEMES.medium;
        return SCORE_THEMES.low;
    };

    const containerVariants = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: { staggerChildren: 0.04 }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0 }
    };

    return (
        <div className="bg-slate-900/20 backdrop-blur-xl rounded-[2rem] border border-slate-800/60 shadow-2xl overflow-hidden">
            {/* Header section */}
            <div className="px-6 py-4 border-b border-slate-800/40 bg-slate-900/30">
                <div className="flex flex-row items-center justify-between gap-4 w-full flex-wrap sm:flex-nowrap">
                    <div className="flex items-center gap-3 shrink-0">
                        <div className="w-9 h-9 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-950/20">
                            <Zap className="w-4.5 h-4.5 text-indigo-400 animate-pulse" />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-white tracking-tight">
                                Cash Segment Radars
                            </h2>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        // Premium Sliding Capsule Tabs
                        <div className="flex bg-slate-950/80 p-0.5 rounded-lg border border-slate-800/60 relative">
                            {[
                                { id: 'circuit', label: 'ΓÜí Upper Circuit' },
                                { id: 'snapback', label: 'Γå⌐ EMA Snapback' },
                                { id: 'pre_uc_setup', label: 'ΓÜí Pre-UC Setup' },
                                { id: 'ema_snapback_scalp', label: '≡ƒƒú SCALP' },
                                { id: 'morning_continuation', label: '≡ƒƒó CONT' },
                                { id: 'institutional', label: '≡ƒÅ¢ Inst. Radar' },
                                { id: 'conviction', label: '≡ƒÄ» Unified CX' }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => { setActiveTab(tab.id as any); setExpandedIdx(null); }}
                                    className={`relative px-3 py-1.5 rounded text-[8.5px] font-black uppercase tracking-wider transition-all duration-300 z-10 ${activeTab === tab.id ? 'text-white' : 'text-slate-500 hover:text-slate-355'
                                        }`}
                                >
                                    {activeTab === tab.id && (
                                        <motion.div
                                            layoutId="activeRadarTabCapsule"
                                            className="absolute inset-0 bg-indigo-600 rounded -z-10 shadow-md shadow-indigo-500/20"
                                            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                                        />
                                    )}
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 mt-4 text-[10px] text-slate-500 font-semibold tracking-wide border-t border-slate-800/20 pt-3">
                    <Clock className="w-3.5 h-3.5 text-slate-650" />
                    <span>Loaded Cash Universe: <strong className="text-slate-300 font-mono">{filteredStocks.length}</strong> assets</span>
                    {advancedFilters?.excludePennyTraps && (
                        <>
                            <span className="text-slate-700 font-black">┬╖</span>
                            <span className="text-emerald-400 flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                                Penny traps filtered out
                            </span>
                        </>
                    )}
                </div>
            </div>

            {/* Render Tab Contents with Stable unmounting layout */}
            <div className="p-6">
                {filteredStocks.length === 0 ? (
                    <div className="p-16 flex flex-col items-center gap-5 text-center">
                        <ShieldAlert className="w-12 h-12 text-slate-750" />
                        <div>
                            <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest">No Active Database Assets</h4>
                            <p className="text-slate-600 text-xs mt-1.5 max-w-sm leading-relaxed">
                                Prime the cash database via live proxy sync or clipboard paste in the controls above to activate radars.
                            </p>
                        </div>
                    </div>
                ) : (
                    <AnimatePresence>
                        <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                        >
                            {activeTab === 'circuit' ? (
                                /* CIRCUIT TAB */
                                ucCandidates.length === 0 ? (
                                    <div className="p-12 text-center text-slate-500 text-xs font-bold uppercase tracking-wider border border-dashed border-slate-800/40 rounded-3xl">
                                        No stocks meeting circuit-breakout criteria at this time.
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {ucCandidates.filter(c => !advancedFilters?.excludePennyTraps || !(c.stock.Symbol in volumeAverages) || (volumeAverages[c.stock.Symbol] || 0) > 50000).slice(0, 15).map((cand, idx) => {
                                            const theme = getScoreTheme(cand.score, 7);
                                            const isExpanded = expandedIdx === idx;
                                            const hodPercent = Math.round(cand.dayExtreme * 100);

                                            // Real-time metrics calculations
                                            const symbol = cand.stock.Symbol;
                                            const quote = liveQuotes[symbol];
                                            const adv = volumeAverages[symbol];
                                            const todayVol = quote?.volume || cand.stock.Volume || 0;
                                            const rvol = adv > 0 ? todayVol / adv : 1.0;
                                            const vwap = quote?.average_price || 0;
                                            const vwapDistance = vwap > 0 ? ((cand.stock.LTP - vwap) / vwap) * 100 : 0;
                                            const isPullback = vwap > 0 && vwapDistance >= 0 && vwapDistance <= 1.5;

                                            return (
                                                <div
                                                    key={`uc-${cand.stock.Symbol}-${idx}`}
                                                    className={`rounded-2xl border bg-gradient-to-br ${theme.bg} overflow-hidden shadow-lg transition-all duration-300 cursor-pointer`}
                                                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                                                >
                                                    {/* Header Row */}
                                                    <div className="p-4 flex items-center justify-between gap-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className="text-slate-500 font-bold text-sm w-6 font-mono">#{String(idx + 1).padStart(2, '0')}</div>
                                                            <div>
                                                                <span className="text-[14.5px] font-bold text-white tracking-normal">{cand.stock.Symbol}</span>
                                                                <span className="text-[11px] font-medium text-slate-400 truncate block max-w-[145px] mt-0.5">
                                                                    {cand.stock.CompanyName || 'Cash Segment'}
                                                                </span>
                                                            </div>
                                                        </div>
 
                                                        <div className="flex items-center gap-3">
                                                             <div className={`flex items-center justify-center w-8 h-8 rounded-lg border ${theme.badgeBg} shrink-0 shadow-inner`}>
                                                                 <span className={`text-[12px] font-black ${theme.text}`}>{cand.score}</span>
                                                             </div>
 
                                                             <div className="text-right">
                                                                 <div className="text-[13px] font-mono font-bold text-white">{formatINR(cand.stock.LTP)}</div>
                                                                 <div className="text-[11.5px] font-bold text-emerald-400 flex items-center justify-end">
                                                                     <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400 mr-0.5 shrink-0" />
                                                                     {formatPercentage(cand.stock.Change)}
                                                                 </div>
                                                             </div>
                                                        </div>
                                                    </div>
 
                                                    {/* Badges Row */}
                                                    <div className="px-4 pb-2.5 flex items-center gap-1.5 flex-wrap">
                                                        <AlphaVerdictPanel
                                                            symbol={cand.stock.Symbol}
                                                            result={getVerdictResult(cand.stock.Symbol, false)}
                                                            variant="badge"
                                                            onOpenDetail={() => setVerdictSymbol(cand.stock.Symbol)}
                                                        />
                                                        {cand.isSmall && (
                                                            <span className="text-[9.5px] font-bold px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/25 text-indigo-400 uppercase tracking-wide">
                                                                Small
                                                            </span>
                                                        )}
                                                        {isPullback && (
                                                            <span className="text-[9.5px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 uppercase tracking-wide animate-pulse">
                                                                Pullback
                                                            </span>
                                                        )}
                                                    </div>
  
                                                    {/* Mini gauge */}
                                                    <div className="px-4 pb-4">
                                                        <div className="space-y-1 bg-slate-950/40 p-2.5 rounded-xl border border-slate-950/60">
                                                            <div className="flex justify-between text-[9.5px] font-bold text-slate-400 uppercase tracking-wide">
                                                                <span>LOW ({formatINR(cand.stock.Low || 0, { decimals: 1 })})</span>
                                                                <span className="text-indigo-400 font-black">HOD PROX: {hodPercent}%</span>
                                                                <span>HIGH ({formatINR(cand.stock.High || 0, { decimals: 1 })})</span>
                                                            </div>
                                                            <div className="h-1 bg-slate-950 rounded-full overflow-hidden relative">
                                                                <div
                                                                    className={`h-full rounded-full bg-gradient-to-r ${theme.progress}`}
                                                                    style={{ width: `${hodPercent}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Grid details */}
                                                    <div className="px-4 py-3 grid grid-cols-3 gap-2 border-t border-slate-900/60 bg-slate-950/40">
                                                        <MetricBadge label="RVOL" value={adv ? `${rvol.toFixed(1)}x` : 'N/A'} valueClass={adv ? getRvolColorClass(rvol, todayVol, cand.stock.LTP) : "text-white"} />
                                                        <MetricBadge label="UC Distance" value={`${cand.ucDistance.toFixed(1)}%`} valueClass="text-amber-400" />
                                                        <MetricBadge label="UC Limit" value={`Γé╣${cand.ucPrice.toFixed(1)}`} />
                                                    </div>

                                                    {/* Expanded checklist */}
                                                    <AnimatePresence>
                                                        {isExpanded && (
                                                            <motion.div
                                                                initial={{ height: 0, opacity: 0 }}
                                                                animate={{ height: 'auto', opacity: 1 }}
                                                                exit={{ height: 0, opacity: 0 }}
                                                                className="border-t border-slate-900 bg-slate-950/60"
                                                            >
                                                                <div className="p-4 space-y-4">
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                        <ChecklistBadge label="C2C Gain > 4%" pass={cand.flags.changeOk} />
                                                                        <ChecklistBadge label="O2C Change > 0.5%" pass={cand.flags.o2cOk} />
                                                                        <ChecklistBadge label="At HOD > 85%" pass={cand.flags.atHOD} />
                                                                        <ChecklistBadge label="Low Preserved" pass={cand.flags.orbLowOk} />
                                                                        <ChecklistBadge label="No Trap Risk" pass={cand.flags.noTrap} />
                                                                        <ChecklistBadge label="Strength > 0" pass={cand.flags.strengthOk} />
                                                                        <ChecklistBadge label="Gap < 2% (Healthy)" pass={cand.flags.gapBonus} />
                                                                        <ChecklistBadge label={isPullback ? "Near VWAP Support" : "Above VWAP"} pass={vwap > 0 ? cand.stock.LTP >= vwap : true} />
                                                                    </div>

                                                                    {/* Analytical support context card */}
                                                                    <div className="p-3 bg-indigo-500/5 border border-indigo-500/15 rounded-xl space-y-2">
                                                                        <div className="flex gap-2">
                                                                            <Info className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
                                                                            <p className="text-[9px] text-slate-400 leading-relaxed font-semibold font-sans">
                                                                                {isPullback
                                                                                    ? `Stock is in the Institutional Pullback Zone (LTP Γé╣${cand.stock.LTP} is only ${vwapDistance.toFixed(2)}% above VWAP of Γé╣${vwap.toFixed(2)}).`
                                                                                    : `Stock has strong momentum. Current price is ${vwapDistance.toFixed(1)}% above VWAP.`
                                                                                } RVOL: {rvol.toFixed(1)}x. Target circuit: Γé╣{cand.ucPrice.toFixed(2)}.
                                                                            </p>
                                                                        </div>
                                                                        {adv && (
                                                                            <div className="flex justify-between text-[8px] font-mono text-slate-500 border-t border-slate-900/60 pt-1.5">
                                                                                <span>20d ADV: {formatNumberIndian(Math.round(adv))}</span>
                                                                                <span>Today Vol: {formatNumberIndian(todayVol)}</span>
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            openTradingView(cand.stock.Symbol);
                                                                        }}
                                                                        className="w-full py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-[10px] font-black text-indigo-400 hover:text-white uppercase tracking-widest transition-all"
                                                                    >
                                                                        Open TradingView Chart
                                                                    </button>
                                                                </div>
                                                            </motion.div>
                                                        )}
                                                    </AnimatePresence>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )
                            ) : activeTab === 'snapback' ? (
                                /* SNAPBACK TAB */
                                snapbackCandidates.length === 0 ? (
                                    <div className="p-12 text-center text-slate-500 text-xs font-bold uppercase tracking-wider border border-dashed border-slate-800/40 rounded-3xl">
                                        No stocks meeting snapback criteria at this time.
                                    </div>
                                ) : (
                                    <div
                                        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                                    >
                                        {snapbackCandidates.slice(0, 15).map((cand, idx) => {
                                            const theme = getScoreTheme(cand.score, 5);
                                            const isExpanded = expandedIdx === idx;
                                            const hodPercent = Math.round(cand.dayExtreme * 100);

                                            return (
                                                <div
                                                    key={`sb-${cand.stock.Symbol}-${idx}`}
                                                    className={`rounded-2xl border bg-gradient-to-br ${theme.bg} overflow-hidden shadow-lg transition-all duration-300 cursor-pointer`}
                                                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                                                >
                                                    {/* Header Row */}
                                                    <div className="p-4 flex items-center justify-between gap-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className="text-slate-500 font-bold text-sm w-6 font-mono">#{String(idx + 1).padStart(2, '0')}</div>
                                                            <div>
                                                                <span className="text-[14.5px] font-bold text-white tracking-normal">{cand.stock.Symbol}</span>
                                                                <span className="text-[11px] font-medium text-slate-400 truncate block max-w-[145px] mt-0.5">
                                                                    {cand.stock.CompanyName || 'Cash Segment'}
                                                                </span>
                                                            </div>
                                                        </div>
 
                                                        <div className="flex items-center gap-3">
                                                            <div className={`flex items-center justify-center w-8 h-8 rounded-lg border ${theme.badgeBg} shrink-0 shadow-inner`}>
                                                                <span className={`text-[14px] font-black ${theme.text}`}>{cand.score}</span>
                                                            </div>
 
                                                            <div className="text-right">
                                                                <div className="text-[13px] font-mono font-bold text-white">{formatINR(cand.stock.LTP)}</div>
                                                                <div className="text-[11.5px] font-bold text-rose-400 flex items-center justify-end">
                                                                    <TrendingDown className="w-3.5 h-3.5 text-rose-400 mr-0.5 shrink-0" />
                                                                    {formatPercentage(cand.stock.Change)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
 
                                                    {/* Badges Row */}
                                                    <div className="px-4 pb-2.5 flex items-center gap-1.5 flex-wrap">
                                                        <AlphaVerdictPanel
                                                            symbol={cand.stock.Symbol}
                                                            result={getVerdictResult(cand.stock.Symbol, true)}
                                                            variant="badge"
                                                            onOpenDetail={() => setVerdictSymbol(cand.stock.Symbol)}
                                                        />
                                                        <span className="text-[9.5px] font-bold px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/25 text-rose-400 uppercase tracking-wide">
                                                            FADE/SHORT
                                                        </span>
                                                    </div>

                                                    {/* Mini gauge */}
                                                    <div className="px-4 pb-4">
                                                        <div className="space-y-1 bg-slate-950/40 p-2.5 rounded-xl border border-slate-950/60">
                                                            <div className="flex justify-between text-[9.5px] font-bold text-slate-400 uppercase tracking-wide">
                                                                <span>LOW ({formatINR(cand.stock.Low || 0, { decimals: 1 })})</span>
                                                                <span className="text-rose-400 font-black">EXHAUST PROX: {hodPercent}%</span>
                                                                <span>HIGH ({formatINR(cand.stock.High || 0, { decimals: 1 })})</span>
                                                            </div>
                                                            <div className="h-1 bg-slate-950 rounded-full overflow-hidden relative">
                                                                <div
                                                                    className={`h-full rounded-full bg-gradient-to-r ${theme.progress}`}
                                                                    style={{ width: `${hodPercent}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Grid details */}
                                                    <div className="px-4 py-3 grid grid-cols-3 gap-2 border-t border-slate-900/60 bg-slate-950/40">
                                                        <MetricBadge label="Open (EMA Target)" value={`Γé╣${cand.emaTarget.toFixed(1)}`} />
                                                        <MetricBadge label="Potential Fade" value={`+${cand.potentialReturn.toFixed(1)}%`} valueClass="text-emerald-400" />
                                                        <MetricBadge label="Stop Loss (HOD+)" value={`Γé╣${cand.stopLoss.toFixed(1)}`} valueClass="text-rose-400" />
                                                    </div>

                                                    {/* Expanded checklist */}
                                                    <AnimatePresence>
                                                        {isExpanded && (
                                                            <motion.div
                                                                initial={{ height: 0, opacity: 0 }}
                                                                animate={{ height: 'auto', opacity: 1 }}
                                                                exit={{ height: 0, opacity: 0 }}
                                                                className="border-t border-slate-900 bg-slate-950/60"
                                                            >
                                                                <div className="p-4 space-y-4">
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                        <ChecklistBadge label="C2C Spike > 3%" pass={cand.flags.changeOk} />
                                                                        <ChecklistBadge label="HOD Extreme > 88%" pass={cand.flags.atHOD} />
                                                                        <ChecklistBadge label="Gap Up > 1.5%" pass={cand.flags.gapOk} />
                                                                        <ChecklistBadge label="O2C Change > 1.5%" pass={cand.flags.o2cOk} />
                                                                        <ChecklistBadge label="Exhausted State" pass={cand.flags.exhausted} />
                                                                    </div>

                                                                    <div className="p-3 bg-rose-500/5 border border-rose-500/15 rounded-xl flex gap-2">
                                                                        <Info className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
                                                                        <p className="text-[9px] text-slate-400 leading-relaxed font-semibold font-sans">
                                                                            Fade setup targeting snapback back to today's open price (EMA proxy). Set SL strictly at high plus 0.5% ({formatINR(cand.stopLoss)}).
                                                                        </p>
                                                                    </div>

                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            openTradingView(cand.stock.Symbol);
                                                                        }}
                                                                        className="w-full py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-[10px] font-black text-indigo-400 hover:text-white uppercase tracking-widest transition-all"
                                                                    >
                                                                        Open TradingView Chart
                                                                    </button>
                                                                </div>
                                                            </motion.div>
                                                        )}
                                                    </AnimatePresence>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )
                            ) : activeTab === 'institutional' ? (
                                /* INSTITUTIONAL RADAR TAB */
                                institutionalCandidates.length === 0 ? (
                                    <div className="p-12 text-center text-slate-500 text-xs font-bold uppercase tracking-wider border border-dashed border-slate-800/40 rounded-3xl">
                                        No institutional footprints detected at this time. (Requires score ΓëÑ 2)
                                    </div>
                                ) : (
                                    <div
                                        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                                    >
                                        {institutionalCandidates.slice(0, 15).map((cand, idx) => {
                                            const theme = getScoreTheme(cand.score, 11);
                                            const isExpanded = expandedIdx === idx;
                                            const scorePercent = Math.round((cand.score / 11) * 100);

                                            return (
                                                <div
                                                    key={`inst-${cand.stock.Symbol}-${idx}`}
                                                    className={`rounded-2xl border bg-gradient-to-br ${theme.bg} overflow-hidden shadow-lg transition-all duration-300 cursor-pointer`}
                                                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                                                >
                                                    {/* Header Row */}
                                                    <div className="p-4 flex items-center justify-between gap-3">
                                                        <div className="flex items-center gap-3 font-sans">
                                                            <div className="text-slate-500 font-bold text-sm w-6 font-mono">#{String(idx + 1).padStart(2, '0')}</div>
                                                            <div>
                                                                <span className="text-[14.5px] font-bold text-white tracking-normal">{cand.stock.Symbol}</span>
                                                                <span className="text-[11px] font-medium text-slate-400 truncate block max-w-[145px] mt-0.5">
                                                                    {cand.stock.CompanyName || 'Cash Segment'}
                                                                </span>
                                                            </div>
                                                        </div>
 
                                                        <div className="flex items-center gap-3">
                                                            <div className={`flex items-center justify-center w-8 h-8 rounded-lg border ${theme.badgeBg} shrink-0 shadow-inner`}>
                                                                <span className={`text-[14px] font-black ${theme.text}`}>{cand.score}</span>
                                                            </div>
 
                                                            <div className="text-right">
                                                                <div className="text-[13px] font-mono font-bold text-white">{formatINR(cand.stock.LTP)}</div>
                                                                <div className={`text-[11.5px] font-bold ${cand.stock.Change >= 0 ? 'text-emerald-400' : 'text-rose-400'} flex items-center justify-end`}>
                                                                    {cand.stock.Change >= 0 ? (
                                                                        <ArrowUpRight className="w-3.5 h-3.5 mr-0.5 shrink-0" />
                                                                    ) : (
                                                                        <TrendingDown className="w-3.5 h-3.5 mr-0.5 shrink-0" />
                                                                    )}
                                                                    {formatPercentage(cand.stock.Change)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
 
                                                    {/* Badges Row */}
                                                    <div className="px-4 pb-2.5 flex items-center gap-1.5 flex-wrap">
                                                        <AlphaVerdictPanel
                                                            symbol={cand.stock.Symbol}
                                                            result={getVerdictResult(cand.stock.Symbol, false)}
                                                            variant="badge"
                                                            onOpenDetail={() => setVerdictSymbol(cand.stock.Symbol)}
                                                        />
                                                        {cand.signals.isOpenLow && (
                                                            <span className="text-[9.5px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 uppercase tracking-wide">
                                                                OPEN=LOW
                                                            </span>
                                                        )}
                                                        {cand.signals.isOrbBullish && (
                                                            <span className="text-[9.5px] font-bold px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/25 text-indigo-400 uppercase tracking-wide">
                                                                ORB Γ£ô
                                                            </span>
                                                        )}
                                                        {cand.signals.isVolumeSurge && (
                                                            <span className="text-[9.5px] font-bold px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-400 uppercase tracking-wide">
                                                                VOL SURGE
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Mini gauge */}
                                                    <div className="px-4 pb-4">
                                                        <div className="space-y-1 bg-slate-950/40 p-2.5 rounded-xl border border-slate-950/60">
                                                            <div className="flex justify-between text-[9.5px] font-bold text-slate-400 uppercase tracking-wide">
                                                                <span>CONFLUENCE METER</span>
                                                                <span className="text-indigo-400 font-black">{cand.score} / 11 SIGNALS</span>
                                                            </div>
                                                            <div className="h-1 bg-slate-950 rounded-full overflow-hidden relative">
                                                                <div
                                                                    className={`h-full rounded-full bg-gradient-to-r ${theme.progress}`}
                                                                    style={{ width: `${scorePercent}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Grid details */}
                                                    <div className="px-4 py-3 grid grid-cols-3 gap-2 border-t border-slate-900/60 bg-slate-950/40">
                                                        <MetricBadge label="RVOL" value={`${cand.rvol.toFixed(1)}x`} valueClass={getRvolColorClass(cand.rvol, cand.stock.Volume || 0, cand.stock.LTP)} />
                                                        <MetricBadge label="VWAP DIST" value={`${cand.vwapDistance.toFixed(1)}%`} valueClass={cand.vwapDistance > 0 ? "text-emerald-400 font-bold" : "text-rose-450 font-bold"} />
                                                        <MetricBadge label="MKT CAP (CR)" value={cand.stock.MarketCap ? `${formatINR(cand.stock.MarketCap, { decimals: 0 })} Cr` : 'N/A'} />
                                                    </div>

                                                    {/* Expanded checklist */}
                                                    <AnimatePresence>
                                                        {isExpanded && (
                                                            <motion.div
                                                                initial={{ height: 0, opacity: 0 }}
                                                                animate={{ height: 'auto', opacity: 1 }}
                                                                exit={{ height: 0, opacity: 0 }}
                                                                className="border-t border-slate-900 bg-slate-950/60 overflow-hidden"
                                                            >
                                                                <div className="p-4 space-y-4">
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                        <ChecklistBadge label="Open = Low (+3)" pass={cand.signals.isOpenLow} />
                                                                        <ChecklistBadge label="Bullish ORB 15m (+2)" pass={cand.signals.isOrbBullish} />
                                                                        <ChecklistBadge label="Volume Surge > 2x (+2)" pass={cand.signals.isVolumeSurge} />
                                                                        <ChecklistBadge label="VWAP Above Open (+1)" pass={cand.signals.isVwapAboveOpen} />
                                                                        <ChecklistBadge label="Mid/Large Cap (+1)" pass={cand.signals.isMidLarge} />
                                                                        <ChecklistBadge label="Mkt Cap > 2k Cr (+1)" pass={cand.signals.isMarketCapLimit} />
                                                                        <ChecklistBadge label="Day Change > 5% (+1)" pass={cand.signals.isChangeAbove5} />
                                                                    </div>

                                                                    <div className="p-3 bg-indigo-500/5 border border-indigo-500/15 rounded-xl flex gap-2">
                                                                        <Info className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
                                                                        <p className="text-[9px] text-slate-400 leading-relaxed font-semibold font-sans">
                                                                            Institutional footprint radar. Signal weight: {cand.score}/11. Volume footprint shows {cand.rvol.toFixed(1)}x normal activity. Cap Category: {cand.stock.CapCategory || 'N/A'}.
                                                                        </p>
                                                                    </div>

                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            openTradingView(cand.stock.Symbol);
                                                                        }}
                                                                        className="w-full py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-[10px] font-black text-indigo-400 hover:text-white uppercase tracking-widest transition-all"
                                                                    >
                                                                        Open TradingView Chart
                                                                    </button>
                                                                </div>
                                                            </motion.div>
                                                        )}
                                                    </AnimatePresence>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )
                            ) : activeTab === 'pre_uc_setup' ? (
                                /* PRE-UC SETUP TAB */
                                preUcSetupCandidates.length === 0 ? (
                                    <div className="p-12 text-center text-slate-500 text-xs font-bold uppercase tracking-wider border border-dashed border-slate-800/40 rounded-3xl">
                                        No stocks meeting Pre-UC Setup criteria at this time.
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {preUcSetupCandidates.slice(0, 15).map((cand, idx) => (
                                            <StrategyCandidateCard
                                                key={`pre-uc-${cand.stock.Symbol}-${idx}`}
                                                cand={cand}
                                                idx={idx}
                                                isExpanded={expandedIdx === idx}
                                                onToggleExpand={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                                            />
                                        ))}
                                    </div>
                                )
                            ) : activeTab === 'ema_snapback_scalp' ? (
                                /* EMA SNAPBACK SCALP TAB */
                                emaSnapbackCandidates.length === 0 ? (
                                    <div className="p-12 text-center text-slate-500 text-xs font-bold uppercase tracking-wider border border-dashed border-slate-800/40 rounded-3xl">
                                        No stocks meeting EMA Snapback Scalp criteria at this time.
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {emaSnapbackCandidates.slice(0, 15).map((cand, idx) => (
                                            <StrategyCandidateCard
                                                key={`scalp-${cand.stock.Symbol}-${idx}`}
                                                cand={cand}
                                                idx={idx}
                                                isExpanded={expandedIdx === idx}
                                                onToggleExpand={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                                            />
                                        ))}
                                    </div>
                                )
                            ) : activeTab === 'morning_continuation' ? (
                                /* MORNING CONTINUATION TAB */
                                morningContinuationCandidates.length === 0 ? (
                                    <div className="p-12 text-center text-slate-500 text-xs font-bold uppercase tracking-wider border border-dashed border-slate-800/40 rounded-3xl">
                                        No stocks meeting 9-10AM Continuation criteria at this time.
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {morningContinuationCandidates.slice(0, 15).map((cand, idx) => (
                                            <StrategyCandidateCard
                                                key={`morning-${cand.stock.Symbol}-${idx}`}
                                                cand={cand}
                                                idx={idx}
                                                isExpanded={expandedIdx === idx}
                                                onToggleExpand={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                                            />
                                        ))}
                                    </div>
                                )
                            ) : activeTab === 'conviction' ? (
                                /* UNIFIED CONVICTION (CC68) */
                                <div className="space-y-3">
                                    <div className="px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-800/80 text-[10.5px] text-slate-400 font-mono flex flex-wrap gap-x-4 gap-y-1">
                                        <span>pulseStocks=<span className="text-emerald-300 font-bold">{pulseStocks.length}</span></span>
                                        <span>convictionCards=<span className="text-emerald-300 font-bold">{convictionCards.length}</span></span>
                                        {pulseStocks.length > 0 && (
                                            <span className="truncate max-w-full">
                                                first 3: <span className="text-slate-200">{pulseStocks.slice(0, 3).map((s: any) => s.Symbol ?? s.symbol ?? '?').join(', ')}</span>
                                            </span>
                                        )}
                                    </div>
                                    <ConvictionCardPanel
                                        title="Unified Conviction"
                                        cards={convictionCards}
                                        variant="cash"
                                        maxRows={20}
                                        emptyMessage={pulseStocks.length === 0
                                            ? "Import cash stocks above first ΓÇö then the verdict list populates."
                                            : "Conviction cards compute as MCS data warms. Refresh in a moment."}
                                    />
                                </div>
                            ) : null
                            }
                        </motion.div>
                    </AnimatePresence>
                )}
            </div>
            {/* Verdict Drawer Overlay */}
            {typeof window !== 'undefined' && createPortal(
                <AnimatePresence>
                    {verdictSymbol && (
                        <div
                            className="fixed inset-0 z-50 flex items-center justify-center p-4"
                        >
                            {/* Backdrop */}
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setVerdictSymbol(null)}
                                className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
                            />

                            {/* Modal Card */}
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                                transition={{ duration: 0.2, ease: 'easeOut' }}
                                className="relative z-10 w-full max-w-3xl"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <AlphaVerdictPanel
                                    symbol={verdictSymbol || undefined}
                                    stock={pulseStocks.find(s => s.Symbol === (verdictSymbol || ''))}
                                    result={getVerdictResult(verdictSymbol || '', activeTab === 'snapback')}
                                    variant="detail"
                                    onClose={() => setVerdictSymbol(null)}
                                />
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </div>
    );
};

export default CashRadarPanel;
