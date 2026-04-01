import React, { useState, useEffect } from 'react';
import { StrategyDefinition, ScreenerConfig, ScreenerResult, SymbolScreenerResult, SimulatedTrade } from '../../types/backtester.types';
import { ScreenerService } from '../../services/backtester/ScreenerService';
import { EquityCurveChart } from './EquityCurveChart';
import { formatCurrency } from '../../utils/helpers';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, 
  Database, 
  TrendingUp, 
  Percent, 
  Activity, 
  Filter, 
  ChevronDown, 
  Check, 
  AlertCircle, 
  RefreshCw, 
  Layers, 
  Grid, 
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Tag
} from 'lucide-react';
import { useNavigationIntentStore } from '../../store/navigationIntentStore';

interface ScreenerTabProps {
  strategy: StrategyDefinition;
  initialCapital: number;
}

export const ScreenerTab: React.FC<ScreenerTabProps> = ({ strategy, initialCapital }) => {
  const [universe, setUniverse] = useState<'indices' | 'all' | 'custom'>('indices');
  const [customSymbols, setCustomSymbols] = useState<string>('');
  
  const [availableSectors, setAvailableSectors] = useState<string[]>([]);
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  const [isSectorDropdownOpen, setIsSectorDropdownOpen] = useState(false);
  
  const [portfolioMode, setPortfolioMode] = useState<'independent' | 'consolidated'>('consolidated');
  const [maxConcurrentTrades, setMaxConcurrentTrades] = useState<number>(5);
  
  const [dateRange, setDateRange] = useState({
    from: '2024-01-01',
    to: '2024-06-01'
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [screenerResult, setScreenerResult] = useState<ScreenerResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Table sort states
  const [sortField, setSortField] = useState<keyof SymbolScreenerResult>('netPnL');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  
  // Selected symbol filter for trade log
  const [selectedSymbolFilter, setSelectedSymbolFilter] = useState<string | null>(null);
  
  // Trade Log pagination state
  const [tradeLogPage, setTradeLogPage] = useState(1);
  const tradeLogPageSize = 10;

  // Load available sectors dynamically on mount
  useEffect(() => {
    const loadSectors = async () => {
      try {
        const data = await ScreenerService.fetchFnOList();
        const sectorsSet = new Set(data.map(item => item.sector));
        setAvailableSectors(Array.from(sectorsSet).sort());
      } catch (err) {
        console.error('[ScreenerTab] Error loading F&O list sectors:', err);
      }
    };
    loadSectors();
  }, []);

  const handleRunScreener = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setSelectedSymbolFilter(null);
    setTradeLogPage(1);
    
    const config: ScreenerConfig = {
      strategy,
      universe,
      customSymbols: universe === 'custom' ? customSymbols : undefined,
      sectors: universe !== 'indices' && selectedSectors.length > 0 ? selectedSectors : undefined,
      portfolioMode,
      maxConcurrentTrades: portfolioMode === 'consolidated' ? maxConcurrentTrades : undefined,
      dateRange,
      initialCapital,
      costs: {
        brokeragePerOrder: 20,
        sttRate: 0.000625,
        exchangeFeeRate: 0.0005,
        stampDutyRate: 0.0001,
        estimatedSlippagePercent: 0.05
      }
    };

    try {
      const result = await ScreenerService.runScreener(config);
      setScreenerResult(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMsg(message || 'Screener failed. Please verify the Python bridge is running.');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSector = (sector: string) => {
    setSelectedSectors(prev => 
      prev.includes(sector) ? prev.filter(s => s !== sector) : [...prev, sector]
    );
  };

  const handleSort = (field: keyof SymbolScreenerResult) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Filter trade log by selected symbol
  const filteredTrades = screenerResult?.trades.filter(t => 
    selectedSymbolFilter ? t.ticker === selectedSymbolFilter : true
  ) || [];

  // Sort breakdown list
  const sortedBreakdown = [...(screenerResult?.symbolBreakdown || [])].sort((a, b) => {
    const valA = a[sortField];
    const valB = b[sortField];
    
    if (typeof valA === 'string' && typeof valB === 'string') {
      return sortDirection === 'asc' 
        ? valA.localeCompare(valB) 
        : valB.localeCompare(valA);
    }
    
    return sortDirection === 'asc' 
      ? (valA as number) - (valB as number) 
      : (valB as number) - (valA as number);
  });

  const totalTradesLogPages = Math.ceil(filteredTrades.length / tradeLogPageSize);
  const paginatedTrades = filteredTrades.slice(
    (tradeLogPage - 1) * tradeLogPageSize, 
    tradeLogPage * tradeLogPageSize
  );

  return (
    <div className="space-y-8 max-w-6xl mx-auto py-4">
      {/* Configure Screener Controls Card */}
      <div className="bg-slate-900/40 p-8 rounded-[2.5rem] border border-slate-800/60 backdrop-blur-md shadow-2xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
          <SlidersHorizontal size={160} className="text-violet-500 rotate-12" />
        </div>
        
        <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter mb-2">Multi-Symbol Backtest Screener</h2>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] mb-8">Execute strategy on a full universe of assets using archived Parquet candles</p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          {/* Universe Selection */}
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Universe</label>
            <select
              value={universe}
              onChange={(e) => {
                setUniverse(e.target.value as any);
                setSelectedSectors([]);
              }}
              disabled={isLoading}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors"
            >
              <option value="indices">Indices (Nifty, BankNifty, etc.)</option>
              <option value="all">Full F&O Universe (180+ stocks)</option>
              <option value="custom">Custom Ticker List</option>
            </select>
            
            {universe === 'custom' && (
              <input
                type="text"
                placeholder="e.g. INFY,RELIANCE,TCS"
                value={customSymbols}
                onChange={(e) => setCustomSymbols(e.target.value)}
                disabled={isLoading}
                className="w-full mt-2 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-bold text-white placeholder-slate-700 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            )}
          </div>

          {/* Sector Filtering */}
          <div className="relative">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Sectors</label>
            <button
              onClick={() => universe !== 'indices' && setIsSectorDropdownOpen(!isSectorDropdownOpen)}
              disabled={universe === 'indices' || isLoading}
              aria-expanded={isSectorDropdownOpen}
              aria-haspopup="listbox"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 flex justify-between items-center transition-colors disabled:opacity-40"
            >
              <span className="truncate">
                {selectedSectors.length === 0 
                  ? 'All Sectors' 
                  : `${selectedSectors.length} Sectors Selected`}
              </span>
              <ChevronDown size={14} className="text-slate-400" />
            </button>

            {isSectorDropdownOpen && (
              <div className="absolute z-20 mt-2 w-full max-h-60 overflow-y-auto bg-slate-950 border border-slate-800 rounded-xl p-2 shadow-2xl">
                {availableSectors.map((sector) => {
                  const isChecked = selectedSectors.includes(sector);
                  return (
                    <button
                      key={sector}
                      onClick={() => toggleSector(sector)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors text-left ${
                        isChecked ? 'bg-indigo-600/10 text-indigo-400' : 'text-slate-400 hover:bg-slate-900'
                      }`}
                    >
                      <span>{sector}</span>
                      {isChecked && <Check size={12} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sizing / Allocation Mode */}
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Allocation model</label>
            <select
              value={portfolioMode}
              onChange={(e) => setPortfolioMode(e.target.value as any)}
              disabled={isLoading}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors"
            >
              <option value="consolidated">Consolidated Shared Pool</option>
              <option value="independent">Simple Independent Portfolios</option>
            </select>
          </div>

          {/* Concurrent Trade Limit / Capital Sizing */}
          {portfolioMode === 'consolidated' ? (
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Max Concurrent Trades</label>
              <input
                type="number"
                min={1}
                max={50}
                value={maxConcurrentTrades}
                onChange={(e) => setMaxConcurrentTrades(Number(e.target.value))}
                disabled={isLoading}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
          ) : (
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Execution Style</label>
              <div className="bg-slate-950/60 border border-slate-800/40 rounded-xl px-4 py-3 text-xs font-black text-slate-400 uppercase tracking-wider italic">
                Parallel Capitals
              </div>
            </div>
          )}
        </div>

        {/* Date Ranges and Run Button */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-6 pt-4 border-t border-slate-800/50">
          <div className="flex items-center gap-4 w-full sm:w-auto">
            <div>
              <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block mb-1">From Date</label>
              <input
                type="date"
                value={dateRange.from}
                onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                disabled={isLoading}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block mb-1">To Date</label>
              <input
                type="date"
                value={dateRange.to}
                onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                disabled={isLoading}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <button
            onClick={handleRunScreener}
            disabled={isLoading}
            className="flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-black text-[10px] uppercase tracking-widest px-10 py-4 rounded-2xl transition-all shadow-lg hover:shadow-violet-500/20 disabled:opacity-40 w-full sm:w-auto"
          >
            {isLoading ? (
              <>
                <RefreshCw size={14} className="animate-spin" /> Screening...
              </>
            ) : (
              <>
                <Play size={14} /> Run Screener Engine
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error display */}
      <AnimatePresence>
        {errorMsg && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-6 rounded-[2rem] border bg-rose-500/10 border-rose-500/20 text-rose-400 flex items-center gap-4"
          >
            <AlertCircle size={24} />
            <span className="text-xs font-bold uppercase tracking-wide">{errorMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Interactive Backtest Results */}
      {screenerResult && (
        <div className="space-y-8">
          
          {/* Scan Live CTA */}
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-slate-900/40 p-6 rounded-3xl border border-slate-800/60 backdrop-blur-md">
            <div>
              <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2">
                <TrendingUp size={14} className="text-indigo-400" />
                Screener Backtest Results
              </h3>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mt-1">
                Completed simulation for {screenerResult.symbolBreakdown.length} tickers
              </span>
            </div>
            <button
              onClick={() => {
                const symbols = screenerResult.symbolBreakdown.map(s => s.symbol);
                sessionStorage.setItem('alpha_screener_filter_override', JSON.stringify(symbols));
                useNavigationIntentStore.getState().setIntent({
                  target: 'alpha',
                  action: 'screener_override',
                  createdAt: Date.now()
                });
              }}
              className="flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-black text-[10px] uppercase tracking-widest px-6 py-3.5 rounded-xl transition-all shadow-lg hover:shadow-indigo-500/20"
            >
              <TrendingUp size={12} className="text-emerald-400" />
              Scan Live in Alpha Engine
            </button>
          </div>
          
          {/* Institutional Performance Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/60 backdrop-blur-md shadow-lg flex flex-col justify-between">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Total Return %</span>
              <span className={`text-2xl font-black italic ${screenerResult.metrics.totalReturnPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {screenerResult.metrics.totalReturnPercent >= 0 ? '+' : ''}{screenerResult.metrics.totalReturnPercent.toFixed(2)}%
              </span>
            </div>

            <div className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/60 backdrop-blur-md shadow-lg flex flex-col justify-between">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Sharpe Ratio</span>
              <span className="text-2xl font-black text-white italic">
                {screenerResult.metrics.sharpeRatio.toFixed(2)}
              </span>
            </div>

            <div className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/60 backdrop-blur-md shadow-lg flex flex-col justify-between">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Max Drawdown %</span>
              <span className="text-2xl font-black text-rose-400 italic">
                -{(screenerResult.metrics.maxDrawdownPercent * 100).toFixed(2)}%
              </span>
            </div>

            <div className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/60 backdrop-blur-md shadow-lg flex flex-col justify-between">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Total Trades</span>
              <span className="text-2xl font-black text-indigo-400 italic">
                {screenerResult.metrics.totalTrades}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/60 backdrop-blur-md shadow-lg flex flex-col justify-between">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Win Rate</span>
              <span className="text-2xl font-black text-white italic">
                {(screenerResult.metrics.winRate * 100).toFixed(1)}%
              </span>
            </div>

            <div className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/60 backdrop-blur-md shadow-lg flex flex-col justify-between">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Profit Factor</span>
              <span className="text-2xl font-black text-white italic">
                {screenerResult.metrics.profitFactor.toFixed(2)}
              </span>
            </div>

            <div className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/60 backdrop-blur-md shadow-lg flex flex-col justify-between">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Recovery Factor</span>
              <span className="text-2xl font-black text-white italic">
                {screenerResult.metrics.recoveryFactor.toFixed(2)}
              </span>
            </div>

            <div className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/60 backdrop-blur-md shadow-lg flex flex-col justify-between">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Execution Speed</span>
              <span className="text-2xl font-black text-indigo-400 italic">
                {screenerResult.executionTimeMs.toFixed(0)} ms
              </span>
            </div>
          </div>

          {/* Equity & Drawdown Chart */}
          <div className="h-[460px] bg-slate-900/20 rounded-[2rem] p-6 border border-slate-800/60 backdrop-blur-md">
            <EquityCurveChart 
              data={screenerResult.equityCurve} 
              drawdownData={screenerResult.drawdownCurve} 
            />
          </div>

          {/* Symbol breakdown and Trade log details */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Symbol Breakdown Table */}
            <div className="lg:col-span-1 bg-slate-900/40 rounded-3xl border border-slate-800/60 backdrop-blur-md flex flex-col overflow-hidden">
              <div className="p-5 border-b border-slate-800 flex justify-between items-center">
                <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                  <Grid size={16} className="text-indigo-400" /> Symbol Breakdown
                </h3>
              </div>
              
              <div className="overflow-y-auto max-h-[500px]">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-900/60 border-b border-slate-800">
                      <th 
                        onClick={() => handleSort('symbol')}
                        className="p-3 text-[9px] font-black text-slate-500 uppercase tracking-widest cursor-pointer hover:text-white transition-colors"
                      >
                        <div className="flex items-center gap-1">Symbol <ArrowUpDown size={10} /></div>
                      </th>
                      <th 
                        onClick={() => handleSort('tradesCount')}
                        className="p-3 text-[9px] font-black text-slate-500 uppercase tracking-widest cursor-pointer hover:text-white transition-colors text-center"
                      >
                        <div className="flex items-center justify-center gap-1">Trades <ArrowUpDown size={10} /></div>
                      </th>
                      <th 
                        onClick={() => handleSort('winRate')}
                        className="p-3 text-[9px] font-black text-slate-500 uppercase tracking-widest cursor-pointer hover:text-white transition-colors text-center"
                      >
                        <div className="flex items-center justify-center gap-1">WR <ArrowUpDown size={10} /></div>
                      </th>
                      <th 
                        onClick={() => handleSort('netPnL')}
                        className="p-3 text-[9px] font-black text-slate-500 uppercase tracking-widest cursor-pointer hover:text-white transition-colors text-right"
                      >
                        <div className="flex items-center justify-end gap-1">PnL <ArrowUpDown size={10} /></div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedBreakdown.map((item) => (
                      <tr 
                        key={item.symbol} 
                        onClick={() => {
                          setSelectedSymbolFilter(prev => prev === item.symbol ? null : item.symbol);
                          setTradeLogPage(1);
                        }}
                        className={`border-b border-slate-800/40 hover:bg-indigo-600/10 cursor-pointer transition-colors ${
                          selectedSymbolFilter === item.symbol ? 'bg-indigo-600/20' : ''
                        }`}
                      >
                        <td className="p-3">
                          <div className="text-xs font-black text-white">{item.symbol}</div>
                          <div className="text-[8px] font-bold text-slate-500 uppercase">{item.sector}</div>
                        </td>
                        <td className="p-3 text-xs font-bold text-slate-300 text-center">{item.tradesCount}</td>
                        <td className="p-3 text-xs font-bold text-slate-300 text-center">{(item.winRate * 100).toFixed(0)}%</td>
                        <td className={`p-3 text-xs font-black text-right ${item.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {item.netPnL >= 0 ? '+' : ''}{formatCurrency(item.netPnL)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Consolidated Simulated Trade Log */}
            <div className="lg:col-span-2 bg-slate-900/40 rounded-3xl border border-slate-800/60 backdrop-blur-md flex flex-col overflow-hidden">
              <div className="p-5 border-b border-slate-800 flex justify-between items-center">
                <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                  <TrendingUp size={16} className="text-violet-400" /> 
                  {selectedSymbolFilter ? `${selectedSymbolFilter} Trade Logs` : 'Consolidated Trade Logs'}
                </h3>
                <div className="flex items-center gap-2">
                  {selectedSymbolFilter && (
                    <button 
                      onClick={() => {
                        setSelectedSymbolFilter(null);
                        setTradeLogPage(1);
                      }}
                      className="text-[9px] font-black text-indigo-400 uppercase tracking-widest bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 px-3 py-1.5 rounded-xl transition-all"
                    >
                      Clear Filter
                    </button>
                  )}
                  <span className="text-[10px] text-slate-500 font-black tracking-widest uppercase">
                    {filteredTrades.length} Trades Simulated
                  </span>
                </div>
              </div>
              
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-900/60 border-b border-slate-800">
                      <th className="p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Date</th>
                      <th className="p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Ticker</th>
                      <th className="p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Dir</th>
                      <th className="p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest text-right">Qty</th>
                      <th className="p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest text-right">Entry</th>
                      <th className="p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest text-right">Exit</th>
                      <th className="p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest text-right">Net P&L</th>
                      <th className="p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedTrades.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
                          No trades simulated for this criteria
                        </td>
                      </tr>
                    ) : (
                      paginatedTrades.map((t, idx) => (
                        <tr 
                          key={t.id} 
                          className={`border-b border-slate-800/30 hover:bg-slate-800/30 transition-colors ${
                            idx % 2 === 0 ? 'bg-transparent' : 'bg-slate-900/10'
                          }`}
                        >
                          <td className="p-4 whitespace-nowrap text-xs font-bold text-slate-300">
                            {new Date(t.date).toLocaleDateString()}
                          </td>
                          <td className="p-4 text-xs font-black text-white">{t.ticker}</td>
                          <td className="p-4">
                            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                              t.direction === 'Long' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                            }`}>
                              {t.direction}
                            </span>
                          </td>
                          <td className="p-4 text-xs font-bold text-slate-300 text-right">{t.quantity}</td>
                          <td className="p-4 text-xs font-bold text-slate-300 text-right">₹{t.entryPrice.toFixed(2)}</td>
                          <td className="p-4 text-xs font-bold text-slate-300 text-right">₹{t.exitPrice.toFixed(2)}</td>
                          <td className={`p-4 text-xs font-black text-right ${t.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {t.netPnL >= 0 ? '+' : ''}{formatCurrency(t.netPnL)}
                          </td>
                          <td className="p-4 text-[9px] font-bold text-slate-500 text-center uppercase tracking-wider">
                            {t.reason?.replace(/_/g, ' ') || 'N/A'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {totalTradesLogPages > 1 && (
                <div className="p-4 border-t border-slate-800/60 flex justify-between items-center bg-slate-900/20">
                  <button 
                    onClick={() => setTradeLogPage(p => Math.max(1, p - 1))}
                    disabled={tradeLogPage === 1}
                    className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:bg-slate-700 disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    Page {tradeLogPage} of {totalTradesLogPages}
                  </span>
                  <button 
                    onClick={() => setTradeLogPage(p => Math.min(totalTradesLogPages, p + 1))}
                    disabled={tradeLogPage === totalTradesLogPages}
                    className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:bg-slate-700 disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
};
