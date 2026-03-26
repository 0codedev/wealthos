import React, { useState, useEffect, useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Activity, Zap, AlertTriangle, CheckCircle2, TrendingUp, TrendingDown, 
  Settings, Plus, Trash2, RefreshCw, BarChart2, ShieldCheck, HelpCircle
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, Tooltip, 
  ReferenceLine, CartesianGrid 
} from 'recharts';
import { orderFlowService, OrderFlowTick } from '../../services/OrderFlowService';
import { alphaEngineService, StockData } from '../../services/AlphaEngineService';
import { formatNumberIndian } from '../../utils/helpers';
import { Tabs } from '../ui/AnimatedTabs';
import { ActionButton } from '../ui/ActionButton';

export const OrderFlowDashboardWidget: React.FC = () => {
  const [watchlist, setWatchlist] = useState<string[]>(['RELIANCE', 'SBIN', 'HDFCBANK', 'ICICIBANK', 'INFY']);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('NIFTY');
  const [liveData, setLiveData] = useState<OrderFlowTick | null>(null);
  const [historyData, setHistoryData] = useState<OrderFlowTick[]>([]);
  const [isLoadingLive, setIsLoadingLive] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isUpdatingWatchlist, setIsUpdatingWatchlist] = useState(false);
  const [newSymbolInput, setNewSymbolInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  
  // Fetch active F&O stocks for autocomplete/dropdown fallback
  const fnoStocks = useMemo(() => {
    return alphaEngineService.getCachedStocks().map(s => s.symbol).sort();
  }, []);

  // Fetch Watchlist and Selected Symbol Data
  const fetchData = async (symbol: string, force = false) => {
    setIsLoadingLive(true);
    setIsLoadingHistory(true);
    setError(null);
    try {
      // 1. Fetch live metrics
      const live = await orderFlowService.getLiveOrderFlow(symbol, force);
      setLiveData(live);
      
      // 2. Fetch intraday history ticks
      const hist = await orderFlowService.getOrderFlowHistory(symbol, undefined, force);
      setHistoryData(hist);
    } catch (err: unknown) {
      console.error('[OrderFlowWidget] Error fetching data:', err);
      setError('Could not connect to the Python NSE Bridge. Ensure start.bat is running on port 8765.');
    } finally {
      setIsLoadingLive(false);
      setIsLoadingHistory(false);
    }
  };

  // Sync Watchlist with Python Backend
  const syncWatchlist = async (newList: string[]) => {
    setIsUpdatingWatchlist(true);
    try {
      const updated = await orderFlowService.updateWatchlist(newList);
      setWatchlist(updated);
    } catch (err) {
      console.error('[OrderFlowWidget] Failed to sync watchlist:', err);
    } finally {
      setIsUpdatingWatchlist(false);
    }
  };

  useEffect(() => {
    fetchData(selectedSymbol);
  }, [selectedSymbol]);

  // Handle adding stock to watchlist
  const handleAddSymbol = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = newSymbolInput.toUpperCase().trim();
    if (!sym) return;
    
    // Check if valid F&O stock or index
    const validSymbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', ...fnoStocks];
    if (!validSymbols.includes(sym)) {
      setError(`${sym} is not a valid F&O stock or index.`);
      return;
    }

    if (watchlist.includes(sym)) {
      setError(`${sym} is already in the watchlist.`);
      return;
    }

    const updated = [...watchlist, sym];
    setWatchlist(updated);
    syncWatchlist(updated);
    setNewSymbolInput('');
    setError(null);
  };

  // Handle removing stock from watchlist
  const handleRemoveSymbol = (sym: string) => {
    const updated = watchlist.filter(s => s !== sym);
    setWatchlist(updated);
    syncWatchlist(updated);
  };

  // Gauge configuration
  const getGaugeColor = (val: number) => {
    if (val > 1.5) return 'text-emerald-400';
    if (val < -1.5) return 'text-rose-500';
    return 'text-slate-400';
  };

  // Sector Aggregation rollup based on active watchlist / fno stocks we have cached
  const sectorRollup = useMemo(() => {
    const cached = alphaEngineService.getCachedStocks();
    const map: Record<string, { sum: number; count: number; name: string }> = {};
    
    watchlist.forEach(sym => {
      const stock = cached.find(s => s.symbol === sym);
      if (stock && stock.sector && stock.gFactor) {
        if (!map[stock.sector]) {
          map[stock.sector] = { sum: 0, count: 0, name: stock.sector };
        }
        // Use rules-based confluence as proxy for aggregate sector flow
        map[stock.sector].sum += stock.gFactor;
        map[stock.sector].count += 1;
      }
    });

    return Object.values(map)
      .map(s => ({
        sector: s.name,
        average: Number((s.sum / s.count).toFixed(2)),
        count: s.count
      }))
      .sort((a, b) => b.average - a.average);
  }, [watchlist]);

  return (
    <div className="space-y-6 text-sans">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div>
          <h2 className="text-lg font-black text-slate-100 uppercase tracking-tight flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-400 animate-pulse" /> Institutional Order Flow Analytics
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time Institutional Aggression Multiplier (R-Factor) and trend exhaustion indicators.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Quick symbol selectors */}
          <Tabs.Root
            value={selectedSymbol}
            onChange={(val) => setSelectedSymbol(val)}
            variant="solid-indigo"
            layoutId="order-flow-symbol-nav"
            motionPreset="spring"
          >
            <Tabs.List className="bg-slate-950 p-1 rounded-xl border border-slate-800 text-[10px] font-black uppercase tracking-wider">
              {['NIFTY', 'BANKNIFTY', 'FINNIFTY'].map(idx => (
                <Tabs.Trigger
                  key={idx}
                  value={idx}
                  className="px-3 py-1.5"
                >
                  {idx}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </Tabs.Root>

          <ActionButton
            size="sm"
            icon={<RefreshCw size={13} className="text-slate-400" />}
            onClick={() => fetchData(selectedSymbol, true)}
            isLoading={isLoadingLive || isLoadingHistory}
            disabled={isLoadingLive || isLoadingHistory}
            title="Refresh order flow logs"
          />

          <ActionButton
            size="sm"
            icon={<Settings size={13} />}
            isActive={showConfig}
            activeVariant="indigo"
            onClick={() => setShowConfig(!showConfig)}
            title="Configure Active Watchlist"
          />
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/25 rounded-2xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-black text-rose-400 uppercase tracking-wider mb-1">Bridge Connection Failure</h4>
            <p className="text-[11px] text-slate-400 leading-relaxed font-semibold">
              {error} Start the background polling engine by executing the <code className="bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 text-indigo-400 font-mono">python-bridge/start.bat</code> file.
            </p>
          </div>
        </div>
      )}

      {/* Watchlist Setup Drawer */}
      <AnimatePresence>
        {showConfig && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border border-slate-800 bg-slate-900/60 rounded-2xl shadow-inner"
          >
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Polling Watchlist (Up to 50 F&O Assets)</h4>
                <span className="text-[9px] font-bold text-slate-500 uppercase">{watchlist.length} / 50 symbols configured</span>
              </div>

              {/* Add form */}
              <form onSubmit={handleAddSymbol} className="flex gap-2 max-w-md">
                <input
                  type="text"
                  placeholder="ADD SYMBOL (E.G. RELIANCE, TCS)"
                  value={newSymbolInput}
                  onChange={e => setNewSymbolInput(e.target.value.toUpperCase())}
                  className="flex-1 bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none uppercase font-mono tracking-wider focus:border-indigo-500/50"
                  list="fno-autocomplete"
                />
                <datalist id="fno-autocomplete">
                  {fnoStocks.map(s => <option key={s} value={s} />)}
                </datalist>
                <button
                  type="submit"
                  disabled={isUpdatingWatchlist}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </form>

              {/* Tags grid */}
              <div className="flex flex-wrap gap-2 pt-2">
                {watchlist.map(sym => (
                  <div
                    key={sym}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono font-bold tracking-tight transition-all cursor-pointer ${
                      selectedSymbol === sym 
                        ? 'bg-indigo-500/20 border-indigo-500/55 text-indigo-400 shadow-md shadow-indigo-500/5'
                        : 'bg-slate-950 border-slate-850 text-slate-300 hover:border-slate-700'
                    }`}
                    onClick={() => setSelectedSymbol(sym)}
                  >
                    <span>{sym}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleRemoveSymbol(sym); }}
                      className="text-slate-500 hover:text-rose-400 transition-colors"
                      title={`Remove ${sym}`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
                {watchlist.length === 0 && (
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-wider py-4">Watchlist is empty. Add symbols to start option polling.</p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Grid: Left Timeline + Metrics, Right Watchlist Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Watchlist / Sidebar Column */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col h-[520px]">
          <div className="border-b border-slate-800 pb-3 mb-4 shrink-0 flex items-center justify-between">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <BarChart2 className="w-3.5 h-3.5 text-indigo-400" /> Watchlist Overview
            </span>
            {isUpdatingWatchlist && <RefreshCw size={11} className="text-indigo-400 animate-spin" />}
          </div>
          
          <div className="flex-1 overflow-y-auto no-scrollbar space-y-2.5">
            {['NIFTY', 'BANKNIFTY', 'FINNIFTY', ...watchlist].map(sym => {
              const isActive = selectedSymbol === sym;
              return (
                <div
                  key={sym}
                  onClick={() => setSelectedSymbol(sym)}
                  className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all duration-200 ${
                    isActive 
                      ? 'bg-indigo-500/10 border-indigo-500/40 shadow-lg' 
                      : 'bg-slate-950/40 border-slate-850 hover:bg-slate-800/35 hover:border-slate-800'
                  }`}
                >
                  <div>
                    <span className={`font-mono font-bold text-xs ${isActive ? 'text-indigo-400' : 'text-slate-200'}`}>{sym}</span>
                    <span className="text-[8px] text-slate-500 uppercase font-black block mt-0.5 tracking-wider">
                      {sym === 'NIFTY' || sym === 'BANKNIFTY' || sym === 'FINNIFTY' ? 'Index' : 'Watchlist'}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] text-slate-400 font-mono font-bold block">
                      {isActive && liveData ? `R.Fac: ${liveData.r_factor.toFixed(2)}` : 'Click to view'}
                    </span>
                    {isActive && liveData && liveData.apex_signal !== 'NEUTRAL' && (
                      <span className={`text-[8px] font-black uppercase tracking-wider block mt-1 ${liveData.apex_signal === 'EXHAUSTION_APEX' ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {liveData.apex_signal === 'EXHAUSTION_APEX' ? 'EXHAUSTION' : 'ACCUMULATION'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Dashboard Dashboard Screen: Chart & Gauges */}
        <div className="lg:col-span-3 space-y-6 flex flex-col justify-between">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            
            {/* Live R-Factor Widget */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between relative overflow-hidden h-[180px]">
              <div className="absolute -right-6 -bottom-6 opacity-5 pointer-events-none">
                <TrendingUp size={90} className="text-indigo-400" />
              </div>
              <div className="shrink-0">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Metrics Alpha</span>
                <h4 className="text-xs font-black text-slate-200 uppercase tracking-tight">R-Factor Score</h4>
              </div>
              
              <div className="my-2.5 flex items-baseline gap-2">
                <span className={`text-4xl font-black font-mono tracking-tighter ${liveData && liveData.r_factor >= 2.0 ? 'text-emerald-400' : liveData && liveData.r_factor <= -2.0 ? 'text-rose-400' : 'text-slate-100'}`}>
                  {isLoadingLive ? '...' : liveData ? liveData.r_factor.toFixed(2) : '1.00'}
                </span>
                <span className="text-[10px] text-slate-500 font-bold font-mono">/ Baseline</span>
              </div>
              
              <div className="border-t border-slate-800/60 pt-2 shrink-0">
                <p className="text-[9px] text-slate-400 font-semibold leading-relaxed">
                  {liveData && liveData.r_factor > 1.5 
                    ? '⚡ Institutional Aggression detected: Buying volume is highly elevated relative to historical average.'
                    : liveData && liveData.r_factor < -1.5 
                      ? '⚠️ Institutional Aggression detected: Heavy selling flow/aggressive ask sweeping.'
                      : '✓ Normal market flow: composite volume matching average ranges.'}
                </p>
              </div>
            </div>

            {/* Option Apex Indicator */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between relative overflow-hidden h-[180px]">
              <div className="absolute -right-6 -bottom-6 opacity-5 pointer-events-none">
                <ShieldCheck size={90} className="text-indigo-400" />
              </div>
              <div className="shrink-0 flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Metrics Beta</span>
                  <h4 className="text-xs font-black text-slate-200 uppercase tracking-tight">Option Apex Vector</h4>
                </div>
                {liveData && liveData.apex_signal !== 'NEUTRAL' && (
                  <span className={`px-2 py-0.5 rounded text-[8px] font-black tracking-widest uppercase animate-pulse border ${
                    liveData.apex_signal === 'EXHAUSTION_APEX' 
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/25' 
                      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                  }`}>
                    {liveData.apex_signal === 'EXHAUSTION_APEX' ? 'SELL EXHAUSTION' : 'ACCUMULATION'}
                  </span>
                )}
              </div>

              <div className="my-2.5">
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Net Position Vector P.Inst:</p>
                <span className="text-xl font-mono font-black text-slate-100">
                  {isLoadingLive ? '...' : liveData ? formatNumberIndian(liveData.p_inst) : '0'}
                </span>
              </div>

              <div className="border-t border-slate-800/60 pt-2 shrink-0">
                <p className="text-[9px] text-slate-400 font-semibold leading-relaxed">
                  {liveData?.apex_signal === 'EXHAUSTION_APEX'
                    ? '⚠️ EXHAUSTION WARNING: Price is rising but institutional delta positioning is decreasing (EXIT Signal).'
                    : liveData?.apex_signal === 'ACCUMULATION_APEX'
                      ? '✓ CONFIRMATION: Price decreasing/consolidating while institutions accumulate delta positions.'
                      : '✓ Trend Vector: delta-positioning is synchronized with spot price movement.'}
                </p>
              </div>
            </div>

            {/* Sector Rollup Roll */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between relative overflow-hidden h-[180px]">
              <div className="absolute -right-6 -bottom-6 opacity-5 pointer-events-none">
                <HelpCircle size={90} className="text-indigo-400" />
              </div>
              <div className="shrink-0">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Aggregate Rollup</span>
                <h4 className="text-xs font-black text-slate-200 uppercase tracking-tight">Top Sector Confluence</h4>
              </div>

              <div className="my-2 flex-grow overflow-y-auto no-scrollbar pt-2 space-y-1.5 text-[10px]">
                {sectorRollup.slice(0, 3).map(sec => (
                  <div key={sec.sector} className="flex justify-between items-center font-bold">
                    <span className="text-slate-400 truncate max-w-[120px]">{sec.sector}</span>
                    <span className="text-indigo-400 font-mono">{sec.average.toFixed(2)} G.Fac</span>
                  </div>
                ))}
                {sectorRollup.length === 0 && (
                  <p className="text-slate-500 font-semibold uppercase tracking-wider text-[9px]">Add watchlist stocks to view sector aggregates.</p>
                )}
              </div>

              <div className="border-t border-slate-800/60 pt-1.5 shrink-0 text-[8px] text-slate-500 uppercase font-black tracking-widest text-right">
                Based on watchlist
              </div>
            </div>

          </div>

          {/* Timeline Chart Container */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl h-[320px] flex flex-col justify-between overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-3 mb-4 shrink-0">
              <div>
                <h4 className="text-xs font-black text-slate-200 uppercase tracking-tight">{selectedSymbol} Intraday R-Factor Waveform</h4>
                <p className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">R-Factor values logged in 5m intervals vs neutral baseline (1.0)</p>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500">
                <span className="flex items-center gap-1"><span className="w-2.5 h-1.5 bg-indigo-500 rounded-sm"></span> R-Factor</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-1 bg-amber-500/80 rounded-sm"></span> Spot Price</span>
              </div>
            </div>

            {isLoadingHistory ? (
              <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                <div className="w-10 h-10 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest animate-pulse">Reconstructing Waveform</h3>
              </div>
            ) : historyData.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-500">
                <Activity className="w-8 h-8 mb-2 opacity-30 animate-pulse" />
                <p className="text-xs font-bold uppercase tracking-wider">No history recorded for today yet</p>
                <p className="text-[10px] text-slate-650 mt-1 max-w-sm">Data will populate automatically as background yfinance and option scans run during market sessions.</p>
              </div>
            ) : (
              <div className="flex-1 min-h-0 w-full relative">
                <SafeChartContainer>
                  <AreaChart data={historyData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorRFactor" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0.01}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.3} />
                    <XAxis 
                      dataKey="time_slot" 
                      stroke="#475569" 
                      fontSize={9} 
                      fontFamily="monospace"
                      tickLine={false}
                    />
                    <YAxis 
                      stroke="#475569" 
                      fontSize={9} 
                      fontFamily="monospace"
                      tickLine={false}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{ 
                        backgroundColor: '#020617', 
                        borderColor: '#1e293b',
                        borderRadius: '12px',
                        fontSize: '10px',
                        color: '#f8fafc',
                        fontFamily: 'monospace'
                      }}
                      itemStyle={{ color: '#818cf8', fontWeight: 'bold' }}
                      labelStyle={{ color: '#94a3b8', fontWeight: 'black', textTransform: 'uppercase' }}
                    />
                    <ReferenceLine y={1.0} stroke="#f59e0b" strokeDasharray="3 3" opacity={0.7} label={{ value: 'Baseline', fill: '#f59e0b', fontSize: 8, position: 'insideTopLeft' }} />
                    <Area 
                      type="monotone" 
                      dataKey="r_factor" 
                      name="R-Factor"
                      stroke="#6366f1" 
                      strokeWidth={2.5}
                      fillOpacity={1} 
                      fill="url(#colorRFactor)" 
                    />
                  </AreaChart>
                </SafeChartContainer>
              </div>
            )}
            
            <div className="shrink-0 flex items-center justify-between border-t border-slate-800/40 pt-3 mt-2 text-[9px] font-black text-slate-500 uppercase tracking-widest">
              <span>SEBI COMPLIANCE: Suggestions are based on momentum models. This is not financial advice.</span>
              <span>100% GPU-ACCELERATED WAVEFORMS</span>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};
