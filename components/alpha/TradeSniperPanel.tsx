import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { alphaEngineService, StockData, SectorData } from '../../services/AlphaEngineService';
import { motion, AnimatePresence } from 'framer-motion';
import { Target, RefreshCw, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, XCircle, Zap, Clock, ShieldAlert } from 'lucide-react';
import { openTradingView } from '../../utils/navigation';
import { score as convictionScore, buildInputsFromStock, smoothScoreObject, type ConvictionScore } from '../../services/alpha/ConvictionEngine';
import { mceOrchestrator } from '../../services/mce/orchestrator';
import { computeMorningPicks, R_FACTOR_SECONDARY, type MorningResult, type MorningPick } from '../../services/alpha/MorningMomentumEngine';
import { scoreCleanTrend, type CleanTrendResult } from '../../services/alpha/CleanTrendEngine';
import { getTodayCandles, getHistoricalCandles } from '../../services/IntradayCandleService';
import { useMorningMomentumStore } from '../../store/morningMomentumStore';
import { FNO_STOCKS } from '../../data/fno_stocks';
import { NumberInput } from '../ui/NumberInput';
import { usePausedInterval } from '../../hooks/usePausedInterval';
import { Tabs } from '../ui/AnimatedTabs';
import { ActionButton } from '../ui/ActionButton';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SniperCandidate {
    stock: StockData;
    sectorName: string;
    sectorSCS: number;
    sectorGrade: string;
    sectorFatigue: number;
    sectorFatigueState: string;
    direction: 'CALL' | 'PUT';
    score: number;          // 0–100 composite confidence
    passingChecks: number;  // out of 7
    flags: {
        marketBullish: boolean;
        sectorStrong: boolean;
        sectorNotExhausted: boolean;
        gFactorOk: boolean;
        rFactorOk: boolean;
        notExhausted: boolean;
        notTrapRisk: boolean;
        orbPreserved: boolean;
    };
    reason: string; // one-line reason why this is the top pick
    /** CC68: unified conviction — drives sort + displayed CX score. */
    conviction: ConvictionScore | null;
}

// ─── Score formula ────────────────────────────────────────────────────────────

function computeSniperScore(
    stock: StockData,
    sectorSCS: number,
    sectorFatigueScore: number,
    marketBullish: boolean
): { score: number; passingChecks: number; flags: SniperCandidate['flags']; direction: 'CALL' | 'PUT' } {
    const isBull = stock.signal === 'Up';
    const direction: 'CALL' | 'PUT' = isBull ? 'CALL' : 'PUT';

    const flags: SniperCandidate['flags'] = {
        marketBullish: isBull ? marketBullish : !marketBullish,
        sectorStrong: isBull ? sectorSCS >= 25 : sectorSCS <= -25,
        sectorNotExhausted: isBull ? sectorFatigueScore <= 2 : sectorFatigueScore >= -2,
        gFactorOk: (stock.gFactor ?? 0) >= 6.0,
        rFactorOk: (stock.rFactor ?? 1.0) >= R_FACTOR_SECONDARY,
        notExhausted: !stock.isExhausted,
        notTrapRisk: !stock.isTrapRisk,
        orbPreserved: isBull ? (stock.isORBLowPreservedProxy ?? false) : (stock.isORBHighPreservedProxy ?? false),
    };

    const weights = {
        marketBullish: 10,
        sectorStrong: 20,
        sectorNotExhausted: 10,
        gFactorOk: 20,
        rFactorOk: 15,
        notExhausted: 15,
        notTrapRisk: 5,
        orbPreserved: 5,
    };

    let score = 0;
    let passingChecks = 0;
    (Object.keys(flags) as (keyof typeof flags)[]).forEach(k => {
        if (flags[k]) {
            score += weights[k];
            passingChecks++;
        }
    });

    // Bonus: springboard sector
    if (isBull && sectorFatigueScore <= -3) score = Math.min(100, score + 8);
    if (!isBull && sectorFatigueScore >= 3) score = Math.min(100, score + 8);

    // Bonus: extreme G-Factor
    if ((stock.gFactor ?? 0) >= 8.0) score = Math.min(100, score + 5);

    // Bonus: rebound
    if (stock.isRebound && isBull) score = Math.min(100, score + 5);

    return { score, passingChecks, flags, direction };
}

function buildReason(cand: SniperCandidate): string {
    const parts: string[] = [];
    if (cand.flags.orbPreserved) parts.push('ORB held');
    if (cand.stock.gFactor >= 8) parts.push(`G=${cand.stock.gFactor.toFixed(1)} 🔥`);
    else if (cand.flags.gFactorOk) parts.push(`G=${cand.stock.gFactor.toFixed(1)}`);
    if (cand.flags.rFactorOk) parts.push(`R=${(cand.stock.rFactor ?? 0).toFixed(1)}`);
    if (cand.sectorFatigueState === 'springboard') parts.push('Sector springboard');
    if (cand.stock.isRebound) parts.push('Rebound setup');
    if (cand.flags.sectorStrong) parts.push(`SCS ${cand.sectorSCS > 0 ? '+' : ''}${Math.round(cand.sectorSCS)}`);
    return parts.join(' · ') || 'Multi-factor confluence';
}

// ─── Hard-kill check: if ANY of these are true, candidate is KILLED ───────────

function isKilled(stock: StockData, sectorSCS: number, sectorFatigueScore: number, isBull: boolean): boolean {
    if (stock.isExhausted) return true;
    if (stock.isTrapRisk) return true;
    if ((stock.gFactor ?? 0) < 4.0) return true;
    // Must have sector in the right direction
    if (isBull && sectorSCS < 0) return true;
    if (!isBull && sectorSCS > 0) return true;
    return false;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface TradeSniperPanelProps {
    autoRefresh?: boolean;
    refreshTrigger?: number;
    isVisible?: boolean;
    onStockSelect?: (stock: StockData) => void;
}

const SCORE_COLORS = {
    high: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', glow: 'shadow-[0_0_18px_rgba(16,185,129,0.15)]' },
    medium: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', glow: '' },
    low: { bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-400', glow: '' },
};

const CheckIcon = ({ pass }: { pass: boolean }) =>
    pass
        ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        : <XCircle className="w-3.5 h-3.5 text-slate-600 shrink-0" />;

const FlagRow = ({ label, pass }: { label: string; pass: boolean }) => (
    <div className={`flex items-center gap-1.5 ${pass ? 'text-slate-300' : 'text-slate-600'}`}>
        <CheckIcon pass={pass} />
        <span className="text-[9px] font-bold uppercase tracking-wider">{label}</span>
    </div>
);

export const TradeSniperPanel: React.FC<TradeSniperPanelProps> = ({
    autoRefresh = true,
    refreshTrigger = 0,
    isVisible = true,
    onStockSelect,
}) => {
    const [candidates, setCandidates] = useState<SniperCandidate[]>([]);
    const [marketBullish, setMarketBullish] = useState<boolean | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
    const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
    const [direction, setDirection] = useState<'ALL' | 'CALL' | 'PUT'>('ALL');

    // CC68.39 — Morning Momentum / Focus Mode
    const [morningResult, setMorningResult] = useState<MorningResult | null>(null);
    const [showFilters, setShowFilters] = useState(false);
    const focusMode = useMorningMomentumStore(s => s.focusMode);
    const toggleFocusMode = useMorningMomentumStore(s => s.toggleFocusMode);
    const setActivePick = useMorningMomentumStore(s => s.setActivePick);
    const cleanTrendThresholds = useMorningMomentumStore(s => s.cleanTrendThresholds);
    const cleanTrendToggles = useMorningMomentumStore(s => s.cleanTrendToggles);
    const setCleanTrendThreshold = useMorningMomentumStore(s => s.setCleanTrendThreshold);
    const setCleanTrendToggle = useMorningMomentumStore(s => s.setCleanTrendToggle);
    const resetCleanTrend = useMorningMomentumStore(s => s.resetCleanTrend);
    const fnoSymbols = useMemo(() => new Set(FNO_STOCKS.map(x => x.symbol.toUpperCase())), []);

    const buildCandidates = useCallback(() => {
        const allStocks = alphaEngineService.getCachedStocks();
        const allSectors = alphaEngineService.getCachedSectors();
        const mood = alphaEngineService.getCachedMood() ?? null;
        const isBullishMood = mood?.isBullish ?? true;
        setMarketBullish(isBullishMood);

        if (allStocks.length === 0) {
            setIsLoading(false);
            return;
        }

        // Build sector lookup
        const sectorMap: Record<string, SectorData> = {};
        allSectors.forEach(s => {
            sectorMap[s.sector] = s;
        });

        const results: SniperCandidate[] = [];

        allStocks.forEach(stock => {
            const isBull = stock.signal === 'Up';
            // Find sector by matching sector name
            const sData = allSectors.find(s =>
                s.sector === stock.sector ||
                s.sector === stock.sector?.replace('NIFTY ', '') ||
                stock.sector?.includes(s.sector)
            );

            const sectorSCS = sData?.confluenceScore ?? 0;  // -100 to +100
            const sectorFatigueScore = sData?.fatigueScore ?? 0;
            const sectorGrade = sData?.confluenceGrade ?? 'NEUTRAL';
            const sectorFatigueState = sData?.fatigueState ?? 'neutral';
            const sectorName = sData?.sector ?? stock.sector ?? 'Unknown';

            // Kill check
            if (isKilled(stock, sectorSCS, sectorFatigueScore, isBull)) return;

            const { score, passingChecks, flags, direction: dir } = computeSniperScore(
                stock, sectorSCS, sectorFatigueScore, isBullishMood
            );

            // Minimum viable: at least 5 out of 8 checks passing AND score >= 55
            if (passingChecks < 5 || score < 55) return;

            const cand: SniperCandidate = {
                stock,
                sectorName,
                sectorSCS,
                sectorGrade,
                sectorFatigue: sectorFatigueScore,
                sectorFatigueState,
                direction: dir,
                score,
                passingChecks,
                flags,
                reason: '',
                conviction: null,  // filled in by best-effort async pass below
            };
            cand.reason = buildReason(cand);
            results.push(cand);
        });

        // Sort by score desc, take top 8 (sort by legacy computeSniperScore for now;
        // a second async pass will re-sort by ConvictionEngine)
        results.sort((a, b) => b.score - a.score);
        setCandidates(results.slice(0, 8));
        setLastRefresh(new Date());
        setIsLoading(false);

        // CC68: best-effort async ConvictionEngine pass for the top 8.
        // mceOrchestrator has a 3s dedupe, so this is cheap even on rapid refreshes.
        (async () => {
            const enriched = await Promise.all(
                results.slice(0, 8).map(async (cand) => {
                    try {
                        const mcsSnap = await mceOrchestrator.score(cand.stock.symbol, 'PRE_ENTRY');
                        return { ...cand, conviction: smoothScoreObject(cand.stock.symbol, convictionScore(buildInputsFromStock(cand.stock, {
                            mcs: mcsSnap,
                            direction: cand.direction,
                            sectorSCSOverride: cand.sectorSCS,
                            sectorFatigueOverride: cand.sectorFatigue,
                            fiiNetBuyer: isBullishMood,
                        }))) };
                    } catch {
                        return cand;
                    }
                })
            );
            // Re-sort by unified ConvictionEngine score
            enriched.sort((a, b) => {
                const aScore = a.conviction && !a.conviction.killed ? a.conviction.score : a.score;
                const bScore = b.conviction && !b.conviction.killed ? b.conviction.score : b.score;
                return bScore - aScore;
            });
            setCandidates(enriched);

            // SPRINT 2.E1 — GhostScan producer: log these untraded candidates so
            // the weekly outcome-backfill can learn real ML/quant/AI weights.
            try {
                await alphaEngineService.recordGhostScanCandidates(enriched.map((cand) => {
                    const mcsTotal = (cand.conviction as any)?.mcs?.hitProb != null
                        ? Number((cand.conviction as any).mcs.hitProb) * 100
                        : null;
                    return {
                        symbol: cand.stock.symbol,
                        combinedScore: Math.round(cand.score),
                        mlProb: Number.isFinite(mcsTotal as number) ? Number(((mcsTotal as number) / 100).toFixed(3)) : 0.5,
                        quantScore: Math.round(cand.score),
                        aiConviction: cand.conviction && !cand.conviction.killed ? Math.round(cand.conviction.score) : 0,
                    };
                }));
            } catch { /* ghost logging must never break the sniper */ }
        })();
    }, []);

    // CC68.39 — Morning Momentum pipeline (sync-first, then async CX enrichment).
    const buildMorningPicks = useCallback(() => {
        const allStocks = alphaEngineService.getCachedStocks();
        const allSectors = alphaEngineService.getCachedSectors();
        const mood = alphaEngineService.getCachedMood() ?? null;
        const bridgeLive = alphaEngineService.isBridgeRFactorLive();

        // Sync pass: cxSignal neutral (0.5) — renders instantly.
        const sync = computeMorningPicks({
            stocks: allStocks, sectors: allSectors, mood,
            fnoSymbols, bridgeRFactorLive: bridgeLive,
        });
        setMorningResult(sync);

        // Async pass: enrich with CX + candle-based clean-trend, recompute once.
        (async () => {
            if (sync.picks.length === 0) return;
            const convictions = new Map<string, ConvictionScore>();
            const cleanTrend = new Map<string, CleanTrendResult>();
            const { cleanTrendThresholds: T, cleanTrendToggles: TG } = useMorningMomentumStore.getState();
            const to = new Date();
            const from = new Date(to.getTime() - 14 * 24 * 3600 * 1000); // ~10 trading days
            const fmt = (d: Date) => d.toISOString().slice(0, 10);

            await Promise.all(sync.picks.map(async (p) => {
                // ConvictionEngine CX
                try {
                    const mcsSnap = await mceOrchestrator.score(p.stock.symbol, 'PRE_ENTRY');
                    convictions.set(p.stock.symbol, smoothScoreObject(p.stock.symbol, convictionScore(buildInputsFromStock(p.stock, {
                        mcs: mcsSnap,
                        direction: p.direction,
                        fiiNetBuyer: mood?.isBullish ?? true,
                    }))));
                } catch { /* keep neutral */ }
                // Clean-trend: today's 5-min candles + historical baseline (parquet)
                try {
                    const [today, hist] = await Promise.all([
                        getTodayCandles(p.stock.symbol, '5minute'),
                        getHistoricalCandles(p.stock.symbol, '5minute', fmt(from), fmt(to)),
                    ]);
                    if (today.length >= 2) {
                        cleanTrend.set(p.stock.symbol, scoreCleanTrend({
                            todayCandles: today,
                            histBaseline: hist,
                            openingGapPct: p.stock.openingGapPct,
                            prevClose: p.stock.previousClose,
                            thresholds: T,
                            toggles: TG,
                        }));
                    }
                } catch { /* skip */ }
            }));

            if (convictions.size === 0 && cleanTrend.size === 0) return;
            setMorningResult(computeMorningPicks({
                stocks: allStocks, sectors: allSectors, mood,
                convictions: convictions.size ? convictions : undefined,
                cleanTrend: cleanTrend.size ? cleanTrend : undefined,
                fnoSymbols, bridgeRFactorLive: bridgeLive,
            }));
        })();
    }, [fnoSymbols]);

    useEffect(() => {
        setIsLoading(true);
        // Small delay to let cached data settle after a refresh
        const t = setTimeout(() => { buildCandidates(); buildMorningPicks(); }, 600);
        return () => clearTimeout(t);
    }, [refreshTrigger, buildCandidates, buildMorningPicks, cleanTrendThresholds, cleanTrendToggles]);

    usePausedInterval(
        () => {
            buildCandidates();
            buildMorningPicks();
        },
        autoRefresh && isVisible ? 30000 : null,
        { runImmediately: false }
    );

    const filtered = useMemo(() =>
        direction === 'ALL' ? candidates : candidates.filter(c => c.direction === direction),
        [candidates, direction]
    );

    const getScoreTheme = (score: number) =>
        score >= 80 ? SCORE_COLORS.high : score >= 65 ? SCORE_COLORS.medium : SCORE_COLORS.low;

    const formatTime = (d: Date) =>
        d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // ── Empty state ──────────────────────────────────────────────────────────
    if (isLoading) {
        return (
            <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-slate-800/50 p-6 flex items-center justify-center h-48">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Scanning all sectors…</p>
                </div>
            </div>
        );
    }

    // CC68.39 — Focus Mode: minimal curated Morning Momentum view (one sector → top picks).
    // Hides every other score (IGS, CX ring, SCS, fatigue, G, O2C, Day-Pos, 23-check breakdown).
    if (focusMode) {
        const mr = morningResult;
        const dom = mr?.dominantSector ?? null;
        const bridgeLive = mr?.bridgeRFactorLive ?? alphaEngineService.isBridgeRFactorLive();
        const dot = (on: boolean | null, label: string) => (
            <span className="flex items-center gap-1" title={on === null ? `${label}: confirm on chart` : `${label}: ${on ? 'yes' : 'no'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${on === null ? 'bg-slate-600' : on ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                <span className="text-[8px] text-slate-500 uppercase tracking-wider">{label}</span>
            </span>
        );
        return (
            <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-slate-800/50 shadow-lg overflow-hidden">
                {/* Focus header */}
                <div className="p-4 border-b border-slate-800/50 bg-slate-800/20 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center justify-center">
                            <Target className="w-4.5 h-4.5 text-indigo-400" />
                        </div>
                        <div>
                            <h2 className="text-base font-black text-white tracking-tight">🎯 Morning Momentum</h2>
                            <p className="text-[10px] text-slate-500 font-medium">
                                9:50–10:30 · one dominant sector · top {mr?.picks.length ?? 0} pick{(mr?.picks.length ?? 0) !== 1 ? 's' : ''} · ride 9-EMA · exit 3 PM
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span
                            className={`px-2.5 py-1 rounded-lg border text-[9px] font-black uppercase tracking-wider ${bridgeLive ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}
                            title={bridgeLive ? 'Bridge is supplying real R-factor' : 'Bridge down — R-factor in mock fallback, elite tier unreachable'}
                        >
                            R-Factor: {bridgeLive ? 'LIVE' : 'FALLBACK'}
                        </span>
                        <button
                            onClick={() => setShowFilters(v => !v)}
                            className={`px-2.5 py-1 rounded-lg border text-[9px] font-black uppercase tracking-wider transition-all ${showFilters ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
                            title="Edit Clean-Trend filter thresholds + toggles"
                        >
                            ⚙ Filters
                        </button>
                        <button
                            onClick={toggleFocusMode}
                            className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 border border-indigo-400 text-[9px] font-black text-white uppercase tracking-wider transition-all"
                            title="Exit Focus Mode"
                        >
                            Focus: ON
                        </button>
                    </div>
                </div>

                {/* CC68.45 — ⚙ Filters popover: editable thresholds + toggleable sub-checks */}
                {showFilters && (
                    <div className="mx-4 mt-3 p-3 rounded-xl border border-slate-700 bg-slate-950/80 text-[10px]">
                        <div className="flex items-center justify-between mb-2">
                            <span className="font-black text-slate-300 uppercase tracking-wider">Clean-Trend Filters</span>
                            <button onClick={resetCleanTrend} className="text-[9px] font-bold text-slate-500 hover:text-slate-300 underline">Reset defaults</button>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {([
                                ['maxGapPct', 'Max open gap %', 'percent', 0.1, 0, 10],
                                ['volumeSpikeMultiple', '9:30 vol ×', 'compact', 0.1, 0, 20],
                                ['maxPullbackPct', 'Max pullback %', 'percent', 0.1, 0, 10],
                                ['minLegRatio', 'Min leg ratio', 'compact', 0.1, 0, 10],
                                ['maxAdverseClosePct', 'Max adverse close %', 'percent', 0.1, 0, 10],
                                ['bigGapPct', 'Big-gap trap %', 'percent', 0.1, 0, 10],
                                ['rangeBoundPct', 'Range-bound %', 'percent', 0.1, 0, 10],
                            ] as const).map(([key, label, variant, step, min, max]) => (
                                <label key={key} className="flex flex-col gap-1">
                                    <span className="text-slate-500 uppercase tracking-wider">{label}</span>
                                    <NumberInput
                                        value={cleanTrendThresholds[key]}
                                        onChange={(v) => setCleanTrendThreshold(key, v ?? 0)}
                                        step={step} min={min} max={max} decimals={2} variant={variant}
                                        className="!py-1 !text-[11px]"
                                    />
                                </label>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3">
                            {([
                                ['smallGap', 'Small gap'],
                                ['volume930Spike', '9:30 volume spike'],
                                ['cleanTrend', 'Clean trend'],
                                ['trapExclude', 'Trap exclude'],
                            ] as const).map(([key, label]) => (
                                <button
                                    key={key}
                                    onClick={() => setCleanTrendToggle(key, !cleanTrendToggles[key])}
                                    className={`px-2 py-1 rounded-lg border text-[9px] font-black uppercase tracking-wider transition-all ${cleanTrendToggles[key] ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                                >
                                    {cleanTrendToggles[key] ? '✓ ' : ''}{label}
                                </button>
                            ))}
                        </div>
                        <p className="text-[9px] text-slate-600 mt-2 leading-relaxed">
                            OFF = sub-check skipped (neutral, never blocks). Thresholds apply live on the next refresh.
                        </p>
                    </div>
                )}

                {/* Dominant-sector banner / sit-out */}
                <div className="px-4 pt-3">
                    {!mr || mr.sitOutReason || !dom ? (
                        <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 flex items-center gap-2">
                            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                            <span className="text-xs font-bold text-amber-300">{mr?.sitOutReason ?? 'No dominant sector — sit out today.'}</span>
                        </div>
                    ) : (
                        <div className={`p-3 rounded-xl border flex items-center gap-2 ${mr.direction === 'CALL' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}>
                            {mr.direction === 'CALL' ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-rose-400" />}
                            <span className="text-xs font-black text-white">Dominant: {dom.sector}</span>
                            <span className={`text-[10px] font-bold ${mr.direction === 'CALL' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                zFactor {dom.zFactor > 0 ? '+' : ''}{dom.zFactor.toFixed(1)} · {dom.percentChange > 0 ? '+' : ''}{dom.percentChange.toFixed(1)}% · {mr.direction} side
                            </span>
                        </div>
                    )}
                </div>

                {/* Picks — minimal cards, ONE number (MMS) each */}
                <div className="p-4 space-y-2">
                    {dom && mr?.picks.map((p, idx) => {
                        const isEnter = p.verdict === 'ENTER';
                        const isWatch = p.verdict === 'WATCH';
                        const theme = isEnter ? 'border-emerald-500/40 bg-emerald-500/5' : isWatch ? 'border-amber-500/30 bg-amber-500/5' : 'border-rose-500/30 bg-rose-500/5';
                        const vColor = isEnter ? 'text-emerald-400' : isWatch ? 'text-amber-400' : 'text-rose-400';
                        return (
                            <div key={p.stock.symbol} className={`rounded-xl border ${theme} p-3 flex items-center gap-3 flex-wrap`}>
                                <div className="text-slate-700 font-black text-xs w-4 text-center shrink-0">#{idx + 1}</div>
                                <div className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border shrink-0 ${p.direction === 'CALL' ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400' : 'bg-rose-600/20 border-rose-500/40 text-rose-400'}`}>
                                    {p.direction === 'CALL' ? '🟢 CALL' : '🔴 PUT'}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-white font-black text-sm">{p.stock.symbol}</span>
                                        <span className="text-slate-500 text-[9px] font-bold uppercase">{p.sector}</span>
                                    </div>
                                    <div className="flex items-center gap-2.5 mt-1">
                                        {dot(p.entryTrigger.dayHighBreak, 'Break')}
                                        {dot(p.entryTrigger.sectorDominant, 'Sector')}
                                        {dot(p.entryTrigger.vol2x, '2×Vol')}
                                        {dot(p.entryTrigger.ema9Held, '9EMA')}
                                    </div>
                                </div>
                                <div className="flex flex-col items-center justify-center w-12 shrink-0">
                                    <span className={`text-xl font-black ${vColor}`}>{p.mms}</span>
                                    <span className="text-[7px] text-slate-600 uppercase font-bold tracking-wider">MMS</span>
                                </div>
                                <div className={`px-2 py-0.5 rounded text-[9px] font-black uppercase shrink-0 ${vColor} bg-slate-950/40`}>{p.verdict}</div>
                                <div className="text-right shrink-0 w-14">
                                    <div className="text-[8px] text-slate-500 uppercase font-bold tracking-wider">R-Factor</div>
                                    <div className={`text-xs font-black ${p.rFactorLive ? 'text-emerald-400' : 'text-slate-500'}`}>{p.rFactorValue != null ? p.rFactorValue.toFixed(1) : '—'}</div>
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); openTradingView(p.stock.symbol); setActivePick(p.stock.symbol); }}
                                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-[9px] font-black text-slate-300 uppercase tracking-wider shrink-0 transition-all"
                                    title="Open chart & track for 3 PM exit"
                                >
                                    Chart
                                </button>
                                {p.deadGap.reason && (
                                    <div className="w-full text-[9px] text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1">⚠ {p.deadGap.reason}</div>
                                )}
                            </div>
                        );
                    })}
                    {dom && mr && mr.picks.length > 0 && (
                        <p className="text-[9px] text-slate-600 text-center pt-1">Enter only when Break + Sector + 2×Vol + 9EMA all confirm · Ride the 9-EMA · hard exit 3:00 PM</p>
                    )}
                    {dom && mr && mr.picks.length === 0 && (
                        <p className="text-[9px] text-slate-500 text-center py-6">No F&O candidates passed the dead-gap filter in {dom.sector}. Sit out or wait for a setup.</p>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-slate-800/50 shadow-lg overflow-hidden">

            {/* ── Header ─────────────────────────────────────────────────────── */}
            <div className="p-4 border-b border-slate-800/50 bg-slate-800/20">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center justify-center">
                            <Target className="w-4.5 h-4.5 text-indigo-400" />
                        </div>
                        <div>
                            <h2 className="text-base font-black text-white tracking-tight flex items-center gap-2">
                                Trade Sniper
                            </h2>
                            <p className="text-[10px] text-slate-500 font-medium">
                                All-in-one filter · {filtered.length} ready candidate{filtered.length !== 1 ? 's' : ''} across all sectors
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        {/* Market mood badge */}
                        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[9px] font-black uppercase tracking-wider ${
                            marketBullish
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                        }`}>
                            {marketBullish ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            Market: {marketBullish ? 'Bullish' : 'Bearish'}
                        </div>

                        {/* Direction filter */}
                        <Tabs.Root
                            value={direction}
                            onValueChange={(v) => setDirection(v as any)}
                            layoutId="trade-sniper-direction-nav"
                            variant="solid-indigo"
                            motionPreset="spring"
                        >
                            <Tabs.List className="min-h-[30px] p-0.5 bg-slate-950/60 border border-slate-800">
                                <Tabs.Trigger
                                    value="ALL"
                                    className="px-2.5 min-h-[24px] text-[9px] font-black uppercase tracking-wider"
                                >
                                    ALL
                                </Tabs.Trigger>
                                <Tabs.Trigger
                                    value="CALL"
                                    className="px-2.5 min-h-[24px] text-[9px] font-black uppercase tracking-wider"
                                    indicatorClassName="bg-emerald-600 rounded-lg shadow-md shadow-emerald-500/30"
                                >
                                    CALL
                                </Tabs.Trigger>
                                <Tabs.Trigger
                                    value="PUT"
                                    className="px-2.5 min-h-[24px] text-[9px] font-black uppercase tracking-wider"
                                    indicatorClassName="bg-rose-600 rounded-lg shadow-md shadow-rose-500/30"
                                >
                                    PUT
                                </Tabs.Trigger>
                            </Tabs.List>
                        </Tabs.Root>

                        {/* Refresh */}
                        <ActionButton
                            size="sm"
                            icon={<RefreshCw className="w-3.5 h-3.5 text-slate-400" />}
                            isLoading={isLoading}
                            onClick={() => { setIsLoading(true); setTimeout(() => { buildCandidates(); buildMorningPicks(); }, 100); }}
                            title="Refresh candidates"
                        />

                        {/* CC68.39 — Focus Mode toggle */}
                        <ActionButton
                            size="sm"
                            icon={<span>🎯</span>}
                            label="Focus"
                            isActive={focusMode}
                            activeVariant="indigo"
                            onClick={toggleFocusMode}
                            title="Focus Mode: hide all scores, show only the morning-momentum picks"
                        />
                    </div>
                </div>

                {/* Last refresh */}
                {lastRefresh && (
                    <div className="flex items-center gap-1.5 mt-2">
                        <Clock className="w-3 h-3 text-slate-600" />
                        <span className="text-[9px] text-slate-600">Updated {formatTime(lastRefresh)}</span>
                        <span className="text-[9px] text-slate-700">·</span>
                        <span className="text-[9px] text-slate-600">Enter only after <strong className="text-slate-400">10:00 AM</strong></span>
                    </div>
                )}
            </div>

            {/* ── No candidates state ─────────────────────────────────────────── */}
            {filtered.length === 0 && (
                <div className="p-10 flex flex-col items-center gap-4 text-center">
                    <ShieldAlert className="w-10 h-10 text-slate-700" />
                    <div>
                        <p className="text-slate-400 font-black text-sm uppercase tracking-wider">No High-Quality Setup Found</p>
                        <p className="text-slate-600 text-xs mt-1 max-w-xs">
                            {direction !== 'ALL'
                                ? `No ${direction} candidates passing all filters right now. Try switching to ALL.`
                                : 'All stocks are either exhausted, trap risk, or lacking sector confluence. Sit out today — this is also a valid decision.'}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 text-[9px] text-amber-500 bg-amber-500/5 border border-amber-500/20 px-3 py-2 rounded-lg">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        No valid setup = No trade. Protect capital.
                    </div>
                </div>
            )}

            {/* ── Candidate cards ─────────────────────────────────────────────── */}
            <div className="p-4 space-y-3">
                <AnimatePresence>
                    {filtered.map((cand, idx) => {
                        const theme = getScoreTheme(cand.score);
                        const isExpanded = expandedIdx === idx;
                        const isCall = cand.direction === 'CALL';
                        const isTopPick = idx === 0;

                        return (
                            <motion.div
                                key={`${cand.stock.symbol}-${idx}`}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                transition={{ delay: idx * 0.04 }}
                                className={`rounded-xl border ${theme.border} ${theme.bg} ${theme.glow} overflow-hidden cursor-pointer select-none`}
                                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                            >
                                {/* Top pick banner */}
                                {isTopPick && (
                                    <div className="bg-indigo-600/20 border-b border-indigo-500/20 px-3 py-1 flex items-center gap-2">
                                        <Zap className="w-3 h-3 text-indigo-400" />
                                        <span className="text-[9px] font-black text-indigo-400 uppercase tracking-wider">
                                            Top Pick Today — Highest Combined Score
                                        </span>
                                    </div>
                                )}

                                {/* Main row — never wraps: symbol block absorbs compression
                                    via truncate; everything else is shrink-0. Sector sits on
                                    its own line so it can never stack vertically. */}
                                <div className="p-2.5 sm:p-3 flex items-center gap-2 sm:gap-3">
                                    {/* Rank */}
                                    <div className="text-slate-700 font-black text-xs w-4 text-center shrink-0">#{idx + 1}</div>

                                    {/* Direction badge */}
                                    <div className={`px-1.5 sm:px-2.5 py-1 rounded-lg text-[8px] sm:text-[9px] font-black uppercase tracking-wider border shrink-0 ${
                                        isCall
                                            ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400'
                                            : 'bg-rose-600/20 border-rose-500/40 text-rose-400'
                                    }`}>
                                        {isCall ? 'CALL' : 'PUT'}
                                    </div>

                                    {/* Symbol + sector (absorbs all compression) */}
                                    <div className="flex-1 min-w-0">
                                        <span className="block text-white font-black text-sm sm:text-base truncate leading-tight">{cand.stock.symbol}</span>
                                        <span className="block text-[8.5px] sm:text-[9px] text-slate-500 font-bold uppercase truncate leading-tight mt-0.5">{cand.sectorName}</span>
                                        <p className="hidden sm:block text-[9px] text-slate-500 truncate mt-0.5">{cand.reason}</p>
                                    </div>

                                    {/* Score ring — uses ConvictionEngine score if available, else legacy */}
                                    <div className={`flex flex-col items-center justify-center w-11 h-11 sm:w-14 sm:h-14 rounded-xl border ${theme.border} ${theme.bg} shrink-0`}>
                                        <span className={`text-base sm:text-xl font-black ${theme.text}`}>
                                            {cand.conviction && !cand.conviction.killed ? cand.conviction.score : cand.score}
                                        </span>
                                        <span className="text-[7px] text-slate-600 uppercase font-bold tracking-wider">CX /100</span>
                                    </div>

                                    {/* Checks passing — ConvictionEngine: 23-check count */}
                                    <div className="flex flex-col items-center shrink-0">
                                        <span className="text-white font-black text-xs sm:text-sm">
                                            {cand.conviction
                                                ? `${cand.conviction.checks.filter((c) => c.passed).length}/${cand.conviction.checks.length}`
                                                : `${cand.passingChecks}/8`}
                                        </span>
                                        <span className="text-[7px] text-slate-600 uppercase font-bold tracking-wider">Checks</span>
                                    </div>

                                    {/* Price */}
                                    <div className="text-right shrink-0">
                                        <div className="text-white font-black text-[11px] sm:text-xs font-mono">₹{cand.stock.lastPrice.toFixed(2)}</div>
                                        <div className={`text-[9px] font-black ${cand.stock.percentChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {cand.stock.percentChange >= 0 ? '+' : ''}{cand.stock.percentChange.toFixed(2)}%
                                        </div>
                                    </div>

                                    {/* TradingView link */}
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openTradingView(cand.stock.symbol);
                                            onStockSelect?.(cand.stock);
                                        }}
                                        className="px-2 py-1 sm:px-2.5 sm:py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-[8px] sm:text-[9px] font-black text-slate-300 uppercase tracking-wider shrink-0 transition-all"
                                        title="Open chart"
                                    >
                                        Chart
                                    </button>
                                </div>

                                {/* Expanded detail */}
                                <AnimatePresence>
                                    {isExpanded && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="overflow-hidden border-t border-slate-800/50"
                                        >
                                            <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-4">
                                                {/* Signal checks */}
                                                <div>
                                                    <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2">Signal Checks</p>
                                                    <div className="space-y-1.5">
                                                        <FlagRow label="Market Mood" pass={cand.flags.marketBullish} />
                                                        <FlagRow label="Sector Direction" pass={cand.flags.sectorStrong} />
                                                        <FlagRow label="Sector Not Exhausted" pass={cand.flags.sectorNotExhausted} />
                                                        <FlagRow label="G-Factor ≥ 6" pass={cand.flags.gFactorOk} />
                                                    </div>
                                                </div>
                                                <div>
                                                    <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2">Risk Filters</p>
                                                    <div className="space-y-1.5">
                                                        <FlagRow label="R-Factor ≥ 1.5" pass={cand.flags.rFactorOk} />
                                                        <FlagRow label="Not Exhausted" pass={cand.flags.notExhausted} />
                                                        <FlagRow label="No Trap Risk" pass={cand.flags.notTrapRisk} />
                                                        <FlagRow label="ORB Preserved" pass={cand.flags.orbPreserved} />
                                                    </div>
                                                </div>
                                                {/* Sector data */}
                                                <div>
                                                    <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2">Sector Data</p>
                                                    <div className="space-y-1.5 text-[9px]">
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-500">SCS</span>
                                                            <span className={`font-black ${cand.sectorSCS >= 25 ? 'text-emerald-400' : cand.sectorSCS <= -25 ? 'text-rose-400' : 'text-slate-400'}`}>
                                                                {cand.sectorSCS > 0 ? '+' : ''}{Math.round(cand.sectorSCS)}
                                                            </span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-500">Grade</span>
                                                            <span className="font-black text-slate-300 text-[8px]">{cand.sectorGrade}</span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-500">Fatigue</span>
                                                            <span className={`font-black ${
                                                                cand.sectorFatigueState === 'springboard' ? 'text-cyan-400'
                                                                    : cand.sectorFatigueState === 'exhaustion' ? 'text-rose-400'
                                                                        : 'text-slate-400'
                                                            }`}>{cand.sectorFatigue > 0 ? '+' : ''}{cand.sectorFatigue} ({cand.sectorFatigueState})</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                {/* Stock data */}
                                                <div>
                                                    <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2">Stock Data</p>
                                                    <div className="space-y-1.5 text-[9px]">
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-500">G-Factor</span>
                                                            <span className="font-black text-yellow-400">{(cand.stock.gFactor ?? 0).toFixed(2)}</span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-500">R-Factor</span>
                                                            <span className={`font-black ${(cand.stock.rFactor ?? 0) >= 1.5 ? 'text-emerald-400' : 'text-slate-400'}`}>
                                                                {(cand.stock.rFactor ?? 0).toFixed(2)}
                                                            </span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-500">O2C</span>
                                                            <span className={`font-black ${(cand.stock.openChangePct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                                {(cand.stock.openChangePct ?? 0) >= 0 ? '+' : ''}{(cand.stock.openChangePct ?? 0).toFixed(2)}%
                                                            </span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-500">Day Pos</span>
                                                            <span className="font-black text-indigo-400">{((cand.stock.dayExtremeScore ?? 0) * 100).toFixed(0)}%</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Trade reminder */}
                                            <div className="mx-3 mb-3 p-2.5 bg-slate-950/40 border border-slate-800/50 rounded-lg flex items-start gap-2">
                                                <Clock className="w-3 h-3 text-slate-500 mt-0.5 shrink-0" />
                                                <p className="text-[9px] text-slate-500 leading-relaxed">
                                                    <strong className="text-slate-400">Enter only after 10:00 AM.</strong> Set SL before entering.
                                                    {' '}Target 2× your SL (2R). Sit in trade till 1–2 PM unless apex signal = EXHAUSTION.
                                                </p>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>

            {/* Footer note */}
            {filtered.length > 0 && (
                <div className="px-4 pb-4">
                    <p className="text-[9px] text-slate-600 text-center">
                        Tap any card to see all 8 signal checks · Sorted by combined confidence score · Auto-refreshes every 30s
                    </p>
                </div>
            )}
        </div>
    );
};

export default TradeSniperPanel;
