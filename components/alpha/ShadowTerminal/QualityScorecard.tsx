import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tabs } from '../../ui/AnimatedTabs';
import { 
  ChevronDown, 
  ChevronUp, 
  Search, 
  LayoutGrid, 
  List, 
  Filter,
  BarChart2,
  TrendingUp,
  Shield,
  Zap,
  Target,
  User,
  Activity,
  Award,
  Circle,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ChevronDown as ChevronDownIcon,
  ExternalLink
} from 'lucide-react';
import { openTradingView } from '../../../utils/navigation';
import { QualityScoreItem } from '../../../services/alpha/ShadowScreenerService';

interface QualityScorecardProps {
  data: QualityScoreItem[];
  selectedType: string;
  onTypeChange: (type: string) => void;
  selectedFilter: 'high' | 'low';
  onFilterChange: (filter: 'high' | 'low') => void;
  onSync: () => void;
}

const SCORE_TYPES = [
  { id: 'total_score', label: 'Overall Quality', icon: Award },
  { id: 'profitability_score', label: 'Profitability', icon: TrendingUp },
  { id: 'growth_score', label: 'Growth', icon: Zap },
  { id: 'valuation_score', label: 'Valuation', icon: BarChart2 },
  { id: 'cash_flow_score', label: 'Cash Flow', icon: Activity },
  { id: 'financial_strength_score', label: 'Strength', icon: Shield },
  { id: 'management_score', label: 'Management', icon: User },
  { id: 'moat_score', label: 'Moat', icon: Target },
  { id: 'risk_score', label: 'Risk Profile', icon: Shield },
  { id: 'momentum_score', label: 'Momentum', icon: Activity }
];

export const QualityScorecard: React.FC<QualityScorecardProps> = ({ 
  data, 
  selectedType, 
  onTypeChange, 
  selectedFilter, 
  onFilterChange,
  onSync
}) => {
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSector, setSelectedSector] = useState('All Sectors');
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [isSectorDropdownOpen, setIsSectorDropdownOpen] = useState(false);
  const sectorDropdownRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sectorDropdownRef.current && !sectorDropdownRef.current.contains(event.target as Node)) {
        setIsSectorDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Pagination & Sorting State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [sortConfig, setSortConfig] = useState<{ 
    key: keyof QualityScoreItem | null, 
    direction: 'asc' | 'desc' | null 
  }>({ key: 'total_score', direction: 'desc' });

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedSector, selectedType, selectedFilter]);

  const sectors = useMemo(() => {
    const s = new Set<string>();
    s.add('All Sectors');
    data.forEach(item => { if (item.sector) s.add(item.sector); });
    return Array.from(s).sort();
  }, [data]);

  const processedData = useMemo(() => {
    let filtered = data.filter(item => {
      const matchesSearch = item.symbol_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.company_name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesSector = selectedSector === 'All Sectors' || item.sector === selectedSector;
      return matchesSearch && matchesSector;
    });

    if (sortConfig.key && sortConfig.direction) {
      filtered = [...filtered].sort((a, b) => {
        const aVal = parseFloat(a[sortConfig.key!] as string) || 0;
        const bVal = parseFloat(b[sortConfig.key!] as string) || 0;
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [data, searchQuery, selectedSector, sortConfig]);

  const totalPages = Math.ceil(processedData.length / itemsPerPage);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return processedData.slice(start, start + itemsPerPage);
  }, [processedData, currentPage, itemsPerPage]);

  const handleSort = (key: keyof QualityScoreItem) => {
    let direction: 'asc' | 'desc' | null = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    else if (sortConfig.key === key && sortConfig.direction === 'desc') direction = null;
    setSortConfig({ key: direction ? key : null, direction });
  };

  const SortIcon = ({ column }: { column: keyof QualityScoreItem }) => {
    if (sortConfig.key !== column) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortConfig.direction === 'asc' ? 
      <ChevronUp className="w-3 h-3 ml-1 text-indigo-400" /> : 
      <ChevronDown className="w-3 h-3 ml-1 text-indigo-400" />;
  };

  const ScoreCircle = ({ score, size = 40, strokeWidth = 3, color = 'emerald' }: { score: number, size?: number, strokeWidth?: number, color?: string }) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - (score / 100) * circumference;

    const colorClasses: Record<string, string> = {
      emerald: 'stroke-emerald-500',
      indigo: 'stroke-indigo-500',
      rose: 'stroke-rose-500',
      amber: 'stroke-amber-500',
      sky: 'stroke-sky-500'
    };

    return (
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="transform -rotate-90" width={size} height={size}>
          <circle
            className="text-slate-800"
            strokeWidth={strokeWidth}
            stroke="currentColor"
            fill="transparent"
            r={radius}
            cx={size / 2}
            cy={size / 2}
          />
          <circle
            className={`${colorClasses[color] || 'stroke-emerald-500'} transition-all duration-1000 ease-out`}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            stroke="currentColor"
            fill="transparent"
            r={radius}
            cx={size / 2}
            cy={size / 2}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-black text-white">{Math.round(score)}</span>
        </div>
      </div>
    );
  };

  const QualityCard = ({ item }: { item: QualityScoreItem }) => {
    const isExpanded = expandedSymbol === item.symbol_name;
    
    return (
      <motion.div 
        layout
        className="bg-slate-900/40 border border-slate-800/60 rounded-3xl overflow-hidden backdrop-blur-xl relative group"
      >
        <div className="p-6">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4 group/symbol">
              <div className="w-12 h-12 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-center text-xl font-black text-white">
                {item.symbol_name[0]}
              </div>
              <div>
                <div 
                  onClick={(e) => { e.stopPropagation(); openTradingView(item.symbol_name); }}
                  className="flex items-center gap-1.5 text-base font-black text-white tracking-tight group-hover/symbol:text-indigo-400 transition-colors cursor-alias"
                >
                  {item.symbol_name}
                  <ExternalLink size={12} className="opacity-0 group-hover/symbol:opacity-100 transition-opacity" />
                </div>
                <p className="text-[10px] font-bold text-slate-500 uppercase truncate max-w-[150px]">{item.company_name}</p>
              </div>
            </div>
            <ScoreCircle score={parseFloat(item.total_score)} size={48} strokeWidth={4} />
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="space-y-1">
              <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Valuation</p>
              <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                <motion.div 
                  initial={false}
                  animate={{ width: `${(parseFloat(item.valuation_score) / 20) * 100}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                  className="h-full bg-indigo-500"
                />
              </div>
              <p className="text-[10px] font-black text-white">{item.valuation_score}/20</p>
            </div>
            <div className="space-y-1">
              <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Growth</p>
              <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                <motion.div 
                  initial={false}
                  animate={{ width: `${(parseFloat(item.growth_score) / 20) * 100}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                  className="h-full bg-emerald-500"
                />
              </div>
              <p className="text-[10px] font-black text-white">{item.growth_score}/20</p>
            </div>
            <div className="space-y-1">
              <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Profit</p>
              <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                <motion.div 
                  initial={false}
                  animate={{ width: `${(parseFloat(item.profitability_score) / 20) * 100}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                  className="h-full bg-sky-500"
                />
              </div>
              <p className="text-[10px] font-black text-white">{item.profitability_score}/20</p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-800/50">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-slate-500 uppercase">CMP</span>
              <span className="text-sm font-black text-white">₹{item.cmp}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Rating</span>
              <span className={`text-[10px] font-black uppercase tracking-widest ${
                item.rating.includes('BUY') ? 'text-emerald-400' : 
                item.rating.includes('SELL') ? 'text-rose-400' : 'text-amber-400'
              }`}>{item.rating}</span>
            </div>
          </div>

          <button 
            onClick={() => setExpandedSymbol(isExpanded ? null : item.symbol_name)}
            className="w-full mt-6 py-2 bg-slate-800/50 hover:bg-slate-800 rounded-xl text-[9px] font-black text-slate-400 uppercase tracking-widest transition-all flex items-center justify-center gap-2"
          >
            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {isExpanded ? 'Show Less' : 'Full Diagnostics'}
          </button>
        </div>

        <AnimatePresence>
          {isExpanded && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-slate-950/80 border-t border-slate-800/50 overflow-hidden"
            >
              <div className="p-6 grid grid-cols-2 gap-4">
                {[
                  { label: 'Cash Flow', val: item.cash_flow_score, max: 10 },
                  { label: 'Strength', val: item.financial_strength_score, max: 15 },
                  { label: 'Management', val: item.management_score, max: 10 },
                  { label: 'Moat', val: item.moat_score, max: 10 },
                  { label: 'Risk Profile', val: item.risk_score, max: 10 },
                  { label: 'Momentum', val: item.momentum_score, max: 10 },
                ].map(metric => (
                  <div key={metric.label} className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">{metric.label}</span>
                      <span className="text-[9px] font-black text-white">{metric.val}/{metric.max}</span>
                    </div>
                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${(parseFloat(metric.val) / metric.max) * 100}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                        className="h-full bg-slate-400"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Analysis Type Chips */}
      <div className="flex flex-wrap items-center gap-2">
        {SCORE_TYPES.map(type => (
          <button
            key={type.id}
            onClick={() => onTypeChange(type.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
              selectedType === type.id 
                ? 'bg-indigo-600 text-white shadow-[0_0_20px_rgba(79,70,229,0.3)]' 
                : 'bg-slate-900/50 text-slate-500 hover:text-slate-300 border border-slate-800/50'
            }`}
          >
            <type.icon className={`w-3.5 h-3.5 ${selectedType === type.id ? 'text-white' : 'text-slate-600'}`} />
            {type.label}
          </button>
        ))}
      </div>

      {/* Primary Filters Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 p-6 bg-slate-900/20 border border-slate-800/40 rounded-[2.5rem]">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input 
              type="text"
              placeholder="Search Quality Matrix..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950/50 border border-slate-800/60 rounded-2xl py-3 pl-12 pr-4 text-xs font-bold text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
            />
          </div>
          
          <Tabs.Root
            value={selectedFilter}
            onChange={(val) => onFilterChange(val as 'high' | 'low')}
            variant="solid-indigo"
            layoutId="quality-scorecard-filter"
            motionPreset="spring"
          >
            <Tabs.List className="bg-slate-950/50 p-1 rounded-2xl border border-slate-800">
              <Tabs.Trigger value="high" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">
                High Quality
              </Tabs.Trigger>
              <Tabs.Trigger 
                value="low" 
                className="px-6 py-2 text-[10px] font-black uppercase tracking-widest"
                indicatorClassName="bg-emerald-600"
              >
                Value Picks
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="relative" ref={sectorDropdownRef}>
            <button 
              onClick={() => setIsSectorDropdownOpen(!isSectorDropdownOpen)}
              className="flex items-center gap-3 bg-slate-950/50 px-5 py-2.5 rounded-2xl border border-slate-800 hover:border-indigo-500/50 transition-all group min-w-[200px]"
            >
              <Filter className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 transition-colors" />
              <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest flex-1 text-left truncate">
                {selectedSector}
              </span>
              <ChevronDownIcon className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-300 ${isSectorDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {isSectorDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 5, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 top-full z-[100] w-[260px] bg-slate-900/95 border border-slate-800 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl p-2 max-h-[400px] overflow-y-auto custom-scrollbar"
                >
                  <div className="grid grid-cols-1 gap-1">
                    {sectors.map(s => (
                      <button
                        key={s}
                        onClick={() => {
                          setSelectedSector(s);
                          setIsSectorDropdownOpen(false);
                        }}
                        className={`w-full px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-left transition-all flex items-center justify-between group ${
                          selectedSector === s 
                            ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30' 
                            : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800/50'
                        }`}
                      >
                        {s}
                        {selectedSector === s && <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.5)]" />}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex bg-slate-950/50 p-1 rounded-2xl border border-slate-800">
            <button 
              onClick={() => setViewMode('table')}
              className={`p-2 rounded-xl transition-all ${viewMode === 'table' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <List className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setViewMode('cards')}
              className={`p-2 rounded-xl transition-all ${viewMode === 'cards' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content View */}
      {viewMode === 'table' ? (
        <div className="bg-slate-900/20 border border-slate-800/40 rounded-[2.5rem] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-800/50">
                  <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('symbol_name')}>Symbol <SortIcon column="symbol_name" /></th>
                  <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('total_score')}>Overall Score <SortIcon column="total_score" /></th>
                  <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Rating</th>
                  <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('intrinsic_value')}>Intrinsic <SortIcon column="intrinsic_value" /></th>
                  <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('cmp')}>CMP <SortIcon column="cmp" /></th>
                  <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('roce')}>ROCE <SortIcon column="roce" /></th>
                  <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('market_cap')}>Market Cap <SortIcon column="market_cap" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/30">
                {paginatedData.map((item) => (
                  <tr key={item.symbol_name} className="group hover:bg-slate-800/30 transition-colors">
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-center font-black text-indigo-400">
                          {item.symbol_name[0]}
                        </div>
                        <div className="group/symbol">
                          <div 
                            onClick={(e) => { e.stopPropagation(); openTradingView(item.symbol_name); }}
                            className="flex items-center gap-1.5 text-xs font-black text-white group-hover/symbol:text-indigo-400 transition-colors cursor-alias"
                          >
                            {item.symbol_name}
                            <ExternalLink size={10} className="opacity-0 group-hover/symbol:opacity-100 transition-opacity" />
                          </div>
                          <p className="text-[9px] font-bold text-slate-500 truncate max-w-[120px]">{item.sector}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-4">
                        <ScoreCircle score={parseFloat(item.total_score)} size={36} strokeWidth={3} />
                        <span className="text-[10px] font-black text-white">{item.total_score}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5 text-center">
                      <span className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                        item.rating.includes('BUY') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 
                        item.rating.includes('SELL') ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 
                        'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}>
                        {item.rating}
                      </span>
                    </td>
                    <td className="px-8 py-5">
                      <p className="text-xs font-black text-white">₹{item.intrinsic_value}</p>
                      <p className={`text-[9px] font-bold ${parseFloat(item.intrinsic_value) > parseFloat(item.cmp) ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {((parseFloat(item.intrinsic_value) - parseFloat(item.cmp)) / parseFloat(item.cmp) * 100).toFixed(1)}% Upside
                      </p>
                    </td>
                    <td className="px-8 py-5 text-xs font-black text-white">₹{item.cmp}</td>
                    <td className="px-8 py-5 text-xs font-black text-emerald-400">{item.roce}%</td>
                    <td className="px-8 py-5 text-[10px] font-black text-slate-400">₹{(parseFloat(item.market_cap) / 1000).toFixed(1)}K Cr</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {paginatedData.map((item) => (
            <QualityCard key={item.symbol_name} item={item} />
          ))}
        </div>
      )}

      {processedData.length > itemsPerPage && (
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-6 bg-slate-900/20 border border-slate-800/40 rounded-[2.5rem] mt-8">
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              Showing {((currentPage - 1) * itemsPerPage) + 1} - {Math.min(currentPage * itemsPerPage, processedData.length)} of {processedData.length} Assets
            </span>
            <div className="h-4 w-px bg-slate-800" />
            <div className="flex items-center gap-2 bg-slate-950/50 px-3 py-1.5 rounded-xl border border-slate-800">
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Per Page:</span>
              <select 
                value={itemsPerPage}
                onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                className="bg-transparent text-[9px] font-black text-slate-300 uppercase outline-none cursor-pointer"
              >
                {[20, 50, 100, 200].map(val => <option key={val} value={val}>{val}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => prev - 1)}
              className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-slate-800 border border-slate-700/50 rounded-xl transition-all"
            >
              <ChevronLeft className="w-4 h-4 text-white" />
            </button>
            
            <div className="flex items-center gap-1">
              {[...Array(totalPages)].map((_, i) => {
                const page = i + 1;
                if (totalPages > 5 && Math.abs(page - currentPage) > 2) {
                  if (page === 1 || page === totalPages) return <span key={page} className="px-2 text-slate-600">...</span>;
                  return null;
                }
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-8 h-8 rounded-xl text-[10px] font-black transition-all ${
                      currentPage === page ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-900/50 text-slate-500 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {page}
                  </button>
                );
              })}
            </div>

            <button 
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(prev => prev + 1)}
              className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-slate-800 border border-slate-700/50 rounded-xl transition-all"
            >
              <ChevronRight className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      )}

      {processedData.length === 0 && (
        <div className="min-h-[400px] flex flex-col items-center justify-center text-center">
          <Circle className="w-16 h-16 text-slate-800 mb-6" />
          <h3 className="text-xl font-black text-white uppercase tracking-widest mb-2">Diagnostic Scan Complete</h3>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">No assets matching your fundamental filters</p>
        </div>
      )}
    </div>
  );
};
