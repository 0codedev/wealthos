import React, { useState, useMemo } from 'react';
import { Layers, TrendingUp, TrendingDown, Info, LayoutGrid, List, Search, ExternalLink } from 'lucide-react';
import { openTradingView } from '../../../utils/navigation';
import { LotSizeItem, ShadowScreenerService } from '../../../services/alpha/ShadowScreenerService';
import { formatCurrencyPrecise } from '../../../utils/helpers';
import { Tabs } from '../../ui/AnimatedTabs';

interface LotSizeTableProps {
  data: LotSizeItem[];
}

export const LotSizeTable: React.FC<LotSizeTableProps> = ({ data }) => {
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string | null, direction: 'asc' | 'desc' | null }>({ key: 'symbol', direction: 'asc' });

  // Reset to first page when data changes or search term changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [data.length, searchTerm]);

  // Compute active lot sizes once to avoid recalculation during sorting
  const computedData = useMemo(() => {
    return data.map(item => ({
      ...item,
      activeLotSize: ShadowScreenerService.getActiveLotSize(item.month_data)
    }));
  }, [data]);

  const filteredData = useMemo(() => {
    if (!searchTerm) return computedData;
    const q = searchTerm.toLowerCase();
    return computedData.filter(item => 
      item.symbol.toLowerCase().includes(q) || 
      item.underlying.toLowerCase().includes(q)
    );
  }, [computedData, searchTerm]);

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

  const sortedData = useMemo(() => {
    if (!sortConfig.key || !sortConfig.direction) return filteredData;

    return [...filteredData].sort((a: any, b: any) => {
      const aValue = a[sortConfig.key!];
      const bValue = b[sortConfig.key!];

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortConfig]);

  const totalPages = Math.ceil(sortedData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, sortedData.length);
  const currentData = sortedData.slice(startIndex, endIndex);

  const SortIcon = ({ column }: { column: string }) => {
    if (sortConfig.key !== column || !sortConfig.direction) return <span className="opacity-20 ml-1 text-[8px]">⇅</span>;
    return sortConfig.direction === 'asc' ? <span className="text-indigo-400 ml-1 text-[8px]">▲</span> : <span className="text-indigo-400 ml-1 text-[8px]">▼</span>;
  };

  // Helper to format exiries for display (e.g. "MAY-26: 500 | JUN-26: 500")
  const formatExpiries = (monthData: string | object) => {
    try {
      if (!monthData) return 'N/A';
      const parsed = typeof monthData === 'string' ? JSON.parse(monthData) : monthData;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'N/A';
      return Object.entries(parsed)
        .map(([exp, lot]) => `${exp}: ${lot}`)
        .join(' | ');
    } catch {
      return 'N/A';
    }
  };

  if (data.length === 0) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center bg-slate-900/10 border border-slate-800/40 rounded-3xl p-12 text-center">
        <Layers className="w-12 h-12 text-slate-700 mb-6 animate-pulse" />
        <h3 className="text-xl font-bold text-slate-400 mb-2 uppercase tracking-widest">No Lot Sizes Found</h3>
        <p className="text-slate-600 text-sm max-w-md">There are no F&O lot sizes in the current database. Make sure your StockeZee token is active.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* SEARCH & CONTROLS */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 px-4">
        <div className="relative w-full md:w-96 group">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors">
            <Search size={16} />
          </div>
          <input 
            type="text"
            placeholder="Search symbol or underlying stock..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-900/40 border border-slate-800/60 rounded-2xl py-2.5 pl-12 pr-4 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-indigo-500/50 transition-all"
          />
        </div>

        <div className="flex items-center gap-3">
          <Tabs.Root
            value={viewMode}
            onValueChange={(v) => setViewMode(v as any)}
            layoutId="lot-size-view-mode-nav"
            variant="solid-indigo"
            motionPreset="spring"
          >
            <Tabs.List className="min-h-[30px] p-0.5 bg-slate-950/50 border border-slate-800">
              <Tabs.Trigger
                value="table"
                className="px-2.5 min-h-[24px]"
                title="Table View"
              >
                <List size={15} />
              </Tabs.Trigger>
              <Tabs.Trigger
                value="grid"
                className="px-2.5 min-h-[24px]"
                title="Grid View"
              >
                <LayoutGrid size={15} />
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
        </div>
      </div>

      {viewMode === 'table' ? (
        <div className="bg-slate-900/20 border border-slate-800/60 rounded-3xl shadow-sm overflow-hidden overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-slate-950/60 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800/50 select-none">
                <th className="py-4 pl-8 font-bold cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('symbol')}>Symbol <SortIcon column="symbol" /></th>
                <th className="py-4 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('last_trade_price')}>LTP <SortIcon column="last_trade_price" /></th>
                <th className="py-4 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('change_percent')}>Change (%) <SortIcon column="change_percent" /></th>
                <th className="py-4 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('activeLotSize')}>Lot Size <SortIcon column="activeLotSize" /></th>
                <th className="py-4 pr-8 text-right font-bold">Month-wise Expiries</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/30">
              {currentData.map((item, idx) => (
                <tr 
                  key={item.symbol + idx}
                  className="group hover:bg-indigo-500/5 transition-all duration-200 cursor-pointer"
                >
                  <td className="py-5 pl-8">
                    <div className="flex flex-col group/symbol">
                      <div 
                        onClick={(e) => { e.stopPropagation(); openTradingView(item.symbol); }}
                        className="flex items-center gap-1.5 font-black text-slate-200 tracking-tight group-hover/symbol:text-indigo-400 transition-colors text-base cursor-alias"
                      >
                        {item.symbol}
                        <ExternalLink size={12} className="opacity-0 group-hover/symbol:opacity-100 transition-opacity" />
                      </div>
                      <span className="text-[10px] font-bold text-slate-600 uppercase tracking-tighter mt-0.5 truncate max-w-[180px]">{item.underlying}</span>
                    </div>
                  </td>
                  <td className="py-5 text-center">
                    <span className="text-sm font-black text-white">{formatCurrencyPrecise(Number(item.last_trade_price))}</span>
                  </td>
                  <td className="py-5 text-center">
                    <span className={`text-[11px] font-black ${item.change_percent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {item.change_percent >= 0 ? '▲' : '▼'} {Math.abs(item.change_percent).toFixed(2)}%
                    </span>
                  </td>
                  <td className="py-5 text-center font-mono text-sm text-indigo-400 font-bold tracking-wider">
                    {item.activeLotSize}
                  </td>
                  <td className="py-5 pr-8 text-right">
                    <span className="px-3 py-1.5 bg-slate-950/50 border border-slate-800/50 rounded-xl text-[10px] font-black text-slate-400 tracking-wider">
                      {formatExpiries(item.month_data)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {currentData.map((item, idx) => (
            <div 
              key={item.symbol + idx}
              className="bg-slate-900/30 border border-slate-800/60 rounded-3xl p-6 hover:border-indigo-500/40 transition-all group cursor-pointer relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 blur-3xl rounded-full" />
              
              <div className="flex justify-between items-start mb-6">
                <div className="flex flex-col group/symbol">
                  <div 
                    onClick={(e) => { e.stopPropagation(); openTradingView(item.symbol); }}
                    className="flex items-center gap-1.5 text-lg font-black text-white group-hover/symbol:text-indigo-400 transition-colors tracking-tight cursor-alias"
                  >
                    {item.symbol}
                    <ExternalLink size={12} className="opacity-0 group-hover/symbol:opacity-100 transition-opacity" />
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest truncate max-w-[120px]">{item.underlying}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-0.5">Lot Size</span>
                  <span className="px-2 py-1 bg-slate-800/80 text-indigo-400 rounded-lg text-xs font-black tracking-widest border border-slate-700/50">
                    {item.activeLotSize}
                  </span>
                </div>
              </div>

              <div className="flex items-end justify-between mb-6">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">LTP</span>
                  <span className="text-xl font-black text-white font-mono tracking-tight">{formatCurrencyPrecise(Number(item.last_trade_price))}</span>
                </div>
                <div className={`flex flex-col items-end ${item.change_percent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  <span className="text-[11px] font-black flex items-center gap-1">
                    {item.change_percent >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                    {Math.abs(item.change_percent).toFixed(2)}%
                  </span>
                  <span className="text-[9px] font-bold opacity-60 uppercase tracking-tighter">Day Change</span>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800/40">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col max-w-[80%]">
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Expiries</span>
                    <span className="text-[10px] font-black text-slate-400 tracking-wider truncate mt-0.5" title={formatExpiries(item.month_data)}>
                      {formatExpiries(item.month_data)}
                    </span>
                  </div>
                  <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-400">
                    <Layers size={18} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-8 py-6 bg-slate-950/40 border border-slate-800/60 rounded-3xl mt-8">
        <div className="flex items-center gap-6">
          <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
            Showing <span className="text-white">{startIndex + 1}</span> to <span className="text-white">{endIndex}</span> of <span className="text-white">{sortedData.length}</span>
          </span>
          <select 
            value={itemsPerPage}
            onChange={(e) => {
              setItemsPerPage(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="bg-slate-900 border border-slate-800 text-[11px] font-black text-slate-300 rounded-xl px-4 py-2 outline-none focus:border-indigo-500 transition-colors cursor-pointer"
          >
            {[50, 100, 200, 500].map(val => (
              <option key={val} value={val}>{val} per page</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <button 
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(prev => prev - 1)}
            className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <span className="text-sm font-black">←</span>
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
                  className={`w-10 h-10 rounded-xl text-[11px] font-black transition-all ${
                    currentPage === pageNum ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20 ring-2 ring-indigo-500/20' : 'bg-slate-900 border border-slate-800 text-slate-500 hover:text-slate-300'
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
            className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <span className="text-sm font-black">→</span>
          </button>
        </div>
      </div>
    </div>
  );
};
