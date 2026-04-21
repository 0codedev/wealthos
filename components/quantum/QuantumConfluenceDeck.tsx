import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Activity, Zap, Shield, TrendingUp, TrendingDown, AlertTriangle,
    Sparkles, Network, Box, Layers, ChevronRight, ChevronDown,
    BarChart3, GitBranch, Eye, EyeOff, RefreshCw, Crown, Atom
} from 'lucide-react';
import { useQuantumStore } from '../../store/quantumStore';
import { useShallow } from 'zustand/react/shallow';
import { usePortfolioStore } from '../../store/portfolioStore';
import {
    applyScenarioShock,
    buildCrossAssetRisk,
    buildCorrelationMatrix,
    returnsFromCloses,
} from '../../services/QuantumMath';
import type { QuantumAsset, ScenarioAxis } from '../../types/quantum';
import { QuantumPrimeRibbon } from './QuantumPrimeRibbon';
import { QuantumCommandRibbon } from './QuantumCommandRibbon';
import { QuantumScenariosRibbon } from './QuantumScenariosRibbon';
import { formatCurrency, formatCurrencyCompact } from '../../utils/helpers';

/**
 * QuantumConfluenceDeck — CC34
 * =====================================================================
 * The "Quantum Terminal" — a unified cross-asset confluence workspace
 * that fuses:
 *
 *   • Cross-asset correlation matrix (live)
 *   • Beta-weighted portfolio delta vs NIFTY 50
 *   • Parametric VaR (95%) + CVaR (Expected Shortfall)
 *   • Live scenario shock simulator (NIFTY ±5%, VIX ±20%, etc.)
 *   • One-click quick-link to the StrategyOptimizer for the active symbol
 *
 * Selecting any asset or strike here broadcasts to every other Quantum
 * widget via `useQuantumStore` — instant cross-component reactivity.
 */
export const QuantumConfluenceDeck: React.FC = () => {
    const investments = usePortfolioStore(useShallow(s => s.investments));

    // Local + store state
    const activeSymbol = useQuantumStore(useShallow(s => s.activeSymbol));
    const setActiveSymbol = useQuantumStore(useShallow(s => s.setActiveSymbol));
    const activeAxis = useQuantumStore(useShallow(s => s.activeAxis));
    const activeShock = useQuantumStore(useShallow(s => s.activeShock));
    const setActiveAxis = useQuantumStore(useShallow(s => s.setActiveAxis));
    const setActiveShock = useQuantumStore(useShallow(s => s.setActiveShock));
    const setOptimizerUnderlying = useQuantumStore(useShallow(s => s.setOptimizerUnderlying));
    const setAssets = useQuantumStore(useShallow(s => s.setAssets));
    const setRisk = useQuantumStore(useShallow(s => s.setRisk));

    // -- Build the asset universe from holdings (we'd add indices/options in a future pass) --
    const assets: QuantumAsset[] = useMemo(() => {
        const list: QuantumAsset[] = investments
            .filter(i => i.currentValue > 0)
            .map((inv) => ({
                symbol: (inv.ticker || inv.name).toUpperCase(),
                name: inv.name,
                assetClass: 'EQUITY' as const,
                price: (inv.quantity && inv.quantity > 0) ? inv.currentValue / inv.quantity : inv.currentValue,
                changePct: 0,
                volatility: 0.20,
                beta: 1.0,
                exposure: inv.currentValue,
            }));
        // Also include NIFTY as a market index so the matrix is meaningful
        if (!list.find(a => a.symbol === 'NIFTY')) {
            list.unshift({
                symbol: 'NIFTY', name: 'NIFTY 50', assetClass: 'INDEX_OPT',
                price: 0, changePct: 0, volatility: 0.16, beta: 1.0, exposure: 0,
            });
        }
        return list;
    }, [investments]);

    // -- Seed a synthetic history per asset so the correlation matrix has teeth --
    // In production, this would be replaced by a 90-day closes fetch from
    // the central memory store (CC20). For the demo, we seed a deterministic
    // GBM path with the asset's volatility and a small cap on NIFTY correlation.
    const series: number[][] = useMemo(() => {
        const len = 90;
        return assets.map((a, idx) => {
            const out: number[] = [];
            let p = 100;
            for (let i = 0; i < len; i++) {
                // deterministic "noise" — combine asset beta & index
                const baseShock = Math.sin(i * 0.31 + idx) * 0.4 + Math.cos(i * 0.13 + idx * 0.7) * 0.4;
                const shock = baseShock * a.volatility * 0.04 + a.beta * Math.sin(i * 0.21) * 0.005;
                p = p * (1 + shock);
                out.push(p);
            }
            return out;
        });
    }, [assets]);

    // -- Build correlation matrix from daily returns --
    const returns = useMemo(() => series.map(returnsFromCloses), [series]);
    const matrix = useMemo(() => buildCorrelationMatrix(assets.map(a => a.symbol), returns), [assets, returns]);
    const niftySpot = assets.find(a => a.symbol === 'NIFTY')?.price || 0;

    // -- Compute the full risk snapshot and push it to the store --
    useEffect(() => {
        if (assets.length === 0) return;
        const risk = buildCrossAssetRisk(assets, matrix, niftySpot);
        setRisk(risk);
        setAssets(assets);
    }, [assets, matrix, niftySpot, setAssets, setRisk]);

    // -- Apply the current shock to estimate P&L impact --
    const impact = useMemo(
        () => ({ axis: activeAxis, label: activeAxis, shockPct: activeShock, ...applyScenarioShock(assets, activeAxis, activeShock, niftySpot) }),
        [assets, activeAxis, activeShock, niftySpot],
    );

    // -- Quick-link: send the active symbol to the StrategyOptimizer --
    const handleQuickLink = useCallback((symbol: string) => {
        setActiveSymbol(symbol);
        setOptimizerUnderlying(symbol);
    }, [setActiveSymbol, setOptimizerUnderlying]);

    return (
        <div className="space-y-4">
            {/* A. Prime ribbon — top KPIs (score, beta, VaR, CVaR, #assets) */}
            <QuantumPrimeRibbon />

            {/* B. Master command bar — collapse / expand / refresh */}
            <QuantumCommandRibbon
                onRefresh={() => {
                    // Force a re-derivation by toggling the store
                    setAssets([]);
                    setTimeout(() => setAssets(assets), 0);
                }}
            />

            {/* C. Live asset quick-pick grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {assets.slice(0, 12).map((a) => {
                    const isActive = activeSymbol === a.symbol;
                    return (
                        <button
                            key={a.symbol}
                            onClick={() => handleQuickLink(a.symbol)}
                            className={`group relative overflow-hidden rounded-2xl border p-3 text-left transition-all ${
                                isActive
                                    ? 'border-cyan-400/50 bg-cyan-500/10 shadow-lg shadow-cyan-500/20'
                                    : 'border-slate-800/80 bg-slate-950/50 hover:border-cyan-500/30 hover:bg-slate-900/50'
                            }`}
                        >
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{a.symbol}</span>
                                <span className="text-[9px] text-slate-500">{a.assetClass.replace('_', ' ')}</span>
                            </div>
                            <div className="flex items-end justify-between">
                                <div>
                                    <div className="text-base font-bold text-slate-100">{a.price > 0 ? `₹${a.price.toFixed(0)}` : '—'}</div>
                                    <div className="text-[10px] text-slate-500 mt-0.5">{formatCurrencyCompact(a.exposure)} exp.</div>
                                </div>
                                <ChevronRight size={14} className={`transition-transform ${isActive ? 'translate-x-1 text-cyan-400' : 'text-slate-600 group-hover:text-cyan-500'}`} />
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* D. Correlation matrix */}
            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Network size={16} className="text-cyan-400" />
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-300">Cross-Asset Correlation</h3>
                    </div>
                    <span className="text-[9px] text-slate-500">90-day synthetic · click a cell to set the active symbol</span>
                </div>
                {assets.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="border-separate border-spacing-1">
                            <thead>
                                <tr>
                                    <th />
                                    {assets.slice(0, 12).map(a => (
                                        <th key={a.symbol} className="text-[9px] font-black uppercase text-slate-500 px-1 text-center">{a.symbol.slice(0, 6)}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {assets.slice(0, 12).map((row, i) => (
                                    <tr key={row.symbol}>
                                        <td className="text-[9px] font-black uppercase text-slate-500 pr-2 text-right">{row.symbol.slice(0, 6)}</td>
                                        {assets.slice(0, 12).map((col, j) => {
                                            const r = matrix[i]?.[j] ?? 0;
                                            const isDiag = i === j;
                                            const isActive = activeSymbol && (row.symbol === activeSymbol || col.symbol === activeSymbol);
                                            const intensity = Math.min(1, Math.abs(r));
                                            const isPos = r >= 0;
                                            return (
                                                <td key={col.symbol}>
                                                    <button
                                                        onClick={() => setActiveSymbol(row.symbol === col.symbol ? row.symbol : row.symbol)}
                                                        className={`h-7 w-9 rounded text-[9px] font-mono font-bold transition-all hover:scale-110 ${
                                                            isDiag
                                                                ? 'bg-slate-800 text-slate-500'
                                                                : isActive
                                                                    ? 'ring-2 ring-cyan-400/60'
                                                                    : ''
                                                        }`}
                                                        style={!isDiag ? {
                                                            background: isPos
                                                                ? `rgba(244, 63, 94, ${intensity * 0.8})`
                                                                : `rgba(16, 185, 129, ${intensity * 0.8})`,
                                                            color: intensity > 0.5 ? '#fff' : '#cbd5e1',
                                                        } : {}}
                                                        title={`${row.symbol} vs ${col.symbol}: ${r.toFixed(2)}`}
                                                    >
                                                        {r.toFixed(2)}
                                                    </button>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="text-xs text-slate-500 py-8 text-center">No assets in the universe yet — add holdings to see correlations.</div>
                )}
            </div>

            {/* E. Scenario shock slider + impact breakdown */}
            <QuantumScenariosRibbon impact={impact} />

            {/* F. Per-asset breakdown of the current shock */}
            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Layers size={16} className="text-cyan-400" />
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-300">Per-Asset Shock Contribution</h3>
                    </div>
                    <span className="text-[9px] text-slate-500">ranked by absolute ₹ impact</span>
                </div>
                {Object.keys(impact.perAsset).length > 0 ? (
                    <div className="space-y-1.5">
                        {Object.entries(impact.perAsset)
                            .filter(([, v]) => Math.abs(v) > 0)
                            .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                            .slice(0, 8)
                            .map(([sym, v]) => {
                                const maxAbs = Math.max(1, ...Object.values(impact.perAsset).map(x => Math.abs(x)));
                                const widthPct = Math.min(100, (Math.abs(v) / maxAbs) * 100);
                                const isPos = v >= 0;
                                return (
                                    <div key={sym} className="flex items-center gap-2 text-[11px]">
                                        <span className="w-16 font-mono font-bold text-slate-300">{sym}</span>
                                        <div className="flex-1 h-5 rounded bg-slate-900/80 overflow-hidden relative">
                                            <div
                                                className={`h-full ${isPos ? 'bg-emerald-500/70' : 'bg-rose-500/70'}`}
                                                style={{ width: `${widthPct}%` }}
                                            />
                                        </div>
                                        <span className={`w-24 text-right font-mono font-bold ${isPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {isPos ? '+' : ''}{formatCurrency(v)}
                                        </span>
                                    </div>
                                );
                            })}
                    </div>
                ) : (
                    <div className="text-xs text-slate-500 py-6 text-center">Move the shock slider to see per-asset impact.</div>
                )}
            </div>
        </div>
    );
};

export default QuantumConfluenceDeck;
