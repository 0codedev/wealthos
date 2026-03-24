import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Activity, AlertTriangle, BarChart3, ChevronDown, ChevronUp, Layers,
    ShieldAlert, ShieldCheck, TrendingDown, TrendingUp, Zap
} from 'lucide-react';
import { StockData } from '../../services/AlphaEngineService';
import { optionChainService, OptionChainSnapshot } from '../../services/OptionChainService';
import { orderBookIntelligenceService } from '../../services/OrderBookIntelligenceService';
import { alphaEngineService } from '../../services/AlphaEngineService';
import {
    DerivativesConfluence, DerivativesInput, computeDerivativesConfluenceBatch,
    type DerivativesVerdict
} from '../../services/alpha/DerivativesConfluenceEngine';
import { alphaCache } from '../../lib/alphaCache';

interface DerivativesFlowPanelProps {
    /** F&O stocks to surface in the panel. */
    fnoStocks: StockData[];
    /** Refreshing trigger — bumped by the screener's refresh button. */
    refreshTrigger?: number;
    /** When false, the panel pauses its auto-refresh. */
    isVisible?: boolean;
    /** Cached CVD map (symbol → raw CVD). */
    cvdMap?: Record<string, number>;
    /** Cached previous CVD map for velocity. */
    cvdPrevMap?: Record<string, number>;
}

const CACHE_KEY = 'derivatives_confluence_snapshot_v1';
const CACHE_TTL_MIN = 5; // 5 min — matches the screener refresh cadence

/**
 * Alpha 3.0 — Derivatives & Flow Confluence Panel
 *
 * Renders a per-stock score for the F&O universe with the live
 * verdict, the five sub-signals, and the F&O Trade Gate chips.
 * The math itself lives in
 * `services/alpha/DerivativesConfluenceEngine.ts` — this component
 * is a pure consumer of that engine.
 */
export const DerivativesFlowPanel: React.FC<DerivativesFlowPanelProps> = ({
    fnoStocks,
    refreshTrigger = 0,
    isVisible = true,
    cvdMap = {},
    cvdPrevMap = {},
}) => {
    const [confluenceMap, setConfluenceMap] = useState<Record<string, DerivativesConfluence>>({});
    const [chainsBySymbol, setChainsBySymbol] = useState<Record<string, OptionChainSnapshot>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [showExplainer, setShowExplainer] = useState(false);

    // Hydrate from the IndexedDB snapshot on mount
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const cached = await alphaCache.get(CACHE_KEY);
            if (cancelled) return;
            if (cached && !cached.isStale && cached.data?.confluenceMap) {
                setConfluenceMap(cached.data.confluenceMap);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // The "previous chain" used to compute PCR velocity.  We keep
    // the *snapshot from the last refresh* as `chainPrev` for the
    // next refresh.  The first call has no previous chain, so the
    // velocity defaults to 0 and the agreement score is neutral.
    const [chainPrev, setChainPrev] = useState<Record<string, OptionChainSnapshot>>({});

    const computeAndCache = async (force = false) => {
        if (fnoStocks.length === 0) return;
        setIsLoading(true);
        try {
            const newChains: Record<string, OptionChainSnapshot> = {};
            // Fetch chains in parallel — each call is cached in
            // OptionChainService's sessionStorage, so the second
            // refresh in a session is fast.
            const results = await Promise.all(
                fnoStocks.map(async (s) => {
                    try {
                        const chain = await optionChainService.fetchOptionChain(s.symbol, undefined, force);
                        return { symbol: s.symbol, chain };
                    } catch (err) {
                        return { symbol: s.symbol, chain: null };
                    }
                })
            );
            for (const r of results) {
                if (r.chain) newChains[r.symbol] = r.chain;
            }
            setChainsBySymbol(newChains);

            // Build the DCE inputs.
            const sectorLookup = new Map(alphaEngineService.getCachedSectors().map(sec => [sec.sector, sec]));
            const inputs: DerivativesInput[] = fnoStocks.map((stock) => ({
                symbol: stock.symbol,
                stock,
                sector: sectorLookup.get(stock.sector),
                chain: newChains[stock.symbol] ?? null,
                chainPrev: chainPrev[stock.symbol] ?? null,
                underlyingChangePct: stock.percentChange,
                cvd: cvdMap[stock.symbol],
                cvdPrev: cvdPrevMap[stock.symbol],
                cvdRollingStd: 1, // floor — we'll tune this in v3.1
                orderBookSignal: orderBookIntelligenceService.getSignal(stock.symbol) ?? null,
                apexSignal: (stock.apexSignal as DerivativesInput['apexSignal']) ?? null,
            }));

            const confluences = computeDerivativesConfluenceBatch(inputs);
            const next: Record<string, DerivativesConfluence> = {};
            for (const c of confluences) next[c.symbol] = c;
            setConfluenceMap(next);

            // Snapshot the chains so the *next* refresh can compute
            // PCR velocity.
            setChainPrev(newChains);

            // Persist for hydration
            await alphaCache.set(CACHE_KEY, { confluenceMap: next }, CACHE_TTL_MIN / 60);
        } catch (err) {
            console.error('[DerivativesFlowPanel] Failed to compute confluence', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (!isVisible) return;
        computeAndCache(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshTrigger, isVisible]);

    // Auto-refresh every 3 minutes — chains change in real time
    // during the session and the panel needs to stay current.
    useEffect(() => {
        if (!isVisible) return;
        const id = setInterval(() => computeAndCache(true), 3 * 60 * 1000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isVisible]);

    const sortedConfluences = useMemo(() => {
        const arr = Object.values(confluenceMap);
        arr.sort((a, b) => b.score - a.score);
        return arr;
    }, [confluenceMap]);

    const verdictCounts = useMemo(() => {
        const counts: Record<DerivativesVerdict, number> = {
            APEX_BUY: 0, APEX_SELL: 0, NEUTRAL: 0, TRAP_RISK: 0, LOW_CONVICTION: 0,
        };
        for (const c of Object.values(confluenceMap)) {
            counts[c.verdict] = (counts[c.verdict] ?? 0) + 1;
        }
        return counts;
    }, [confluenceMap]);

    return (
        <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-slate-800/50 shadow-lg flex flex-col">
            {/* Header */}
            <div className="px-5 pt-5 pb-3 border-b border-slate-800/50 bg-slate-800/20 rounded-t-2xl flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-1 bg-violet-500 rounded-full shadow-[0_0_10px_rgba(167,139,250,0.5)]" />
                    <div>
                        <h2 className="text-base font-black text-white uppercase tracking-wider italic flex items-center gap-2">
                            <Layers className="w-4 h-4 text-violet-400" />
                            Derivatives & Flow Confluence
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 border border-violet-500/20">ALPHA 3.0</span>
                        </h2>
                        <p className="hidden sm:block text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1 font-mono">
                            Δ-Weighted PCR · Gamma OI Walls · CVD Velocity · Book Pressure
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <VerdictChip kind="APEX_BUY" count={verdictCounts.APEX_BUY} />
                    <VerdictChip kind="TRAP_RISK" count={verdictCounts.TRAP_RISK} />
                    <VerdictChip kind="LOW_CONVICTION" count={verdictCounts.LOW_CONVICTION} />
                </div>
            </div>

            {/* Explainer (collapsible) */}
            <button
                onClick={() => setShowExplainer(s => !s)}
                className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-300 px-5 py-2 flex items-center gap-2 transition-colors"
            >
                {showExplainer ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {showExplainer ? 'Hide' : 'Show'} the F&O Trade Gate logic
            </button>
            <AnimatePresence initial={false}>
                {showExplainer && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="px-5 pb-3 text-[11px] text-slate-400 leading-relaxed space-y-1.5 border-b border-slate-800/30">
                            <p><span className="text-violet-300 font-black">APEX_BUY</span>: DCS ≥ 75 · call wall ≤ 0.45 · CVD velocity &gt; +0.5 · book pressure &gt; +0.2 · ACCUMULATION_APEX tag.</p>
                            <p><span className="text-rose-300 font-black">TRAP_RISK</span>: call-wall pin (wallRatio &gt; 0.70 and price &gt; 0) · put-wall floor · CVD divergence with |price| &gt; 0.5%.</p>
                            <p><span className="text-amber-300 font-black">LOW_CONVICTION</span>: DCS &lt; 50 or option chain unavailable for the symbol.</p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Table */}
            <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-[11px] font-mono">
                    <thead className="text-[9px] font-black uppercase tracking-widest text-slate-500 bg-slate-900/40 sticky top-0 z-10">
                        <tr>
                            <th className="px-4 py-2.5">Symbol</th>
                            <th className="px-2 py-2.5 text-right">DCS</th>
                            <th className="px-2 py-2.5 text-right">ΔW PCR</th>
                            <th className="px-2 py-2.5 text-right">PCR Vel</th>
                            <th className="px-2 py-2.5 text-right">Wall</th>
                            <th className="px-2 py-2.5 text-right">CVDv</th>
                            <th className="px-2 py-2.5 text-right">OBP</th>
                            <th className="px-2 py-2.5 text-center">Verdict</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && sortedConfluences.length === 0 && (
                            <tr>
                                <td colSpan={8} className="text-center py-12">
                                    <Activity className="w-6 h-6 text-slate-600 mx-auto animate-pulse" />
                                    <p className="text-[10px] uppercase tracking-widest text-slate-500 mt-2">Computing derivatives confluence…</p>
                                </td>
                            </tr>
                        )}
                        {!isLoading && sortedConfluences.length === 0 && (
                            <tr>
                                <td colSpan={8} className="text-center py-12 text-slate-500 text-[10px] uppercase tracking-widest">
                                    No F&O chains available. Sync the option chain to populate.
                                </td>
                            </tr>
                        )}
                        {sortedConfluences.map((c) => (
                            <ConfluenceRow key={c.symbol} c={c} />
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const ConfluenceRow: React.FC<{ c: DerivativesConfluence }> = ({ c }) => {
    const [expanded, setExpanded] = useState(false);
    const verdictClass = verdictColor(c.verdict);
    const direction = c.score >= 60 ? TrendingUp : c.score <= 40 ? TrendingDown : Activity;
    const DirIcon = direction;
    return (
        <>
            <tr
                onClick={() => setExpanded(v => !v)}
                className={`border-b border-slate-800/30 hover:bg-slate-800/30 cursor-pointer transition-colors ${
                    c.verdict === 'APEX_BUY' || c.verdict === 'APEX_SELL' ? 'bg-emerald-500/5' : ''
                } ${c.verdict === 'TRAP_RISK' ? 'bg-rose-500/5' : ''}`}
            >
                <td className="px-4 py-2.5 font-black text-white flex items-center gap-2">
                    <DirIcon className={`w-3.5 h-3.5 ${c.score >= 60 ? 'text-emerald-400' : c.score <= 40 ? 'text-rose-400' : 'text-slate-500'}`} />
                    {c.symbol}
                </td>
                <td className={`px-2 py-2.5 text-right font-black tabular-nums ${verdictClass.text}`}>
                    {Math.round(c.score)}
                </td>
                <td className="px-2 py-2.5 text-right text-slate-300 tabular-nums">{c.deltaWeightedPcr.toFixed(2)}</td>
                <td className={`px-2 py-2.5 text-right tabular-nums ${
                    Math.abs(c.pcrVelocity) < 0.05 ? 'text-slate-500' : c.pcrVelocity > 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                    {c.pcrVelocity > 0 ? '+' : ''}{(c.pcrVelocity * 100).toFixed(0)}%
                </td>
                <td className="px-2 py-2.5 text-right text-slate-300 tabular-nums">
                    {c.wallRatio.toFixed(2)}
                    <span className="text-[9px] text-slate-500 ml-1">
                        {c.wallRatio > 0.7 ? '↑ calls' : c.wallRatio < 0.3 ? '↓ puts' : 'balanced'}
                    </span>
                </td>
                <td className={`px-2 py-2.5 text-right tabular-nums ${
                    Math.abs(c.cvdVelocity) < 0.05 ? 'text-slate-500' : c.cvdVelocity > 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                    {c.cvdVelocity > 0 ? '+' : ''}{c.cvdVelocity.toFixed(2)}
                    {c.cvdDivergence && <span className="text-rose-500 ml-1">⚡</span>}
                </td>
                <td className={`px-2 py-2.5 text-right tabular-nums ${
                    Math.abs(c.orderBookPressure) < 0.05 ? 'text-slate-500' : c.orderBookPressure > 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                    {c.orderBookPressure > 0 ? '+' : ''}{c.orderBookPressure.toFixed(2)}
                </td>
                <td className="px-2 py-2.5 text-center">
                    <VerdictBadge verdict={c.verdict} />
                </td>
            </tr>
            <AnimatePresence initial={false}>
                {expanded && (
                    <motion.tr
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="bg-slate-900/40"
                    >
                        <td colSpan={8} className="px-6 py-3 text-[10px] text-slate-400 leading-relaxed">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <SubMetric label="PCR Agreement" value={c.pcrAgreement.toFixed(2)} note="velocity × price" />
                                <SubMetric label="Call Wall Δ" value={`${c.callWallDistancePct.toFixed(2)}%`} note="distance to largest call wall" />
                                <SubMetric label="Put Wall Δ" value={`${c.putWallDistancePct.toFixed(2)}%`} note="distance to largest put wall" />
                                <SubMetric label="Apex Tilt" value={c.apexTilt > 0 ? '+1.00' : c.apexTilt < 0 ? '-1.00' : '0.00'} note="upstream ACCUMULATION/EXHAUSTION" />
                            </div>
                            {c.riskFlags.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                    {c.riskFlags.map(flag => (
                                        <span key={flag} className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/20">
                                            <AlertTriangle className="w-3 h-3 inline mr-1" />{flag}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </td>
                    </motion.tr>
                )}
            </AnimatePresence>
        </>
    );
};

const SubMetric: React.FC<{ label: string; value: string; note: string }> = ({ label, value, note }) => (
    <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-800/40">
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</p>
        <p className="text-sm font-black text-white font-mono mt-0.5">{value}</p>
        <p className="text-[9px] text-slate-500 mt-0.5">{note}</p>
    </div>
);

const VerdictBadge: React.FC<{ verdict: DerivativesVerdict }> = ({ verdict }) => {
    const style = verdictColor(verdict);
    const label = {
        APEX_BUY: 'APEX ↑',
        APEX_SELL: 'APEX ↓',
        TRAP_RISK: 'TRAP',
        NEUTRAL: 'NEUTRAL',
        LOW_CONVICTION: 'LOW',
    }[verdict];
    return (
        <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md border ${style.bg} ${style.text} ${style.border}`}>
            {label}
        </span>
    );
};

const VerdictChip: React.FC<{ kind: DerivativesVerdict; count: number }> = ({ kind, count }) => {
    if (count === 0) return null;
    const style = verdictColor(kind);
    const label = {
        APEX_BUY: 'Apex', APEX_SELL: 'Apex', TRAP_RISK: 'Traps',
        NEUTRAL: 'Neutral', LOW_CONVICTION: 'Low-Conv',
    }[kind];
    const Icon = kind === 'APEX_BUY' || kind === 'APEX_SELL' ? ShieldCheck
              : kind === 'TRAP_RISK' ? ShieldAlert
              : BarChart3;
    return (
        <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md border ${style.bg} ${style.text} ${style.border} flex items-center gap-1.5`}>
            <Icon className="w-3 h-3" />
            {count} {label}
        </span>
    );
};

function verdictColor(v: DerivativesVerdict): { text: string; bg: string; border: string } {
    switch (v) {
        case 'APEX_BUY':
        case 'APEX_SELL':
            return { text: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' };
        case 'TRAP_RISK':
            return { text: 'text-rose-300', bg: 'bg-rose-500/10', border: 'border-rose-500/30' };
        case 'NEUTRAL':
            return { text: 'text-cyan-300', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30' };
        case 'LOW_CONVICTION':
        default:
            return { text: 'text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-500/30' };
    }
}

export default DerivativesFlowPanel;
