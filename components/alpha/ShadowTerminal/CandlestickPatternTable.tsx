import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Info, LayoutGrid, List, Target, ShieldAlert, HelpCircle, ExternalLink } from 'lucide-react';
import { openTradingView } from '../../../utils/navigation';
import MomentumRangeBar from '../MomentumRangeBar';
import { getPatternIntel } from '../../../utils/alpha/CandlestickIntel';
import { formatCurrency, formatNumberIndian } from '../../../utils/helpers';
import { Tabs } from '../../ui/AnimatedTabs';

interface CandlestickPatternTableProps {
  data: any[];
  selectedPattern: string;
}

export const CandlestickPatternTable: React.FC<CandlestickPatternTableProps> = ({ data: rawData, selectedPattern }) => {
  const data = React.useMemo(() => Array.isArray(rawData) ? rawData : [], [rawData]);
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [sortConfig, setSortConfig] = useState<{ key: string | null, direction: 'asc' | 'desc' | null }>({ key: null, direction: null });

  // Reset to first page when data changes
  React.useEffect(() => {
    setCurrentPage(1);
    setSortConfig({ key: null, direction: null });
  }, [data.length, selectedPattern]);

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

  const sortedData = React.useMemo(() => {
    if (!sortConfig.key || !sortConfig.direction) return data;

    return [...data].sort((a, b) => {
      const aValue = a[sortConfig.key!];
      const bValue = b[sortConfig.key!];

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortConfig]);

  if (data.length === 0) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center bg-slate-900/10 border border-slate-800/40 rounded-3xl p-12 text-center">
        <Info className="w-12 h-12 text-slate-700 mb-6 animate-pulse" />
        <h3 className="text-xl font-bold text-slate-400 mb-2 uppercase tracking-widest">No Patterns Found</h3>
        <p className="text-slate-600 text-sm max-w-md">No stocks currently exhibit the "{selectedPattern}" pattern in this timeframe.</p>
      </div>
    );
  }

  const intel = getPatternIntel(selectedPattern);
  const totalPages = Math.ceil(sortedData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, sortedData.length);
  const currentData = sortedData.slice(startIndex, endIndex);

  const SortIcon = ({ column }: { column: string }) => {
    if (sortConfig.key !== column || !sortConfig.direction) return <span className="opacity-20 ml-1 text-[8px]">⇅</span>;
    return sortConfig.direction === 'asc' ? <span className="text-indigo-400 ml-1 text-[8px]">▲</span> : <span className="text-indigo-400 ml-1 text-[8px]">▼</span>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-4">
        <div className="flex items-center gap-2 group/intel relative">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Active Pattern:</span>
          <div className="relative">
            <span className="px-3 py-1 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded-lg text-[10px] font-black uppercase cursor-help hover:bg-indigo-500/30 transition-all flex items-center gap-1.5">
              {selectedPattern}
              <HelpCircle size={10} className="text-indigo-400/60" />
            </span>

            {/* SIMPLE CSS TOOLTIP (Zero Animation) */}
            <div className="absolute top-full left-0 mt-3 w-80 opacity-0 invisible group-hover/intel:opacity-100 group-hover/intel:visible transition-none z-[100]">
              <div className="bg-slate-900 border border-indigo-500/30 rounded-3xl p-6 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${intel.sentiment === 'Bullish' ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}>
                    {intel.sentiment === 'Bullish' ? <TrendingUp className="text-emerald-400" size={20} /> : <TrendingDown className="text-rose-400" size={20} />}
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white uppercase tracking-tight">{intel.name}</h4>
                    <span className={`text-[9px] font-bold uppercase tracking-widest ${intel.sentiment === 'Bullish' ? 'text-emerald-400' : 'text-rose-400'}`}>{intel.sentiment} REVERSAL</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Technical Logic</p>
                    <p className="text-xs text-slate-300 leading-relaxed font-medium">{intel.definition}</p>
                  </div>
                  
                  <div className="p-3 bg-slate-950/50 rounded-2xl border border-slate-800/50">
                    <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                      <Target size={10} /> Trade Strategy
                    </p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 font-bold">ENTRY</span>
                        <span className="text-white font-black">{intel.strategy.entry}</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 font-bold">STOP LOSS</span>
                        <span className="text-rose-400 font-black">{intel.strategy.stopLoss}</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 font-bold">TARGET</span>
                        <span className="text-emerald-400 font-black">{intel.strategy.target}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                      <ShieldAlert size={10} /> Market Psychology
                    </p>
                    <p className="text-[11px] text-slate-400 leading-relaxed italic">"{intel.psychology}"</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <Tabs.Root
          value={viewMode}
          onValueChange={(v) => setViewMode(v as any)}
          layoutId="candlestick-view-mode-nav"
          variant="solid-indigo"
          motionPreset="spring"
        >
          <Tabs.List className="min-h-[30px] p-0.5 bg-slate-950/50 border border-slate-800">
            <Tabs.Trigger
              value="table"
              className="px-2.5 min-h-[24px]"
              title="Table View"
            >
              <List size={14} />
            </Tabs.Trigger>
            <Tabs.Trigger
              value="grid"
              className="px-2.5 min-h-[24px]"
              title="Grid View"
            >
              <LayoutGrid size={14} />
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
      </div>

      {viewMode === 'table' ? (
        <div className="bg-slate-900/20 border border-slate-800/60 rounded-2xl shadow-sm overflow-hidden overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-slate-950/40 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800/50 select-none">
                <th className="py-3 pl-6 font-bold cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('Symbol')}>Symbol <SortIcon column="Symbol" /></th>
                <th className="py-3 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('LTP')}>Price Status <SortIcon column="LTP" /></th>
                <th className="py-3 font-bold w-1/4 text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('Change')}>Today Range <SortIcon column="Change" /></th>
                <th className="py-3 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('Volume')}>Volume <SortIcon column="Volume" /></th>
                <th className="py-3 text-right pr-6 font-bold cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('sentiment')}>Sentiment <SortIcon column="sentiment" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/30">
              {currentData.map((stock, idx) => (
                <tr 
                  key={stock.Symbol + idx}
                  className="group hover:bg-indigo-500/10 transition-all duration-200 cursor-pointer"
                >
                  <td className="py-4 pl-6">
                    <div className="flex flex-col group/symbol">
                      <div 
                        onClick={(e) => { e.stopPropagation(); openTradingView(stock.Symbol); }}
                        className="flex items-center gap-1.5 font-black text-slate-200 tracking-tight group-hover/symbol:text-indigo-400 transition-colors text-base cursor-alias"
                      >
                        {stock.Symbol}
                        <ExternalLink size={12} className="opacity-0 group-hover/symbol:opacity-100 transition-opacity" />
                      </div>
                      <span className="text-[9px] font-bold text-slate-600 uppercase tracking-tighter mt-0.5">NSE EQUITY</span>
                    </div>
                  </td>
                  <td className="py-4 text-center">
                    <div className="flex flex-col items-center">
                      <span className="text-sm font-black text-white">{formatCurrency(stock.LTP || 0)}</span>
                      <span className={`text-[10px] font-black ${stock.Change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {stock.Change >= 0 ? '+' : ''}{(stock.Change || 0).toFixed(2)}%
                      </span>
                    </div>
                  </td>
                  <td className="py-4 px-8 min-w-[200px]">
                    <MomentumRangeBar low={stock.Low} high={stock.High} current={stock.LTP} />
                  </td>
                  <td className="py-4 text-center font-mono text-[11px] text-slate-400 font-bold">
                    {(stock.Volume || 0) > 1000000 ? `${((stock.Volume || 0) / 1000000).toFixed(1)}M` : formatNumberIndian(stock.Volume || 0)}
                  </td>
                  <td className="py-4 pr-6 text-right">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black tracking-widest inline-flex items-center gap-1.5 ${
                      stock.sentiment === 'Bullish' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}>
                      {stock.sentiment === 'Bullish' ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                      {stock.sentiment.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {currentData.map((stock, idx) => (
            <div 
              key={stock.Symbol + idx}
              className="bg-slate-900/30 border border-slate-800/60 rounded-3xl p-5 hover:border-indigo-500/40 transition-all group cursor-pointer"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex flex-col group/symbol">
                  <div 
                    onClick={(e) => { e.stopPropagation(); openTradingView(stock.Symbol); }}
                    className="flex items-center gap-1.5 text-lg font-black text-white group-hover/symbol:text-indigo-400 transition-colors tracking-tight cursor-alias"
                  >
                    {stock.Symbol}
                    <ExternalLink size={12} className="opacity-0 group-hover/symbol:opacity-100 transition-opacity" />
                  </div>
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">NSE Equity</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-[8px] font-black tracking-tighter uppercase ${
                  stock.sentiment === 'Bullish' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                }`}>
                  {stock.sentiment}
                </span>
              </div>

              <div className="flex items-end justify-between mb-6">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Current Price</span>
                  <span className="text-xl font-black text-white">{formatCurrency(stock.LTP || 0)}</span>
                </div>
                <div className={`flex flex-col items-end ${stock.Change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  <span className="text-[10px] font-black">{stock.Change >= 0 ? '▲' : '▼'} {Math.abs(stock.Change || 0).toFixed(2)}%</span>
                  <span className="text-[9px] font-bold opacity-60 uppercase tracking-tighter">Today</span>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                    <span>Low</span>
                    <span>Range Intensity</span>
                    <span>High</span>
                  </div>
                  <MomentumRangeBar low={stock.Low} high={stock.High} current={stock.LTP} />
                </div>

                <div className="pt-4 border-t border-slate-800/40 flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Vol Traded</span>
                    <span className="text-[10px] font-black text-slate-300">
                      {(stock.Volume || 0) > 1000000 ? `${((stock.Volume || 0) / 1000000).toFixed(1)}M` : formatNumberIndian(stock.Volume || 0)}
                    </span>
                  </div>
                  <button className="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl hover:bg-indigo-500 hover:text-white transition-all">
                    <TrendingUp size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-4 bg-slate-950/30 border border-slate-800/60 rounded-2xl">
        <div className="flex items-center gap-4">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            Showing <span className="text-white">{startIndex + 1}</span> to <span className="text-white">{endIndex}</span> of <span className="text-white">{sortedData.length}</span>
          </span>
          <select 
            value={itemsPerPage}
            onChange={(e) => {
              setItemsPerPage(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="bg-slate-900 border border-slate-800 text-[10px] font-black text-slate-300 rounded-lg px-2 py-1 outline-none focus:border-indigo-500 transition-colors"
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
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <span className="text-xs">←</span>
          </button>
          
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum = currentPage;
              if (totalPages <= 5) pageNum = i + 1;
              else if (currentPage <= 3) pageNum = i + 1;
              else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
              else pageNum = currentPage - 2 + i;

              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`w-8 h-8 rounded-lg text-[10px] font-black transition-all ${
                    currentPage === pageNum ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'bg-slate-900 border border-slate-800 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button 
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(prev => prev + 1)}
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <span className="text-xs">→</span>
          </button>
        </div>
      </div>
    </div>
  );
};
