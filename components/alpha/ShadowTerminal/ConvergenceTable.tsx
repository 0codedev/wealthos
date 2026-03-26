import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Target, TrendingUp, TrendingDown, Clock, Activity, BarChart3, AlertTriangle, ShieldAlert, ChevronDown, ChevronRight, Copy, CheckCircle2, Zap, Award, ExternalLink } from 'lucide-react';
import { openTradingView } from '../../../utils/navigation';
import { ScoredStock, ConvergenceEngine } from '../../../services/alpha/ConvergenceEngine';
import { useAlphaToPortfolioWorkflow } from '../../../hooks/useAlphaToPortfolioWorkflow';
import { Tabs } from '../../ui/AnimatedTabs';

interface ConvergenceTableProps {
  data: ScoredStock[];
  direction: 'bullish' | 'bearish' | 'both';
  setDirection: (d: 'bullish' | 'bearish' | 'both') => void;
  mode: 'intraday' | 'swing';
  setMode: (m: 'intraday' | 'swing') => void;
  portfolioSymbols?: string[];
  onTrackInPortfolio?: (symbol: string, ltp: number) => void;
}

export const ConvergenceTable = React.memo<ConvergenceTableProps>(({ 
  data, 
  direction, 
  setDirection, 
  mode, 
  setMode,
  portfolioSymbols = [],
  onTrackInPortfolio
}) => {
  const { sendToPortfolioWatchlist } = useAlphaToPortfolioWorkflow();
  const [activeTier, setActiveTier] = useState<'ALL' | 'PERFECT' | 'CONFIRMED' | 'DEVELOPING' | 'SPECULATIVE'>('ALL');
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Pagination & Sorting State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [sortConfig, setSortConfig] = useState<{ key: keyof ScoredStock | null, direction: 'asc' | 'desc' | null }>({ key: 'convictionScore', direction: 'desc' });

  // Reset to first page when data changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [data.length, activeTier, direction, mode]);

  const handleSort = (key: keyof ScoredStock) => {
    let dir: 'asc' | 'desc' | null = 'asc';
    let newKey: keyof ScoredStock | null = key;
    
    if (sortConfig.key === key) {
      if (sortConfig.direction === 'asc') dir = 'desc';
      else if (sortConfig.direction === 'desc') {
        dir = null;
        newKey = null;
      }
    }
    
    setSortConfig({ key: newKey, direction: dir });
    setCurrentPage(1);
  };

  const sortedData = useMemo(() => {
    let filtered = data.filter(stock => activeTier === 'ALL' || stock.tier === activeTier);
    
    if (!sortConfig.key || !sortConfig.direction) return filtered;

    return [...filtered].sort((a, b) => {
      const aValue = a[sortConfig.key!];
      const bValue = b[sortConfig.key!];

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
      }
      
      const aStr = String(aValue).toLowerCase();
      const bStr = String(bValue).toLowerCase();
      
      if (aStr < bStr) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aStr > bStr) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, activeTier, sortConfig]);

  const totalPages = Math.ceil(sortedData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, sortedData.length);
  const currentData = sortedData.slice(startIndex, endIndex);

  const SortIcon = ({ column }: { column: keyof ScoredStock }) => {
    const isActive = sortConfig.key === column;
    const isAsc = sortConfig.direction === 'asc';
    return (
      <span className="inline-flex flex-col ml-1.5 align-middle">
        <span className={`text-[8px] leading-[6px] transition-colors ${isActive && isAsc ? 'text-indigo-400 font-bold' : 'text-slate-600 opacity-40'}`}>▲</span>
        <span className={`text-[8px] leading-[6px] transition-colors ${isActive && !isAsc ? 'text-indigo-400 font-bold' : 'text-slate-600 opacity-40'}`}>▼</span>
      </span>
    );
  };

  const handleSniperExport = () => {
    // Export top 20 symbols
    const symbols = sortedData.slice(0, 20).map((s: ScoredStock) => s.symbol);
    navigator.clipboard.writeText(JSON.stringify(symbols));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'PERFECT': return 'from-yellow-400 to-amber-600 border-yellow-500/50 text-yellow-400 shadow-[0_0_15px_rgba(251,191,36,0.3)]';
      case 'CONFIRMED': return 'from-emerald-400 to-emerald-600 border-emerald-500/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]';
      case 'DEVELOPING': return 'from-blue-400 to-indigo-600 border-blue-500/50 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.3)]';
      case 'SPECULATIVE': return 'from-rose-400 to-rose-600 border-rose-500/50 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.3)]';
      default: return 'from-slate-400 to-slate-600 border-slate-500/50 text-slate-400';
    }
  };

  const getTierBg = (tier: string) => {
    switch (tier) {
      case 'PERFECT': return 'bg-amber-500/10';
      case 'CONFIRMED': return 'bg-emerald-500/10';
      case 'DEVELOPING': return 'bg-blue-500/10';
      case 'SPECULATIVE': return 'bg-rose-500/10';
      default: return 'bg-slate-500/10';
    }
  };

  const SignalPill = ({ label, active, icon: Icon, colorClass }: { label: string, active: boolean, icon: any, colorClass: string }) => (
    <div className={`flex flex-col items-center gap-1 opacity-${active ? '100' : '30 grayscale'} transition-all`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${active ? colorClass : 'bg-slate-800'}`}>
        <Icon className={`w-4 h-4 ${active ? 'text-white' : 'text-slate-500'}`} />
      </div>
      <span className={`text-[8px] font-black uppercase tracking-widest ${active ? 'text-slate-300' : 'text-slate-600'}`}>{label}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* HEADER & FILTERS */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 bg-slate-900/40 p-6 rounded-2xl border border-slate-800/60 backdrop-blur-md">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-black text-white uppercase tracking-widest flex items-center gap-3">
            <Target className="w-6 h-6 text-indigo-400" />
            Convergence Scan
          </h2>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-9">
            {sortedData.length} High-Probability Setups Found
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button 
            onClick={handleSniperExport}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700/50 rounded-xl text-[10px] font-black text-slate-300 uppercase tracking-widest transition-colors"
          >
            {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-indigo-400" />}
            {copied ? 'Sniper List Copied' : 'Export Sniper'}
          </button>

          {/* Mode Toggle */}
          <Tabs.Root
            value={mode}
            onValueChange={(v) => setMode(v as any)}
            layoutId="convergence-mode-nav"
            variant="solid-indigo"
            motionPreset="spring"
          >
            <Tabs.List className="min-h-[32px] p-0.5 bg-slate-950/50 border border-slate-800">
              <Tabs.Trigger
                value="intraday"
                className="px-4 min-h-[26px] text-[9px] font-black uppercase tracking-widest"
              >
                Intraday
              </Tabs.Trigger>
              <Tabs.Trigger
                value="swing"
                className="px-4 min-h-[26px] text-[9px] font-black uppercase tracking-widest"
              >
                Swing / Carry
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>

          {/* Direction Toggle */}
          <Tabs.Root
            value={direction}
            onValueChange={(v) => setDirection(v as any)}
            layoutId="convergence-direction-nav"
            variant="solid-indigo"
            motionPreset="spring"
          >
            <Tabs.List className="min-h-[32px] p-0.5 bg-slate-950/50 border border-slate-800">
              <Tabs.Trigger
                value="bullish"
                className="px-4 min-h-[26px] text-[9px] font-black uppercase tracking-widest"
                indicatorClassName="bg-emerald-600 rounded-lg shadow-md shadow-emerald-500/30"
              >
                Bullish
              </Tabs.Trigger>
              <Tabs.Trigger
                value="both"
                className="px-4 min-h-[26px] text-[9px] font-black uppercase tracking-widest"
                indicatorClassName="bg-slate-700 rounded-lg shadow-md shadow-slate-600/30"
              >
                Both
              </Tabs.Trigger>
              <Tabs.Trigger
                value="bearish"
                className="px-4 min-h-[26px] text-[9px] font-black uppercase tracking-widest"
                indicatorClassName="bg-rose-600 rounded-lg shadow-md shadow-rose-500/30"
              >
                Bearish
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
        </div>
      </div>

      {/* TIER FILTER */}
      <div className="flex flex-wrap gap-3">
        {['ALL', 'PERFECT', 'CONFIRMED', 'DEVELOPING', 'SPECULATIVE'].map(tier => (
          <button
            key={tier}
            onClick={() => setActiveTier(tier as any)}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${activeTier === tier ? 'bg-slate-800 border-slate-600 text-white shadow-lg' : 'bg-slate-900/30 border-slate-800/50 text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
          >
            {tier === 'PERFECT' && '🏆 '}
            {tier === 'CONFIRMED' && '🟢 '}
            {tier === 'DEVELOPING' && '🟡 '}
            {tier === 'SPECULATIVE' && '🔴 '}
            {tier}
          </button>
        ))}
      </div>

      {/* SORT HEADERS */}
      {sortedData.length > 0 && (
        <div className="flex items-center gap-6 px-5 py-3 bg-slate-950/40 border border-slate-800/60 rounded-xl mb-4 text-[9px] font-black text-slate-500 uppercase tracking-widest select-none">
          <div className="w-28 cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('symbol')}>Symbol <SortIcon column="symbol" /></div>
          <div className="w-24 cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('direction')}>Direction <SortIcon column="direction" /></div>
          <div className="flex-1 max-w-md cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('convictionScore')}>Conviction <SortIcon column="convictionScore" /></div>
          <div className="flex items-center gap-4 ml-auto">
            <div className="cursor-default">Signals Breakdown</div>
            <div className="w-5 ml-4"></div>
          </div>
        </div>
      )}

      {/* DATA LIST */}
      <div className="space-y-4">
        {sortedData.length === 0 ? (
          <div className="text-center py-20 bg-slate-900/20 border border-slate-800/40 rounded-2xl">
            <ShieldAlert className="w-12 h-12 text-slate-700 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-slate-500 uppercase tracking-widest">No Convergence Found</h3>
            <p className="text-xs font-medium text-slate-600 mt-2 max-w-sm mx-auto">Try lowering conviction tier or switching directions.</p>
          </div>
        ) : (
          currentData.map((stock, idx) => {
            const isPortfolioStock = portfolioSymbols.includes(stock.symbol);
            return (
              <motion.div 
                key={`${stock.symbol}-${idx}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className={`bg-slate-900/40 border border-slate-800/60 rounded-2xl overflow-hidden transition-all hover:bg-slate-800/40 ${getTierBg(stock.tier)} ${stock.tier === 'PERFECT' ? 'shadow-[0_0_20px_rgba(16,185,129,0.15)] border-emerald-500/25' : ''}`}
              >
                {/* ROW HEADER */}
                <div
                  className="flex flex-col lg:flex-row lg:items-center p-4 lg:p-5 cursor-pointer gap-3 lg:gap-6"
                  onClick={() => setExpandedSymbol(expandedSymbol === stock.symbol ? null : stock.symbol)}
                >
                  {/* Left: Ticker Info */}
                  <div className="flex-shrink-0 w-28 group/symbol">
                    <div 
                      onClick={(e) => { e.stopPropagation(); openTradingView(stock.symbol); }}
                      className="flex items-center gap-1.5 font-black text-white tracking-tight group-hover/symbol:text-indigo-400 transition-colors cursor-alias"
                    >
                      <h3 className="text-lg font-black">{stock.symbol}</h3>
                      {isPortfolioStock && (
                        <span className="text-[11px] text-indigo-400" title="In Portfolio">🏠</span>
                      )}
                      <ExternalLink size={12} className="opacity-0 group-hover/symbol:opacity-100 transition-opacity" />
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] font-bold text-slate-400">₹{Number(stock.ltp || 0).toFixed(2)}</span>
                      <span className={`text-[11px] font-bold ${Number(stock.change || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {Number(stock.change || 0) >= 0 ? '+' : ''}{Number(stock.change || 0).toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <button
                        title="Track in Portfolio"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onTrackInPortfolio) {
                            onTrackInPortfolio(stock.symbol, stock.ltp);
                          } else {
                            sendToPortfolioWatchlist(stock.symbol, stock.ltp, stock.direction === 'bullish' ? 'BULLISH' : 'BEARISH');
                          }
                        }}
                        className="px-1.5 py-0.5 bg-indigo-500/10 hover:bg-indigo-500/30 text-indigo-400 hover:text-indigo-200 rounded transition-all duration-150 opacity-0 group-hover:opacity-100 text-[9px] font-bold"
                      >
                        + Track
                      </button>
                    </div>
                  </div>

                  {/* Middle-Left: Direction Badge */}
                  <div className="flex-shrink-0 w-24 flex items-center">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${stock.direction === 'bullish' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                      {stock.direction}
                    </span>
                  </div>

                  {/* Middle: Score Bar */}
                  <div className="flex-1 max-w-md">
                    <div className="flex justify-between items-end mb-2">
                      <span className={`text-[10px] font-black uppercase tracking-widest ${getTierColor(stock.tier).split(' ')[3]}`}>
                        {stock.tier}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400 tracking-wider">
                        SCORE: <span className="text-sm font-black text-white font-tabular bg-slate-950/60 px-2 py-0.5 rounded border border-slate-800/80">{stock.convictionScore}</span> <span className="text-[10px] text-slate-650">/ 800</span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${(stock.convictionScore / 800) * 100}%` }}
                        transition={{ duration: 1, ease: 'easeOut' }}
                        className="h-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500"
                      />
                    </div>
                  </div>

                  {/* Right: Signal Pills */}
                  <div className="flex items-center gap-4 ml-auto min-w-0 overflow-x-auto no-scrollbar flex-nowrap">
                  <SignalPill label="MOM" active={stock.signals.momentum} icon={Activity} colorClass={stock.direction === 'bullish' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]'} />
                  <SignalPill label="PLS" active={stock.signals.pulse} icon={Zap} colorClass={stock.direction === 'bullish' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]'} />
                  <SignalPill label="SCT" active={stock.signals.sectorStrength} icon={BarChart3} colorClass={stock.direction === 'bullish' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]'} />
                  <SignalPill label="CDL-D" active={stock.signals.dailyCandle} icon={stock.direction === 'bullish' ? TrendingUp : TrendingDown} colorClass={stock.direction === 'bullish' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]'} />
                  <SignalPill label="CDL-W" active={stock.signals.weeklyCandle} icon={stock.direction === 'bullish' ? TrendingUp : TrendingDown} colorClass={stock.direction === 'bullish' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]'} />
                  <SignalPill label="ORB" active={stock.signals.orb} icon={Clock} colorClass={stock.direction === 'bullish' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]'} />
                  <SignalPill label="VAL" active={stock.signals.valuation} icon={AlertTriangle} colorClass={stock.direction === 'bullish' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]'} />
                  <SignalPill label="QUAL" active={stock.signals.quality} icon={Award} colorClass={stock.direction === 'bullish' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]'} />
                  
                  <div className="ml-4 pl-4 border-l border-slate-700/50">
                    {expandedSymbol === stock.symbol ? <ChevronDown className="w-5 h-5 text-slate-500" /> : <ChevronRight className="w-5 h-5 text-slate-500" />}
                  </div>
                </div>
              </div>

              {/* EXPANDED DETAILS */}
              <AnimatePresence>
                {expandedSymbol === stock.symbol && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-slate-800/60 bg-slate-900/60"
                  >
                    <div className="p-6 text-sm text-slate-300">
                      <div className="mb-4 flex items-center gap-2">
                        <Target className="w-4 h-4 text-indigo-400" />
                        <h4 className="font-bold uppercase tracking-widest text-slate-400">Why this trade?</h4>
                      </div>
                      <ul className="space-y-3 pl-2">
                        {ConvergenceEngine.getWhyThisTrade(stock).map((reason, i) => (
                          <li key={i} className="flex items-start gap-3">
                            <div className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${stock.direction === 'bullish' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            <span className="leading-relaxed font-medium text-slate-300">{reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })
      )}
      </div>

      {/* PAGINATION FOOTER */}
      {sortedData.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-5 bg-slate-950/30 border border-slate-800/60 rounded-2xl mt-8">
          <div className="flex items-center gap-6">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              Showing <span className="text-white">{startIndex + 1}</span> to <span className="text-white">{endIndex}</span> of <span className="text-white">{sortedData.length}</span>
            </span>
            <select 
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-slate-900 border border-slate-800 text-[10px] font-black text-slate-300 rounded-lg px-3 py-1.5 outline-none focus:border-indigo-500 transition-colors"
            >
              {[50, 100, 200, 500].map(val => (
                <option key={val} value={val}>{val} per page</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button 
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => prev - 1)}
              className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <span className="text-xs">←</span>
            </button>
            
            <div className="flex items-center gap-1.5">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum = currentPage;
                if (totalPages <= 5) pageNum = i + 1;
                else if (currentPage <= 3) pageNum = i + 1;
                else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                else pageNum = currentPage - 2 + i;

                if (pageNum < 1 || pageNum > totalPages) return null;

                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`w-9 h-9 rounded-xl text-[10px] font-black transition-all ${
                      currentPage === pageNum ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'bg-slate-900 border border-slate-800 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>

            <button 
              disabled={currentPage === totalPages || totalPages === 0}
              onClick={() => setCurrentPage(prev => prev + 1)}
              className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <span className="text-xs">→</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
