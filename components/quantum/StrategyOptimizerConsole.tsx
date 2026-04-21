import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
    Beaker, Play, Loader2, TrendingUp, Award, Zap, ChevronRight,
    Download, Send, Activity, Target, BarChart3, Brain, Sparkles
} from 'lucide-react';
import { useQuantumStore } from '../../store/quantumStore';
import { useShallow } from 'zustand/react/shallow';
import {
    strategyOptimizerEngine,
    STRATEGY_LABELS,
    INDEX_SPOT_HINTS,
    INDEX_IV_HINTS,
} from '../../services/StrategyOptimizerEngine';
import type { OptimizerResult, OptimizerRow, StrategyKind } from '../../types/quantum';
import { formatCurrency } from '../../utils/helpers';

/**
 * StrategyOptimizerConsole — CC36
 * =====================================================================
 * Multi-leg options backtester + parameter sweep optimizer. The console
 * pulls the active strategy from the Quantum store, runs a 16-cell
 * strike × DTE sweep via `strategyOptimizerEngine`, and renders a
 * top-N table + a "Sharpe surface" heatmap.
 *
 * The console can export the best row's legs to the Quantum store's
 * `optimizerResult` and dispatch a "Sync to Journal" event so the
 * TradeDiary calendar receives the simulated setup.
 */
const STRATEGY_LIST = Object.keys(STRATEGY_LABELS) as StrategyKind[];

export const StrategyOptimizerConsole: React.FC = () => {
    const activeStrategy = useQuantumStore(useShallow(s => s.activeStrategy));
    const setActiveStrategy = useQuantumStore(useShallow(s => s.setActiveStrategy));
    const optimizerUnderlying = useQuantumStore(useShallow(s => s.optimizerUnderlying));
    const setOptimizerUnderlying = useQuantumStore(useShallow(s => s.setOptimizerUnderlying));
    const setOptimizerResult = useQuantumStore(useShallow(s => s.setOptimizerResult));
    const storedResult = useQuantumStore(useShallow(s => s.optimizerResult));
    const focusedSymbol = useQuantumStore(useShallow(s => s.activeSymbol));

    const [result, setResult] = useState<OptimizerResult | null>(storedResult);
    const [loading, setLoading] = useState(false);

    // When the focused symbol changes (from Quantum deck), pre-fill the underlying.
    useEffect(() => {
        if (focusedSymbol && focusedSymbol !== optimizerUnderlying) {
            setOptimizerUnderlying(focusedSymbol);
        }
    }, [focusedSymbol, optimizerUnderlying, setOptimizerUnderlying]);

    // Run the sweep on first mount and whenever strategy/underlying changes.
    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            setLoading(true);
            try {
                const spot = INDEX_SPOT_HINTS[optimizerUnderlying] || 23500;
                const iv = INDEX_IV_HINTS[optimizerUnderlying] || 0.16;
                const r = await strategyOptimizerEngine.run({
                    underlying: optimizerUnderlying,
                    spot,
                    strategy: activeStrategy,
                    iv,
                });
                if (!cancelled) {
                    setResult(r);
                    setOptimizerResult(r);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        run();
        return () => { cancelled = true; };
    }, [activeStrategy, optimizerUnderlying, setOptimizerResult]);

    const best = result?.best;

    return (
        <div className="space-y-4">
            {/* A. Strategy + underlying pickers */}
            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                    <Beaker size={16} className="text-violet-400" />
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-300">Strategy Optimizer</h3>
                    <span className="ml-auto text-[10px] text-slate-500">{result ? `${result.rows.length} cells swept in ${result.durationMs.toFixed(0)}ms` : '—'}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Underlying</label>
                        <select
                            value={optimizerUnderlying}
                            onChange={(e) => setOptimizerUnderlying(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-sm text-white"
                        >
                            {Object.keys(INDEX_SPOT_HINTS).map(s => <option key={s} value={s}>{s}</option>)}
                            <option value="RELIANCE">RELIANCE</option>
                            <option value="HDFCBANK">HDFCBANK</option>
                            <option value="TCS">TCS</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Strategy</label>
                        <select
                            value={activeStrategy}
                            onChange={(e) => setActiveStrategy(e.target.value as StrategyKind)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-sm text-white"
                        >
                            {STRATEGY_LIST.map(s => <option key={s} value={s}>{STRATEGY_LABELS[s].label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="mt-2 text-[10px] text-slate-500 italic">{STRATEGY_LABELS[activeStrategy].description}</div>
            </div>

            {loading && (
                <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-6 flex items-center justify-center gap-3 text-violet-300">
                    <Loader2 className="animate-spin" size={18} />
                    <span className="text-sm font-bold">Sweeping {result ? result.rows.length : '16'} parameter cells…</span>
                </div>
            )}

            {best && !loading && (
                <>
                    {/* B. The "Best Setup" hero card */}
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-2xl border border-violet-500/40 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 p-4 shadow-xl shadow-violet-500/10"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <Award size={16} className="text-amber-400" />
                                <h3 className="text-sm font-black uppercase tracking-widest text-amber-300">Best Setup</h3>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-slate-500">
                                <span>Score</span>
                                <span className="text-amber-300 font-mono font-bold text-sm">{best.score.toFixed(0)}</span>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <Kpi label="Strike" value={`₹${best.strike.toFixed(0)}`} sub={`${best.dte} DTE`} />
                            <Kpi label="Net Premium" value={formatCurrency(best.netPremium)} sub={best.netPremium > 0 ? 'debit' : 'credit'} positive={best.netPremium < 0} />
                            <Kpi label="Win Rate" value={`${(best.winRate * 100).toFixed(0)}%`} sub="1k paths" />
                            <Kpi label="Expectancy" value={formatCurrency(best.expectancy)} sub="per trade" positive={best.expectancy >= 0} />
                        </div>
                        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                            <Kpi label="Avg Win" value={formatCurrency(best.avgWin)} sub="winning trade" positive={best.avgWin > 0} small />
                            <Kpi label="Avg Loss" value={formatCurrency(best.avgLoss)} sub="losing trade" positive={best.avgLoss >= 0} small />
                            <Kpi label="Profit Factor" value={Number.isFinite(best.profitFactor) ? best.profitFactor.toFixed(2) : '∞'} sub="sumW/|sumL|" small />
                            <Kpi label="Max DD" value={formatCurrency(best.maxDrawdown)} sub="drawdown" positive={false} small />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <button
                                onClick={() => {
                                    window.dispatchEvent(new CustomEvent('quantum:export-to-payoff', { detail: { strategy: activeStrategy, underlying: optimizerUnderlying, strike: best.strike, dte: best.dte } }));
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[10px] font-bold uppercase tracking-widest hover:bg-cyan-500/25"
                            >
                                <Download size={11} /> Export to Payoff
                            </button>
                            <button
                                onClick={() => {
                                    window.dispatchEvent(new CustomEvent('quantum:sync-to-journal', { detail: { strategy: activeStrategy, underlying: optimizerUnderlying, strike: best.strike, dte: best.dte, premium: best.netPremium, expectedEdge: best.expectancy } }));
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[10px] font-bold uppercase tracking-widest hover:bg-violet-500/25"
                            >
                                <Send size={11} /> Sync to Journal
                            </button>
                        </div>
                    </motion.div>

                    {/* C. Sharpe surface heatmap (strike x DTE) */}
                    <SharpeSurface rows={result!.rows} />

                    {/* D. Top 10 sweep rows */}
                    <TopRowsTable rows={result!.rows.slice(0, 10)} />
                </>
            )}
        </div>
    );
};

const Kpi: React.FC<{ label: string; value: string; sub?: string; positive?: boolean; small?: boolean }> = ({ label, value, sub, positive, small }) => (
    <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-2">
        <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</div>
        <div className={`font-mono font-bold ${small ? 'text-xs' : 'text-base'} ${positive === undefined ? 'text-slate-100' : positive ? 'text-emerald-300' : 'text-rose-300'}`}>{value}</div>
        {sub && <div className="text-[9px] text-slate-500">{sub}</div>}
    </div>
);

const SharpeSurface: React.FC<{ rows: OptimizerRow[] }> = ({ rows }) => {
    const strikes = useMemo(() => Array.from(new Set(rows.map(r => r.strike))).sort((a, b) => a - b), [rows]);
    const dtes = useMemo(() => Array.from(new Set(rows.map(r => r.dte))).sort((a, b) => a - b), [rows]);
    const min = Math.min(...rows.map(r => r.sharpe));
    const max = Math.max(...rows.map(r => r.sharpe));
    const span = Math.max(0.0001, max - min);
    const lookup = useMemo(() => {
        const m = new Map<string, OptimizerRow>();
        for (const r of rows) m.set(`${r.strike}_${r.dte}`, r);
        return m;
    }, [rows]);
    return (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4">
            <div className="flex items-center gap-2 mb-3">
                <BarChart3 size={16} className="text-cyan-400" />
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-300">Sharpe Surface · Strike × DTE</h3>
            </div>
            <div className="overflow-x-auto">
                <table className="border-separate border-spacing-0.5">
                    <thead>
                        <tr>
                            <th className="text-[9px] font-black text-slate-500 px-1 text-right">Strike \\ DTE</th>
                            {dtes.map(d => <th key={d} className="text-[9px] font-black text-slate-500 px-1 text-center">{d}d</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {strikes.map(s => (
                            <tr key={s}>
                                <td className="text-[9px] font-mono text-slate-500 pr-2 text-right">₹{s.toFixed(0)}</td>
                                {dtes.map(d => {
                                    const r = lookup.get(`${s}_${d}`);
                                    const v = r?.sharpe ?? 0;
                                    const t = (v - min) / span;
                                    const isPos = v >= 0;
                                    return (
                                        <td
                                            key={d}
                                            className="h-7 w-12 rounded text-center text-[9px] font-mono font-bold"
                                            style={{
                                                background: isPos
                                                    ? `rgba(16, 185, 129, ${0.15 + t * 0.6})`
                                                    : `rgba(244, 63, 94, ${0.15 + Math.abs(t) * 0.6})`,
                                                color: t > 0.5 ? '#fff' : '#cbd5e1',
                                            }}
                                            title={`Strike ₹${s}, ${d} DTE · Sharpe ${v.toFixed(2)}`}
                                        >
                                            {v.toFixed(2)}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const TopRowsTable: React.FC<{ rows: OptimizerRow[] }> = ({ rows }) => (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4">
        <div className="flex items-center gap-2 mb-3">
            <Target size={16} className="text-cyan-400" />
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-300">Top 10 Cells (by composite score)</h3>
        </div>
        <div className="overflow-x-auto">
            <table className="w-full text-xs">
                <thead>
                    <tr className="text-[9px] font-black uppercase tracking-widest text-slate-500 border-b border-slate-800">
                        <th className="text-left py-1 px-1">#</th>
                        <th className="text-right py-1 px-1">Strike</th>
                        <th className="text-right py-1 px-1">DTE</th>
                        <th className="text-right py-1 px-1">Win%</th>
                        <th className="text-right py-1 px-1">Expectancy</th>
                        <th className="text-right py-1 px-1">Sharpe</th>
                        <th className="text-right py-1 px-1">PF</th>
                        <th className="text-right py-1 px-1">Score</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={i} className="border-b border-slate-900 hover:bg-slate-900/40">
                            <td className="py-1 px-1 text-slate-500">{i + 1}</td>
                            <td className="py-1 px-1 text-right font-mono text-slate-200">₹{r.strike.toFixed(0)}</td>
                            <td className="py-1 px-1 text-right text-slate-300">{r.dte}</td>
                            <td className="py-1 px-1 text-right text-slate-200">{(r.winRate * 100).toFixed(0)}%</td>
                            <td className={`py-1 px-1 text-right font-mono ${r.expectancy >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{formatCurrency(r.expectancy)}</td>
                            <td className={`py-1 px-1 text-right font-mono ${r.sharpe >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{r.sharpe.toFixed(2)}</td>
                            <td className="py-1 px-1 text-right font-mono text-slate-300">{Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞'}</td>
                            <td className="py-1 px-1 text-right font-mono font-bold text-amber-300">{r.score.toFixed(0)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

export default StrategyOptimizerConsole;
