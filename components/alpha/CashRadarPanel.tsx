import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { StockData, AdvancedFilters } from '../../hooks/alpha/useAlphaEngineState';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, TrendingDown, Clock, ShieldAlert, CheckCircle2, XCircle, Info, ArrowUpRight, Award, ShieldCheck, Landmark, ChevronDown } from 'lucide-react';
import { formatINR, formatPercentage } from '../../utils/indianFormatter';
import { openTradingView } from '../../utils/navigation';
import { upstoxMarketDataService } from '../../services/UpstoxMarketDataService';
import { ShadowScreenerService, calculateOwnershipScore } from '../../services/alpha/ShadowScreenerService';
import { AlphaVerdictPanel } from './AlphaVerdictPanel';
import { formatNumberIndian } from '../../utils/helpers';
import { VerdictEngine } from '../../services/alpha/VerdictEngine';
import { score as convictionScore, buildInputsFromStock, type ConvictionScore } from '../../services/alpha/ConvictionEngine';
import { evaluateStrategyScore, detectBestStrategy, STRATEGY_CONFIGS, type StrategyId } from '../../services/alpha/StrategyEngine';
import { mceOrchestrator } from '../../services/mce/orchestrator';
import { ConvictionCardPanel, type ConvictionCard } from './ConvictionCardPanel';
import { CONDITIONS } from './indicator_constants';
import { bulkPrefetchHistoricalCandles } from '../../services/IntradayCandleService';
import { useGlobalTickStore } from '../../store/globalTickStore';
import { upstoxInstrumentService } from '../../services/UpstoxInstrumentService';
import { useToast } from '../shared/ToastProvider';
import { loadStockTypeConfig, classifyStockType, TYPE_LABELS, type StockTypeThresholds } from '../../services/alpha/StockTypeClassifier';
import { computeStockTypeFeatures, type LiveCandle } from '../../services/alpha/stockTypeFeatures';
import { Tabs } from '../ui/AnimatedTabs';
import { CashSandboxDesk, DEFAULT_RISK_SETTINGS, isWithinCashMorningWindow, type CashSandboxRiskSettings } from './CashSandboxDesk';

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
    resultsCalendarData?: import('../../services/alpha/ShadowScreenerService').ResultsCalendarItem[];
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

interface RadarCandidateCardProps {
    cand: any;
    rank: number;
    isExpanded: boolean;
    onToggleExpand: () => void;
    isPunching: boolean;
    punchedInfo?: { orderId: string; timestamp: number };
    verdictResult: any;
    onOpenVerdict: () => void;
    onPunchSandbox: (cand: any, qty: number) => void;
}

const RadarCandidateCard = React.memo(({
    cand,
    rank,
    isExpanded,
    onToggleExpand,
    isPunching,
    punchedInfo,
    verdictResult,
    onOpenVerdict,
    onPunchSandbox
}: RadarCandidateCardProps) => {
    const isShort = cand.action === 'SELL';
    const isVetoed = !!cand.isVetoed;
    const cardBorderClass = isVetoed
        ? 'border-rose-500/40 hover:border-rose-500/70 hover:shadow-rose-950/20'
        : isShort
            ? 'border-rose-500/30 hover:border-rose-500/70 hover:shadow-rose-950/20'
            : cand.strategyId === 'type1_accumulator'
                ? 'border-indigo-500/30 hover:border-indigo-500/70 hover:shadow-indigo-950/20'
                : cand.strategyId === 'type2_pullback'
                    ? 'border-amber-500/30 hover:border-amber-500/70 hover:shadow-amber-950/20'
                    : 'border-slate-800/80 hover:border-slate-700 hover:shadow-slate-900/40';

    const ltp = cand.stock.LTP || cand.stock.lastPrice || 0;
    const qty = Math.max(1, Math.floor(15000 / (ltp || 100)));
    const score = cand.score ?? 50;

    const [intradayAnalysis, setIntradayAnalysis] = useState<any>(null);
    const [isLoading5m, setIsLoading5m] = useState<boolean>(false);

    const handleVerify5m = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isLoading5m) return;
        setIsLoading5m(true);
        try {
            const res = await upstoxMarketDataService.get5mIntradayAnalysis(cand.stock.Symbol);
            if (res && res.status === 'success') {
                setIntradayAnalysis(res);
            }
        } catch (err) {
            console.error('Failed to verify 5m candles:', err);
        } finally {
            setIsLoading5m(false);
        }
    };

    const handlePunchClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isPunching || isVetoed) return;
        onPunchSandbox(cand, qty);
    };

    return (
        <div
            className={`rounded-2xl border bg-gradient-to-br from-slate-900/90 to-slate-950/95 ${cardBorderClass} overflow-hidden shadow-lg transition-colors duration-200`}
        >
            {/* Header Row - Clickable to toggle expand */}
            <div
                className="p-4 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-slate-800/25 transition-colors"
                onClick={onToggleExpand}
            >
                <div className="flex items-center gap-3">
                    <div className="text-slate-500 font-bold text-sm w-6 font-mono">#{String(rank).padStart(2, '0')}</div>
                    <div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-[14.5px] font-bold text-white tracking-normal">{cand.stock.Symbol}</span>
                            {isVetoed && (
                                <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                    VETOED
                                </span>
                            )}
                        </div>
                        <span className="text-[11px] font-medium text-slate-400 truncate block max-w-[145px] mt-0.5">
                            {cand.stock.CompanyName || 'Cash Segment'}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className={`flex items-center justify-center w-8 h-8 rounded-lg border shrink-0 shadow-inner ${
                        isVetoed
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                            : score >= 80 
                                ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400' 
                                : score >= 60 
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                                    : 'bg-slate-800/80 border-slate-700/50 text-slate-400'
                    }`}>
                        <span className="text-[13px] font-black">{score}</span>
                    </div>

                    <div className="text-right">
                        <div className="text-[13px] font-mono font-bold text-white">{formatINR(ltp)}</div>
                        <div className={`text-[11.5px] font-bold ${cand.stock.Change >= 0 ? 'text-emerald-400' : 'text-rose-455'} flex items-center justify-end`}>
                            {cand.stock.Change >= 0 ? (
                                <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400 mr-0.5 shrink-0" />
                            ) : (
                                <TrendingDown className="w-3.5 h-3.5 text-rose-455 mr-0.5 shrink-0" />
                            )}
                            {formatPercentage(cand.stock.Change)}
                        </div>
                    </div>

                    <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-180 text-slate-300' : ''}`} />
                </div>
            </div>

            {/* Live Upstox Anti-Dump Veto Alert Banner */}
            {isVetoed && (
                <div className="mx-4 mb-2.5 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-2 text-rose-300">
                    <div className="flex items-center gap-1.5 font-black text-[9px] uppercase tracking-wider">
                        <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        <span>{cand.vetoReason || '⛔ VETOED: REJECTED FROM HOD'}</span>
                    </div>
                    <span className="text-[7.5px] font-mono font-bold bg-rose-500/20 px-1.5 py-0.5 rounded text-rose-300">
                        EXECUTION BLOCKED
                    </span>
                </div>
            )}

            {/* Badges Row: Verdict + Action + Tier 3 Micro-Evidence Badges */}
            <div className="px-4 pb-2.5 flex items-center gap-1.5 flex-wrap">
                <AlphaVerdictPanel
                    symbol={cand.stock.Symbol}
                    result={verdictResult}
                    variant="badge"
                    onOpenDetail={onOpenVerdict}
                />
                <span className={`text-[9px] font-black px-2 py-0.5 rounded border uppercase tracking-wider ${
                    isVetoed
                        ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                        : isShort
                            ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                            : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                }`}>
                    {isVetoed ? '⛔ VETOED' : isShort ? '🐻 FADE / SHORT' : '⚡ BUY'}
                </span>
                {cand.badges?.map((badge: any, bIdx: number) => (
                    <span
                        key={bIdx}
                        className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase tracking-wide ${badge.colorClass || 'bg-slate-800 border-slate-700 text-slate-300'}`}
                    >
                        {badge.label}: {badge.value}
                    </span>
                ))}
            </div>

            {/* Mini Details Grid */}
            <div className="px-4 py-3 grid grid-cols-3 gap-2 border-t border-slate-900/60 bg-slate-950/40 text-[10px]">
                <div className="bg-slate-900/80 p-1.5 rounded-lg border border-slate-850 flex flex-col justify-between items-center text-center min-h-[52px]">
                    <span className="text-[7.5px] text-slate-500 uppercase font-black block mb-0.5 leading-tight w-full">Trigger</span>
                    <span className="text-white font-bold font-mono text-[14px] truncate block leading-none w-full">₹{cand.entryTrigger}</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded-lg border border-slate-850 flex flex-col justify-between items-center text-center min-h-[52px]">
                    <span className="text-[7.5px] text-slate-500 uppercase font-black block mb-0.5 leading-tight w-full">Target</span>
                    <span className="text-emerald-400 font-bold font-mono text-[14px] truncate block leading-none w-full">₹{cand.target}</span>
                </div>
                <div className="bg-slate-900/80 p-1.5 rounded-lg border border-slate-850 flex flex-col justify-between items-center text-center min-h-[52px]">
                    <span className="text-[7.5px] text-slate-500 uppercase font-black block mb-0.5 leading-tight w-full">Stop Loss</span>
                    <span className="text-rose-400 font-bold font-mono text-[14px] truncate block leading-none w-full">₹{cand.stopLoss}</span>
                </div>
            </div>

            {/* Direct Action Cockpit Banner with 1-Click Sandbox Punch */}
            <div className={`p-3 mx-3 my-2.5 rounded-xl border flex flex-col gap-2 ${
                isVetoed
                    ? 'bg-rose-950/15 border-rose-500/25'
                    : isShort
                        ? 'bg-rose-950/15 border-rose-500/20'
                        : cand.strategyId === 'type1_accumulator'
                            ? 'bg-indigo-950/15 border-indigo-500/20'
                            : cand.strategyId === 'type2_pullback'
                                ? 'bg-amber-950/15 border-amber-500/20'
                                : 'bg-slate-900/30 border-slate-800/60'
            }`}>
                <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-wide ${
                            isVetoed
                                ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                : isShort
                                    ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                    : cand.strategyId === 'type1_accumulator'
                                        ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                                        : cand.strategyId === 'type2_pullback'
                                            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}>
                            {cand.strategyLabel}
                        </span>
                        <span className="text-[10px] font-bold text-slate-300">
                            {cand.strategySubLabel}
                        </span>
                    </div>
                    <span className="text-[9px] font-mono font-bold text-slate-400">
                        ₹15k 5x Margin · Qty: {qty}
                    </span>
                </div>

                <button
                    onClick={handlePunchClick}
                    disabled={isPunching || isVetoed}
                    className={`w-full py-2 px-3 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all duration-200 border active:scale-[0.98] ${
                        isVetoed
                            ? 'bg-rose-950/30 border-rose-500/30 text-rose-400/80 cursor-not-allowed shadow-none'
                            : punchedInfo
                                ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300 shadow-none'
                                : isShort
                                    ? 'bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/30 hover:border-rose-500/50 text-rose-300 shadow-none'
                                    : cand.strategyId === 'type1_accumulator'
                                        ? 'bg-indigo-500/10 hover:bg-indigo-500/20 border-indigo-500/30 hover:border-indigo-500/50 text-indigo-300 shadow-none'
                                        : cand.strategyId === 'type2_pullback'
                                            ? 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 hover:border-amber-500/50 text-amber-300 shadow-none'
                                            : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700/60 text-slate-300 shadow-none'
                    }`}
                >
                    <Zap className={`w-3.5 h-3.5 ${isPunching ? 'animate-spin' : ''}`} />
                    <span>
                        {isVetoed
                            ? '⛔ EXECUTION VETOED (DUMPED FROM HOD)'
                            : punchedInfo
                                ? `Sandbox Order Punched (${punchedInfo.orderId}) ✓`
                                : isPunching
                                    ? 'Punching Sandbox...'
                                    : `⚡ Punch Sandbox (${qty} shares @ MKT)`}
                    </span>
                </button>
            </div>

            {/* Expanded Content - Dual-HUD Architecture */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-slate-900 bg-slate-950/60 overflow-hidden"
                    >
                        <div className="p-4 space-y-3 text-[11px]">
                            <div className="bg-slate-900/40 p-2.5 rounded-xl border border-slate-900/85">
                                <span className="text-[8px] text-slate-500 font-black uppercase tracking-wider block mb-1">Execution Rationale</span>
                                <p className="text-white font-semibold text-xs leading-normal">{cand.whyNote}</p>
                            </div>

                            {/* Dual-HUD: Scout vs Live Reality Arbiter */}
                            <div className="space-y-2">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                    {/* Left Column: 🛰️ Scout Confirmations (StockeZee) */}
                                    <div className="p-2.5 rounded-xl border border-slate-800/60 bg-slate-900/30 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[8.5px] font-black uppercase tracking-wider text-slate-300 flex items-center gap-1">
                                                🛰️ Scout Signals (StockeZee)
                                            </span>
                                            <span className="text-[7.5px] font-bold px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400">
                                                Auxiliary Radar
                                            </span>
                                        </div>
                                        <div className="space-y-1">
                                            {(cand.scoutChecks || cand.p0Checks?.slice(5) || []).map((check: any) => (
                                                <ChecklistBadge key={check.id} label={check.label} pass={check.pass} />
                                            ))}
                                        </div>
                                    </div>

                                    {/* Right Column: 🛡️ Live Reality Arbiter (Upstox Ground Truth) */}
                                    <div className="p-2.5 rounded-xl border border-indigo-500/20 bg-indigo-950/10 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[8.5px] font-black uppercase tracking-wider text-indigo-300 flex items-center gap-1">
                                                🛡️ Live Reality Arbiter (Upstox)
                                            </span>
                                            <span className={`text-[7.5px] font-bold px-1.5 py-0.5 rounded border ${
                                                isVetoed
                                                    ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                                                    : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                                            }`}>
                                                {isVetoed ? 'VETOED ❌' : 'VERIFIED ✓'}
                                            </span>
                                        </div>
                                        <div className="space-y-1">
                                            {(cand.realityChecks || cand.p0Checks?.slice(0, 5) || []).map((check: any) => (
                                                <ChecklistBadge key={check.id} label={check.label} pass={check.pass} />
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Upstox 5-Minute Intraday Candle Verification Box */}
                                <div className="p-2.5 rounded-xl border border-slate-800/80 bg-slate-900/40 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[8.5px] font-black uppercase tracking-wider text-slate-300 flex items-center gap-1">
                                            🕯️ Upstox 5m Candle Telemetry &amp; Anti-Dump Gate
                                        </span>
                                        <button
                                            onClick={handleVerify5m}
                                            disabled={isLoading5m}
                                            className="px-2 py-0.5 rounded-md text-[8.5px] font-bold uppercase tracking-wider bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 transition-colors flex items-center gap-1"
                                        >
                                            {isLoading5m ? <Clock className="w-2.5 h-2.5 animate-spin" /> : <ShieldCheck className="w-2.5 h-2.5" />}
                                            {isLoading5m ? 'Verifying...' : intradayAnalysis ? 'Re-Audit 5m' : 'Audit 5m Candles'}
                                        </button>
                                    </div>

                                    {intradayAnalysis && (
                                        <div className="space-y-1.5 pt-1 border-t border-slate-800/60">
                                            {intradayAnalysis.veto_reasons?.length > 0 ? (
                                                <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/25 space-y-1">
                                                    <div className="text-[8.5px] font-black text-rose-400 uppercase tracking-wide flex items-center gap-1">
                                                        <ShieldAlert className="w-3 h-3 text-rose-400" />
                                                        Dump / Breach Rejections Detected:
                                                    </div>
                                                    {intradayAnalysis.veto_reasons.map((vr: string, vIdx: number) => (
                                                        <div key={vIdx} className="text-[8px] font-mono text-rose-300/90 pl-4">
                                                            • {vr}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-[8.5px] font-bold text-emerald-400 flex items-center gap-1.5">
                                                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                                    All 5m reality checks passed. Solid price retention near HOD and above VWAP.
                                                </div>
                                            )}

                                            {intradayAnalysis.ema_9 !== undefined && (
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1">
                                                    <div className="bg-slate-950/80 p-1.5 rounded border border-slate-800/80 text-center">
                                                        <span className="text-[7.5px] text-slate-400 font-bold uppercase block">9-EMA (5m)</span>
                                                        <span className="text-[11px] font-mono font-bold text-white">₹{intradayAnalysis.ema_9} ({intradayAnalysis.ema_9_distance_pct >= 0 ? '+' : ''}{intradayAnalysis.ema_9_distance_pct}%)</span>
                                                    </div>
                                                    <div className="bg-slate-950/80 p-1.5 rounded border border-slate-800/80 text-center">
                                                        <span className="text-[7.5px] text-slate-400 font-bold uppercase block">Dip Vol (PVCR)</span>
                                                        <span className={`text-[11px] font-mono font-bold ${intradayAnalysis.is_low_vol_dip ? 'text-emerald-400' : 'text-amber-400'}`}>{intradayAnalysis.pvcr}x</span>
                                                    </div>
                                                    <div className="bg-slate-950/80 p-1.5 rounded border border-slate-800/80 text-center">
                                                        <span className="text-[7.5px] text-slate-400 font-bold uppercase block">Upper Wick</span>
                                                        <span className={`text-[11px] font-mono font-bold ${intradayAnalysis.is_upper_wick_rejection ? 'text-rose-400' : 'text-slate-300'}`}>{intradayAnalysis.upper_wick_ratio}%</span>
                                                    </div>
                                                    <div className="bg-slate-950/80 p-1.5 rounded border border-slate-800/80 text-center">
                                                        <span className="text-[7.5px] text-slate-400 font-bold uppercase block">HOD Retest Runway</span>
                                                        <span className="text-[11px] font-mono font-bold text-indigo-300">+{intradayAnalysis.retest_runway_pct}%</span>
                                                    </div>
                                                </div>
                                            )}

                                            {intradayAnalysis.last_candles?.length > 0 && (
                                                <div className="grid grid-cols-6 gap-1 pt-1 text-[7.5px] font-mono">
                                                    {intradayAnalysis.last_candles.map((c: any, cIdx: number) => (
                                                        <div key={cIdx} className="bg-slate-950/70 border border-slate-800 p-1 rounded text-center">
                                                            <div className="text-slate-400 truncate">{c.time.split('T')[1]?.slice(0, 5) || c.time}</div>
                                                            <div className={c.close >= c.open ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                                                ₹{c.close}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
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
});

export type CashRadarTab = 'type1_accumulator' | 'type2_pullback' | 'type3_exhaustion' | 'all_cash';

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
    indicatorMatches = {},
    resultsCalendarData = []
}) => {
    const [activeTab, setActiveTab] = useState<CashRadarTab>('type1_accumulator');
    const { toast } = useToast();
    const [punchingSymbols, setPunchingSymbols] = useState<Record<string, boolean>>({});
    const [punchedOrders, setPunchedOrders] = useState<Record<string, { orderId: string; timestamp: number }>>({});
    const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
    const [verdictSymbol, setVerdictSymbol] = useState<string | null>(null);
    // CC68: conviction cards computed alongside the existing pipeline.
    const [mcsSnaps, setMcsSnaps] = useState<Record<string, any>>({});

    // --- TIER 2 SUB-PILLS: HIERARCHICAL CONTEXTUAL CONTROLS ---
    const [type1LowOpen, setType1LowOpen] = useState<boolean>(true);
    const [type1RoomToUc, setType1RoomToUc] = useState<boolean>(true);
    const [type1RvolMin, setType1RvolMin] = useState<boolean>(false);
    const [type1OrbBreak, setType1OrbBreak] = useState<boolean>(false);
    const [type1BoosterOnly, setType1BoosterOnly] = useState<boolean>(false);
    const [type1InstAccumOnly, setType1InstAccumOnly] = useState<boolean>(false);
    const [type1QualityOnly, setType1QualityOnly] = useState<boolean>(false);
    const [type1AutoPunch, setType1AutoPunch] = useState<boolean>(false);
    const [autoPunchedSession, setAutoPunchedSession] = useState<Record<string, boolean>>({});

    // Type 2: Pullback & Continue (9-EMA / VWAP Dip Buyer)
    const [type2EmaTouch, setType2EmaTouch] = useState<boolean>(false);
    const [type2LowVolDip, setType2LowVolDip] = useState<boolean>(false);
    const [type2HoldingVwap, setType2HoldingVwap] = useState<boolean>(true);
    const [type2QualityOnly, setType2QualityOnly] = useState<boolean>(false);
    const [type2RetestRunway, setType2RetestRunway] = useState<boolean>(false);
    const [type2AutoPunch, setType2AutoPunch] = useState<boolean>(false);

    // Type 3: Exhaustion Trap (Volume / Gap Traps - Fades / Shorts)
    const [type3VolSpike, setType3VolSpike] = useState<boolean>(false);
    const [type3GapTrap, setType3GapTrap] = useState<boolean>(false);
    const [type3RejectionHod, setType3RejectionHod] = useState<boolean>(false);
    const [type3RunwayVwap, setType3RunwayVwap] = useState<boolean>(false);
    const [type3AutoPunch, setType3AutoPunch] = useState<boolean>(false);

    // Cash Sandbox Execution Desk States
    const [isSandboxDeskOpen, setIsSandboxDeskOpen] = useState<boolean>(false);
    const [sandboxPositionsCount, setSandboxPositionsCount] = useState<number>(0);
    const [sandboxRiskSettings, setSandboxRiskSettings] = useState<CashSandboxRiskSettings>(DEFAULT_RISK_SETTINGS);

    const registerSandboxPosition = React.useCallback((cand: any, qty: number, orderId: string) => {
        try {
            const sym = cand.stock.Symbol;
            const ltp = cand.stock.LTP || cand.stock.lastPrice || 0;
            const saved = localStorage.getItem('wealthos_cash_sandbox_positions_v1');
            const list: any[] = saved ? JSON.parse(saved) : [];
            if (!list.some(p => p.symbol === sym)) {
                const newPos = {
                    id: `CSB_${Date.now()}_${sym}`,
                    orderId,
                    symbol: sym,
                    action: cand.action || 'BUY',
                    strategyTag: cand.strategyTag || 'Cash_Strategy1_FlatORB',
                    strategyLabel: cand.strategyLabel || 'STRATEGY 1: SILENT ACCUMULATOR',
                    quantity: qty,
                    entryPrice: ltp,
                    currentPrice: ltp,
                    unrealizedPnl: 0,
                    unrealizedPnlPct: 0,
                    targetPrice: cand.target || (ltp * 1.10),
                    stopLossPrice: cand.stopLoss || (ltp * 0.99),
                    trailingStopLoss: cand.stopLoss || (ltp * 0.99),
                    trailState: 'NONE',
                    entryTime: Date.now(),
                    isNearCircuit: (cand.ucDistance || 10) <= 0.8,
                    roomToUc: cand.ucDistance || 10,
                    upperCircuit: cand.ucPrice || (ltp * 1.20)
                };
                list.unshift(newPos);
                localStorage.setItem('wealthos_cash_sandbox_positions_v1', JSON.stringify(list));
                window.dispatchEvent(new Event('wealthos_sandbox_positions_updated'));
            }
        } catch (e) {
            console.error('Failed to register sandbox position:', e);
        }
    }, []);

    // All Cash Universe Overview
    const [allCashMinRvol, setAllCashMinRvol] = useState<boolean>(false);
    const [allCashNearHod, setAllCashNearHod] = useState<boolean>(false);

    // Stock-type classifier config (shared with the Python backtest brain)
    const [stockTypeConfig, setStockTypeConfig] = useState<StockTypeThresholds | null>(null);
    useEffect(() => {
        let alive = true;
        loadStockTypeConfig().then(cfg => { if (alive) setStockTypeConfig(cfg); }).catch(() => {});
        return () => { alive = false; };
    }, []);
    // Classify one live stock into the strategy_brief taxonomy (NaN-safe)
    const stockTypeOf = (stock: any): { typeId: string; priority: number } => {
        if (!stockTypeConfig) return { typeId: 'NONE', priority: 9 };
        try {
            const feats = computeStockTypeFeatures({
                ltp: stock.LTP || stock.lastPrice || 0,
                openPrice: stock.Open || stock.todayOpen || stock.openPrice || 0,
                high: stock.High || stock.high || 0,
                low: stock.Low || stock.low || 0,
                openingGapPct: stock.openingGapPct ?? 0,
                atr: stock.atr ?? null,
                volumeAverages20: volumeAverages?.[stock.Symbol] || volumeAverages?.[stock.Symbol?.toLowerCase()] || undefined,
            }, (stock.candleBuffer || stock.candles) as LiveCandle[] | undefined);
            const r = classifyStockType(feats, 'cash', stockTypeConfig);
            return { typeId: r.type_id, priority: r.priority };
        } catch { return { typeId: 'NONE', priority: 9 }; }
    };

    const [prefetchEnabled, setPrefetchEnabled] = useState<boolean>(() => {
        return localStorage.getItem('enable_rvol_prefetch') === 'true';
    });

    const handleTogglePrefetch = () => {
        const newValue = !prefetchEnabled;
        setPrefetchEnabled(newValue);
        localStorage.setItem('enable_rvol_prefetch', String(newValue));
        if (newValue && pulseStocks.length > 0) {
            const symbols = pulseStocks.map(s => s.Symbol);
            bulkPrefetchHistoricalCandles(symbols).catch(() => {});
        }
    };

    // --- Advanced Live Feeds State ---
    const [fetchedQuotes, setFetchedQuotes] = useState<Record<string, any>>({});
    const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);

    const ticks = useGlobalTickStore((s) => s.ticks);
    const [symbolToKey, setSymbolToKey] = useState<Record<string, string>>({});

    useEffect(() => {
        if (pulseStocks.length === 0) return;
        const symbols = pulseStocks.map(s => s.Symbol);
        let active = true;
        upstoxInstrumentService.getInstrumentKeys(symbols, 'NSE_EQ').then(keysMap => {
            if (active) setSymbolToKey(keysMap);
        });
        return () => { active = false; };
    }, [pulseStocks]);

    const pulseStocksWithLive = useMemo(() => {
        return pulseStocks.map(stock => {
            const key = symbolToKey[stock.Symbol];
            const tick = key ? ticks[key] : null;
            if (!tick) return stock;

            const liveLtp = tick.ltp !== null ? tick.ltp : stock.LTP || 0;
            const liveVolume = tick.volume !== null ? tick.volume : stock.Volume || 0;
            const prevClose = tick.close !== null && tick.close !== undefined ? tick.close : (stock.prevClose || (stock.Open ? stock.Open / (1 + stock.Change / 100) : liveLtp / (1 + stock.Change / 100)));
            const liveChange = prevClose > 0 ? ((liveLtp - prevClose) / prevClose) * 100 : stock.Change || 0;
            const liveHigh = stock.High || liveLtp;
            const liveLow = stock.Low || liveLtp;
            const liveOpen = stock.Open || liveLtp;

            return {
                ...stock,
                LTP: liveLtp,
                Volume: liveVolume,
                Change: liveChange,
                High: liveHigh,
                Low: liveLow,
                Open: liveOpen,
                prevClose
            };
        });
    }, [pulseStocks, symbolToKey, ticks]);

    const liveQuotes = useMemo(() => {
        const merged = { ...fetchedQuotes };
        pulseStocks.forEach(stock => {
            const key = symbolToKey[stock.Symbol];
            const tick = key ? ticks[key] : null;
            if (tick) {
                merged[stock.Symbol] = {
                    ...merged[stock.Symbol],
                    last_price: tick.ltp !== null ? tick.ltp : merged[stock.Symbol]?.last_price,
                    volume: tick.volume !== null ? tick.volume : merged[stock.Symbol]?.volume,
                    close: tick.close !== null ? tick.close : merged[stock.Symbol]?.close,
                };
            }
        });
        return merged;
    }, [pulseStocks, symbolToKey, ticks, fetchedQuotes]);

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

    const handleToggleExpand = React.useCallback((sym: string) => {
        setExpandedSymbol(prev => prev === sym ? null : sym);
    }, []);

    const handleOpenVerdict = React.useCallback((sym: string) => {
        setVerdictSymbol(sym);
    }, []);

    const handlePunchCandidate = React.useCallback(async (cand: any, qty: number) => {
        const sym = cand.stock.Symbol;
        setPunchingSymbols(prev => {
            if (prev[sym]) return prev;
            return { ...prev, [sym]: true };
        });
        try {
            const action = cand.action || 'BUY';
            const strategyTag = cand.strategyTag || 'Cash_Strategy1_FlatORB';
            const ltp = cand.stock.LTP || cand.stock.lastPrice || 0;
            const score = cand.score ?? 50;
            const rvol = cand.rvol ?? 1.0;
            const resp = await fetch('/api/python-nse/api/openalgo/placeorder-sandbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: sym,
                    action,
                    exchange: 'NSE',
                    quantity: qty,
                    pricetype: 'MARKET',
                    product: 'MIS',
                    strategy: strategyTag,
                    reasoning: `${cand.strategyLabel} | Score: ${score} | Target: ₹${cand.target} | SL: ₹${cand.stopLoss} | RVOL: ${rvol.toFixed(1)}x`
                })
            });
            const data = await resp.json().catch(() => ({}));
            if (resp.ok && data.status === 'success') {
                const orderId = String(data.orderid || `SBX_${Date.now().toString().slice(-4)}`);
                setPunchedOrders(prev => ({ ...prev, [sym]: { orderId, timestamp: Date.now() } }));
                registerSandboxPosition(cand, qty, orderId);
                setIsSandboxDeskOpen(true);
                toast.success(`⚡ Sandbox Order Punched: ${action} ${qty} ${sym} @ ₹${ltp} (#${orderId})`);
            } else {
                const mockId = `SBX_MOCK_${Date.now().toString().slice(-4)}`;
                setPunchedOrders(prev => ({ ...prev, [sym]: { orderId: mockId, timestamp: Date.now() } }));
                registerSandboxPosition(cand, qty, mockId);
                setIsSandboxDeskOpen(true);
                toast.info(`⚡ Sandbox Order Recorded: ${action} ${qty} ${sym} (#${mockId})`);
            }
        } catch (err) {
            const mockId = `SBX_LOCAL_${Date.now().toString().slice(-4)}`;
            setPunchedOrders(prev => ({ ...prev, [sym]: { orderId: mockId, timestamp: Date.now() } }));
            registerSandboxPosition(cand, qty, mockId);
            setIsSandboxDeskOpen(true);
            toast.info(`⚡ Sandbox Order Queued: ${sym} (#${mockId})`);
        } finally {
            setPunchingSymbols(prev => ({ ...prev, [sym]: false }));
        }
    }, [toast, registerSandboxPosition]);

    // CC68.17: Two paths so the panel is NEVER stuck on the empty message.
    //
    //  (A) Synchronous fall-back — runs the lightweight ConvictionEngine
    //      over the cash hook fields (RVOL, G, R, O2C, day-extreme, sector
    //      score). NO network calls. Returns a usable ENTRY/WATCH/SKIP
    //      verdict in <1 frame. This is what the user sees first.
    //
    //  (B) Async MCS upgrade — kicks off the MCE orchestrator (3s dedupe)
    //      to enrich the synchronous verdict with MCS sub-scores (Group F).
    //      Catches every error so one bad symbol can't kill the whole panel.
    //
    // CC68.12: cash-only stocks (CEMPRO, BSL, AARON, …) have no option
    // chain. /api/upstox/option-chain returns 404, the orchestrator returns
    // null, the ConvictionEngine marks Group F as "data unavailable" but
    // does NOT kill the card.
    const [loadingMcs, setLoadingMcs] = useState(false);

    // Fetch MCS snaps once when static pulseStocks changes
    useEffect(() => {
        if (pulseStocks.length === 0) return;
        let cancelled = false;
        (async () => {
            setLoadingMcs(true);
            try {
                const top30 = pulseStocks.slice(0, 30);
                const snaps: Record<string, any> = {};
                await Promise.all(
                    top30.map(async (stock) => {
                        const sym = stock.Symbol;
                        try {
                            const snap = await mceOrchestrator.score(sym, 'PRE_ENTRY');
                            snaps[sym] = snap;
                        } catch {
                            snaps[sym] = null;
                        }
                    })
                );
                if (!cancelled) {
                    setMcsSnaps(snaps);
                }
            } catch (err) {
                console.error('Error prefetching MCS snaps:', err);
            } finally {
                if (!cancelled) setLoadingMcs(false);
            }
        })();
        return () => { cancelled = true; };
    }, [pulseStocks]);

    const convictionCards = useMemo(() => {
        if (pulseStocksWithLive.length === 0) return [];
        return pulseStocksWithLive.slice(0, 30).map((ps) => {
            const sym = ps.Symbol;
            const mcsSnap = mcsSnaps[sym] || null;

            const mapped = {
                symbol: sym,
                sector: (ps as any).Sector ?? '',
                lastPrice: (ps as any).LTP ?? 0,
                previousClose: (ps as any).prevClose ?? 0,
                openPrice: (ps as any).Open ?? 0,
                high: (ps as any).High ?? 0,
                low: (ps as any).Low ?? 0,
                percentChange: (ps as any).Change ?? 0,
                volume: (ps as any).Volume ?? 0,
                value: (ps as any).Value ?? 0,
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

            const ltp = mapped.lastPrice || 0;
            const op = mapped.openPrice || 0;
            const dirSign = mapped.signal === 'Up' ? 1 : -1;
            const o2cPct = op > 0 ? ((ltp - op) / op) * 100 * dirSign : 0;
            const turnoverCr = (ltp * (mapped.volume || 0)) / 1e7;
            const rvolProxy = Math.min(3, Math.max(0.5, turnoverCr / 50));
            const orbProxy = op > 0 && ltp > 0 && Math.abs((ltp - op) / op) * 100 < 0.4;

            const cs = convictionScore(buildInputsFromStock(mapped, {
                mcs: mcsSnap,
                direction: mapped.signal === 'Up' ? 'CALL' : 'PUT',
                rvol: rvolProxy,
                o2cOverride: o2cPct,
                orbPreserved: orbProxy ? true : null,
            } as any));

            return {
                symbol: sym,
                companyName: (ps as any).CompanyName || '',
                ltp: mapped.lastPrice,
                change: mapped.percentChange,
                sector: mapped.sector,
                conviction: cs,
            };
        });
    }, [pulseStocksWithLive, mcsSnaps]);

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
        if (!pulseStocksWithLive || pulseStocksWithLive.length === 0) return [];
        const isTargetActive = advancedFilters?.applyToCardView ?? true;
        if (!isTargetActive) return [...pulseStocksWithLive];

        return pulseStocksWithLive.filter(stock => {
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

    // =========================================================================
    // 🟢 TIER 1 SETUP 1: TYPE 1 SILENT ACCUMULATOR (Upper Circuit Hunter)
    // =========================================================================
    const type1Candidates = useMemo(() => {
        if (!filteredStocks || filteredStocks.length === 0) return [];
        const candidates: any[] = [];

        filteredStocks.forEach(stock => {
            const ltp = stock.LTP || 0;
            const open = stock.Open || stock.todayOpen || 0;
            const low = stock.Low || 0;
            const high = stock.High || 0;
            const change = stock.Change || 0;
            const prevCloseVal = stock.prevClose || (open > 0 ? open / (1 + change / 100) : ltp / (1 + change / 100));

            if (ltp <= 0 || open <= 0) return;

            const sym = stock.Symbol.toUpperCase();

            // 1. Upstox Live Primary Indicators & Reality Ground Truth
            const quote = liveQuotes[stock.Symbol];
            const ucPrice = quote?.upper_circuit_limit || prevCloseVal * 1.20;
            const ucDistance = quote?.upper_circuit_limit 
                ? ((quote.upper_circuit_limit - ltp) / ltp) * 100 
                : ((ucPrice - ltp) / ltp) * 100;

            const lowOpenDiffPct = open > 0 && low > 0 ? (Math.abs(open - low) / open) * 100 : 99;
            const isLowEqualsOpen = lowOpenDiffPct <= 0.15 || (open > 0 && low === open) || openLowStocks.some(s => s.Symbol.toUpperCase() === sym);

            const adv = volumeAverages[stock.Symbol] || quote?.adv || 0;
            const todayVol = quote?.volume || stock.Volume || 0;
            const rvol = adv > 0 ? todayVol / adv : (quote?.rvol || 1.0);

            const dayRange = high - low;
            const dayExtreme = dayRange > 0 ? (ltp - low) / dayRange : 0.5;
            const openingGap = prevCloseVal > 0 ? ((open - prevCloseVal) / prevCloseVal) * 100 : 0;

            // Exhaustion trap filter (ADFFOODS archetype)
            const isExhausted = rvol >= 7.0 || (dayExtreme > 0.92 && change > 5.5) || openingGap >= 5.0;
            if (isExhausted) return;

            // Upstox Ground Truth Reality Checks
            const hodDistPct = high > 0 ? ((high - ltp) / high) * 100 : 0;
            const isHodRetaining = quote?.is_hod_retaining ?? (high > 0 ? (ltp >= high * 0.985) : true);
            const vwap = quote?.average_price || quote?.vwap || 0;
            const isHoldingVwap = quote?.is_above_vwap ?? (vwap > 0 ? ltp >= vwap * 0.998 : ltp >= open);
            const vwapDist = vwap > 0 ? ((ltp - vwap) / vwap) * 100 : 0;
            const dai = quote?.dai ?? 1.0;
            const depthPressure = quote?.depth_pressure ?? 'NEUTRAL';
            const isDaiFavorable = dai >= 0.8 || depthPressure !== 'SELL_SIDE';
            const roomToUc = quote?.room_to_uc ?? ucDistance;
            const isLiquidUniverse = adv >= 50000;

            // Ground Truth Anti-Dump Veto Flag
            let isVetoed = false;
            let vetoReason = '';
            if (!isHodRetaining && hodDistPct > 1.5) {
                isVetoed = true;
                vetoReason = `⛔ VETOED: REJECTED FROM HOD (-${hodDistPct.toFixed(1)}% off high)`;
            } else if (vwap > 0 && ltp < vwap * 0.99) {
                isVetoed = true;
                vetoReason = `⛔ VETOED: BROKE VWAP SUPPORT (-${Math.abs(vwapDist).toFixed(1)}% below VWAP)`;
            }

            // 2. StockeZee Intraday Booster (Velocity Rank)
            const boosterMatch = boosterStocksList?.find((item: any) => 
                (item.symbol_name || item.Symbol || '').toUpperCase() === sym
            );
            const boosterScore = Number(boosterMatch?.current_score || boosterMatch?.['Strength Factor'] || 0);
            const isBoosterBullish = !!boosterMatch && ((boosterMatch.trend || '').toUpperCase() === 'BULLISH' || boosterScore > 0);

            // 3. StockeZee Multi-Timeframe ORB Breakout (15m / 30m)
            let isOrb15Breakout = false;
            let orbPrice = 0;
            const orb15List = orbDataCache?.['15_false'] || orbDataCache?.['15_true'] || [];
            if (Array.isArray(orb15List)) {
                const orbMatch = orb15List.find((item: any) => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
                if (orbMatch) {
                    orbPrice = Number(orbMatch.orb_price || orbMatch.orbPrice || 0);
                    isOrb15Breakout = orbMatch.breakout === 'Bullish' || (orbPrice > 0 && ltp >= orbPrice);
                }
            }
            const isOrbBullish = isOrb15Breakout || orbData[stock.Symbol] === true || ((stock as any).isORBLowPreservedProxy ?? false);

            // 4. StockeZee Institutional Shareholding (FII / Promoter Accumulation)
            const fiiBuyList = shareholdingDataCache?.['fii_buy'] || [];
            const promoterBuyList = shareholdingDataCache?.['promoter_buy'] || [];
            const fiiMatch = fiiBuyList.find((item: any) => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
            const promoterMatch = promoterBuyList.find((item: any) => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
            const fiiChange = parseFloat(fiiMatch?.change_in_fii_hold || '0') || 0;
            const promoterChange = parseFloat(promoterMatch?.change_in_promoters_hold || '0') || 0;
            const ownershipScore = calculateOwnershipScore(sym, shareholdingDataCache || {}) || 
                                   (shareholdingMap?.[sym]?.accumulation_flag === 'ACCUMULATING' ? 1.0 : 0);
            const isInstitutionalAccumulated = ownershipScore > 0 || fiiChange > 0 || promoterChange > 0 || (shareholdingMap?.[sym]?.fii_velocity || 0) > 0;

            // 5. StockeZee Fundamental Quality & Solvency Shield
            let qualityScore = 0;
            let financialStrength = 0;
            const qualityList = qualityDataCache?.['total_score_high'] || qualityDataCache?.['total_score'] || [];
            if (Array.isArray(qualityList)) {
                const qMatch = qualityList.find((item: any) => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
                if (qMatch) {
                    qualityScore = Number(qMatch.total_score || qMatch.score || 0);
                    financialStrength = Number(qMatch.financial_strength_score || 0);
                }
            }
            const isHighQuality = qualityScore >= 65 || financialStrength >= 70;

            // 6. StockeZee Daily Candlestick Pattern Alignment
            let candlePatternName = '';
            let isBullishCandle = false;
            if (dailyCandleData && typeof dailyCandleData === 'object') {
                const patternKeys = Object.keys(dailyCandleData).filter(k => k !== 'available_pattens');
                for (const key of patternKeys) {
                    const list = dailyCandleData[key];
                    if (Array.isArray(list)) {
                        const cMatch = list.find((item: any) => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
                        if (cMatch && (cMatch.pattern_sentiment === 'Bullish' || cMatch.sentiment === 'Bullish')) {
                            isBullishCandle = true;
                            candlePatternName = cMatch.pattern_type || key.replace(/_/g, ' ');
                            break;
                        }
                    }
                }
            }

            // 7. StockeZee Valuation Screener (Margin of Safety)
            let isUndervalued = false;
            let upsidePct = 0;
            const underValuedList = valuationDataCache?.['under_valued'] || [];
            if (Array.isArray(underValuedList)) {
                const valMatch = underValuedList.find((item: any) => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
                if (valMatch) {
                    const intrinsicVal = Number(valMatch.intrinsic_value || valMatch.intrinsicValue || 0);
                    upsidePct = Number(valMatch.upside_percent || valMatch.upside || 0);
                    if (intrinsicVal > ltp || upsidePct >= 10) {
                        isUndervalued = true;
                    }
                }
            }

            // 8. Multi-Timeframe Breakout & Structural Signals
            const prbList = orbDataCache?.['15_true'] || [];
            const isPrbBreakout = Array.isArray(prbList) && prbList.some(
                (item: any) => (item.symbol_name || item.Symbol || '').toUpperCase() === sym && (item.breakout === 'Bullish' || item.breakout === 'BULLISH')
            );

            const orb30List = orbDataCache?.['30_false'] || [];
            const isOrb30Breakout = Array.isArray(orb30List) && orb30List.some(
                (item: any) => (item.symbol_name || item.Symbol || '').toUpperCase() === sym && (item.breakout === 'Bullish' || item.breakout === 'BULLISH')
            );

            const hasRangeBreakout = Array.isArray(indicatorMatches?.[sym]) && indicatorMatches[sym].includes('range_high_breakout');
            const hasVwapCross = Array.isArray(indicatorMatches?.[sym]) && indicatorMatches[sym].includes('vwap_5min_cross_above');

            // 9. Earnings Horizon Safety Shield (Forthcoming Results)
            const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
            const hasEarningsToday = Array.isArray(resultsCalendarData) && resultsCalendarData.some(
                item => (item.symbol || '').toUpperCase() === sym && item.meeting_date === todayStr
            );
            const isEarningsSafe = !hasEarningsToday;

            // Contextual Sub-Pill Filtering (Soft / Independent)
            if (type1LowOpen && !isLowEqualsOpen) return;
            if (type1RoomToUc && ucDistance < 8.0) return;
            if (type1RvolMin && rvol < 1.5) return;
            if (type1OrbBreak && !isOrbBullish) return;
            if (type1BoosterOnly && !isBoosterBullish) return;
            if (type1InstAccumOnly && !isInstitutionalAccumulated) return;
            if (type1QualityOnly && !isHighQuality) return;

            // Multi-Source Confluence Probability Score (0-100)
            let score = 30;
            if (isLowEqualsOpen) score += 15;
            if (ucDistance >= 10.0) score += 10;
            else if (ucDistance >= 5.0) score += 5;
            if (rvol >= 1.5 && rvol <= 4.5) score += 10;
            if (openingGap >= -0.5 && openingGap <= 2.0) score += 5;

            // Divergent Confirmations
            if (isOrbBullish) score += 5;
            if (isOrb30Breakout) score += 5;
            if (isPrbBreakout) score += 5;
            if (isBoosterBullish) score += 10;
            if (isInstitutionalAccumulated) score += 10;
            if (isHighQuality) score += 10;
            if (isBullishCandle) score += 5;
            if (isUndervalued) score += 5;
            if (isEarningsSafe) score += 5;
            if (hasRangeBreakout) score += 5;
            if (hasVwapCross) score += 5;

            if (isVetoed) {
                score = Math.min(score, 25);
            } else {
                score = Math.min(100, Math.max(0, score));
            }

            const confirmationPoints = [
                isLowEqualsOpen,
                ucDistance >= 8.0,
                rvol >= 1.5 && rvol <= 4.5,
                !isExhausted,
                isOrbBullish,
                isOrb30Breakout,
                isPrbBreakout,
                isBoosterBullish,
                isInstitutionalAccumulated,
                isHighQuality,
                isBullishCandle,
                isEarningsSafe,
                isHodRetaining,
                isHoldingVwap,
                isDaiFavorable
            ].filter(Boolean).length;

            const stopLoss = low > 0 ? Number((low * 0.995).toFixed(2)) : Number((open * 0.99).toFixed(2));
            const target = Number(ucPrice.toFixed(2));
            const entryTrigger = Number(ltp.toFixed(2));

            const realityChecks = [
                { id: 'hod_retention', label: `Anti-Dump HOD Retention (<= 1.5% off high: -${hodDistPct.toFixed(1)}%)`, pass: isHodRetaining },
                { id: 'vwap_defense', label: `Intraday VWAP Defense (LTP >= VWAP: ${vwapDist >= 0 ? '+' : ''}${vwapDist.toFixed(1)}%)`, pass: isHoldingVwap },
                { id: 'continuous_liquidity', label: `Liquid Universe Gate (ADV >= 50k: ${formatNumberIndian(adv || 0)} shares)`, pass: isLiquidUniverse },
                { id: 'dai_pressure', label: `Depth Asymmetry (DAI >= 0.8: ${dai.toFixed(1)}x ${depthPressure})`, pass: isDaiFavorable },
                { id: 'uc_runway', label: `Circuit Runway (>= 5% room to UC: +${roomToUc.toFixed(1)}%)`, pass: roomToUc >= 5.0 }
            ];

            const scoutChecks = [
                { id: 'low_open', label: 'Low = Open Support (< 0.15% wick)', pass: isLowEqualsOpen },
                { id: 'rvol_pacing', label: 'Controlled RVOL Pacing (1.5x - 4.5x)', pass: rvol >= 1.5 && rvol <= 4.5 },
                { id: 'orb_15', label: '15m Opening Range Breakout', pass: isOrbBullish },
                { id: 'orb_30', label: '30m Multi-Timeframe Confirmation', pass: isOrb30Breakout },
                { id: 'prb_prior_high', label: 'Prior Day High Cleared (PRB)', pass: isPrbBreakout },
                { id: 'booster_velocity', label: 'StockeZee Booster Velocity Rank', pass: isBoosterBullish },
                { id: 'inst_accum', label: 'FII / Promoter Inventory Accumulation', pass: isInstitutionalAccumulated },
                { id: 'quality_shield', label: 'Fundamental Quality & Solvency Shield', pass: isHighQuality },
                { id: 'candle_pattern', label: 'Bullish Daily Candlestick Pattern', pass: isBullishCandle },
                { id: 'clean_earnings', label: 'Clean Earnings Horizon (No Results Today)', pass: isEarningsSafe }
            ];

            candidates.push({
                stock,
                score,
                action: 'BUY' as const,
                strategyId: 'type1_accumulator' as const,
                strategyTag: 'Cash_Strategy1_FlatORB',
                strategyLabel: 'STRATEGY 1: SILENT ACCUMULATOR',
                strategySubLabel: isVetoed ? '⛔ VETOED: REJECTED FROM HOD' : `${confirmationPoints}/15 Ground Truth & Scout Confirmations`,
                rvol,
                ucPrice,
                ucDistance,
                stopLoss,
                target,
                entryTrigger,
                isVetoed,
                vetoReason,
                upstoxReality: {
                    isHodRetaining,
                    hodDistPct,
                    isHoldingVwap,
                    vwapDist,
                    dai,
                    depthPressure,
                    isDaiFavorable,
                    roomToUc,
                    isLiquidUniverse,
                    vwap
                },
                whyNote: isVetoed 
                    ? `REJECTED BY UPSTOX GROUND TRUTH: ${vetoReason}. Stock dumped ${hodDistPct.toFixed(1)}% off High of Day. Never buy a stock collapsing through VWAP.`
                    : `Exhaustive dual-engine confluence (${confirmationPoints}/15 verified criteria): ${isLowEqualsOpen ? 'Low=Open base' : ''} ${isBoosterBullish ? '· Booster momentum' : ''} ${isInstitutionalAccumulated ? '· Institutional accumulation' : ''} ${isHighQuality ? '· Quality shield' : ''} ${isOrbBullish ? '· 15m ORB break' : ''} ${isPrbBreakout ? '· PRB prior high cleared' : ''} ${isEarningsSafe ? '· Clean earnings horizon' : ''}. Runway to UC: +${ucDistance.toFixed(1)}%.`,
                badges: [
                    ...(isVetoed ? [{ label: 'STATUS', value: '⛔ VETOED', colorClass: 'text-rose-400 bg-rose-500/20 border-rose-500/40 font-black' }] : []),
                    { label: 'HOD RETENTION', value: `${(100 - hodDistPct).toFixed(1)}%`, colorClass: isHodRetaining ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-400 bg-rose-500/10 border-rose-500/20 font-bold' },
                    { label: 'VWAP DIST', value: `${vwapDist >= 0 ? '+' : ''}${vwapDist.toFixed(1)}%`, colorClass: isHoldingVwap ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
                    { label: 'CONFIRMATIONS', value: `${confirmationPoints}/15`, colorClass: confirmationPoints >= 10 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' },
                    { label: 'LOW = OPEN', value: isLowEqualsOpen ? 'YES ✓' : 'NO', colorClass: isLowEqualsOpen ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-tf-text-muted bg-tf-bg-card border-tf-border' },
                    { label: 'RVOL', value: `${rvol.toFixed(1)}x`, colorClass: getRvolColorClass(rvol, todayVol, ltp) },
                    { label: 'ROOM TO UC', value: `+${ucDistance.toFixed(1)}%`, colorClass: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
                    ...(isBoosterBullish ? [{ label: '🚀 BOOSTER', value: boosterScore > 0 ? `#${boosterScore}` : 'BULLISH', colorClass: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' }] : []),
                    ...(isInstitutionalAccumulated ? [{ label: '🏛 FII/PROMOTER', value: fiiChange > 0 ? `+${fiiChange.toFixed(1)}%` : 'ACCUMULATING', colorClass: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' }] : []),
                    ...(isHighQuality ? [{ label: '⭐ QUALITY', value: qualityScore > 0 ? `${qualityScore}/100` : 'SOLVENT', colorClass: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20' }] : []),
                    ...(isBullishCandle ? [{ label: '🕯 PATTERN', value: candlePatternName || 'BULLISH', colorClass: 'text-amber-300 bg-amber-500/10 border-amber-500/20' }] : []),
                    ...(isPrbBreakout ? [{ label: '⚡ PRB BREAK', value: 'PRIOR HOD', colorClass: 'text-teal-300 bg-teal-500/10 border-teal-500/20' }] : []),
                    ...(isOrb30Breakout ? [{ label: '⏳ 30M ORB', value: 'CONFIRMED', colorClass: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20' }] : []),
                    ...(isEarningsSafe ? [{ label: '📅 EVENT SAFE', value: 'CLEAN', colorClass: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' }] : [{ label: '⚠️ RESULTS TODAY', value: 'EVENT RISK', colorClass: 'text-amber-400 bg-amber-500/10 border-amber-500/20' }]),
                    ...(hasRangeBreakout ? [{ label: '📈 RANGE HIGH', value: 'BREAKOUT', colorClass: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20' }] : []),
                    ...(isUndervalued ? [{ label: '💎 VALUE', value: `+${upsidePct.toFixed(0)}%`, colorClass: 'text-teal-300 bg-teal-500/10 border-teal-500/20' }] : [])
                ],
                realityChecks,
                scoutChecks,
                p0Checks: [...realityChecks, ...scoutChecks]
            });
        });

        const filtered = candidates.filter(c => c.stock.Symbol.toLowerCase().includes(searchTerm.toLowerCase()));
        return filtered.sort((a, b) => {
            if (a.isVetoed !== b.isVetoed) return a.isVetoed ? 1 : -1;
            return b.score - a.score || b.stock.Change - a.stock.Change;
        });
    }, [
        filteredStocks,
        liveQuotes,
        volumeAverages,
        openLowStocks,
        orbData,
        orbDataCache,
        boosterStocksList,
        shareholdingDataCache,
        shareholdingMap,
        qualityDataCache,
        dailyCandleData,
        valuationDataCache,
        resultsCalendarData,
        indicatorMatches,
        searchTerm,
        type1LowOpen,
        type1RoomToUc,
        type1RvolMin,
        type1OrbBreak,
        type1BoosterOnly,
        type1InstAccumOnly,
        type1QualityOnly
    ]);

    // =========================================================================
    // 🟠 TIER 1 SETUP 2: TYPE 2 PULLBACK & CONTINUE (9-EMA Dip Buyer)
    // =========================================================================
    const type2Candidates = useMemo(() => {
        if (!filteredStocks || filteredStocks.length === 0) return [];
        const candidates: any[] = [];

        filteredStocks.forEach(stock => {
            const ltp = stock.LTP || 0;
            const open = stock.Open || stock.todayOpen || 0;
            const low = stock.Low || 0;
            const high = stock.High || 0;
            const change = stock.Change || 0;

            if (ltp <= 0 || open <= 0) return;

            // Must have had an initial morning push (+0.5% to +6%)
            if (change < 0.5) return;

            const quote = liveQuotes[stock.Symbol];
            const vwap = quote?.average_price || quote?.vwap || 0;
            const vwapDist = vwap > 0 ? ((ltp - vwap) / vwap) * 100 : 0;

            const adv = volumeAverages[stock.Symbol] || quote?.adv || 0;
            const todayVol = quote?.volume || stock.Volume || 0;
            const rvol = adv > 0 ? todayVol / adv : (quote?.rvol || 1.0);

            const dayRange = high - low;
            const dayExtreme = dayRange > 0 ? (ltp - low) / dayRange : 0.5;
            const initialPushPct = open > 0 ? ((high - open) / open) * 100 : change;

            const isEmaTouch = vwap > 0 ? Math.abs(vwapDist) <= 1.2 : (dayExtreme >= 0.40 && dayExtreme <= 0.75);
            const isLowVolDip = rvol < 1.2;
            const isHoldingVwap = vwap > 0 ? ltp >= vwap * 0.995 : ltp >= open;

            const hodDistPct = high > 0 ? ((high - ltp) / high) * 100 : 0;
            const isHodRetaining = quote?.is_hod_retaining ?? (high > 0 ? (ltp >= high * 0.985) : true);
            const dai = quote?.dai ?? 1.0;
            const depthPressure = quote?.depth_pressure ?? 'NEUTRAL';
            const isDaiFavorable = dai >= 0.8 || depthPressure !== 'SELL_SIDE';
            const retestRunway = (high > ltp && ltp > 0) ? ((high - ltp) / ltp) * 100 : 0;
            const roomToUc = quote?.room_to_uc ?? retestRunway;
            const isLiquidUniverse = adv >= 50000;

            let isVetoed = false;
            let vetoReason = '';
            if (vwap > 0 && ltp < vwap * 0.985) {
                isVetoed = true;
                vetoReason = `⛔ VETOED: BROKE VWAP SUPPORT (-${Math.abs(vwapDist).toFixed(1)}% below VWAP)`;
            }

            const sym = (stock.Symbol || '').toUpperCase();

            // Institutional & Quality Verification from StockeZee Caches
            let qualityScore = 0;
            const qualityList = qualityDataCache?.['total_score_high'] || qualityDataCache?.['total_score'] || [];
            if (Array.isArray(qualityList)) {
                const qMatch = qualityList.find((item: any) => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
                if (qMatch) {
                    qualityScore = Number(qMatch.total_score || qMatch.score || 0);
                }
            }
            const isHighQuality = qualityScore >= 60;

            const fiiBuyList = shareholdingDataCache?.['fii_buy'] || [];
            const promoterBuyList = shareholdingDataCache?.['promoter_buy'] || [];
            const fiiMatch = fiiBuyList.find((item: any) => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
            const promoterMatch = promoterBuyList.find((item: any) => (item.symbol_name || item.Symbol || '').toUpperCase() === sym);
            const fiiChange = parseFloat(fiiMatch?.change_in_fii_hold || '0') || 0;
            const promoterChange = parseFloat(promoterMatch?.change_in_promoters_hold || '0') || 0;
            const isInstBacked = fiiChange > 0 || promoterChange > 0 || (shareholdingMap?.[sym]?.accumulation_flag === 'ACCUMULATING');

            const isBoosterActive = Array.isArray(boosterStocksList) && boosterStocksList.some((b: any) => (b.symbol || b.Symbol || '').toUpperCase() === sym);

            const hasVwapSupport = Array.isArray(indicatorMatches?.[sym]) && (indicatorMatches[sym].includes('vwap_support') || indicatorMatches[sym].includes('vwap_5min_cross_above'));

            const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
            const hasEarningsToday = Array.isArray(resultsCalendarData) && resultsCalendarData.some(
                item => (item.symbol || '').toUpperCase() === sym && item.meeting_date === todayStr
            );
            const isEarningsSafe = !hasEarningsToday;

            // Contextual Sub-Pill Filtering
            if (type2EmaTouch && !isEmaTouch) return;
            if (type2LowVolDip && !isLowVolDip) return;
            if (type2HoldingVwap && !isHoldingVwap) return;
            if (type2QualityOnly && !isHighQuality) return;
            if (type2RetestRunway && retestRunway < 1.2) return;

            let score = 45;
            if (isHoldingVwap) score += 20;
            if (isEmaTouch) score += 15;
            if (isLowVolDip) score += 10;
            if (retestRunway >= 1.5) score += 10;
            if (initialPushPct >= 1.5 && initialPushPct <= 6.0) score += 10;
            if (isHighQuality) score += 10;
            if (isInstBacked) score += 10;
            if (isBoosterActive) score += 5;
            if (hasVwapSupport) score += 5;
            if (isEarningsSafe) score += 5;

            if (isVetoed) {
                score = Math.min(score, 25);
            } else {
                score = Math.min(100, score);
            }

            const confirmationPoints = [
                isHoldingVwap,
                isEmaTouch,
                isLowVolDip,
                retestRunway >= 1.2,
                initialPushPct >= 1.5,
                isHighQuality,
                isInstBacked,
                isBoosterActive,
                hasVwapSupport,
                isEarningsSafe,
                isDaiFavorable,
                isLiquidUniverse
            ].filter(Boolean).length;

            const stopLoss = vwap > 0 ? Number((vwap * 0.992).toFixed(2)) : Number((low * 0.992).toFixed(2));
            const target = Number(high.toFixed(2)); // Retest of HOD
            const entryTrigger = Number(ltp.toFixed(2));

            const realityChecks = [
                { id: 'holding_vwap', label: `Holding VWAP / 9-EMA Support (${vwapDist >= 0 ? '+' : ''}${vwapDist.toFixed(1)}%)`, pass: isHoldingVwap },
                { id: 'low_vol_dip', label: `Low Volume Pullback (${rvol.toFixed(1)}x < 1.2x)`, pass: isLowVolDip },
                { id: 'retest_runway', label: `Runway to HOD Retest >= 1.2% (+${retestRunway.toFixed(1)}%)`, pass: retestRunway >= 1.2 },
                { id: 'continuous_liquidity', label: `Liquid Universe Gate (ADV >= 50k: ${formatNumberIndian(adv || 0)} shares)`, pass: isLiquidUniverse },
                { id: 'dai_pressure', label: `Depth Asymmetry (DAI >= 0.8: ${dai.toFixed(1)}x ${depthPressure})`, pass: isDaiFavorable }
            ];

            const scoutChecks = [
                { id: 'prior_push', label: `Initial Morning Push (+${initialPushPct.toFixed(1)}%)`, pass: initialPushPct >= 1.5 && initialPushPct <= 6.0 },
                { id: 'ema_touch', label: 'Within 1.2% of 9-EMA / VWAP Equilibrium', pass: isEmaTouch },
                { id: 'quality_shield', label: 'Fundamental Quality & Solvency Shield (>= 60)', pass: isHighQuality },
                { id: 'inst_backing', label: 'FII / Promoter Inventory Accumulation', pass: isInstBacked },
                { id: 'booster_active', label: 'StockeZee Booster Velocity Pulse', pass: isBoosterActive },
                { id: 'clean_earnings', label: 'Clean Earnings Horizon (No Results Today)', pass: isEarningsSafe }
            ];

            candidates.push({
                stock,
                score,
                action: 'BUY' as const,
                strategyId: 'type2_pullback' as const,
                strategyTag: 'Cash_Strategy2_Pullback',
                strategyLabel: 'STRATEGY 2: PULLBACK & CONTINUE',
                strategySubLabel: isVetoed ? '⛔ VETOED: BROKE VWAP' : `${confirmationPoints}/12 Pullback & Retest Confirmations`,
                rvol,
                ucPrice: high,
                ucDistance: retestRunway,
                stopLoss,
                target,
                entryTrigger,
                isVetoed,
                vetoReason,
                upstoxReality: {
                    isHodRetaining,
                    hodDistPct,
                    isHoldingVwap,
                    vwapDist,
                    dai,
                    depthPressure,
                    isDaiFavorable,
                    roomToUc,
                    isLiquidUniverse,
                    vwap
                },
                whyNote: isVetoed
                    ? `REJECTED BY UPSTOX GROUND TRUTH: ${vetoReason}. Broken support below VWAP indicates selling pressure, not an orderly pullback.`
                    : `Initial morning expansion (+${initialPushPct.toFixed(1)}%) followed by low-volume orderly dip to VWAP / 9-EMA support (${rvol.toFixed(1)}x vol). ${isHighQuality ? 'Quality verified. ' : ''}${isInstBacked ? 'Institutional accumulation. ' : ''}${isEarningsSafe ? 'Clean earnings horizon. ' : ''}Targeting retest of High of Day (+${retestRunway.toFixed(1)}% runway).`,
                badges: [
                    ...(isVetoed ? [{ label: 'STATUS', value: '⛔ VETOED', colorClass: 'text-rose-400 bg-rose-500/20 border-rose-500/40 font-black' }] : []),
                    { label: 'PUSH', value: `+${initialPushPct.toFixed(1)}%`, colorClass: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' },
                    { label: 'DIP VOL', value: `${rvol.toFixed(1)}x`, colorClass: rvol < 1.2 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
                    { label: 'VWAP DIST', value: `${vwapDist >= 0 ? '+' : ''}${vwapDist.toFixed(1)}%`, colorClass: Math.abs(vwapDist) <= 1.0 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-tf-text-muted bg-tf-bg-card border-tf-border' },
                    { label: 'RETEST TARGET', value: `₹${high.toFixed(1)} (+${retestRunway.toFixed(1)}%)`, colorClass: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20 font-bold' },
                    { label: 'CONFIRMATIONS', value: `${confirmationPoints}/12`, colorClass: confirmationPoints >= 8 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' },
                    ...(isHighQuality ? [{ label: '⭐ QUALITY', value: `${qualityScore}/100`, colorClass: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20' }] : []),
                    ...(isInstBacked ? [{ label: '🏛 INST. BACKED', value: 'YES ✓', colorClass: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' }] : []),
                    ...(isBoosterActive ? [{ label: '🚀 BOOSTER', value: 'ACTIVE', colorClass: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' }] : []),
                    ...(isEarningsSafe ? [{ label: '📅 EVENT SAFE', value: 'CLEAN', colorClass: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' }] : [{ label: '⚠️ RESULTS TODAY', value: 'EVENT RISK', colorClass: 'text-amber-400 bg-amber-500/10 border-amber-500/20' }])
                ],
                realityChecks,
                scoutChecks,
                p0Checks: [...realityChecks, ...scoutChecks]
            });
        });

        const filtered = candidates.filter(c => c.stock.Symbol.toLowerCase().includes(searchTerm.toLowerCase()));
        return filtered.sort((a, b) => {
            if (a.isVetoed !== b.isVetoed) return a.isVetoed ? 1 : -1;
            return b.score - a.score || b.stock.Change - a.stock.Change;
        });
    }, [filteredStocks, liveQuotes, volumeAverages, qualityDataCache, shareholdingDataCache, shareholdingMap, boosterStocksList, resultsCalendarData, indicatorMatches, searchTerm, type2EmaTouch, type2LowVolDip, type2HoldingVwap, type2QualityOnly, type2RetestRunway]);

    // =========================================================================
    // ⛔ TIER 1 SETUP 3: TYPE 3 EXHAUSTION TRAPS (Hard Exclusion / Fade Scalp)
    // =========================================================================
    const type3Candidates = useMemo(() => {
        if (!filteredStocks || filteredStocks.length === 0) return [];
        const candidates: any[] = [];

        filteredStocks.forEach(stock => {
            const ltp = stock.LTP || 0;
            const open = stock.Open || stock.todayOpen || 0;
            const low = stock.Low || 0;
            const high = stock.High || 0;
            const change = stock.Change || 0;
            const prevCloseVal = stock.prevClose || (open > 0 ? open / (1 + change / 100) : ltp / (1 + change / 100));

            if (ltp <= 0 || open <= 0) return;

            const quote = liveQuotes[stock.Symbol];
            const vwap = quote?.average_price || quote?.vwap || 0;
            const adv = volumeAverages[stock.Symbol] || quote?.adv || 0;
            const todayVol = quote?.volume || stock.Volume || 0;
            const rvol = adv > 0 ? todayVol / adv : (quote?.rvol || 1.0);

            const dayRange = high - low;
            const dayExtreme = dayRange > 0 ? (ltp - low) / dayRange : 0.5;
            const openingGap = prevCloseVal > 0 ? ((open - prevCloseVal) / prevCloseVal) * 100 : 0;
            const upperWick = high - Math.max(open, ltp);
            const upperWickRatio = dayRange > 0 ? (upperWick / dayRange) * 100 : 0;
            const fadeRunwayPct = vwap > 0 && ltp > vwap ? ((ltp - vwap) / ltp) * 100 : (open > 0 && ltp > open ? ((ltp - open) / ltp) * 100 : 0);

            const isVolSpike = rvol >= 5.0;
            const isGapTrap = openingGap >= 4.0;
            const isRejection = (dayExtreme < 0.70 && change > 2.0) || upperWickRatio >= 30.0;
            const isExhaustedFlag = (stock as any).isExhausted || (stock as any).isTrapRisk || (stock as any).is_exhaustion_risk;
            const dai = quote?.dai ?? 1.0;
            const depthPressure = quote?.depth_pressure ?? 'NEUTRAL';
            const hodDistPct = high > 0 ? ((high - ltp) / high) * 100 : 0;

            const sym = (stock.Symbol || '').toUpperCase();
            const hasVolShocker = Array.isArray(indicatorMatches?.[sym]) && indicatorMatches[sym].includes('volume_shocker');

            // Must have at least one trap characteristic
            if (!isVolSpike && !isGapTrap && !isRejection && !isExhaustedFlag) return;

            // Contextual Sub-Pill Filtering
            if (type3VolSpike && !isVolSpike) return;
            if (type3GapTrap && !isGapTrap) return;
            if (type3RejectionHod && !isRejection) return;
            if (type3RunwayVwap && fadeRunwayPct < 1.5) return;

            let score = 50;
            if (isVolSpike) score += 25;
            if (isGapTrap) score += 20;
            if (isRejection) score += 20;
            if (fadeRunwayPct >= 1.5) score += 15;
            if (hasVolShocker) score += 10;
            if (depthPressure === 'SELL_SIDE' || dai < 0.9) score += 10;

            score = Math.min(100, score);

            const stopLoss = Number((high * 1.006).toFixed(2));
            const target = Number((vwap > 0 ? vwap : open).toFixed(2));
            const entryTrigger = Number(ltp.toFixed(2));

            const realityChecks = [
                { id: 'hod_rejection', label: `Upper Wick Rejection at HOD (${upperWickRatio.toFixed(0)}% wick)`, pass: upperWickRatio >= 30.0 || isRejection },
                { id: 'fade_runway', label: `Fade Runway to VWAP/Open >= 1.5% (-${fadeRunwayPct.toFixed(1)}%)`, pass: fadeRunwayPct >= 1.5 },
                { id: 'order_book_pressure', label: `Sell-Side Order Pressure (DAI: ${dai.toFixed(1)}x ${depthPressure})`, pass: depthPressure === 'SELL_SIDE' || dai < 0.9 },
                { id: 'failed_extension', label: `Rejected from High (-${hodDistPct.toFixed(1)}% off HOD)`, pass: hodDistPct >= 1.0 }
            ];

            const scoutChecks = [
                { id: 'vol_spike', label: `Massive Volume Spike (RVOL ${rvol.toFixed(1)}x >= 5x)`, pass: isVolSpike },
                { id: 'gap_trap', label: `Aggressive Opening Gap (+${openingGap.toFixed(1)}% >= 4%)`, pass: isGapTrap },
                { id: 'exhaustion_invariant', label: 'Front-Loaded Momentum Exhaustion Invariant', pass: isExhaustedFlag || isVolSpike || isGapTrap },
                { id: 'vol_shocker', label: 'StockeZee Volume Shocker Match', pass: hasVolShocker }
            ];

            candidates.push({
                stock,
                score,
                action: 'SELL' as const,
                strategyId: 'type3_exhaustion' as const,
                strategyTag: 'Cash_Strategy3_ExhaustionFade',
                strategyLabel: 'STRATEGY 3: EXHAUSTION FADE',
                strategySubLabel: 'Trap Block & Mean Reversion Short',
                rvol,
                ucPrice: 0,
                ucDistance: 0,
                stopLoss,
                target,
                entryTrigger,
                upstoxReality: {
                    isHodRetaining: false,
                    hodDistPct,
                    isHoldingVwap: ltp >= vwap,
                    vwapDist: vwap > 0 ? ((ltp - vwap) / vwap) * 100 : 0,
                    dai,
                    depthPressure,
                    isDaiFavorable: depthPressure === 'SELL_SIDE' || dai < 0.9,
                    roomToUc: 0,
                    isLiquidUniverse: adv >= 50000,
                    vwap
                },
                whyNote: `Exhaustion pump detected. Massive front-loaded volume spike (${rvol.toFixed(1)}x) or large gap up (+${openingGap.toFixed(1)}%) stalling at highs with ${upperWickRatio.toFixed(0)}% upper wick. Hard excluded from buys; fade scalp back to VWAP/Open.`,
                badges: [
                    { label: 'BUY STATUS', value: '⛔ BLOCKED', colorClass: 'text-rose-400 bg-rose-500/20 border-rose-500/40 font-black' },
                    { label: 'RVOL SPIKE', value: `${rvol.toFixed(1)}x`, colorClass: 'text-rose-400 bg-rose-500/10 border-rose-500/20 font-bold' },
                    { label: 'GAP UP', value: `+${openingGap.toFixed(1)}%`, colorClass: openingGap >= 4.0 ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' : 'text-slate-400 bg-slate-900 border-slate-800' },
                    { label: 'WICK REJECTION', value: `${upperWickRatio.toFixed(0)}%`, colorClass: upperWickRatio >= 30 ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' : 'text-slate-400 bg-slate-900 border-slate-800' },
                    { label: 'FADE RUNWAY', value: `-${fadeRunwayPct.toFixed(1)}%`, colorClass: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20' },
                    { label: 'ACTION', value: 'FADE / SHORT', colorClass: 'text-rose-400 bg-rose-500/20 border-rose-500/40 font-black' }
                ],
                realityChecks,
                scoutChecks,
                p0Checks: [...realityChecks, ...scoutChecks]
            });
        });

        const filtered = candidates.filter(c => c.stock.Symbol.toLowerCase().includes(searchTerm.toLowerCase()));
        return filtered.sort((a, b) => b.score - a.score || b.rvol - a.rvol);
    }, [filteredStocks, liveQuotes, volumeAverages, indicatorMatches, searchTerm, type3VolSpike, type3GapTrap, type3RejectionHod, type3RunwayVwap]);

    // =========================================================================
    // 📊 TIER 1 SETUP 4: ALL CASH POOL (Broad Market Universe Overview)
    // =========================================================================
    const allCashCandidates = useMemo(() => {
        if (!filteredStocks || filteredStocks.length === 0) return [];
        let list = filteredStocks.map(stock => {
            const ltp = stock.LTP || 0;
            const open = stock.Open || stock.todayOpen || 0;
            const low = stock.Low || 0;
            const high = stock.High || 0;
            const change = stock.Change || 0;
            const quote = liveQuotes[stock.Symbol];
            const adv = volumeAverages[stock.Symbol] || 0;
            const todayVol = quote?.volume || stock.Volume || 0;
            const rvol = adv > 0 ? todayVol / adv : 1.0;
            const dayRange = high - low;
            const dayExtreme = dayRange > 0 ? (ltp - low) / dayRange : 0.5;
            const prevCloseVal = stock.prevClose || (open > 0 ? open / (1 + change / 100) : ltp / (1 + change / 100));
            const ucPrice = quote?.upper_circuit_limit || prevCloseVal * 1.20;
            const ucDistance = quote?.upper_circuit_limit 
                ? ((quote.upper_circuit_limit - ltp) / ltp) * 100 
                : ((ucPrice - ltp) / ltp) * 100;
            const lowOpenDiffPct = open > 0 && low > 0 ? (Math.abs(open - low) / open) * 100 : 99;
            const isLowEqualsOpen = lowOpenDiffPct <= 0.15 || (open > 0 && low === open);

            const turnoverCr = (ltp * todayVol) / 1e7;

            return {
                stock,
                score: Math.min(100, Math.round(Math.max(10, change * 10 + rvol * 15))),
                action: 'BUY' as const,
                strategyId: 'all_cash' as const,
                strategyTag: 'Cash_Universe_Momentum',
                strategyLabel: 'CASH UNIVERSE ASSET',
                strategySubLabel: `${stock.Sector || 'Cash Segment'} · ${stock.CapCategory || 'Market'}`,
                rvol,
                ucPrice,
                ucDistance,
                stopLoss: low > 0 ? Number((low * 0.995).toFixed(2)) : Number((open * 0.99).toFixed(2)),
                target: Number((high * 1.02).toFixed(2)),
                entryTrigger: Number(ltp.toFixed(2)),
                whyNote: `Active cash universe asset trading with ${rvol.toFixed(1)}x volume pacing and ${change >= 0 ? '+' : ''}${change.toFixed(1)}% session change.`,
                badges: [
                    { label: 'CHANGE', value: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`, colorClass: change >= 0 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
                    { label: 'RVOL', value: `${rvol.toFixed(1)}x`, colorClass: getRvolColorClass(rvol, todayVol, ltp) },
                    { label: 'TURNOVER', value: `₹${turnoverCr.toFixed(1)}Cr`, colorClass: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' },
                    { label: 'DAY EXTREME', value: `${Math.round(dayExtreme * 100)}% HOD`, colorClass: 'text-slate-300 bg-slate-900 border-slate-800' }
                ],
                p0Checks: [
                    { id: 'liquidity_ok', label: 'Turnover > ₹50L', pass: turnoverCr >= 0.5 },
                    { id: 'near_hod', label: 'Proximity to HOD >= 70%', pass: dayExtreme >= 0.70 },
                    { id: 'low_open', label: 'Low = Open support', pass: isLowEqualsOpen }
                ]
            };
        });

        if (allCashMinRvol) {
            list = list.filter(item => item.rvol >= 1.2);
        }
        if (allCashNearHod) {
            list = list.filter(item => {
                const high = item.stock.High || 0;
                const low = item.stock.Low || 0;
                const ltp = item.stock.LTP || 0;
                const dayExtreme = high > low ? (ltp - low) / (high - low) : 0.5;
                return dayExtreme >= 0.80;
            });
        }

        const filtered = list.filter(c => c.stock.Symbol.toLowerCase().includes(searchTerm.toLowerCase()));
        return filtered.sort((a, b) => b.stock.Change - a.stock.Change || b.rvol - a.rvol);
    }, [filteredStocks, liveQuotes, volumeAverages, searchTerm, allCashMinRvol, allCashNearHod]);

    // Auto-punch effect for Type 1 if enabled with full risk guardrails
    useEffect(() => {
        if (!type1AutoPunch || type1Candidates.length === 0) return;

        // Guardrail 1: Max Concurrent Capacity
        if (sandboxPositionsCount >= sandboxRiskSettings.maxConcurrentPositions) return;

        // Guardrail 2: Morning Window Gate (09:18 - 10:30 IST)
        if (sandboxRiskSettings.enforceMorningWindow && !isWithinCashMorningWindow()) return;

        const top = type1Candidates[0];
        // Guardrail 3: Min Confluence Score
        if (!top || top.score < sandboxRiskSettings.minConfluenceScore) return;

        const sym = top.stock.Symbol;
        if (punchedOrders[sym] || autoPunchedSession[sym]) return;

        // Auto punch top verified candidate once
        setAutoPunchedSession(prev => ({ ...prev, [sym]: true }));
        const qty = Math.max(1, Math.floor(sandboxRiskSettings.capitalPerTrade / (top.stock.LTP || 100)));
        fetch('/api/python-nse/api/openalgo/placeorder-sandbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                symbol: sym,
                action: 'BUY',
                exchange: 'NSE',
                quantity: qty,
                pricetype: 'MARKET',
                product: 'MIS',
                strategy: 'Cash_Strategy1_FlatORB',
                reasoning: `Auto-Punch: Score ${top.score} | RVOL ${top.rvol.toFixed(1)}x | Room to UC +${top.ucDistance.toFixed(1)}%`
            })
        }).then(r => r.json()).then(data => {
            const orderId = String(data.orderid || `SBX_${Date.now().toString().slice(-4)}`);
            setPunchedOrders(prev => ({ ...prev, [sym]: { orderId, timestamp: Date.now() } }));
            registerSandboxPosition(top, qty, orderId);
            toast.success(`⚡ Auto-Punched Sandbox: BUY ${qty} ${sym} @ ₹${top.stock.LTP} (#${orderId})`);
        }).catch(() => {
            const mockId = `SBX_MOCK_${Date.now().toString().slice(-4)}`;
            setPunchedOrders(prev => ({ ...prev, [sym]: { orderId: mockId, timestamp: Date.now() } }));
            registerSandboxPosition(top, qty, mockId);
        });
    }, [type1AutoPunch, type1Candidates, punchedOrders, autoPunchedSession, sandboxPositionsCount, sandboxRiskSettings, registerSandboxPosition, toast]);

    // Auto-punch effect for Type 2 (Pullback & Continue) if enabled with full risk guardrails
    useEffect(() => {
        if (!type2AutoPunch || type2Candidates.length === 0) return;
        if (sandboxPositionsCount >= sandboxRiskSettings.maxConcurrentPositions) return;
        if (sandboxRiskSettings.enforceMorningWindow && !isWithinCashMorningWindow()) return;

        const top = type2Candidates[0];
        if (!top || top.score < sandboxRiskSettings.minConfluenceScore || top.isVetoed) return;

        const sym = top.stock.Symbol;
        if (punchedOrders[sym] || autoPunchedSession[sym]) return;

        setAutoPunchedSession(prev => ({ ...prev, [sym]: true }));
        const qty = Math.max(1, Math.floor(sandboxRiskSettings.capitalPerTrade / (top.stock.LTP || 100)));
        fetch('/api/python-nse/api/openalgo/placeorder-sandbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                symbol: sym,
                action: 'BUY',
                exchange: 'NSE',
                quantity: qty,
                pricetype: 'MARKET',
                product: 'MIS',
                strategy: 'Cash_Strategy2_Pullback',
                reasoning: `Auto-Punch Type 2: Score ${top.score} | 9-EMA/VWAP dip | Target ₹${top.target} | SL ₹${top.stopLoss}`
            })
        }).then(r => r.json()).then(data => {
            const orderId = String(data.orderid || `SBX_${Date.now().toString().slice(-4)}`);
            setPunchedOrders(prev => ({ ...prev, [sym]: { orderId, timestamp: Date.now() } }));
            registerSandboxPosition(top, qty, orderId);
            toast.success(`⚡ Auto-Punched Type 2 Pullback: BUY ${qty} ${sym} @ ₹${top.stock.LTP} (#${orderId})`);
        }).catch(() => {
            const mockId = `SBX_MOCK_${Date.now().toString().slice(-4)}`;
            setPunchedOrders(prev => ({ ...prev, [sym]: { orderId: mockId, timestamp: Date.now() } }));
            registerSandboxPosition(top, qty, mockId);
        });
    }, [type2AutoPunch, type2Candidates, punchedOrders, autoPunchedSession, sandboxPositionsCount, sandboxRiskSettings, registerSandboxPosition, toast]);

    // Auto-punch effect for Type 3 (Fade Short) if enabled with full risk guardrails
    useEffect(() => {
        if (!type3AutoPunch || type3Candidates.length === 0) return;
        if (sandboxPositionsCount >= sandboxRiskSettings.maxConcurrentPositions) return;
        if (sandboxRiskSettings.enforceMorningWindow && !isWithinCashMorningWindow()) return;

        const top = type3Candidates[0];
        if (!top || top.score < sandboxRiskSettings.minConfluenceScore) return;

        const sym = top.stock.Symbol;
        if (punchedOrders[sym] || autoPunchedSession[sym]) return;

        setAutoPunchedSession(prev => ({ ...prev, [sym]: true }));
        const qty = Math.max(1, Math.floor(sandboxRiskSettings.capitalPerTrade / (top.stock.LTP || 100)));
        fetch('/api/python-nse/api/openalgo/placeorder-sandbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                symbol: sym,
                action: 'SELL',
                exchange: 'NSE',
                quantity: qty,
                pricetype: 'MARKET',
                product: 'MIS',
                strategy: 'Cash_Strategy3_ExhaustionFade',
                reasoning: `Auto-Punch Type 3 Fade: Score ${top.score} | RVOL ${top.rvol.toFixed(1)}x | Target VWAP ₹${top.target} | SL ₹${top.stopLoss}`
            })
        }).then(r => r.json()).then(data => {
            const orderId = String(data.orderid || `SBX_${Date.now().toString().slice(-4)}`);
            setPunchedOrders(prev => ({ ...prev, [sym]: { orderId, timestamp: Date.now() } }));
            registerSandboxPosition(top, qty, orderId);
            toast.success(`🐻 Auto-Punched Type 3 Fade Short: SELL ${qty} ${sym} @ ₹${top.stock.LTP} (#${orderId})`);
        }).catch(() => {
            const mockId = `SBX_MOCK_${Date.now().toString().slice(-4)}`;
            setPunchedOrders(prev => ({ ...prev, [sym]: { orderId: mockId, timestamp: Date.now() } }));
            registerSandboxPosition(top, qty, mockId);
        });
    }, [type3AutoPunch, type3Candidates, punchedOrders, autoPunchedSession, sandboxPositionsCount, sandboxRiskSettings, registerSandboxPosition, toast]);

    // --- Fetch ORB on Tab Activation ---
    useEffect(() => {
        if (activeTab !== 'type1_accumulator' || !stockezeeToken) return;
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
                // 1. Ingest Upstox Cash Engine 2.0 Universe Snapshot (~660 stocks)
                const cashSnap = await upstoxMarketDataService.getCashUniverseSnapshot();
                if (cashSnap && Array.isArray(cashSnap.stocks) && cashSnap.stocks.length > 0) {
                    const snapQuotes: Record<string, any> = {};
                    cashSnap.stocks.forEach((s: any) => {
                        snapQuotes[s.symbol] = {
                            last_price: s.lastPrice,
                            average_price: s.average_price,
                            vwap: s.vwap,
                            volume: s.volume,
                            ohlc: {
                                open: s.openPrice,
                                high: s.high,
                                low: s.low,
                                close: s.close
                            },
                            upper_circuit_limit: s.upper_circuit_limit,
                            lower_circuit_limit: s.lower_circuit_limit,
                            dai: s.dai,
                            depth_pressure: s.depth_pressure,
                            total_buy_quantity: s.total_buy_quantity,
                            total_sell_quantity: s.total_sell_quantity,
                            is_above_vwap: s.is_above_vwap,
                            hod_proximity: s.hod_proximity,
                            is_hod_retaining: s.is_hod_retaining,
                            rvol: s.rvol,
                            adv: s.adv,
                            room_to_uc: s.room_to_uc
                        };
                    });
                    setFetchedQuotes(prev => ({ ...snapQuotes, ...prev }));
                    if (cashSnap.volume_averages && typeof cashSnap.volume_averages === 'object') {
                        setVolumeAverages?.((prev: Record<string, number>) => ({ ...prev, ...cashSnap.volume_averages }));
                    }
                }

                // 2. Fetch cached averages once from db (cached for 12h fallback)
                if (Object.keys(volumeAverages).length === 0) {
                    const data = await upstoxMarketDataService.getAllVolumeAverages();
                    setVolumeAverages?.(data || {});
                }

                // 3. Identify top 15 symbols to sync live quotes based on active setup
                let candidates: any[] = [];
                if (activeTab === 'type1_accumulator') candidates = type1Candidates;
                else if (activeTab === 'type2_pullback') candidates = type2Candidates;
                else if (activeTab === 'type3_exhaustion') candidates = type3Candidates;
                else candidates = allCashCandidates;
                
                const topSymbols = candidates.slice(0, 15).map(c => c.stock.Symbol || c.stock.symbol);

                if (topSymbols.length > 0) {
                    const quotes = await upstoxMarketDataService.getFullQuotes(topSymbols);
                    if (quotes) {
                        setFetchedQuotes(prev => ({ ...prev, ...quotes }));
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
        <div className="bg-slate-900/20 backdrop-blur-xl rounded-2xl sm:rounded-[2rem] border border-slate-800/60 shadow-2xl overflow-hidden">
            {/* Header section */}
            <div className="px-3.5 sm:px-6 py-3 sm:py-4 border-b border-slate-800/40 bg-slate-900/30">
                <div className="flex flex-row items-center justify-between gap-3 w-full flex-wrap sm:flex-nowrap">
                    <div className="flex items-center gap-2.5 shrink-0">
                        <div className="w-8 h-8 sm:w-9 sm:h-9 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-950/20">
                            <Zap className="w-4 h-4 text-indigo-400 animate-pulse" />
                        </div>
                        <div>
                            <h2 className="text-base sm:text-lg font-black text-white tracking-tight">
                                Cash Segment Radars
                            </h2>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar max-w-full">
                        {/* Premium Sliding Capsule Tabs (Tier 1 Master Strategy Pills) */}
                        <Tabs.Root
                            value={activeTab}
                            onValueChange={(val) => { setActiveTab(val as any); setExpandedSymbol(null); }}
                            layoutId="cash-radar-tabs"
                            variant="solid-indigo"
                            motionPreset="spring"
                        >
                            <Tabs.List className="min-h-[30px] p-0.5 bg-slate-950/80 border border-slate-800/60 whitespace-nowrap">
                                <Tabs.Trigger value="type1_accumulator" className="px-2.5 sm:px-3 min-h-[24px] text-[8.5px] font-black uppercase tracking-wider shrink-0">
                                    🟢 Type 1: Silent Accumulator
                                </Tabs.Trigger>
                                <Tabs.Trigger value="type2_pullback" className="px-2.5 sm:px-3 min-h-[24px] text-[8.5px] font-black uppercase tracking-wider shrink-0">
                                    🟠 Type 2: Pullback &amp; Continue
                                </Tabs.Trigger>
                                <Tabs.Trigger value="type3_exhaustion" className="px-2.5 sm:px-3 min-h-[24px] text-[8.5px] font-black uppercase tracking-wider shrink-0">
                                    ⛔ Type 3: Exhaustion Trap
                                </Tabs.Trigger>
                                <Tabs.Trigger value="all_cash" className="px-2.5 sm:px-3 min-h-[24px] text-[8.5px] font-black uppercase tracking-wider shrink-0">
                                    📊 All Cash Pool
                                </Tabs.Trigger>
                            </Tabs.List>
                        </Tabs.Root>
                    </div>
                </div>

                {/* Tier 2: Secondary Contextual Sub-Pills (Per Master Tab) */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-3 pt-3 border-t border-tf-border/40">
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar max-w-full py-0.5 sm:flex-wrap">
                        <span className="text-[8px] font-black uppercase text-tf-text-muted tracking-wider mr-1 shrink-0">Contextual Filters:</span>
                        <AnimatePresence mode="wait">
                            {activeTab === 'type1_accumulator' && (
                                <motion.div
                                    key="type1-subpills"
                                    initial={{ opacity: 0, y: -5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -5 }}
                                    className="flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 sm:flex-wrap"
                                >
                                    <button
                                        onClick={() => setType1LowOpen(!type1LowOpen)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            type1LowOpen
                                                ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400 font-black shadow-inner shadow-emerald-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                    >
                                        🏛 Low = Open (0.15% wick)
                                    </button>
                                    <button
                                        onClick={() => setType1RoomToUc(!type1RoomToUc)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            type1RoomToUc
                                                ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400 font-black shadow-inner shadow-indigo-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                    >
                                        ⚡ Room to UC (≥ 8%)
                                    </button>
                                    <button
                                        onClick={() => setType1RvolMin(!type1RvolMin)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            type1RvolMin
                                                ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400 font-black shadow-inner shadow-indigo-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                    >
                                        📊 RVOL ≥ 1.5x
                                    </button>
                                    <button
                                        onClick={() => setType1OrbBreak(!type1OrbBreak)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            type1OrbBreak
                                                ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400 font-black shadow-inner shadow-indigo-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                    >
                                        ⏳ 15m ORB Break
                                    </button>
                                    <button
                                        onClick={() => setType1BoosterOnly(!type1BoosterOnly)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            type1BoosterOnly
                                                ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-400 font-black shadow-inner shadow-cyan-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                        title="Filter to stocks detected in StockeZee Intraday Booster momentum stream"
                                    >
                                        🚀 Booster Mark
                                    </button>
                                    <button
                                        onClick={() => setType1InstAccumOnly(!type1InstAccumOnly)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            type1InstAccumOnly
                                                ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400 font-black shadow-inner shadow-emerald-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                        title="Filter to stocks with verified FII or Promoter quarterly shareholding accumulation"
                                    >
                                        🏦 Inst. Accum
                                    </button>
                                    <button
                                        onClick={() => setType1QualityOnly(!type1QualityOnly)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            type1QualityOnly
                                                ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400 font-black shadow-inner shadow-indigo-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                        title="Filter to fundamentally solvent stocks (Quality Score >= 65, Strength >= 70)"
                                    >
                                        ⭐ Quality ≥ 65
                                    </button>
                                    <button
                                        onClick={() => setType1AutoPunch(!type1AutoPunch)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap flex items-center gap-1.5 ${
                                            type1AutoPunch
                                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                        title="When ON, auto-dispatches a single sandbox trade on top 5/5 verified candidate (₹15k 5x margin)."
                                    >
                                        <span className={`w-1.5 h-1.5 rounded-full ${type1AutoPunch ? 'bg-amber-400' : 'bg-tf-text-muted'}`} />
                                        <span>Auto-Punch Sandbox: {type1AutoPunch ? 'ARMED' : 'OFF'}</span>
                                    </button>
                                </motion.div>
                            )}
                            {activeTab === 'type2_pullback' && (
                                <motion.div
                                    key="type2-subpills"
                                    initial={{ opacity: 0, y: -5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -5 }}
                                    className="flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 sm:flex-wrap"
                                >
                                    <button
                                        onClick={() => setType2EmaTouch(!type2EmaTouch)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            type2EmaTouch
                                                ? 'bg-amber-600/20 border-amber-500/40 text-amber-400 font-black shadow-inner shadow-amber-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                    >
                                        📈 9-EMA Proximity (≤ 1.2%)
                                    </button>
                                    <button
                                        onClick={() => setType2LowVolDip(!type2LowVolDip)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            type2LowVolDip
                                                ? 'bg-amber-600/20 border-amber-500/40 text-amber-400 font-black shadow-inner shadow-amber-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                    >
                                        🛡 Low Vol Dip (&lt; 1.2x)
                                    </button>
                                    <button
                                        onClick={() => setType2HoldingVwap(!type2HoldingVwap)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            type2HoldingVwap
                                                ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400 font-black shadow-inner shadow-emerald-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                    >
                                        ⏱ Holding VWAP
                                    </button>
                                    <button
                                        onClick={() => setType2RetestRunway(!type2RetestRunway)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            type2RetestRunway
                                                ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400 font-black shadow-inner shadow-indigo-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                    >
                                        ⚡ Retest Runway (≥ 1.2%)
                                    </button>
                                    <button
                                        onClick={() => setType2QualityOnly(!type2QualityOnly)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            type2QualityOnly
                                                ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400 font-black shadow-inner shadow-indigo-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                        title="Filter to fundamentally solvent pullbacks (Quality Score >= 60)"
                                    >
                                        ⭐ Quality ≥ 60
                                    </button>
                                    <button
                                        onClick={() => setType2AutoPunch(!type2AutoPunch)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap flex items-center gap-1.5 ${
                                            type2AutoPunch
                                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                        title="When ON, auto-dispatches sandbox BUY order on top verified 9-EMA pullback candidate."
                                    >
                                        <span className={`w-1.5 h-1.5 rounded-full ${type2AutoPunch ? 'bg-amber-400' : 'bg-tf-text-muted'}`} />
                                        <span>Auto-Punch Sandbox: {type2AutoPunch ? 'ARMED' : 'OFF'}</span>
                                    </button>
                                </motion.div>
                            )}
                            {activeTab === 'type3_exhaustion' && (
                                <motion.div
                                    key="type3-subpills"
                                    initial={{ opacity: 0, y: -5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -5 }}
                                    className="flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 sm:flex-wrap"
                                >
                                    <button
                                        onClick={() => setType3VolSpike(!type3VolSpike)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            type3VolSpike
                                                ? 'bg-rose-600/20 border-rose-500/40 text-rose-400 font-black shadow-inner shadow-rose-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                    >
                                        ⛔ 5x+ Vol Spikes
                                    </button>
                                    <button
                                        onClick={() => setType3GapTrap(!type3GapTrap)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            type3GapTrap
                                                ? 'bg-rose-600/20 border-rose-500/40 text-rose-400 font-black shadow-inner shadow-rose-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                    >
                                        🚨 Gap &gt; 4% Traps
                                    </button>
                                    <button
                                        onClick={() => setType3RejectionHod(!type3RejectionHod)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            type3RejectionHod
                                                ? 'bg-rose-600/20 border-rose-500/40 text-rose-400 font-black shadow-inner shadow-rose-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                    >
                                        🐻 Rejection at HOD
                                    </button>
                                    <button
                                        onClick={() => setType3RunwayVwap(!type3RunwayVwap)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            type3RunwayVwap
                                                ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-400 font-black shadow-inner shadow-cyan-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                    >
                                        🎯 Runway to VWAP (≥ 1.5%)
                                    </button>
                                    <button
                                        onClick={() => setType3AutoPunch(!type3AutoPunch)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap flex items-center gap-1.5 ${
                                            type3AutoPunch
                                                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                        title="When ON, auto-dispatches sandbox SELL order on top verified exhaustion fade setup."
                                    >
                                        <span className={`w-1.5 h-1.5 rounded-full ${type3AutoPunch ? 'bg-rose-400' : 'bg-tf-text-muted'}`} />
                                        <span>Auto-Punch Fade: {type3AutoPunch ? 'ARMED' : 'OFF'}</span>
                                    </button>
                                </motion.div>
                            )}
                            {activeTab === 'all_cash' && (
                                <motion.div
                                    key="all-cash-subpills"
                                    initial={{ opacity: 0, y: -5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -5 }}
                                    className="flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 sm:flex-wrap"
                                >
                                    <button
                                        onClick={() => setAllCashMinRvol(!allCashMinRvol)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            allCashMinRvol
                                                ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400 font-black shadow-inner shadow-indigo-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                    >
                                        📊 RVOL ≥ 1.2x
                                    </button>
                                    <button
                                        onClick={() => setAllCashNearHod(!allCashNearHod)}
                                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 shrink-0 whitespace-nowrap ${
                                            allCashNearHod
                                                ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400 font-black shadow-inner shadow-indigo-950/40'
                                                : 'bg-tf-bg-card/60 border-tf-border/60 text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                    >
                                        📈 Near HOD (≥ 80%)
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Background prefetch toggle */}
                    <button
                        onClick={handleTogglePrefetch}
                        className={`px-2.5 py-1 rounded-full text-[8.5px] font-bold uppercase tracking-wider border transition-all duration-200 flex items-center gap-1.5 self-start sm:self-center shrink-0 ${
                            prefetchEnabled
                                ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400 font-black shadow-inner shadow-emerald-950/40'
                                : 'bg-slate-950/60 border-slate-850/60 text-slate-550 hover:text-slate-400'
                        }`}
                        title="When ON, fetches 5-minute historical candles in the background for active stocks to calculate Time-of-Day RVOL."
                    >
                        <span>📥 ToD RVOL Download:</span>
                        <span className={`font-black ${prefetchEnabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                            {prefetchEnabled ? 'ON' : 'OFF'}
                        </span>
                    </button>
                </div>

                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-800/20">
                    <Clock className="w-3.5 h-3.5 text-slate-650" />
                    <span>Loaded Cash Universe: <strong className="text-slate-300 font-mono">{filteredStocks.length}</strong> assets</span>
                    {advancedFilters?.excludePennyTraps && (
                        <>
                            <span className="text-slate-700 font-black">·</span>
                            <span className="text-emerald-400 flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                                Penny traps filtered out
                            </span>
                        </>
                    )}
                </div>
            </div>

            {/* Cash Sandbox Execution Desk */}
            <CashSandboxDesk
                liveQuotes={liveQuotes}
                isOpen={isSandboxDeskOpen}
                onToggle={() => setIsSandboxDeskOpen(prev => !prev)}
                onPositionsChange={setSandboxPositionsCount}
                onSettingsChange={setSandboxRiskSettings}
                activeRiskSettings={sandboxRiskSettings}
            />

            {/* Render Tab Contents with Stable unmounting layout */}
            <div className="p-3 sm:p-6">
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
                            {activeTab === 'type1_accumulator' ? (
                                type1Candidates.length === 0 ? (
                                    <div className="p-12 text-center text-slate-500 text-xs font-bold uppercase tracking-wider border border-dashed border-slate-800/40 rounded-3xl">
                                        No stocks meeting Type 1 Silent Accumulator criteria with active sub-pills.
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {type1Candidates.slice(0, 18).map((cand, idx) => (
                                            <RadarCandidateCard
                                                key={`type1-${cand.stock.Symbol}`}
                                                cand={cand}
                                                rank={idx + 1}
                                                isExpanded={expandedSymbol === cand.stock.Symbol}
                                                onToggleExpand={() => handleToggleExpand(cand.stock.Symbol)}
                                                isPunching={!!punchingSymbols[cand.stock.Symbol]}
                                                punchedInfo={punchedOrders[cand.stock.Symbol]}
                                                verdictResult={getVerdictResult(cand.stock.Symbol, false)}
                                                onOpenVerdict={() => handleOpenVerdict(cand.stock.Symbol)}
                                                onPunchSandbox={handlePunchCandidate}
                                            />
                                        ))}
                                    </div>
                                )
                            ) : activeTab === 'type2_pullback' ? (
                                type2Candidates.length === 0 ? (
                                    <div className="p-12 text-center text-slate-500 text-xs font-bold uppercase tracking-wider border border-dashed border-slate-800/40 rounded-3xl">
                                        No stocks meeting Type 2 Pullback &amp; Continue criteria with active sub-pills.
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {type2Candidates.slice(0, 18).map((cand, idx) => (
                                            <RadarCandidateCard
                                                key={`type2-${cand.stock.Symbol}`}
                                                cand={cand}
                                                rank={idx + 1}
                                                isExpanded={expandedSymbol === cand.stock.Symbol}
                                                onToggleExpand={() => handleToggleExpand(cand.stock.Symbol)}
                                                isPunching={!!punchingSymbols[cand.stock.Symbol]}
                                                punchedInfo={punchedOrders[cand.stock.Symbol]}
                                                verdictResult={getVerdictResult(cand.stock.Symbol, false)}
                                                onOpenVerdict={() => handleOpenVerdict(cand.stock.Symbol)}
                                                onPunchSandbox={handlePunchCandidate}
                                            />
                                        ))}
                                    </div>
                                )
                            ) : activeTab === 'type3_exhaustion' ? (
                                type3Candidates.length === 0 ? (
                                    <div className="p-12 text-center text-slate-500 text-xs font-bold uppercase tracking-wider border border-dashed border-slate-800/40 rounded-3xl">
                                        No exhaustion traps detected with active sub-pills. Market float is clean.
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-4">
                                            <div className="flex items-center gap-2 mb-1">
                                                <TrendingDown className="w-4 h-4 text-rose-400" />
                                                <span className="text-[11px] font-black uppercase tracking-wider text-rose-300">
                                                    Exhaustion Trap Shield ({type3Candidates.length}) - Hard Blocked from Buy Lists
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-rose-300/80 font-medium font-sans">
                                                These stocks exhibit extreme volume acceleration (&ge; 5x) or opening gaps (&gt; 4%) that stall. Do NOT buy. Fade or scalp short back to VWAP/Open.
                                            </p>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {type3Candidates.slice(0, 18).map((cand, idx) => (
                                                <RadarCandidateCard
                                                    key={`type3-${cand.stock.Symbol}`}
                                                    cand={cand}
                                                    rank={idx + 1}
                                                    isExpanded={expandedSymbol === cand.stock.Symbol}
                                                    onToggleExpand={() => handleToggleExpand(cand.stock.Symbol)}
                                                    isPunching={!!punchingSymbols[cand.stock.Symbol]}
                                                    punchedInfo={punchedOrders[cand.stock.Symbol]}
                                                    verdictResult={getVerdictResult(cand.stock.Symbol, true)}
                                                    onOpenVerdict={() => handleOpenVerdict(cand.stock.Symbol)}
                                                    onPunchSandbox={handlePunchCandidate}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )
                            ) : (
                                /* ALL CASH POOL */
                                allCashCandidates.length === 0 ? (
                                    <div className="p-12 text-center text-slate-500 text-xs font-bold uppercase tracking-wider border border-dashed border-slate-800/40 rounded-3xl">
                                        No active cash universe stocks matching search criteria.
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {allCashCandidates.slice(0, 24).map((cand, idx) => (
                                            <RadarCandidateCard
                                                key={`allcash-${cand.stock.Symbol}`}
                                                cand={cand}
                                                rank={idx + 1}
                                                isExpanded={expandedSymbol === cand.stock.Symbol}
                                                onToggleExpand={() => handleToggleExpand(cand.stock.Symbol)}
                                                isPunching={!!punchingSymbols[cand.stock.Symbol]}
                                                punchedInfo={punchedOrders[cand.stock.Symbol]}
                                                verdictResult={getVerdictResult(cand.stock.Symbol, false)}
                                                onOpenVerdict={() => handleOpenVerdict(cand.stock.Symbol)}
                                                onPunchSandbox={handlePunchCandidate}
                                            />
                                        ))}
                                    </div>
                                )
                            )}
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
                                    stock={pulseStocksWithLive.find(s => s.Symbol === (verdictSymbol || ''))}
                                    result={getVerdictResult(verdictSymbol || '', activeTab === 'type3_exhaustion')}
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
