import React, { useState, useEffect, useMemo, useRef } from 'react';
import { RefreshCw, Search, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { openTradingView } from '../../utils/navigation';
import { INDICATORS, CONDITIONS, getConditionMetadata } from './indicator_constants';
import { INDICATOR_ICONS, INDICATOR_HEROES } from './indicator_svgs';
import { STRATEGY_CONFIGS, type StrategyId } from '../../services/alpha/StrategyEngine';

interface TechnicalIndicatorPanelProps {
  prebuildScreens: Record<string, any> | null;
  selectedIndicator: string;
  setSelectedIndicator: (indicator: string) => void;
  selectedCondition: string;
  setSelectedCondition: (condition: string) => void;
  indicatorScreenerData: any[];
  screenerLoading: boolean;
  fetchIndicatorScreenerAction: (indicator: string, condition: string, force?: boolean) => Promise<void>;
  onBack: () => void;
  isWarmingIndicators?: boolean;
  warmingIndicatorStep?: number;
  warmingIndicatorLabel?: string;
  warmTechnicalIndicators?: (forceAll?: boolean) => Promise<void>;
}

const sanitizeSvgHtml = (rawSvg: string): string => {
  if (!rawSvg) return '';
  return rawSvg
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^>\s]+/gi, '')
    .replace(/href\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, '');
};

const getSubGroupForCondition = (indicatorId: string, conditionId: string): string => {
  const groups = CONDITIONS[indicatorId];
  if (!groups) return '';
  for (const [groupName, conds] of Object.entries(groups)) {
    if (conds.some(c => c.id === conditionId)) {
      return groupName;
    }
  }
  return Object.keys(groups)[0] || '';
};

const INDICATOR_DESCRIPTIONS: Record<string, string> = {
  'ema': "Discover momentum-based EMA crossover, breakout and reversal opportunities across NSE stocks in real-time.",
  'sma': "Filter stocks undergoing Simple Moving Average crossovers and trend validations on daily timeframes.",
  'wma': "Track Weighted Moving Average breakouts to capture high-priority trend-following reversals.",
  'ohlc': "Monitor Open-equals-Low, Open-equals-High, and daily candlestick breakout patterns.",
  'fibonacci': "Identify key retracement, support, and resistance levels on the Fibonacci grid.",
  'vwap': "Analyze intraday volume-weighted average price breakouts indicating institutional action.",
  'pivot-points': "Detect price action around classical, Camarilla, or Woodie support and resistance pivot zones.",
  'volatility': "Track Bollinger Bands narrowing squeezes and breakout bands on daily close data.",
  'trend-indicators': "Track MACD crossovers, ADX trend strengths, and Supertrend reversal signals.",
  'volume': "Monitor Chaikin Money Flow and massive buying or selling volume surges.",
  'momentum-oscillators': "Identify overbought and oversold conditions on Relative Strength Index (RSI).",
  'price-action': "Filter volatility squeezes (NR4/NR7), day breakouts, and volume shocks."
};

interface CustomDropdownProps<T> {
  label: string;
  value: string;
  options: T[];
  getOptionId: (opt: T) => string;
  getOptionLabel: (opt: T) => string;
  getOptionMeta?: (opt: T) => { sentiment: string; tags: string[] } | null;
  onChange: (id: string) => void;
  icon?: React.ReactNode;
}

const CustomDropdown = <T,>({
  label,
  value,
  options,
  getOptionId,
  getOptionLabel,
  getOptionMeta,
  onChange,
  icon
}: CustomDropdownProps<T>) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOpt = options.find(opt => getOptionId(opt) === value);
  const displayLabel = selectedOpt ? getOptionLabel(selectedOpt) : 'Select...';

  return (
    <div className="flex flex-col gap-1.5 relative w-full" ref={dropdownRef}>
      <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider select-none">
        {label}
      </label>
      
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between bg-slate-900/80 hover:bg-slate-850/80 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white font-semibold focus:border-indigo-500 transition-all select-none w-full text-left"
      >
        <div className="flex items-center gap-2 truncate">
          {icon && <span className="flex-shrink-0 text-slate-500">{icon}</span>}
          <span className="truncate">{displayLabel}</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-300 flex-shrink-0 ml-2 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 5, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-full z-[100] w-full bg-slate-900/95 border border-slate-800 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl p-2 max-h-[300px] overflow-y-auto custom-scrollbar"
          >
            <div className="grid grid-cols-1 gap-1">
              {options.map((opt) => {
                const optId = getOptionId(opt);
                const optLabel = getOptionLabel(opt);
                const isSelected = optId === value;
                const meta = getOptionMeta ? getOptionMeta(opt) : null;

                return (
                  <button
                    key={optId}
                    type="button"
                    onClick={() => {
                      onChange(optId);
                      setIsOpen(false);
                    }}
                    className={`w-full px-4 py-2.5 rounded-xl text-xs font-semibold text-left transition-all flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex flex-col gap-1 min-w-0 w-full">
                      <div className="flex items-center justify-between w-full gap-2">
                        <span className="truncate font-semibold text-slate-100">{optLabel}</span>
                        {isSelected && (
                          <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.5)] flex-shrink-0" />
                        )}
                      </div>
                      {meta && (meta.sentiment !== 'Neutral' || meta.tags.length > 0) && (
                        <div className="flex flex-wrap items-center gap-1 mt-1 select-none">
                          {meta.sentiment !== 'Neutral' && (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider ${
                              meta.sentiment === 'Bullish'
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : 'bg-rose-500/10 text-rose-450'
                            }`}>
                              {meta.sentiment}
                            </span>
                          )}
                          {meta.tags.slice(0, 2).map(tag => (
                            <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[8px] font-bold bg-slate-950/40 text-slate-450 border border-slate-800/40">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const TechnicalIndicatorPanel: React.FC<TechnicalIndicatorPanelProps> = ({
  prebuildScreens,
  selectedIndicator,
  setSelectedIndicator,
  selectedCondition,
  setSelectedCondition,
  indicatorScreenerData,
  screenerLoading,
  fetchIndicatorScreenerAction,
  onBack,
  isWarmingIndicators = false,
  warmingIndicatorStep = 0,
  warmingIndicatorLabel = '',
  warmTechnicalIndicators
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSubGroup, setSelectedSubGroup] = useState<string>('');
  const [sentimentFilter, setSentimentFilter] = useState<'all' | 'bullish' | 'bearish'>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const itemsPerPage = 50;

  const [strategyMode, setStrategyMode] = useState<boolean>(false);
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyId>('ema_snapback');

  const p20List = useMemo(() => {
    if (!strategyMode) return null;
    return STRATEGY_CONFIGS[selectedStrategy]?.power20 || [];
  }, [strategyMode, selectedStrategy]);

  const activeConditions = useMemo(() => {
    if (!strategyMode || !p20List) return CONDITIONS;
    const result: Record<string, Record<string, { id: string; label: string }[]>> = {};
    for (const [indId, groups] of Object.entries(CONDITIONS)) {
      const filteredGroups: Record<string, { id: string; label: string }[]> = {};
      for (const [groupName, conds] of Object.entries(groups)) {
        const filteredConds = conds.filter(c => p20List.includes(c.id));
        if (filteredConds.length > 0) {
          filteredGroups[groupName] = filteredConds;
        }
      }
      if (Object.keys(filteredGroups).length > 0) {
        result[indId] = filteredGroups;
      }
    }
    return result;
  }, [strategyMode, p20List]);

  const activeIndicators = useMemo(() => {
    if (!strategyMode || !p20List) return INDICATORS;
    return INDICATORS.filter(ind => activeConditions[ind.id] !== undefined);
  }, [strategyMode, p20List, activeConditions]);

  // Sync selected options if they are filtered out in Strategy Mode
  useEffect(() => {
    if (strategyMode && activeIndicators.length > 0) {
      const isValidInd = activeIndicators.some(i => i.id === selectedIndicator);
      if (!isValidInd) {
        handleIndicatorChange(activeIndicators[0].id);
      } else {
        const groupConds = activeConditions[selectedIndicator] || {};
        const validGroups = Object.keys(groupConds);
        const isValidGroup = validGroups.includes(selectedSubGroup);
        if (!isValidGroup && validGroups.length > 0) {
          const nextGroup = validGroups[0];
          setSelectedSubGroup(nextGroup);
          const validConds = groupConds[nextGroup] || [];
          if (validConds.length > 0) {
            setSelectedCondition(validConds[0].id);
          }
        } else {
          const validConds = groupConds[selectedSubGroup] || [];
          const isValidCond = validConds.some(c => c.id === selectedCondition);
          if (!isValidCond && validConds.length > 0) {
            setSelectedCondition(validConds[0].id);
          }
        }
      }
    }
  }, [strategyMode, selectedStrategy, selectedIndicator, selectedSubGroup, selectedCondition, activeIndicators, activeConditions]);

  // Sync sub-group on mount or option change
  useEffect(() => {
    if (selectedIndicator && selectedCondition) {
      const group = getSubGroupForCondition(selectedIndicator, selectedCondition);
      setSelectedSubGroup(group);
    }
  }, [selectedIndicator, selectedCondition]);

  // Sync data on mount or option change
  useEffect(() => {
    fetchIndicatorScreenerAction(selectedIndicator, selectedCondition);
  }, [selectedIndicator, selectedCondition]);

  // Reset filters on condition change
  useEffect(() => {
    setSentimentFilter('all');
    setTagFilter(null);
  }, [selectedIndicator, selectedCondition]);

  const handleIndicatorChange = (ind: string) => {
    setSelectedIndicator(ind);
    const groups = activeConditions[ind] || {};
    const firstGroupName = Object.keys(groups)[0] || '';
    const firstCond = groups[firstGroupName]?.[0]?.id || '';
    setSelectedSubGroup(firstGroupName);
    setSelectedCondition(firstCond);
    setCurrentPage(1);
  };

  const handleSubGroupChange = (group: string) => {
    setSelectedSubGroup(group);
    const conds = activeConditions[selectedIndicator]?.[group] || [];
    const firstCond = conds[0]?.id || '';
    setSelectedCondition(firstCond);
    setCurrentPage(1);
  };

  const handleConditionChange = (cond: string) => {
    setSelectedCondition(cond);
    setCurrentPage(1);
  };

  // Find active condition label
  const activeConditionLabel = useMemo(() => {
    const activeConditionGroup = activeConditions[selectedIndicator];
    if (activeConditionGroup) {
      for (const conds of Object.values(activeConditionGroup)) {
        const found = conds.find(c => c.id === selectedCondition);
        if (found) {
          return found.label;
        }
      }
    }
    return '';
  }, [selectedIndicator, selectedCondition, activeConditions]);

  // Get metadata for active condition
  const metadata = useMemo(() => {
    return getConditionMetadata(selectedIndicator, selectedCondition, activeConditionLabel);
  }, [selectedIndicator, selectedCondition, activeConditionLabel]);

  // Search filter
  const searchedData = useMemo(() => {
    return indicatorScreenerData.filter(s =>
      s.Symbol.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [indicatorScreenerData, searchTerm]);

  // Compute metrics from searched data (overall scanned dataset breadth)
  const stats = useMemo(() => {
    const total = searchedData.length;
    const bullish = searchedData.filter(s => s.Change >= 0).length;
    const bearish = total - bullish;
    const bullishPct = total > 0 ? Math.round((bullish / total) * 100) : 0;
    const bearishPct = total > 0 ? Math.round((bearish / total) * 100) : 0;
    return { total, bullish, bearish, bullishPct, bearishPct };
  }, [searchedData]);

  // Apply sentiment & tag filter
  const filteredData = useMemo(() => {
    let result = searchedData;
    if (sentimentFilter === 'bullish') {
      result = result.filter(s => s.Change >= 0);
    } else if (sentimentFilter === 'bearish') {
      result = result.filter(s => s.Change < 0);
    }

    if (tagFilter === 'Scalping') {
      result = result.filter(s => Math.abs(s.Change) < 1);
    } else if (tagFilter === 'Swing') {
      result = result.filter(s => Math.abs(s.Change) >= 2);
    } else if (tagFilter === 'Intraday') {
      result = result.filter(s => Math.abs(s.Change) >= 1 && Math.abs(s.Change) < 2);
    } else if (tagFilter === 'Trend Following') {
      result = result.filter(s => s.Change > 0);
    }
    return result;
  }, [searchedData, sentimentFilter, tagFilter]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentItems = useMemo(() => {
    return filteredData.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredData, startIndex]);

  // Custom formatted header values
  const indicatorShortName = useMemo(() => {
    const active = INDICATORS.find(i => i.id === selectedIndicator);
    if (!active) return 'Indicator';
    // Clean up label by removing parenthesis contents
    return active.label.split('(')[0].trim();
  }, [selectedIndicator]);

  const activeIconSvg = INDICATOR_ICONS[selectedIndicator] || '';
  const activeHeroSvg = INDICATOR_HEROES[selectedIndicator] || '';

  const handleFilterPillClick = (filter: string) => {
    setCurrentPage(1);
    if (filter === 'All') {
      setSentimentFilter('all');
      setTagFilter(null);
    } else if (filter === 'Bullish') {
      setSentimentFilter('bullish');
      setTagFilter(null);
    } else if (filter === 'Bearish') {
      setSentimentFilter('bearish');
      setTagFilter(null);
    } else {
      setTagFilter(filter);
      setSentimentFilter('all');
    }
  };

  const isFilterActive = (filter: string) => {
    if (filter === 'All') return sentimentFilter === 'all' && tagFilter === null;
    if (filter === 'Bullish') return sentimentFilter === 'bullish';
    if (filter === 'Bearish') return sentimentFilter === 'bearish';
    return tagFilter === filter;
  };

  return (
    <div className="space-y-6">
      {/* HEADER NAVIGATION */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-slate-900 dark:hover:text-white uppercase tracking-widest transition-colors"
        >
          ← Back to Terminal
        </button>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            {filteredData.length} Matches Found
          </span>
        </div>
      </div>

      {/* SCREENER HERO CARD (INTELLIGENCE HUB) */}
      <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800/80 p-8 rounded-[2.5rem] shadow-[0_0_50px_rgba(99,102,241,0.06)] relative overflow-hidden group min-h-[240px] flex flex-col md:flex-row justify-between gap-8 select-none">
        {/* Radial grid line background effect */}
        <div className="absolute inset-0 opacity-15 pointer-events-none" style={{ 
          backgroundImage: `radial-gradient(circle at 1px 1px, rgb(99, 102, 241) 1px, transparent 0)`,
          backgroundSize: '16px 16px' 
        }} />

        {/* Diagonal lighting highlight */}
        <div className={`absolute top-0 right-0 w-[400px] h-[400px] rounded-full filter blur-[120px] opacity-10 -mr-32 -mt-32 transition-all duration-700 pointer-events-none ${
          metadata.sentiment === 'Bullish' ? 'bg-emerald-500' :
          metadata.sentiment === 'Bearish' ? 'bg-rose-500' : 'bg-indigo-500'
        }`} />

        <div className="flex-1 flex flex-col justify-between gap-6 relative z-10">
          <div className="space-y-3">
            {/* Intel tag */}
            <div className="flex items-center gap-2 text-[9px] font-black tracking-[0.2em] text-emerald-400 uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              INTELLIGENCE HUB • LIVE NSE DATA
            </div>

            {/* Title & icon */}
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-black text-white tracking-tight leading-none">
                {indicatorShortName} Screener
              </h2>
              {activeIconSvg && (
                <div 
                  className="w-8 h-8 text-emerald-400 stroke-emerald-400 fill-none flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:stroke-[2.5]" 
                  dangerouslySetInnerHTML={{ __html: sanitizeSvgHtml(activeIconSvg) }} 
                />
              )}
            </div>

            {/* Description */}
            <p className="text-xs text-slate-400 max-w-xl leading-relaxed">
              {INDICATOR_DESCRIPTIONS[selectedIndicator] || "Discover premium momentum crossovers, volatility squeezes, and breakdown indicators across F&O stocks."}
            </p>
          </div>

          {/* Search & filters inside the Hero card */}
          <div className="space-y-4">
            <div className="relative max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder={`Search ${indicatorShortName} screeners...`}
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full bg-slate-950/80 border border-slate-800 hover:border-slate-750 focus:border-indigo-500 rounded-xl pl-12 pr-4 py-3 text-xs text-white placeholder:text-slate-600 outline-none transition-all font-semibold"
              />
            </div>

            {/* Trend Filter Pills */}
            <div className="flex flex-wrap items-center gap-2 select-none">
              {['All', 'Bullish', 'Bearish', 'Scalping', 'Swing', 'Intraday', 'Trend Following'].map((filter) => {
                const isActive = isFilterActive(filter);
                return (
                  <button
                    key={filter}
                    onClick={() => handleFilterPillClick(filter)}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${
                      isActive
                        ? filter === 'Bullish'
                          ? 'bg-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-600/10'
                          : filter === 'Bearish'
                          ? 'bg-rose-600 border-rose-500 text-white shadow-md shadow-rose-600/10'
                          : 'bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/10'
                        : 'bg-slate-950/60 hover:bg-slate-900/60 text-slate-450 hover:text-white border-slate-850 hover:border-slate-800'
                    }`}
                  >
                    {filter}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right side Illustration or mini metrics box */}
        <div className="flex items-center justify-center md:justify-end relative z-10 flex-shrink-0">
          {activeHeroSvg ? (
            <div 
              className="w-64 h-32 md:h-44 text-indigo-400 opacity-80 hover:opacity-100 transition-opacity duration-300 [&>svg]:w-full [&>svg]:h-full [&>svg]:stroke-slate-800 [&>svg]:fill-none [&>svg_path]:stroke-indigo-500/60"
              dangerouslySetInnerHTML={{ __html: sanitizeSvgHtml(activeHeroSvg) }} 
            />
          ) : (
            <div className="w-56 bg-slate-950/30 border border-slate-850 p-5 rounded-2xl flex flex-col justify-between gap-3 shadow-inner">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Breadth Bias</span>
                <span className="text-[10px] font-black text-indigo-400 font-mono bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded-md">
                  {stats.total} stocks
                </span>
              </div>
              {stats.total > 0 ? (
                <div className="space-y-1.5">
                  <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden flex">
                    <div style={{ width: `${stats.bullishPct}%` }} className="h-full bg-emerald-500" />
                    <div style={{ width: `${stats.bearishPct}%` }} className="h-full bg-rose-500" />
                  </div>
                  <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider font-mono">
                    <span className="text-emerald-400">Bullish ({stats.bullishPct}%)</span>
                    <span className="text-rose-450">Bearish ({stats.bearishPct}%)</span>
                  </div>
                </div>
              ) : (
                <div className="text-[10px] font-bold text-slate-650 text-center py-1">No scanned matches</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* CONTROLS SECTION */}
      <div className="bg-slate-950/40 border border-slate-800/60 p-6 rounded-[2rem] backdrop-blur-md space-y-4">
        {/* Strategy Mode Toggle & Buttons */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/30 p-4 rounded-2xl border border-slate-850/60">
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer select-none">
              <input
                type="checkbox"
                checked={strategyMode}
                onChange={(e) => setStrategyMode(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600 peer-checked:after:bg-white"></div>
              <span className="ml-2.5 text-xs font-black text-slate-300 uppercase tracking-wider">Strategy Mode Filter</span>
            </label>
            <span className="text-[10px] font-bold text-slate-500 max-w-xs leading-normal">
              {strategyMode ? 'Showing only Power-20 indicators for the active strategy' : 'Showing all 449 technical indicator-condition scans'}
            </span>
          </div>

          <AnimatePresence>
            {strategyMode && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex items-center gap-1.5 bg-slate-950 p-0.5 rounded-xl border border-slate-850 self-start sm:self-auto"
              >
                {[
                  { id: 'ema_snapback', label: '🟣 SCALP', color: '#A855F7' },
                  { id: 'morning_snapback', label: '🟢 CONT', color: '#22C55E' },
                  { id: 'upper_circuit', label: '🔵 UC', color: '#3B82F6' }
                ].map((strat) => (
                  <button
                    key={strat.id}
                    onClick={() => setSelectedStrategy(strat.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all duration-300 ${
                      selectedStrategy === strat.id
                        ? 'text-white font-black shadow-md'
                        : 'text-slate-500 hover:text-slate-350'
                    }`}
                    style={selectedStrategy === strat.id ? { backgroundColor: strat.color } : {}}
                  >
                    {strat.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* CUSTOM TECHNICAL INDICATOR SELECTOR */}
          <CustomDropdown
            label="Technical Indicator"
            value={selectedIndicator}
            options={activeIndicators}
            getOptionId={(opt) => opt.id}
            getOptionLabel={(opt) => opt.label}
            onChange={handleIndicatorChange}
            icon={activeIconSvg ? (
              <div 
                className="w-3.5 h-3.5 text-indigo-400 stroke-indigo-400 fill-none [&>svg]:w-full [&>svg]:h-full" 
                dangerouslySetInnerHTML={{ __html: sanitizeSvgHtml(activeIconSvg) }} 
              />
            ) : undefined}
          />

          {/* CUSTOM SUB-INDICATOR GROUP SELECTOR */}
          <CustomDropdown
            label="Sub-Indicator / Group"
            value={selectedSubGroup}
            options={Object.keys(activeConditions[selectedIndicator] || {})}
            getOptionId={(opt) => opt}
            getOptionLabel={(opt) => opt}
            onChange={handleSubGroupChange}
          />

          {/* CUSTOM CROSS-FILTER CONDITION SELECTOR */}
          <CustomDropdown
            label="Crossover / Breakout Condition"
            value={selectedCondition}
            options={activeConditions[selectedIndicator]?.[selectedSubGroup] || []}
            getOptionId={(opt) => opt.id}
            getOptionLabel={(opt) => opt.label}
            getOptionMeta={(opt) => {
              const meta = getConditionMetadata(selectedIndicator, opt.id, opt.label);
              return {
                sentiment: meta.sentiment,
                tags: meta.tags
              };
            }}
            onChange={handleConditionChange}
          />
        </div>

        {/* SYNC & PREBUILT METADATA */}
        <div className="flex items-center justify-between border-t border-slate-900 pt-4 mt-2">
          <div className="flex flex-col gap-0.5">
            <p className="text-[10px] text-indigo-400 font-black uppercase tracking-wider">
              {activeConditionLabel || selectedCondition}
            </p>
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">
              Timeframe: 1 Day (Daily close breakouts)
            </p>
          </div>

          <div className="flex items-center gap-3">
            {isWarmingIndicators ? (
              <div className="flex flex-col items-end gap-1 select-none mr-2">
                <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest max-w-[200px] truncate text-right">
                  Warming ({warmingIndicatorStep}/52): {warmingIndicatorLabel}
                </span>
                <div className="w-36 h-1 bg-slate-900 rounded-full overflow-hidden">
                  <div 
                    style={{ width: `${Math.min(100, (warmingIndicatorStep / 52) * 100)}%` }} 
                    className="h-full bg-indigo-500 transition-all duration-300 shadow-[0_0_10px_rgba(99,102,241,0.5)]" 
                  />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => warmTechnicalIndicators && warmTechnicalIndicators(false)}
                disabled={screenerLoading || isWarmingIndicators}
                className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 hover:text-indigo-200 border border-indigo-500/20 disabled:opacity-50 text-xs font-black rounded-xl uppercase tracking-widest transition-all"
                title="Warm-up Power-20 technical indicators for today"
              >
                <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
                <span>Warm Indicators</span>
              </button>
            )}

            <button
              onClick={() => fetchIndicatorScreenerAction(selectedIndicator, selectedCondition, true)}
              disabled={screenerLoading || isWarmingIndicators}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-black rounded-xl uppercase tracking-widest transition-all shadow-lg shadow-indigo-600/10"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${screenerLoading ? 'animate-spin' : ''}`} />
              <span>{screenerLoading ? 'Syncing...' : 'Sync Scans'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* METRIC ANALYSIS INFO CARD */}
      <div className="bg-slate-900/40 border border-slate-850 p-5 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 select-none">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
              metadata.sentiment === 'Bullish'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : metadata.sentiment === 'Bearish'
                ? 'bg-rose-500/10 text-rose-450 border border-rose-500/20'
                : 'bg-slate-500/10 text-slate-400 border border-slate-600/20'
            }`}>
              {metadata.sentiment}
            </span>
            <h4 className="text-xs font-black text-slate-200 uppercase tracking-wider">
              Signal Verdict & Definition
            </h4>
          </div>
          <p className="text-[11px] text-slate-450 leading-relaxed max-w-4xl">
            {metadata.description}
          </p>
        </div>

        {stats.total > 0 && (
          <div className="w-full md:w-48 flex-shrink-0 flex items-center gap-3 bg-slate-950/20 p-2.5 rounded-xl border border-slate-900">
            <div className="flex-1 space-y-1">
              <div className="flex justify-between text-[9px] font-black text-slate-500 uppercase tracking-widest">
                <span>Scanned Bias</span>
                <span className="text-indigo-400 font-mono">{stats.total} matching</span>
              </div>
              <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden flex">
                <div style={{ width: `${stats.bullishPct}%` }} className="h-full bg-emerald-500" />
                <div style={{ width: `${stats.bearishPct}%` }} className="h-full bg-rose-500" />
              </div>
              <div className="flex justify-between text-[8px] font-black uppercase tracking-wider font-mono">
                <span className="text-emerald-400">Bullish {stats.bullishPct}%</span>
                <span className="text-rose-450">Bearish {stats.bearishPct}%</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* DATA TERMINAL GRID */}
      {screenerLoading && indicatorScreenerData.length === 0 ? (
        <div className="min-h-[400px] flex flex-col items-center justify-center space-y-6">
          <div className="w-16 h-16 border-4 border-indigo-500/10 dark:border-indigo-500/20 border-t-indigo-600 dark:border-t-indigo-500 rounded-full animate-spin mx-auto shadow-[0_0_50px_rgba(99,102,241,0.15)]" />
          <h3 className="text-sm font-black text-slate-500 dark:text-slate-350 uppercase tracking-[0.2em] animate-pulse">
            Analyzing Indicator Breakouts
          </h3>
        </div>
      ) : filteredData.length === 0 ? (
        <div className="min-h-[300px] flex flex-col items-center justify-center bg-slate-950/20 border border-slate-800/40 rounded-3xl p-12 text-center shadow-inner">
          <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">No matching stocks found</p>
          <p className="text-slate-600 text-xs mt-1">Try switching indicator criteria, resetting filter tags, or verifying your token connection.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-slate-950/40 border border-slate-800/60 rounded-[2rem] overflow-hidden backdrop-blur-md">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800/50 bg-slate-950/60 select-none">
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Symbol</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">LTP (Spot Price)</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Change %</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Signal Date</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Indicator Metric</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/30">
                  {currentItems.map((stock, idx) => {
                    const isGreen = stock.Change >= 0;
                    return (
                      <tr key={stock.Symbol} className="hover:bg-slate-800/20 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500 font-bold text-[10px] w-5">
                              {(startIndex + idx + 1).toString().padStart(2, '0')}
                            </span>
                            <button
                              onClick={() => openTradingView(stock.Symbol)}
                              className="text-sm font-black text-slate-200 hover:text-indigo-400 transition-colors tracking-tight text-left flex items-center gap-1"
                            >
                              {stock.Symbol}
                              <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-slate-500" />
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right text-xs font-black text-slate-300 font-mono">
                          ₹{(stock.LTP || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-black font-mono shadow-sm ${
                            isGreen
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-450 border border-rose-500/20'
                          }`}>
                            {isGreen ? '+' : ''}{stock.Change.toFixed(2)}%
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center text-xs font-bold text-slate-400 font-mono">
                          {stock.signalDate || 'N/A'}
                        </td>
                        <td className="px-6 py-4 text-right text-xs font-bold text-indigo-400 font-mono">
                          <span className="text-[10px] font-black uppercase text-slate-500 mr-2">
                            {stock.metricKey}
                          </span>
                          {typeof stock.metricValue === 'number'
                            ? stock.metricValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : stock.metricValue}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button
                            onClick={() => openTradingView(stock.Symbol)}
                            className="px-3 py-1.5 bg-slate-900/60 hover:bg-slate-800 border border-slate-800 rounded-xl text-[9px] font-black text-indigo-400 hover:text-white uppercase tracking-widest transition-all shadow-sm"
                          >
                            Chart
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* PAGINATION CONTROLS */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between bg-slate-950/20 p-4 border border-slate-800/40 rounded-2xl">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-850 disabled:opacity-50 text-xs font-bold text-slate-400 hover:text-white rounded-xl transition-all border border-slate-800"
              >
                Previous
              </button>

              <span className="text-xs font-bold text-slate-400">
                Page {currentPage} of {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-850 disabled:opacity-50 text-xs font-bold text-slate-400 hover:text-white rounded-xl transition-all border border-slate-800"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TechnicalIndicatorPanel;
