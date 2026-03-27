// components/alpha/StrategyDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Flame, Crosshair, Eye, Ban, ChevronDown, ChevronRight, CheckCircle2, XCircle, 
  AlertTriangle, Zap, Info, Play, Compass, ArrowUp, ArrowDown, Activity
} from 'lucide-react';
import { alphaEngineService, StockData } from '../../services/AlphaEngineService';
import { useGlobalTickStore } from '../../store/globalTickStore';
import { upstoxInstrumentService } from '../../services/UpstoxInstrumentService';
import { score as convictionScore, buildInputsFromStock, type ConvictionScore } from '../../services/alpha/ConvictionEngine';
import { 
  evaluateStrategyScore, detectBestStrategy, STRATEGY_CONFIGS, 
  type StrategyId, type StrategyScore 
} from '../../services/alpha/StrategyEngine';
import { mceOrchestrator } from '../../services/mce/orchestrator';
import type { McsSnapshot } from '../../services/mce/types';
import { StrategyLearningPanel } from './StrategyLearningPanel';
import { upstoxMarketDataService } from '../../services/UpstoxMarketDataService';

export const StrategyDashboard: React.FC = () => {
  const [activeStrategy, setActiveStrategy] = useState<StrategyId>('ema_snapback');
  const [stocks, setStocks] = useState<StockData[]>(() => alphaEngineService.getCachedStocks());
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [mcsSnaps, setMcsSnaps] = useState<Record<string, McsSnapshot>>({});
  const [volAvgMap, setVolAvgMap] = useState<Record<string, any>>({});
  const [symbolToKey, setSymbolToKey] = useState<Record<string, string>>({});
  
  // Iceberg UI accordion state
  const [openLayer, setOpenLayer] = useState<number | null>(1); // default open Layer 1

  // Fetch volume averages on mount (cached for 12h)
  useEffect(() => {
    upstoxMarketDataService.getAllVolumeAverages()
      .then(data => setVolAvgMap(data))
      .catch(err => console.error('Failed to load volume averages:', err));
  }, []);

  // Fetch and resolve keys
  useEffect(() => {
    if (stocks.length === 0) return;
    const symbols = stocks.map(s => s.symbol);
    upstoxInstrumentService.getInstrumentKeys(symbols, 'NSE_EQ').then((keysMap) => {
      setSymbolToKey(keysMap);
    });
  }, [stocks]);

  // Consume ticks from global store
  const ticks = useGlobalTickStore((s) => s.ticks);

  // Sync live ticks
  useEffect(() => {
    if (stocks.length === 0 || Object.keys(ticks).length === 0) return;
    setStocks(prev => prev.map(stock => {
      const key = symbolToKey[stock.symbol];
      if (key && ticks[key]) {
        const tick = ticks[key];
        const newStock = { ...stock };
        let changed = false;
        
        if (tick.ltp !== null && tick.ltp !== newStock.lastPrice) {
          newStock.lastPrice = tick.ltp;
          const change = tick.ltp - newStock.previousClose;
          newStock.percentChange = newStock.previousClose > 0 ? (change / newStock.previousClose) * 100 : 0;
          newStock.openChangePct = newStock.openPrice > 0 ? ((tick.ltp - newStock.openPrice) / newStock.openPrice) * 100 : 0;
          changed = true;
        }
        if (tick.volume !== null && tick.volume !== newStock.volume) {
          newStock.volume = tick.volume;
          newStock.value = tick.volume * (tick.ltp || newStock.lastPrice);
          changed = true;
        }
        if (tick.oi !== null && tick.oi !== newStock.oi) {
          newStock.oi = tick.oi;
          changed = true;
        }
        if (tick.atp !== undefined && tick.atp !== null) {
          newStock.atp = tick.atp;
          changed = true;
        }
        if (changed) return newStock;
      }
      return stock;
    }));
  }, [ticks, symbolToKey]);

  // Load MCS snapshots for first 25 stocks in background
  useEffect(() => {
    if (stocks.length === 0) return;
    let cancelled = false;
    (async () => {
      const nextMcs: Record<string, McsSnapshot> = {};
      await Promise.all(
        stocks.slice(0, 25).map(async (stock) => {
          try {
            const snap = await mceOrchestrator.score(stock.symbol, 'PRE_ENTRY');
            if (cancelled) return;
            if (snap) nextMcs[stock.symbol] = snap;
          } catch (e) {
            // skip
          }
        })
      );
      if (!cancelled) setMcsSnaps(nextMcs);
    })();
    return () => { cancelled = true; };
  }, [stocks]);

  // Compute evaluated strategies
  const strategyStocks = useMemo(() => {
    return stocks.map(stock => {
      const entry = volAvgMap[stock.symbol];
      const adv = entry ? (typeof entry === 'object' ? entry.avg_volume_20d : entry) : 0;
      const rvolVal = adv > 0 ? stock.volume / adv : 1.0;
      const mcsSnap = mcsSnaps[stock.symbol] ?? null;
      const inputs = buildInputsFromStock(stock, {
        rvol: rvolVal,
        direction: stock.signal === 'Up' ? 'CALL' : 'PUT',
        mcs: mcsSnap,
        orbPreserved: stock.isORBLowPreservedProxy ?? null
      });

      const bestStrategy = detectBestStrategy(stock, inputs);
      const evalScore = bestStrategy ? evaluateStrategyScore(stock, bestStrategy.strategy, inputs) : null;

      return {
        stock,
        bestStrategy,
        evalScore,
        rvol: rvolVal
      };
    });
  }, [stocks, volAvgMap, mcsSnaps]);

  // Filter stocks matching the active strategy tab
  const filteredStocks = useMemo(() => {
    return strategyStocks.filter(item => {
      if (!item.evalScore || !item.evalScore.p0Passed) return false;
      return item.evalScore.strategy === activeStrategy;
    }).sort((a, b) => (b.evalScore?.score ?? 0) - (a.evalScore?.score ?? 0));
  }, [strategyStocks, activeStrategy]);

  // Select first stock by default if none selected or selected not in list
  useEffect(() => {
    if (filteredStocks.length > 0) {
      if (!selectedSymbol || !filteredStocks.some(s => s.stock.symbol === selectedSymbol)) {
        setSelectedSymbol(filteredStocks[0].stock.symbol);
      }
    } else {
      setSelectedSymbol(null);
    }
  }, [filteredStocks, selectedSymbol]);

  const selectedStockDetails = useMemo(() => {
    if (!selectedSymbol) return null;
    return strategyStocks.find(item => item.stock.symbol === selectedSymbol) || null;
  }, [selectedSymbol, strategyStocks]);

  const config = STRATEGY_CONFIGS[activeStrategy];

  // Helper for recommendation styling
  const recommendationStyle = (rec: 'FIRE' | 'WATCH' | 'SKIP') => {
    if (rec === 'FIRE') return { label: 'FIRE / ENTRY', className: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10 shadow-[0_0_12px_rgba(16,185,129,0.25)]', Icon: Play };
    if (rec === 'WATCH') return { label: 'WATCH', className: 'text-amber-400 border-amber-500/30 bg-amber-500/10', Icon: Eye };
    return { label: 'SKIP', className: 'text-slate-400 border-slate-700 bg-slate-800/40', Icon: Ban };
  };

  return (
    <div className="bg-slate-900 border border-slate-850 rounded-3xl p-6 shadow-2xl space-y-6">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-850 pb-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shadow-inner">
            <Flame className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h2 className="text-base font-black text-white uppercase tracking-wider">Strategy Intelligence Console</h2>
            <p className="text-xs text-slate-500 font-medium">Real-time countertrend scalps, continuation breakouts, and Upper Circuit setups.</p>
          </div>
        </div>

        {/* Strategy tabs */}
        <div className="flex bg-slate-950/80 p-1 rounded-2xl border border-slate-850 self-start md:self-auto">
          {(Object.keys(STRATEGY_CONFIGS) as StrategyId[]).map(id => {
            const cfg = STRATEGY_CONFIGS[id];
            const active = activeStrategy === id;
            return (
              <button
                key={id}
                onClick={() => {
                  setActiveStrategy(id);
                  setOpenLayer(1);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-300 ${
                  active 
                    ? 'text-white shadow-md' 
                    : 'text-slate-500 hover:text-slate-300'
                }`}
                style={{ backgroundColor: active ? cfg.color : 'transparent' }}
              >
                {cfg.badgeLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main split-pane content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[500px]">
        {/* Left list pane: candidate stocks */}
        <div className="lg:col-span-4 flex flex-col space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              Active Strategy Matches ({filteredStocks.length})
            </span>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[500px] pr-1 space-y-2 no-scrollbar">
            <AnimatePresence mode="popLayout">
              {filteredStocks.length === 0 ? (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-12 border border-dashed border-slate-800 rounded-2xl"
                >
                  <Compass className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                  <p className="text-xs text-slate-500 font-bold">No setups qualified</p>
                  <p className="text-[10px] text-slate-650 mt-1">Awaiting real-time P0 condition filters</p>
                </motion.div>
              ) : (
                filteredStocks.map(({ stock, evalScore, rvol }) => {
                  const active = selectedSymbol === stock.symbol;
                  return (
                    <motion.button
                      key={stock.symbol}
                      onClick={() => setSelectedSymbol(stock.symbol)}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className={`w-full flex items-center justify-between p-4 rounded-2xl border text-left transition-all duration-200 ${
                        active 
                          ? 'bg-slate-950/80 border-slate-700 shadow-lg' 
                          : 'bg-slate-950/30 border-slate-850/40 hover:border-slate-800 hover:bg-slate-950/50'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-black text-white">{stock.symbol}</span>
                          <span className="text-[9px] text-slate-500 font-medium">· {stock.sector}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-mono font-bold text-slate-300">
                            ₹{stock.lastPrice.toFixed(1)}
                          </span>
                          <span className={`text-[10px] font-mono font-black flex items-center gap-0.5 ${
                            stock.percentChange >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}>
                            {stock.percentChange >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                            {stock.percentChange.toFixed(2)}%
                          </span>
                        </div>
                      </div>

                      <div className="text-right space-y-1">
                        <span className="text-sm font-black font-mono" style={{ color: config.color }}>
                          {evalScore?.score}/100
                        </span>
                        <span className="text-[9px] text-slate-500 block font-bold">RVOL {rvol.toFixed(1)}x</span>
                      </div>
                    </motion.button>
                  );
                })
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right pane: Iceberg UI */}
        <div className="lg:col-span-8">
          <AnimatePresence mode="wait">
            {!selectedStockDetails ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full flex flex-col items-center justify-center border border-slate-850 rounded-3xl bg-slate-950/15 p-6 min-h-[400px]"
              >
                <Info className="w-10 h-10 text-slate-700 mb-3" />
                <p className="text-sm text-slate-400 font-bold uppercase tracking-wider">No Stock Selected</p>
                <p className="text-xs text-slate-500 font-medium mt-1">Select a matched candidate from the list to reveal the Layer 0–3 Iceberg diagnostics.</p>
              </motion.div>
            ) : (
              <motion.div
                key={selectedSymbol}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                {/* LAYER 0 — The Crux (Always Visible) */}
                <div 
                  className="rounded-3xl border p-5 bg-slate-950/80 shadow-xl space-y-4"
                  style={{ borderColor: `${config.color}35` }}
                >
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xl font-black text-white">{selectedStockDetails.stock.symbol}</span>
                        <span className="text-xs font-bold text-slate-500">· {selectedStockDetails.stock.sector}</span>
                        <span 
                          className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border"
                          style={{ borderColor: `${config.color}40`, backgroundColor: `${config.color}15`, color: config.color }}
                        >
                          {config.badgeLabel} ACTIVE
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 font-medium mt-1">{config.description}</p>
                    </div>

                    <div className="text-right">
                      <div className="text-2xl font-black font-mono text-white">
                        {selectedStockDetails.evalScore?.score}<span className="text-xs text-slate-500 font-bold">/100</span>
                      </div>
                      <span className="text-[9px] text-slate-500 uppercase tracking-widest font-black block">Strategy Score</span>
                    </div>
                  </div>

                  {/* Crux Stats / Verdict Row */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-slate-850">
                    <div className="p-3.5 rounded-2xl border border-slate-850 bg-slate-900/30 flex items-center justify-between">
                      <div>
                        <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">Entry Trigger</span>
                        <span className="text-[11px] font-black text-slate-200 mt-0.5 block">{selectedStockDetails.evalScore?.entryTrigger}</span>
                      </div>
                    </div>
                    <div className="p-3.5 rounded-2xl border border-slate-850 bg-slate-900/30 flex items-center justify-between">
                      <div>
                        <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">Target</span>
                        <span className="text-[11px] font-black text-emerald-400 mt-0.5 block">{selectedStockDetails.evalScore?.target}</span>
                      </div>
                    </div>
                    <div className="p-3.5 rounded-2xl border border-slate-850 bg-slate-900/30 flex items-center justify-between">
                      <div>
                        <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">Stop Loss</span>
                        <span className="text-[11px] font-black text-rose-400 mt-0.5 block">{selectedStockDetails.evalScore?.stopLoss}</span>
                      </div>
                    </div>
                  </div>

                  {/* Recommendation banner */}
                  {(() => {
                    const rec = recommendationStyle(selectedStockDetails.evalScore?.recommendation || 'SKIP');
                    const RecIcon = rec.Icon;
                    return (
                      <div className={`p-3 rounded-2xl border flex items-center gap-2.5 ${rec.className}`}>
                        <RecIcon className="w-5 h-5 shrink-0" />
                        <div className="text-xs font-black uppercase tracking-wider">{rec.label} RECOMMENDED</div>
                      </div>
                    );
                  })()}
                </div>

                {/* LAYER 1 — The P0 checklist (Collapsible Accordion) */}
                <div className="rounded-3xl border border-slate-850 bg-slate-950/40 overflow-hidden">
                  <button
                    onClick={() => setOpenLayer(openLayer === 1 ? null : 1)}
                    className="w-full flex items-center justify-between p-4 text-left border-b border-slate-850/50 hover:bg-slate-900/10"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-indigo-500" />
                      <span className="text-[11px] font-black uppercase text-white tracking-wider">Layer 1: Strategy P0 Gate checklist</span>
                    </div>
                    {openLayer === 1 ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                  </button>
                  <AnimatePresence initial={false}>
                    {openLayer === 1 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {config.p0Checks.map(check => {
                              const failed = selectedStockDetails.evalScore?.p0Failures.some(f => f.toLowerCase().includes(check.id.replace('_', ' ')));
                              return (
                                <div 
                                  key={check.id} 
                                  className={`flex items-center justify-between p-3 rounded-2xl border text-xs font-bold ${
                                    failed 
                                      ? 'bg-rose-500/5 border-rose-500/10 text-rose-450' 
                                      : 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    {failed ? <XCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
                                    <span className="text-slate-350">{check.label}</span>
                                  </div>
                                  <span className="text-[10px] font-black uppercase tracking-wider">
                                    {failed ? 'Failed' : 'Passed'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          {/* Power-20 matched indicators */}
                          <div className="space-y-1.5">
                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block pl-1">Power-20 Firing Indicators</span>
                            <div className="flex flex-wrap gap-1.5">
                              {selectedStockDetails.evalScore?.power20Matched.length === 0 ? (
                                <span className="text-[10px] text-slate-500 italic pl-1">No indicators currently firing</span>
                              ) : (
                                selectedStockDetails.evalScore?.power20Matched.map(ind => (
                                  <span 
                                    key={ind} 
                                    className="px-2.5 py-1 rounded-xl text-[9px] font-bold bg-slate-950/80 border border-slate-800 text-slate-350 normal-case"
                                  >
                                    {ind.replace(/_/g, ' ')}
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* LAYER 2 — Diagnostics (28-check ConvictionEngine breakdown) */}
                <div className="rounded-3xl border border-slate-850 bg-slate-950/40 overflow-hidden">
                  <button
                    onClick={() => setOpenLayer(openLayer === 2 ? null : 2)}
                    className="w-full flex items-center justify-between p-4 text-left border-b border-slate-850/50 hover:bg-slate-900/10"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-indigo-500" />
                      <span className="text-[11px] font-black uppercase text-white tracking-wider">Layer 2: Conviction Diagnostics (28 checks)</span>
                    </div>
                    {openLayer === 2 ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                  </button>
                  <AnimatePresence initial={false}>
                    {openLayer === 2 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[300px] overflow-y-auto no-scrollbar">
                            {selectedStockDetails.evalScore?.conviction.checks.map(c => (
                              <div 
                                key={c.id} 
                                className={`flex items-center gap-2.5 p-2 rounded-xl border text-[10px] font-bold ${
                                  c.passed 
                                    ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400' 
                                    : 'bg-slate-950/50 border-slate-900/50 text-slate-500'
                                }`}
                              >
                                <span className="text-[8px] font-black text-slate-500 w-3 shrink-0">{c.group}</span>
                                {c.passed ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0 text-slate-850" />}
                                <span className="flex-1 truncate text-slate-350">{c.name}</span>
                                <span className="text-[9px] text-slate-450 tabular-nums shrink-0 font-medium">w{c.weight}</span>
                                {c.measuredValue != null && (
                                  <span className="text-[9px] text-slate-300 tabular-nums shrink-0 bg-slate-950/40 px-1 py-0.5 rounded font-mono">
                                    {c.measuredValue}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* LAYER 3 — Learning Laboratory (Strategy Learning Panel) */}
                <div className="rounded-3xl border border-slate-850 bg-slate-950/40 overflow-hidden">
                  <button
                    onClick={() => setOpenLayer(openLayer === 3 ? null : 3)}
                    className="w-full flex items-center justify-between p-4 text-left border-b border-slate-850/50 hover:bg-slate-900/10"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-indigo-500" />
                      <span className="text-[11px] font-black uppercase text-white tracking-wider">Layer 3: Learning Laboratory</span>
                    </div>
                    {openLayer === 3 ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                  </button>
                  <AnimatePresence initial={false}>
                    {openLayer === 3 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4">
                          <StrategyLearningPanel strategyId={activeStrategy} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
