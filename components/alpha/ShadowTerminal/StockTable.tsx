import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ExternalLink, MousePointer2, Plus, Newspaper, Columns } from 'lucide-react';
import { openTradingView } from '../../../utils/navigation';
import MomentumRangeBar from '../MomentumRangeBar';
import { AlphaVerdictPanel } from '../AlphaVerdictPanel';
import { VerdictEngine } from '../../../services/alpha/VerdictEngine';
import { useAlphaToPortfolioWorkflow } from '../../../hooks/useAlphaToPortfolioWorkflow';
import { formatDistanceToNow } from 'date-fns';
import { formatCurrency, formatNumberIndian } from '../../../utils/helpers';

export const formatVolume = (vol?: number) => {
  if (vol === undefined || vol === null) return '--';
  if (vol >= 1000000) return `${(vol / 1000000).toFixed(2)}M`;
  if (vol >= 1000) return `${(vol / 1000).toFixed(2)}K`;
  return formatNumberIndian(vol);
};

export interface StockData {
  Symbol: string;
  LTP: number;
  Change: number;
  "Strength Factor": number;
  CapCategory?: string;
  Volume?: number;
  Open?: number;
  High?: number;
  Low?: number;
  Close?: number;
  CompanyName?: string;
  Sector?: string;
  MarketCap?: number;
  PE?: number;
  Dividend?: number;
  prevClose?: number;
  todayOpen?: number;
  ownership_momentum_score?: number;
}

export const getSignal = (stock: StockData) => {
  const open = stock.Open || 0;
  const low = stock.Low || 0;
  const high = stock.High || 0;
  const prevClose = stock.prevClose || 0;
  return {
    isOpenLow: open > 0 && open === low,
    isOpenHigh: open > 0 && open === high,
    isGapUp: open > 0 && prevClose > 0 && open > prevClose,
    isGapDown: open > 0 && prevClose > 0 && open < prevClose
  };
};

export const getGradientStyle = (value: number, min: number, max: number, invert = false) => {
  let score = (value - min) / (max - min);
  if (invert) score = 1 - score;
  score = Math.max(0, Math.min(1, score));

  if (score >= 0.8) {
    return { color: 'text-emerald-450', weight: 'font-black' };
  } else if (score >= 0.6) {
    return { color: 'text-emerald-400', weight: 'font-extrabold' };
  } else if (score >= 0.4) {
    return { color: 'text-yellow-400', weight: 'font-bold' };
  } else if (score >= 0.2) {
    return { color: 'text-orange-400', weight: 'font-semibold' };
  } else {
    return { color: 'text-rose-450', weight: 'font-medium' };
  }
};

export const getScoreStyle = (score: number) => {
  const s = Math.max(0, Math.min(1, score));
  if (s >= 0.8) {
    return {
      bg: 'bg-emerald-500/10 border-emerald-555/30',
      text: 'text-emerald-400 font-black',
      label: 'text-slate-400'
    };
  } else if (s >= 0.6) {
    return {
      bg: 'bg-emerald-555/5 border-emerald-500/20',
      text: 'text-emerald-400/80 font-extrabold',
      label: 'text-slate-400'
    };
  } else if (s >= 0.4) {
    return {
      bg: 'bg-amber-555/15 border-amber-500/25',
      text: 'text-amber-400 font-bold',
      label: 'text-slate-400'
    };
  } else if (s >= 0.2) {
    return {
      bg: 'bg-orange-500/10 border-orange-500/20',
      text: 'text-orange-400 font-semibold',
      label: 'text-slate-450'
    };
  } else {
    return {
      bg: 'bg-rose-555/15 border-rose-500/30',
      text: 'text-rose-400 font-medium',
      label: 'text-slate-500'
    };
  }
};

interface StockTableProps {
  data: StockData[];
  type: 'bullish' | 'bearish';
  isSniper: boolean;
  engineMode?: 'raw' | 'sector_booster' | 'pulse';
  orbDataCache?: Record<string, any[]>;
  dailyCandleData?: any;
  valuationDataCache?: Record<string, any[]>;
  shareholdingDataCache?: Record<string, any[]>;
  qualityDataCache?: Record<string, any[]>;
  boosterStocksList?: any[];
  historicalDataCache?: Record<string, any[]>;
  fiiDiiPulseData?: any[];
  derivativeSummaryData?: any[];
  portfolioSymbols?: string[];
  volumeAverages?: Record<string, number>;
  oreMap?: Record<string, any>;
  cvdMap?: Record<string, number>;
  rsMap?: Record<string, any>;
  patternMap?: Record<string, any>;
  shareholdingMap?: Record<string, any>;
  oiSignalMap?: Record<string, 'LONG_BUILDUP' | 'SHORT_COVERING' | 'SHORT_BUILDUP' | 'LONG_UNWIND' | 'NEUTRAL'>;
}

export const StockTable: React.FC<StockTableProps> = ({
  data,
  type,
  isSniper,
  engineMode,
  orbDataCache = {},
  dailyCandleData = null,
  valuationDataCache = {},
  shareholdingDataCache = {},
  qualityDataCache = {},
  boosterStocksList = [],
  historicalDataCache = {},
  fiiDiiPulseData = [],
  derivativeSummaryData = [],
  portfolioSymbols = [],
  volumeAverages = {},
  oreMap = {},
  cvdMap = {},
  rsMap = {},
  patternMap = {},
  shareholdingMap = {},
  oiSignalMap = {}
}) => {
  const { sendToPortfolioWatchlist } = useAlphaToPortfolioWorkflow();
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [sortConfig, setSortConfig] = useState<{ key: string | null; direction: 'asc' | 'desc' | null }>({ key: null, direction: null });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(['symbol', 'range', 'price', 'volume', 'igs', 'verdict', 'signal', 'prevClose']);
  const [showColumnToggle, setShowColumnToggle] = useState(false);

  const toggleColumn = (col: string) => {
    setVisibleColumns(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
  };

  const calculateColSpan = () => {
    let span = 1; // Market Asset is always visible
    if (visibleColumns.includes('range')) span++;
    if (visibleColumns.includes('price')) span++;
    if (engineMode === 'pulse' && visibleColumns.includes('prevClose')) span++;
    if (visibleColumns.includes('volume')) span++;
    if (visibleColumns.includes('igs')) span++;
    if (visibleColumns.includes('verdict')) span++;
    if (visibleColumns.includes('signal')) span++;
    return span;
  };

  const [verdictSymbol, setVerdictSymbol] = useState<string | null>(null);
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const [tooltipAlign, setTooltipAlign] = useState<'left' | 'right' | 'center'>('center');
  const [newsMap, setNewsMap] = useState<Record<string, any[]>>({});
  const [hoveredNewsSymbol, setHoveredNewsSymbol] = useState<string | null>(null);
  const [newsTooltipPos, setNewsTooltipPos] = useState<{ top: number; left: number } | null>(null);

  // Reset page when data volume changes significantly
  useEffect(() => {
    setCurrentPage(1);
  }, [data.length]);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' | null = 'asc';
    let newKey: string | null = key;

    if (sortConfig.key === key) {
      if (sortConfig.direction === 'asc') direction = 'desc';
      else if (sortConfig.direction === 'desc') {
        direction = null;
        newKey = null;
      }
    }

    setSortConfig({ key: newKey, direction });
    setCurrentPage(1);
  };

  const liveQuotesMap = React.useMemo(() => {
    const map: Record<string, any> = {};
    data.forEach(s => {
      map[s.Symbol.toUpperCase()] = {
        last_price: s.LTP,
        volume: s.Volume,
        ohlc: {
          open: s.Open || s.todayOpen || 0,
          high: s.High || 0,
          low: s.Low || 0,
          close: s.Close || s.prevClose || 0
        },
        dai: (s as any).dai,
        depth_pressure: (s as any).depth_pressure
      };
    });
    return map;
  }, [data]);

  const sortedData = React.useMemo(() => {
    if (!sortConfig.key || !sortConfig.direction) return data;

    if (sortConfig.key === 'IGS') {
      const getIgs = (stock: any) => {
        const res = VerdictEngine.compute(
          stock.Symbol,
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
          liveQuotesMap,
          volumeAverages,
          type === 'bearish',
          {
            oreScore: oreMap?.[stock.Symbol.toUpperCase()]?.ore_score,
            oreDirection: oreMap?.[stock.Symbol.toUpperCase()]?.direction,
            cvd: cvdMap?.[stock.Symbol.toUpperCase()],
            oiSignal: oiSignalMap?.[stock.Symbol.toUpperCase()],
            rsRank: rsMap?.[stock.Symbol.toUpperCase()]?.rs_rank,
            rsCategory: rsMap?.[stock.Symbol.toUpperCase()]?.category,
            fiiVelocity: shareholdingMap?.[stock.Symbol.toUpperCase()]?.fii_velocity,
            valueZoneFlag: shareholdingMap?.[stock.Symbol.toUpperCase()]?.accumulation_flag === 'ACCUMULATING'
          }
        );
        return res.igs ?? 0;
      };

      return [...data].sort((a, b) => {
        const aValue = getIgs(a);
        const bValue = getIgs(b);
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return [...data].sort((a, b) => {
      const aValue = (a as any)[sortConfig.key!];
      const bValue = (b as any)[sortConfig.key!];

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortConfig, orbDataCache, dailyCandleData, valuationDataCache, shareholdingDataCache, qualityDataCache, boosterStocksList, historicalDataCache, fiiDiiPulseData, derivativeSummaryData, liveQuotesMap, volumeAverages, type, oreMap, cvdMap, rsMap, patternMap, shareholdingMap, oiSignalMap]);

  const totalPages = Math.ceil(sortedData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, sortedData.length);
  const currentData = sortedData.slice(startIndex, endIndex);

  const symbolsJoined = useMemo(() => {
    return currentData.map(s => s.Symbol.toUpperCase()).join(',');
  }, [currentData]);

  useEffect(() => {
    if (!symbolsJoined) return;
    
    let isMounted = true;
    
    const fetchNewsForSymbols = async () => {
      try {
        const response = await fetch(`/api/python-nse/api/upstox/news?symbols=${encodeURIComponent(symbolsJoined)}`);
        if (response.ok) {
          const res = await response.json();
          if (res.status === 'success' && res.data && isMounted) {
            setNewsMap(prev => ({
              ...prev,
              ...res.data
            }));
          }
        }
      } catch (err) {
        console.error('Failed to fetch table stock news', err);
      }
    };
    
    fetchNewsForSymbols();
    
    return () => {
      isMounted = false;
    };
  }, [symbolsJoined]);

  const SortIcon = ({ column }: { column: string }) => {
    if (sortConfig.key !== column || !sortConfig.direction) return <span className="opacity-20 ml-1 text-[8px]">⇅</span>;
    return sortConfig.direction === 'asc' ? <span className="text-indigo-400 ml-1 text-[8px]">▲</span> : <span className="text-indigo-400 ml-1 text-[8px]">▼</span>;
  };

  return (
    <div className="w-full overflow-hidden space-y-2">
      <div className="flex justify-end pr-4 mb-1 relative">
        <button
          onClick={() => setShowColumnToggle(!showColumnToggle)}
          className="p-2 bg-slate-900/50 hover:bg-slate-800/80 border border-slate-800 rounded-xl text-slate-400 hover:text-indigo-400 hover:border-indigo-500/30 transition-all shadow-lg backdrop-blur-sm flex items-center justify-center"
          title="Column Settings"
        >
          <Columns size={13} />
        </button>

        <AnimatePresence>
          {showColumnToggle && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              className="absolute top-full right-4 mt-2 z-[110] bg-slate-950 border border-slate-800 rounded-xl shadow-2xl p-4 min-w-[200px] space-y-3 backdrop-blur-xl"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Visible Columns</span>
                <button
                  onClick={() => setVisibleColumns(['symbol', 'range', 'price', 'volume', 'igs', 'verdict', 'signal', 'prevClose'])}
                  className="text-[9px] font-bold text-indigo-400 hover:text-indigo-300"
                >
                  Reset
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {[
                  { id: 'range', label: 'Day Range' },
                  { id: 'price', label: 'Price Status' },
                  ...(engineMode === 'pulse' ? [{ id: 'prevClose', label: 'Prev Close' }] : []),
                  { id: 'volume', label: 'Volume' },
                  { id: 'igs', label: 'IGS Score' },
                  { id: 'verdict', label: 'Verdict' },
                  { id: 'signal', label: 'Signal' }
                ].map(col => (
                  <label key={col.id} className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={visibleColumns.includes(col.id)}
                      onChange={() => toggleColumn(col.id)}
                      className="w-3 h-3 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-0 focus:ring-offset-0"
                    />
                    <span className={`text-xs font-bold transition-colors ${visibleColumns.includes(col.id) ? 'text-slate-200' : 'text-slate-600 group-hover:text-slate-400'}`}>
                      {col.label}
                    </span>
                  </label>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile Card Representation (< md) */}
      <div className="block md:hidden w-full space-y-2.5 p-2 sm:p-3">
        {currentData.map((stock) => {
          const low = stock.Low || 0;
          const high = stock.High || 0;
          const ltp = stock.LTP || 0;
          const isExpanded = expandedSymbol === stock.Symbol;

          const verdictResult = VerdictEngine.compute(
            stock.Symbol,
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
            liveQuotesMap,
            volumeAverages,
            type === 'bearish',
            {
              oreScore: oreMap?.[stock.Symbol.toUpperCase()]?.ore_score,
              oreDirection: oreMap?.[stock.Symbol.toUpperCase()]?.direction,
              cvd: cvdMap?.[stock.Symbol.toUpperCase()],
              oiSignal: oiSignalMap?.[stock.Symbol.toUpperCase()],
              rsRank: rsMap?.[stock.Symbol.toUpperCase()]?.rs_rank,
              rsCategory: rsMap?.[stock.Symbol.toUpperCase()]?.category,
              fiiVelocity: shareholdingMap?.[stock.Symbol.toUpperCase()]?.fii_velocity,
              valueZoneFlag: shareholdingMap?.[stock.Symbol.toUpperCase()]?.accumulation_flag === 'ACCUMULATING'
            }
          );

          const vol = stock.Volume || 0;
          const turnover = ltp * vol;
          const adv = volumeAverages[stock.Symbol] || 0;
          let volStatus: 'good' | 'warning' | 'risk' | 'neutral' = 'neutral';
          let computedRvol: number | null = null;
          if (stock.Volume === undefined || stock.Volume === null) {
            volStatus = 'neutral';
          } else if (vol < 50000 || turnover < 2500000) {
            volStatus = 'risk';
          } else if (adv > 0) {
            computedRvol = vol / adv;
            if (computedRvol >= 2.0 && vol >= 100000) {
              volStatus = 'good';
            } else if (computedRvol >= 1.0) {
              volStatus = 'warning';
            } else {
              volStatus = 'neutral';
            }
          } else {
            if (vol >= 500000) volStatus = 'good';
            else if (vol >= 100000) volStatus = 'warning';
            else volStatus = 'neutral';
          }

          const getCardStatusColor = (s: 'good' | 'warning' | 'risk' | 'neutral') => {
            switch (s) {
              case 'good': return 'text-emerald-400';
              case 'risk': return 'text-rose-400';
              case 'warning': return 'text-amber-400';
              default: return 'text-slate-300';
            }
          };

          return (
            <div
              key={stock.Symbol}
              onClick={() => setExpandedSymbol(isExpanded ? null : stock.Symbol)}
              className={`w-full rounded-xl border p-3.5 transition-all duration-150 cursor-pointer min-w-0 ${
                isExpanded
                  ? 'bg-slate-900 border-indigo-500/50 shadow-lg shadow-indigo-500/10'
                  : 'bg-slate-900/70 border-slate-800/80 hover:border-slate-700'
              }`}
            >
              {/* Row 1: Symbol & Direction | LTP & Change */}
              <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider shrink-0 ${
                      stock.Change >= 0
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {stock.Change >= 0 ? 'CALL' : 'PUT'}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-white text-xs tracking-wide truncate">
                        {stock.Symbol}
                      </span>
                      {portfolioSymbols.includes(stock.Symbol.toUpperCase()) && (
                        <span className="text-[10px] text-indigo-400 shrink-0" title="In Portfolio">🏠</span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 truncate block">
                      {stock.CompanyName || (stock.CapCategory ? stock.CapCategory.toUpperCase() : 'EQUITY')}
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="font-mono font-black text-white text-sm block">
                    {formatCurrency(stock.LTP || 0)}
                  </span>
                  <span className={`text-[10px] font-bold ${stock.Change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {stock.Change >= 0 ? '▲ +' : '▼ '}{stock.Change.toFixed(2)}%
                  </span>
                </div>
              </div>

              {/* Row 2: 2x2 Clean Metric Grid */}
              <div className="grid grid-cols-2 gap-1.5 p-2 bg-slate-950/70 rounded-lg border border-slate-800/60 text-[10px] select-none">
                <div className="flex justify-between items-center pr-1 border-r border-slate-800/40">
                  <span className="text-slate-400">Day Range:</span>
                  <span className="font-mono font-bold text-slate-200 truncate ml-1">
                    {formatCurrency(low)} - {formatCurrency(high)}
                  </span>
                </div>
                <div className="flex justify-between items-center pl-1">
                  <span className="text-slate-400">Volume:</span>
                  <span className={`font-mono font-bold ${getCardStatusColor(volStatus)} ml-1`}>
                    {formatVolume(stock.Volume)}
                  </span>
                </div>
                <div className="flex justify-between items-center pr-1 border-r border-slate-800/40">
                  <span className="text-slate-400">IGS Score:</span>
                  <span className="font-mono font-bold text-indigo-400 ml-1">
                    {verdictResult?.igs !== undefined ? `${verdictResult.igs}%` : (verdictResult?.totalScore ? `${verdictResult.totalScore} pts` : '--')}
                  </span>
                </div>
                <div className="flex justify-between items-center pl-1">
                  <span className="text-slate-400">Verdict:</span>
                  <span className="font-bold truncate text-slate-200 ml-1">
                    {verdictResult?.verdict || (stock.Change >= 0 ? 'BULLISH' : 'BEARISH')}
                  </span>
                </div>
              </div>

              {/* Expandable Verdict Detail */}
              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-slate-800/80 animate-in fade-in duration-200" onClick={(e) => e.stopPropagation()}>
                  <AlphaVerdictPanel
                    result={verdictResult}
                    variant="detail"
                    symbol={stock.Symbol}
                    stock={stock}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop Table Representation (>= md) */}
      <div className="hidden md:block w-full overflow-x-auto no-scrollbar">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead>
            <tr className="bg-slate-950/40 text-[10.5px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-800/50 select-none">
              <th className="py-3 pl-4 font-bold cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('Symbol')}>Market Asset <SortIcon column="Symbol" /></th>
              {visibleColumns.includes('range') && <th className="py-3 font-bold w-1/4 text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('LTP')}>Day Range (L-H)</th>}
              {visibleColumns.includes('price') && <th className="py-3 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('Change')}>Price Status <SortIcon column="Change" /></th>}
              {engineMode === 'pulse' && visibleColumns.includes('prevClose') && <th className="py-3 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('prevClose')}>Prev Close <SortIcon column="prevClose" /></th>}
              {visibleColumns.includes('volume') && <th className="py-3 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('Volume')}>Volume <SortIcon column="Volume" /></th>}
              {visibleColumns.includes('igs') && <th className="py-3 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('IGS')}>IGS Score <SortIcon column="IGS" /></th>}
              {visibleColumns.includes('verdict') && <th className="py-3 font-bold text-center">Verdict</th>}
              {visibleColumns.includes('signal') && <th className="py-3 text-right pr-4 font-bold">Signal</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/30">
            {currentData.map((stock) => {
              const low = stock.Low || 0;
              const high = stock.High || 0;
              const ltp = stock.LTP || 0;
              const prevClose = stock.prevClose || 0;
              const isExpanded = expandedSymbol === stock.Symbol;
              const { isOpenLow, isOpenHigh, isGapUp, isGapDown } = getSignal(stock);

              const verdictResult = VerdictEngine.compute(
                stock.Symbol,
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
                liveQuotesMap,
                volumeAverages,
                type === 'bearish',
                {
                  oreScore: oreMap?.[stock.Symbol.toUpperCase()]?.ore_score,
                  oreDirection: oreMap?.[stock.Symbol.toUpperCase()]?.direction,
                  cvd: cvdMap?.[stock.Symbol.toUpperCase()],
                  oiSignal: oiSignalMap?.[stock.Symbol.toUpperCase()],
                  rsRank: rsMap?.[stock.Symbol.toUpperCase()]?.rs_rank,
                  rsCategory: rsMap?.[stock.Symbol.toUpperCase()]?.category,
                  fiiVelocity: shareholdingMap?.[stock.Symbol.toUpperCase()]?.fii_velocity,
                  valueZoneFlag: shareholdingMap?.[stock.Symbol.toUpperCase()]?.accumulation_flag === 'ACCUMULATING'
                }
              );

              // Helper to get status colors
              const getStatusColors = (type: 'good' | 'warning' | 'risk' | 'neutral') => {
                switch (type) {
                  case 'good':
                    return {
                      bg: 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400',
                      label: 'text-emerald-500/70',
                      value: 'text-emerald-400 font-black',
                      subText: 'text-emerald-500/60'
                    };
                  case 'risk':
                    return {
                      bg: 'bg-rose-500/5 border-rose-500/20 text-rose-450',
                      label: 'text-rose-500/70',
                      value: 'text-rose-450 font-black',
                      subText: 'text-rose-500/60'
                    };
                  case 'warning':
                    return {
                      bg: 'bg-amber-500/5 border-amber-500/20 text-amber-400',
                      label: 'text-amber-500/70',
                      value: 'text-amber-400 font-black',
                      subText: 'text-amber-500/60'
                    };
                  default:
                    return {
                      bg: 'bg-slate-950/50 border-slate-800/50 text-slate-300',
                      label: 'text-slate-500',
                      value: 'text-slate-300 font-bold',
                      subText: 'text-slate-600'
                    };
                }
              };

              // Determine status for each metric
              const dayRangePos = high > low ? (ltp - low) / (high - low) : 0.5;
              const dayRangeStatus = (high === low || high === 0) ? 'neutral' : (dayRangePos >= 0.75 ? 'good' : (dayRangePos <= 0.25 ? 'risk' : 'warning'));
              const dayRangeColors = getStatusColors(dayRangeStatus);

              const o2cVal = stock.Open ? ((ltp - stock.Open) / stock.Open) * 100 : 0;
              const o2cStatus = !stock.Open ? 'neutral' : (o2cVal >= 0.5 ? 'good' : (o2cVal <= -0.5 ? 'risk' : 'warning'));
              const o2cColors = getStatusColors(o2cStatus);

              const capCat = stock.CapCategory?.toLowerCase() || '';
              const capStatus = !stock.CapCategory ? 'neutral' : (capCat.includes('large') ? 'good' : (capCat.includes('mid') ? 'warning' : 'risk'));
              const capColors = getStatusColors(capStatus);

              const peStatus = (stock.PE === undefined || stock.PE === null) ? 'neutral' : (stock.PE <= 0 ? 'risk' : (stock.PE <= 25 ? 'good' : (stock.PE <= 55 ? 'warning' : 'risk')));
              const peColors = getStatusColors(peStatus);

              // Volume calculations: hybrid absolute + relative algorithm
              const vol = stock.Volume || 0;
              const turnover = ltp * vol;
              const adv = volumeAverages[stock.Symbol] || 0;
              let volStatus: 'good' | 'warning' | 'risk' | 'neutral' = 'neutral';
              let computedRvol: number | null = null;

              if (stock.Volume === undefined || stock.Volume === null) {
                volStatus = 'neutral';
              } else if (vol < 50000 || turnover < 2500000) {
                volStatus = 'risk';
              } else if (adv > 0) {
                computedRvol = vol / adv;
                if (computedRvol >= 2.0 && vol >= 100000) {
                  volStatus = 'good';
                } else if (computedRvol >= 1.0) {
                  volStatus = 'warning';
                } else {
                  volStatus = 'neutral';
                }
              } else {
                if (vol >= 500000) {
                  volStatus = 'good';
                } else if (vol >= 100000) {
                  volStatus = 'warning';
                } else {
                  volStatus = 'neutral';
                }
              }
              const volColors = getStatusColors(volStatus);

              const divStatus = (stock.Dividend === undefined || stock.Dividend === null) ? 'neutral' : (stock.Dividend >= 1.5 ? 'good' : (stock.Dividend > 0 ? 'warning' : 'neutral'));
              const divColors = getStatusColors(divStatus);

              return (
                <React.Fragment key={stock.Symbol}>
                  <tr
                     onClick={() => setExpandedSymbol(isExpanded ? null : stock.Symbol)}
                    className={`group hover:bg-indigo-500/10 transition-all duration-200 cursor-pointer ${isExpanded ? 'bg-indigo-500/5' : ''}`}
                  >
                    <td className="py-3 pl-4">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <div
                            className="flex items-center gap-1.5 cursor-pointer group/sym"
                            onClick={(e) => {
                              e.stopPropagation();
                              openTradingView(stock.Symbol);
                            }}
                          >
                            <span className="font-bold text-[13px] text-slate-200 tracking-normal group-hover:text-indigo-300 group-hover/sym:text-indigo-400 transition-colors">{stock.Symbol}</span>
                            {portfolioSymbols.includes(stock.Symbol.toUpperCase()) && (
                              <span className="text-[10px] text-indigo-400 cursor-help" title="In Portfolio">🏠</span>
                            )}
                            <ExternalLink className="w-2.5 h-2.5 text-slate-600 group-hover/sym:text-indigo-400 transition-colors" />
                          </div>

                          {(() => {
                            const activeNews = newsMap[stock.Symbol.toUpperCase()] || [];
                            const hasActiveNews = activeNews.length > 0;
                            if (!hasActiveNews) return null;
                            return (
                              <div className="relative inline-flex items-center" onClick={(e) => e.stopPropagation()}>
                                <a
                                  href={activeNews[0].article_link || '#'}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-orange-500/80 hover:text-orange-400 relative inline-flex items-center justify-center p-1 rounded hover:bg-slate-800 transition-colors"
                                  onMouseEnter={(e) => {
                                    setHoveredNewsSymbol(stock.Symbol);
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setNewsTooltipPos({
                                      top: rect.top + window.scrollY - 10,
                                      left: rect.left + window.scrollX + rect.width / 2
                                    });
                                  }}
                                  onMouseLeave={() => {
                                    setHoveredNewsSymbol(null);
                                  }}
                                >
                                  <Newspaper className="w-3.5 h-3.5 animate-pulse drop-shadow-[0_0_5px_rgba(249,115,22,0.3)]" />
                                </a>
                              </div>
                            );
                          })()}

                          <button
                            title="Track in Portfolio"
                            onClick={(e) => {
                              e.stopPropagation();
                              sendToPortfolioWatchlist(stock.Symbol, ltp, stock.Change >= 0 ? 'BULLISH' : 'BEARISH');
                            }}
                            className="p-1 rounded hover:bg-slate-800/80 text-slate-500 hover:text-emerald-450 transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Plus size={11} />
                          </button>
                        </div>
                        <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mt-0.5 truncate max-w-[130px]">
                          {stock.CompanyName || (stock.CapCategory ? stock.CapCategory.toUpperCase() : 'EQUITY')}
                        </span>
                      </div>
                    </td>
                    {visibleColumns.includes('range') && (
                      <td className="py-3 px-4 min-w-[150px]">
                        <MomentumRangeBar low={low} high={high} current={ltp} />
                      </td>
                    )}
                    {visibleColumns.includes('price') && (
                      <td className="py-3 text-center">
                        <div className="flex flex-col items-center">
                          <span className="text-[12.5px] font-bold text-white">{formatCurrency(stock.LTP || 0)}</span>
                          <span className={`text-[10.5px] font-bold ${stock.Change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {stock.Change >= 0 ? '▲' : '▼'} {Math.abs(stock.Change).toFixed(2)}%
                          </span>
                        </div>
                      </td>
                    )}
                    {engineMode === 'pulse' && visibleColumns.includes('prevClose') && (
                      <td className="py-3 text-center font-mono text-[11.5px] text-slate-400 font-bold">
                        {formatCurrency(prevClose)}
                      </td>
                    )}
                    {visibleColumns.includes('volume') && (
                      <td className="py-3 text-center">
                        <div className="flex flex-col items-center">
                          <span className={`font-mono text-[11.5px] font-bold ${volColors.value}`}>
                            {formatVolume(stock.Volume)}
                          </span>
                          {computedRvol !== null && (
                            <span className={`text-[9.5px] font-bold mt-0.5 ${volStatus === 'good' ? 'text-emerald-400' :
                                volStatus === 'warning' ? 'text-amber-400' :
                                  volStatus === 'risk' ? 'text-rose-400' : 'text-slate-500'
                              }`}>
                              {computedRvol.toFixed(1)}x RVOL
                            </span>
                          )}
                        </div>
                      </td>
                    )}
                    {visibleColumns.includes('igs') && (
                      <td className="py-3 text-center">
                        {(() => {
                          const igs = verdictResult.igs ?? 0;
                          const formattedIgs = `${Math.round(igs * 100)}%`;
                          let tagClass = 'text-rose-450 bg-rose-500/10 border border-rose-500/20 font-medium';
                          if (igs >= 0.75) {
                            tagClass = 'text-emerald-450 bg-emerald-500/10 border border-emerald-500/20 font-black';
                          } else if (igs >= 0.55) {
                            tagClass = 'text-amber-400 bg-amber-500/10 border border-amber-500/20 font-bold';
                          }
                          return (
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-mono tracking-wider ${tagClass}`}>
                              {formattedIgs}
                            </span>
                          );
                        })()}
                      </td>
                    )}
                    {visibleColumns.includes('verdict') && (
                      <td
                        className="py-3 text-center"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <AlphaVerdictPanel
                          symbol={stock.Symbol}
                          result={verdictResult}
                          variant="badge"
                          onOpenDetail={() => setVerdictSymbol(stock.Symbol)}
                        />
                      </td>
                    )}
                    {visibleColumns.includes('signal') && (
                      <td
                        className="py-3 pr-4 text-right cursor-help"
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          if (type === 'bearish') {
                            setTooltipAlign('right');
                            setTooltipPos({
                              top: rect.top + window.scrollY + rect.height / 2,
                              left: rect.left + window.scrollX - 8
                            });
                          } else {
                            setTooltipAlign('left');
                            setTooltipPos({
                              top: rect.top + window.scrollY + rect.height / 2,
                              left: rect.right + window.scrollX + 8
                            });
                          }
                          setHoveredSymbol(stock.Symbol);
                        }}
                        onMouseLeave={() => {
                          setHoveredSymbol(null);
                          setTooltipPos(null);
                        }}
                      >
                        <div className="flex flex-col items-end gap-1">
                          {engineMode === 'pulse' ? (
                            <>
                              {isOpenLow && <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-[9.5px] font-bold tracking-wide">OPEN=LOW</span>}
                              {isOpenHigh && <span className="px-1.5 py-0.5 bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded text-[9.5px] font-bold tracking-wide">OPEN=HIGH</span>}
                              {isGapUp && <span className="px-1.5 py-0.5 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded text-[9.5px] font-bold tracking-wide">GAP UP</span>}
                              {isGapDown && <span className="px-1.5 py-0.5 bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded text-[9.5px] font-bold tracking-wide">GAP DOWN</span>}
                              {!isOpenLow && !isOpenHigh && !isGapUp && !isGapDown && <span className="text-[11px] font-bold text-slate-555">STABLE</span>}
                            </>
                          ) : (
                            <span className={`px-2 py-1 rounded-lg text-[11px] font-bold tracking-wide ${stock.Change >= 5 ? 'bg-emerald-500/20 text-emerald-400' :
                              stock.Change >= 2 ? 'bg-indigo-500/20 text-indigo-400' :
                                stock.Change <= -5 ? 'bg-rose-555/20 text-rose-400' :
                                  'bg-slate-800 text-slate-400'
                              }`}>
                              {stock.Change >= 0 ? 'S' : 'W'}
                            </span>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                  <AnimatePresence>
                    {isExpanded && (
                      <tr className="bg-slate-900/40 border-b border-indigo-500/20 shadow-inner">
                        <td colSpan={calculateColSpan()} className="p-0">
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="p-4 grid grid-cols-3 gap-3">
                              {/* Day Range */}
                              <div className={`flex flex-col gap-1 p-3 rounded-xl border transition-all duration-200 ${dayRangeColors.bg}`}>
                                <span className={`text-[11px] font-black uppercase tracking-wide ${dayRangeColors.label}`}>Day Low - High</span>
                                <div className="flex items-end justify-between mt-1">
                                  <span className={`text-sm font-mono font-black ${dayRangeColors.value}`}>
                                    ₹{stock.Low || 0} - ₹{stock.High || 0}
                                  </span>
                                  {high > low && (
                                    <span className={`text-[10px] font-black tracking-wider uppercase ${dayRangeColors.subText}`}>
                                      {dayRangeStatus === 'good' ? 'Near High' : dayRangeStatus === 'risk' ? 'Near Low' : 'Mid Range'}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Open & O2C */}
                              <div className={`flex flex-col gap-1 p-3 rounded-xl border transition-all duration-200 ${o2cColors.bg}`}>
                                <span className={`text-[11px] font-black uppercase tracking-wide ${o2cColors.label}`}>Opening Context</span>
                                <div className="flex items-end justify-between mt-1">
                                  <span className={`text-sm font-mono font-black ${o2cColors.value}`}>₹{stock.Open || '--'}</span>
                                  {stock.Open && (
                                    <span className={`text-[10.5px] font-black ${o2cColors.value}`}>
                                      {o2cVal >= 0 ? '+' : ''}{o2cVal.toFixed(2)}%
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Market Cap */}
                              <div className={`flex flex-col gap-1 p-3 rounded-xl border transition-all duration-200 ${capColors.bg}`}>
                                <span className={`text-[11px] font-black uppercase tracking-wide ${capColors.label}`}>Market Cap</span>
                                <div className="flex items-end justify-between mt-1">
                                  <span className={`text-sm font-mono font-black ${capColors.value}`}>
                                    {stock.MarketCap ? `₹${formatNumberIndian(stock.MarketCap)} Cr` : '--'}
                                  </span>
                                  <span className={`text-[10px] font-black uppercase tracking-wider ${capColors.value}`}>
                                    {stock.CapCategory ? stock.CapCategory.toUpperCase() : '--'}
                                  </span>
                                </div>
                              </div>

                              {/* PE Ratio */}
                              <div className={`flex flex-col gap-1 p-3 rounded-xl border transition-all duration-200 ${peColors.bg}`}>
                                <span className={`text-[11px] font-black uppercase tracking-wide ${peColors.label}`}>PE Ratio</span>
                                <div className="flex items-end justify-between mt-1">
                                  <span className={`text-sm font-mono font-black ${peColors.value}`}>
                                    {stock.PE ? stock.PE.toFixed(2) : '--'}
                                  </span>
                                  {stock.PE !== undefined && stock.PE !== null && (
                                    <span className={`text-[10px] font-black tracking-wider uppercase ${peColors.subText}`}>
                                      {peStatus === 'good' ? 'Undervalued' : peStatus === 'warning' ? 'Moderate' : stock.PE <= 0 ? 'Loss Making' : 'Expensive'}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Volume */}
                              <div className={`flex flex-col gap-1 p-3 rounded-xl border transition-all duration-200 ${volColors.bg}`}>
                                <span className={`text-[11px] font-black uppercase tracking-wide ${volColors.label}`}>Volume</span>
                                <div className="flex items-end justify-between mt-1">
                                  <span className={`text-sm font-mono font-black ${volColors.value}`}>
                                    {formatVolume(stock.Volume)}
                                  </span>
                                  {stock.Volume !== undefined && stock.Volume !== null && (
                                    <span className={`text-[10px] font-black tracking-wider uppercase ${volColors.subText}`}>
                                      {volStatus === 'good' ? 'High Liquid' : volStatus === 'warning' ? 'Moderate' : 'Low Liquid'}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Dividend Yield */}
                              <div className={`flex flex-col gap-1 p-3 rounded-xl border transition-all duration-200 ${divColors.bg}`}>
                                <span className={`text-[11px] font-black uppercase tracking-wide ${divColors.label}`}>Dividend Yield</span>
                                <div className="flex items-end justify-between mt-1">
                                  <span className={`text-sm font-mono font-black ${divColors.value}`}>
                                    {stock.Dividend !== undefined ? `${stock.Dividend.toFixed(2)}%` : '--'}
                                  </span>
                                  {stock.Dividend !== undefined && stock.Dividend > 0 && (
                                    <span className={`text-[10px] font-black tracking-wider uppercase ${divColors.subText}`}>
                                      {divStatus === 'good' ? 'High Yield' : 'Yielding'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </AnimatePresence>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Simplified Pagination for Side-by-Side Tables */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-950/20 border-t border-slate-800/50">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {startIndex + 1}-{endIndex} / {sortedData.length}
          </span>
          <select
            value={itemsPerPage}
            onChange={(e) => {
              setItemsPerPage(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="bg-slate-900 border border-slate-800 text-[10px] font-bold text-slate-400 rounded-md px-1.5 py-0.5 outline-none"
          >
            {[50, 100, 200].map(val => (
              <option key={val} value={val}>{val}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(prev => prev - 1)}
            className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-500 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-all"
          >
            <span className="text-[10px]">←</span>
          </button>
          <span className="text-[11px] font-bold text-indigo-400 px-2">{currentPage}</span>
          <button
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(prev => prev + 1)}
            className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-500 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-all"
          >
            <span className="text-[10px]">→</span>
          </button>
        </div>
      </div>
      {/* Verdict Details Overlay Modal */}
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
                  symbol={verdictSymbol}
                  stock={data.find(s => s.Symbol === verdictSymbol)}
                  result={VerdictEngine.compute(
                    verdictSymbol,
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
                    liveQuotesMap,
                    volumeAverages,
                    type === 'bearish',
                    {
                      oreScore: oreMap?.[verdictSymbol.toUpperCase()]?.ore_score,
                      oreDirection: oreMap?.[verdictSymbol.toUpperCase()]?.direction,
                      cvd: cvdMap?.[verdictSymbol.toUpperCase()],
                      oiSignal: oiSignalMap?.[verdictSymbol.toUpperCase()],
                      rsRank: rsMap?.[verdictSymbol.toUpperCase()]?.rs_rank,
                      rsCategory: rsMap?.[verdictSymbol.toUpperCase()]?.category,
                      fiiVelocity: shareholdingMap?.[verdictSymbol.toUpperCase()]?.fii_velocity,
                      valueZoneFlag: shareholdingMap?.[verdictSymbol.toUpperCase()]?.accumulation_flag === 'ACCUMULATING'
                    }
                  )}
                  variant="detail"
                  onClose={() => setVerdictSymbol(null)}
                />
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
      {/* Viewport Hover Microstructure Tooltip Popover */}
      {hoveredSymbol && tooltipPos && typeof window !== 'undefined' && createPortal(
        <AnimatePresence>
          <div
            className="fixed z-[9999] pointer-events-none select-none"
            style={{
              top: Math.max(190, Math.min(window.innerHeight - 190, tooltipPos.top)),
              left: tooltipPos.left,
              transform: tooltipAlign === 'right'
                ? 'translate(-100%, -50%)'
                : tooltipAlign === 'left'
                  ? 'translate(0, -50%)'
                  : 'translate(-50%, -50%)'
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="w-[580px] bg-slate-950/98 backdrop-blur-3xl border border-slate-800/80 rounded-2xl p-4 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95)] border-indigo-500/25 text-left font-sans"
            >
              {(() => {
                const hoveredStock = data.find(s => s.Symbol === hoveredSymbol);
                if (!hoveredStock) return null;

                const open = hoveredStock.Open || hoveredStock.todayOpen || 0;
                const ltp = hoveredStock.LTP || 0;
                const high = hoveredStock.High || 0;
                const low = hoveredStock.Low || 0;
                const vol = hoveredStock.Volume || 0;

                const o2c = open > 0 ? ((ltp - open) / open) * 100 : 0;
                const adv = volumeAverages[hoveredStock.Symbol] || 0;
                const rvol = adv > 0 ? vol / adv : 1.0;
                const timeOfDayRvol = (hoveredStock as any).timeOfDayRvol !== undefined && (hoveredStock as any).timeOfDayRvol !== null
                  ? Number((hoveredStock as any).timeOfDayRvol)
                  : null;

                const lowerShadow = open > 0 ? ((Math.min(open, ltp) - low) / open) * 100 : 0;
                const upperShadow = open > 0 ? ((high - Math.max(open, ltp)) / open) * 100 : 0;

                const vwap = (hoveredStock as any).vwap || (hoveredStock as any).averagePrice || (open + high + low + ltp) / 4;
                const vwapDist = vwap > 0 ? ((ltp - vwap) / vwap) * 100 : 0;

                const hodProximity = ltp > 0 ? ((high - ltp) / ltp) * 100 : 0;
                const lodProximity = ltp > 0 ? ((ltp - low) / ltp) * 100 : 0;
                const gFactor = o2c * Math.log(rvol + 1) * (1 - Math.min(100, Math.max(0, type === 'bearish' ? lodProximity : hodProximity)) / 100);

                const tradedValue = (vol * ltp) / 100000;
                const intradayRange = low > 0 ? ((high - low) / low) * 100 : 0;

                const dai = (hoveredStock as any).dai || 1.0;
                const depthPressure = (hoveredStock as any).depth_pressure || 'NEUTRAL';

                // Exact Score Formulas matching VerdictEngine
                const o2cScore = Math.min(Math.max((type === 'bearish' ? -o2c : o2c) / 3.0, 0), 1.0);
                const rvolScore = Math.min(Math.max((rvol - 0.5) / 2.5, 0), 1.0);
                const shadowVal = type === 'bearish' ? upperShadow : lowerShadow;
                const shadowScore = Math.min(Math.max(shadowVal / 1.0, 0), 1.0);
                const vwapScore = Math.min(Math.max((type === 'bearish' ? -vwapDist : vwapDist) / 3.0, 0), 1.0);
                const gScore = Math.min(Math.max((type === 'bearish' ? -gFactor : gFactor) / 10.0, 0), 1.0);
                const proximityVal = type === 'bearish' ? lodProximity : hodProximity;
                const proximityScore = Math.min(Math.max(1 - proximityVal / 1.5, 0), 1.0);
                const valueScore = Math.min(Math.max((tradedValue - 10) / 290, 0), 1.0);
                const rangeScore = Math.min(Math.max((intradayRange - 1.0) / 5.0, 0), 1.0);
                const daiScore = depthPressure === (type === 'bearish' ? 'SELL_SIDE' : 'BUY_SIDE') ? 1.0 : (depthPressure === 'NEUTRAL' ? 0.5 : 0.0);

                // Styling gradients based on individual scores
                const o2cStyle = getScoreStyle(o2cScore);
                const rvolStyle = getScoreStyle(rvolScore);
                const shadowStyle = getScoreStyle(shadowScore);
                const vwapStyle = getScoreStyle(vwapScore);
                const gStyle = getScoreStyle(gScore);
                const proximityStyle = getScoreStyle(proximityScore);
                const valueStyle = getScoreStyle(valueScore);
                const rangeStyle = getScoreStyle(rangeScore);
                const daiStyle = getScoreStyle(daiScore);

                // Full VerdictEngine computation for IGS
                const verdictRes = VerdictEngine.compute(
                  hoveredStock.Symbol,
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
                  liveQuotesMap,
                  volumeAverages,
                  type === 'bearish',
                  {
                    oreScore: oreMap?.[hoveredStock.Symbol.toUpperCase()]?.ore_score,
                    oreDirection: oreMap?.[hoveredStock.Symbol.toUpperCase()]?.direction,
                    cvd: cvdMap?.[hoveredStock.Symbol.toUpperCase()],
                    oiSignal: oiSignalMap?.[hoveredStock.Symbol.toUpperCase()],
                    rsRank: rsMap?.[hoveredStock.Symbol.toUpperCase()]?.rs_rank,
                    rsCategory: rsMap?.[hoveredStock.Symbol.toUpperCase()]?.category,
                    fiiVelocity: shareholdingMap?.[hoveredStock.Symbol.toUpperCase()]?.fii_velocity,
                    valueZoneFlag: shareholdingMap?.[hoveredStock.Symbol.toUpperCase()]?.accumulation_flag === 'ACCUMULATING'
                  }
                );

                return (
                  <div className="space-y-3">
                    {/* Tooltip Header */}
                    <div className="flex items-center justify-between border-b border-slate-800/40 pb-1.5 mb-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
                        <span className="text-[11px] font-bold text-white tracking-tight">{hoveredStock.Symbol}</span>
                        {verdictRes?.igs !== undefined && (
                          <span className="text-[10px] font-mono font-black text-indigo-400 ml-2">
                            IGS: {(verdictRes.igs * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                      <span className="text-[7.5px] font-black text-indigo-400 bg-indigo-500/5 border border-indigo-500/10 px-1.5 py-0.5 rounded uppercase tracking-widest font-mono">
                        Insights
                      </span>
                    </div>

                    {/* 3x3 Grid Layout */}
                    <div className="grid grid-cols-3 gap-2 text-left">
                      {/* Row 1, Box 1: O2C Momentum */}
                      <div className={`border rounded-xl p-2.5 flex flex-col justify-between shadow-inner transition-colors duration-150 ${o2cStyle.bg}`}>
                        <span className={`text-[9px] font-bold uppercase tracking-wide block mb-0.5 ${o2cStyle.label}`}>O2C Momentum</span>
                        <span className={`text-[14px] font-mono ${o2cStyle.text}`}>
                          {o2c >= 0 ? '+' : ''}{o2c.toFixed(2)}%
                        </span>
                        <span className="text-[7.5px] text-slate-500 font-bold uppercase tracking-wider mt-0.5 block">Intraday Run</span>
                      </div>

                      {/* Row 1, Box 2: RVOL Pace */}
                      <div className={`border rounded-xl p-2.5 flex flex-col justify-between shadow-inner transition-colors duration-150 ${rvolStyle.bg}`}>
                        <span className={`text-[9px] font-bold uppercase tracking-wide block mb-0.5 ${rvolStyle.label}`}>RVOL Pace</span>
                        <div className="flex flex-col">
                          {timeOfDayRvol !== null ? (
                            <>
                              <span className={`text-[14px] font-black font-mono ${rvolStyle.text}`}>
                                {timeOfDayRvol.toFixed(1)}x
                              </span>
                              <span className="text-[7.5px] text-slate-400 font-bold uppercase tracking-wider block mt-0.5">
                                ToD ({rvol.toFixed(1)}x Day)
                              </span>
                            </>
                          ) : (
                            <>
                              <span className={`text-[14px] font-mono ${rvolStyle.text} animate-pulse`}>
                                {rvol.toFixed(1)}x
                              </span>
                              <span className="text-[7.5px] text-slate-500 font-bold uppercase tracking-wider block mt-0.5">
                                vs 20d ADV (ToD...)
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Row 1, Box 3: Open Shadow */}
                      <div className={`border rounded-xl p-2.5 flex flex-col justify-between shadow-inner transition-colors duration-150 ${shadowStyle.bg}`}>
                        <span className={`text-[9px] font-bold uppercase tracking-wide block mb-0.5 ${shadowStyle.label}`}>
                          {type === 'bearish' ? 'Open=High Shadow' : 'Open=Low Shadow'}
                        </span>
                        <span className={`text-[14px] font-mono ${shadowStyle.text}`}>
                          {shadowVal.toFixed(2)}%
                        </span>
                        <span className="text-[7.5px] text-slate-500 font-bold uppercase tracking-wider mt-0.5 block">
                          {type === 'bearish' ? 'Upper Shadow' : 'Lower Shadow'}
                        </span>
                      </div>

                      {/* Row 1, Box 4: VWAP Distance */}
                      <div className={`border rounded-xl p-2.5 flex flex-col justify-between shadow-inner transition-colors duration-150 ${vwapStyle.bg}`}>
                        <span className={`text-[9px] font-bold uppercase tracking-wide block mb-0.5 ${vwapStyle.label}`}>VWAP Distance</span>
                        <span className={`text-[14px] font-mono ${vwapStyle.text}`}>
                          {vwapDist >= 0 ? '+' : ''}{vwapDist.toFixed(2)}%
                        </span>
                        <span className="text-[7.5px] text-slate-500 font-bold uppercase tracking-wider mt-0.5 block">vs VWAP Line</span>
                      </div>

                      {/* Row 2, Box 1: G-Force Score */}
                      <div className={`border rounded-xl p-2.5 flex flex-col justify-between shadow-inner transition-colors duration-150 ${gStyle.bg}`}>
                        <span className={`text-[9px] font-bold uppercase tracking-wide block mb-0.5 ${gStyle.label}`}>G-Force Score</span>
                        <span className={`text-[14px] font-mono ${gStyle.text}`}>
                          {gFactor.toFixed(2)}
                        </span>
                        <span className="text-[7.5px] text-slate-500 font-bold uppercase tracking-wider mt-0.5 block">Acceleration</span>
                      </div>

                      {/* Row 2, Box 2: Proximity */}
                      <div className={`border rounded-xl p-2.5 flex flex-col justify-between shadow-inner transition-colors duration-150 ${proximityStyle.bg}`}>
                        <span className={`text-[9px] font-bold uppercase tracking-wide block mb-0.5 ${proximityStyle.label}`}>
                          {type === 'bearish' ? 'LOD Distance' : 'HOD Distance'}
                        </span>
                        <span className={`text-[14px] font-mono ${proximityStyle.text}`}>
                          {proximityVal.toFixed(2)}%
                        </span>
                        <span className="text-[7.5px] text-slate-500 font-bold uppercase tracking-wider mt-0.5 block">
                          {type === 'bearish' ? 'from Day Low' : 'from Day High'}
                        </span>
                      </div>

                      {/* Row 2, Box 3: Traded Value */}
                      <div className={`border rounded-xl p-2.5 flex flex-col justify-between shadow-inner transition-colors duration-150 ${valueStyle.bg}`}>
                        <span className={`text-[9px] font-bold uppercase tracking-wide block mb-0.5 ${valueStyle.label}`}>Traded Value</span>
                        <span className={`text-[14px] font-mono ${valueStyle.text}`}>
                          ₹{tradedValue.toFixed(1)}L
                        </span>
                        <span className="text-[7.5px] text-slate-500 font-bold uppercase tracking-wider mt-0.5 block">Liquidity Size</span>
                      </div>

                      {/* Row 3, Box 2: Intraday Range */}
                      <div className={`border rounded-xl p-2.5 flex flex-col justify-between shadow-inner transition-colors duration-150 ${rangeStyle.bg}`}>
                        <span className={`text-[9px] font-bold uppercase tracking-wide block mb-0.5 ${rangeStyle.label}`}>Intraday Range</span>
                        <span className={`text-[14px] font-mono ${rangeStyle.text}`}>
                          {intradayRange.toFixed(2)}%
                        </span>
                        <span className="text-[7.5px] text-slate-500 font-bold uppercase tracking-wider mt-0.5 block">H-L Spread</span>
                      </div>

                      {/* Row 3, Box 3: Depth Imbalance */}
                      <div className={`border rounded-xl p-2.5 flex flex-col justify-between shadow-inner transition-colors duration-150 ${daiStyle.bg}`}>
                        <span className={`text-[9px] font-bold uppercase tracking-wide block mb-0.5 ${daiStyle.label}`}>Depth Imbalance</span>
                        <span className={`text-[14px] font-mono ${daiStyle.text}`}>
                          {dai.toFixed(2)}x
                        </span>
                        <span className="text-[7.5px] text-slate-500 font-bold uppercase tracking-wider mt-0.5 block">
                          {depthPressure === 'BUY_SIDE' ? 'BUY Pressure' : depthPressure === 'SELL_SIDE' ? 'SELL Pressure' : 'Balanced'}
                        </span>
                      </div>
                    </div>

                    {/* Institutional Footprints Section */}
                    <div className="border-t border-slate-800/40 pt-2 mt-2 space-y-1">
                      <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block font-sans">Institutional Footprints</span>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {/* ORE Badge */}
                        {oreMap?.[hoveredStock.Symbol.toUpperCase()] && (() => {
                          const ore = oreMap[hoveredStock.Symbol.toUpperCase()];
                          return (
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                              ore.direction === 'BULLISH' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                              ore.direction === 'BEARISH' ? 'bg-rose-500/10 border-rose-500/20 text-rose-450' :
                              'bg-slate-900 border-slate-800 text-slate-400'
                            }`}>
                              ORE: {ore.ore_score.toFixed(2)} ({ore.direction})
                            </span>
                          );
                        })()}

                        {/* CVD Badge */}
                        {cvdMap?.[hoveredStock.Symbol.toUpperCase()] !== undefined && (() => {
                          const cvd = cvdMap[hoveredStock.Symbol.toUpperCase()];
                          return (
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                              cvd > 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                              cvd < 0 ? 'bg-rose-500/10 border-rose-500/20 text-rose-450' :
                              'bg-slate-900 border-slate-800 text-slate-400'
                            }`}>
                              CVD: {cvd > 0 ? '+' : ''}{(cvd / 1000000).toFixed(2)}M
                            </span>
                          );
                        })()}

                        {/* RS Rank Badge */}
                        {rsMap?.[hoveredStock.Symbol.toUpperCase()] && (() => {
                          const rs = rsMap[hoveredStock.Symbol.toUpperCase()];
                          return (
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                              rs.category === 'LEADER' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                              rs.category === 'LAGGARD' ? 'bg-rose-500/10 border-rose-500/20 text-rose-450' :
                              'bg-slate-900 border-slate-800 text-slate-400'
                            }`}>
                              RS Rank: #{Math.round(rs.rs_rank)} ({rs.category})
                            </span>
                          );
                        })()}

                        {/* Shareholding / FII Velocity */}
                        {shareholdingMap?.[hoveredStock.Symbol.toUpperCase()] && (() => {
                          const sh = shareholdingMap[hoveredStock.Symbol.toUpperCase()];
                          return (
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                              sh.accumulation_flag === 'ACCUMULATING' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                              sh.accumulation_flag === 'EXITING' ? 'bg-rose-500/10 border-rose-500/20 text-rose-450' :
                              'bg-slate-900 border-slate-800 text-slate-400'
                            }`}>
                              FII Vel: {sh.fii_velocity > 0 ? '+' : ''}{sh.fii_velocity.toFixed(2)}%
                            </span>
                          );
                        })()}

                        {/* OI Signal */}
                        {oiSignalMap?.[hoveredStock.Symbol.toUpperCase()] && (() => {
                          const oi = oiSignalMap[hoveredStock.Symbol.toUpperCase()];
                          return (
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                              oi === 'LONG_BUILDUP' || oi === 'SHORT_COVERING' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                              oi === 'SHORT_BUILDUP' || oi === 'LONG_UNWIND' ? 'bg-rose-500/10 border-rose-500/20 text-rose-450' :
                              'bg-slate-900 border-slate-800 text-slate-400'
                            }`}>
                              OI: {oi}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}

      {/* Premium News Tooltip Popover */}
      {hoveredNewsSymbol && newsTooltipPos && typeof window !== 'undefined' && createPortal(
        <AnimatePresence>
          <div
            className="absolute z-[99999] pointer-events-none select-none"
            style={{
              top: newsTooltipPos.top,
              left: newsTooltipPos.left,
              transform: 'translate(-50%, -100%)',
              paddingBottom: '12px'
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 15 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="w-[320px] bg-slate-900/95 backdrop-blur-md border border-orange-500/15 rounded-2xl overflow-hidden shadow-[0_10px_25px_-10px_rgba(249,115,22,0.15)] text-left font-sans flex flex-col pointer-events-auto"
              onMouseEnter={() => setHoveredNewsSymbol(hoveredNewsSymbol)}
              onMouseLeave={() => setHoveredNewsSymbol(null)}
            >
              {(() => {
                const articles = newsMap[hoveredNewsSymbol.toUpperCase()] || [];
                if (articles.length === 0) return null;
                const art = articles[0];
                const timeStr = art.published_at 
                  ? formatDistanceToNow(new Date(art.published_at), { addSuffix: true }) 
                  : (art.published_time ? formatDistanceToNow(new Date(art.published_time), { addSuffix: true }) : '');

                return (
                  <div>
                    {art.thumbnail && (
                      <div className="w-full h-36 overflow-hidden relative">
                        <img 
                          src={art.thumbnail} 
                          alt="" 
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent" />
                        <span className="absolute top-3 left-3 bg-orange-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
                          LATEST NEWS
                        </span>
                      </div>
                    )}
                    <div className="p-4 space-y-2">
                      <div className="flex items-center justify-between text-[9px] font-bold text-slate-500">
                        <span>UPSTOX NEWS</span>
                        <span>{timeStr}</span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-100 leading-snug line-clamp-2 hover:text-orange-400 transition-colors">
                        {art.heading || art.title}
                      </h4>
                      <p className="text-[11px] text-slate-400 leading-normal line-clamp-3">
                        {art.summary || art.description}
                      </p>
                      <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                        <span className="text-[10px] text-indigo-400 font-extrabold">{hoveredNewsSymbol}</span>
                        <a 
                          href={art.article_link || '#'} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="text-[10px] font-black text-orange-500 hover:text-orange-400 uppercase tracking-widest flex items-center gap-1"
                        >
                          READ MORE <ExternalLink size={10} />
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};

export default StockTable;
