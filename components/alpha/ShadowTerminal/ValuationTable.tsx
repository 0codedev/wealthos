import React, { useState, useMemo, useEffect } from 'react';
import { TrendingUp, TrendingDown, LayoutGrid, List, AlertCircle, ExternalLink } from 'lucide-react';
import { Tabs } from '../../ui/AnimatedTabs';
import { openTradingView } from '../../../utils/navigation';
import { formatCurrency } from '../../../utils/helpers';

interface ValuationStock {
  Symbol: string;
  LTP: number;
  intrinsicValue: number;
  upside: number;
  roce: number;
  roe: number;
  eps: number;
  pbRatio: number;
  marketCap: number;
  sentiment: 'Bullish' | 'Bearish';
}

interface ValuationTableProps {
  data: ValuationStock[];
  type: 'over_valued' | 'under_valued';
}

const ValuationTable: React.FC<ValuationTableProps> = ({ data, type }) => {
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [sortConfig, setSortConfig] = useState<{ key: string | null, direction: 'asc' | 'desc' | null }>({ key: null, direction: null });

  // Reset when data changes
  useEffect(() => {
    setCurrentPage(1);
    setSortConfig({ key: null, direction: null });
  }, [data.length, type]);

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
    if (!sortConfig.key || !sortConfig.direction) return data;

    return [...data].sort((a, b) => {
      const aValue = a[sortConfig.key as keyof ValuationStock];
      const bValue = b[sortConfig.key as keyof ValuationStock];

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortConfig]);

  if (!data || data.length === 0) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center bg-slate-900/20 border border-slate-800/50 rounded-[2rem] p-12 text-center">
        <AlertCircle className="w-12 h-12 text-slate-700 mb-6" />
        <h3 className="text-xl font-bold text-slate-400 mb-2 uppercase tracking-widest">No Stocks Found</h3>
        <p className="text-slate-600 text-sm max-w-md">No stocks currently meet the criteria for the {type.replace('_', ' ')} screener.</p>
      </div>
    );
  }

  const totalPages = Math.ceil(sortedData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, sortedData.length);
  const currentData = sortedData.slice(startIndex, endIndex);

  const SortIcon = ({ column }: { column: string }) => {
    if (sortConfig.key !== column || !sortConfig.direction) return <span className="opacity-20 ml-1 text-[8px]">⇅</span>;
    return sortConfig.direction === 'asc' ? <span className="text-indigo-400 ml-1 text-[8px]">▲</span> : <span className="text-indigo-400 ml-1 text-[8px]">▼</span>;
  };

  const formatMCap = (val: number) => {
    if (val >= 1000) return `${(val / 1000).toFixed(2)}Cr`;
    return `${val.toFixed(2)}Cr`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full animate-pulse ${type === 'under_valued' ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
              Found: {data.length} {type === 'under_valued' ? 'Value' : 'Premium'} Stocks
            </span>
          </div>
        </div>
        <Tabs.Root
          value={viewMode}
          onValueChange={(v) => setViewMode(v as any)}
          layoutId={`valuation-view-mode-${type}`}
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
                <th className="py-3 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('LTP')}>Price <SortIcon column="LTP" /></th>
                <th className="py-3 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('upside')}>Upside% <SortIcon column="upside" /></th>
                <th className="py-3 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('intrinsicValue')}>Fair Value <SortIcon column="intrinsicValue" /></th>
                <th className="py-3 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('roce')}>ROCE% <SortIcon column="roce" /></th>
                <th className="py-3 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('roe')}>ROE% <SortIcon column="roe" /></th>
                <th className="py-3 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('eps')}>EPS <SortIcon column="eps" /></th>
                <th className="py-3 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('pbRatio')}>P/B Ratio <SortIcon column="pbRatio" /></th>
                <th className="py-3 text-right pr-6 font-bold cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('marketCap')}>Market Cap <SortIcon column="marketCap" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/30">
              {currentData.map((stock, idx) => (
                <tr key={stock.Symbol + idx} className="group hover:bg-indigo-500/10 transition-all duration-200 cursor-pointer">
                  <td className="py-4 pl-6 group/symbol">
                    <div 
                      onClick={(e) => { e.stopPropagation(); openTradingView(stock.Symbol); }}
                      className="flex items-center gap-1.5 font-black text-slate-200 group-hover/symbol:text-indigo-400 transition-colors cursor-alias"
                    >
                      {stock.Symbol}
                      <ExternalLink size={10} className="opacity-0 group-hover/symbol:opacity-100 transition-opacity" />
                    </div>
                  </td>
                  <td className="py-4 text-center font-bold text-white text-base">{formatCurrency(stock.LTP || 0)}</td>
                  <td className={`py-4 text-center font-black ${stock.upside >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {stock.upside >= 0 ? '↑ +' : '↓ '}{(stock.upside || 0).toFixed(2)}%
                  </td>
                  <td className="py-4 text-center font-black text-slate-300">{formatCurrency(stock.intrinsicValue || 0)}</td>
                  <td className={`py-4 text-center font-black ${stock.roce >= 15 ? 'text-emerald-400' : 'text-slate-400'}`}>{stock.roce.toFixed(2)}%</td>
                  <td className={`py-4 text-center font-black ${stock.roe >= 15 ? 'text-emerald-400' : 'text-slate-400'}`}>{stock.roe.toFixed(2)}%</td>
                  <td className="py-4 text-center font-black text-indigo-300">₹{stock.eps.toFixed(2)}</td>
                  <td className="py-4 text-center font-bold text-slate-400">{stock.pbRatio.toFixed(2)}</td>
                  <td className="py-4 pr-6 text-right font-black text-slate-300">{formatMCap(stock.marketCap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {currentData.map((stock, idx) => (
            <div key={stock.Symbol + idx} className="bg-slate-900/30 border border-slate-800/60 rounded-3xl p-5 hover:border-indigo-500/40 transition-all group cursor-pointer relative overflow-hidden">
              <div className="flex justify-between items-start mb-4">
                <div className="flex flex-col group/symbol">
                  <div 
                    onClick={(e) => { e.stopPropagation(); openTradingView(stock.Symbol); }}
                    className="flex items-center gap-1.5 text-lg font-black text-white group-hover/symbol:text-indigo-400 transition-colors tracking-tight cursor-alias"
                  >
                    {stock.Symbol}
                    <ExternalLink size={12} className="opacity-0 group-hover/symbol:opacity-100 transition-opacity" />
                  </div>
                  <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest ${stock.upside >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                    {stock.upside >= 0 ? 'Undervalued' : 'Overvalued'}
                  </span>
                </div>
                <div className="text-right">
                   <div className="text-[10px] font-black text-white">{formatCurrency(stock.LTP || 0)}</div>
                   <div className={`text-[8px] font-black ${stock.upside >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                     {stock.upside >= 0 ? '+' : ''}{(stock.upside || 0).toFixed(2)}%
                   </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-6">
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Fair Value</span>
                  <span className="text-sm font-black text-slate-300">{formatCurrency(stock.intrinsicValue || 0)}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">EPS</span>
                  <span className="text-sm font-black text-indigo-300">₹{stock.eps.toFixed(2)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">ROCE%</span>
                  <span className={`text-xs font-black ${stock.roce >= 15 ? 'text-emerald-400' : 'text-slate-400'}`}>{stock.roce.toFixed(1)}%</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">ROE%</span>
                  <span className={`text-xs font-black ${stock.roe >= 15 ? 'text-emerald-400' : 'text-slate-400'}`}>{stock.roe.toFixed(1)}%</span>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800/40 flex justify-between items-center text-[10px]">
                <div className="flex flex-col">
                  <span className="font-bold text-slate-600 uppercase tracking-widest">P/B Ratio</span>
                  <span className="font-black text-slate-300">{stock.pbRatio.toFixed(2)}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="font-bold text-slate-600 uppercase tracking-widest">M-Cap</span>
                  <span className="font-black text-slate-300">{formatMCap(stock.marketCap)}</span>
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

export default ValuationTable;
