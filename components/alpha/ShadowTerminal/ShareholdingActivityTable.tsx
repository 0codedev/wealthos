import React, { useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, LayoutGrid, List, Search, PieChart, Activity, DollarSign, BarChart3, ExternalLink } from 'lucide-react';
import { openTradingView } from '../../../utils/navigation';
import { ShareholdingActivityItem } from '../../../services/alpha/ShadowScreenerService';
import { formatCurrency, formatNumberIndian } from '../../../utils/helpers';
import { Tabs } from '../../ui/AnimatedTabs';

interface ShareholdingActivityTableProps {
  data: ShareholdingActivityItem[];
  investorType: 'fii' | 'promoter';
  transactionType: 'buy' | 'sell';
}

export const ShareholdingActivityTable: React.FC<ShareholdingActivityTableProps> = ({ data, investorType, transactionType }) => {
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof ShareholdingActivityItem | null, direction: 'asc' | 'desc' | null }>({ key: investorType === 'fii' ? 'change_in_fii_hold' : 'change_in_promoters_hold', direction: 'desc' });

  // Reset page when data or search changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [data.length, searchTerm, investorType, transactionType]);

  const filteredData = useMemo(() => {
    if (!searchTerm) return data;
    const q = searchTerm.toLowerCase();
    return data.filter(item => 
      item.symbol_name.toLowerCase().includes(q)
    );
  }, [data, searchTerm]);

  const handleSort = (key: keyof ShareholdingActivityItem) => {
    let direction: 'asc' | 'desc' | null = 'asc';
    let newKey: keyof ShareholdingActivityItem | null = key;
    
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

    return [...filteredData].sort((a, b) => {
      const aVal = a[sortConfig.key!];
      const bVal = b[sortConfig.key!];
      
      // Numeric sort for numeric fields
      const nA = typeof aVal === 'number' ? aVal : (aVal ? parseFloat(aVal as string) : NaN);
      const nB = typeof bVal === 'number' ? bVal : (bVal ? parseFloat(bVal as string) : NaN);
      
      if (!isNaN(nA) && !isNaN(nB)) {
        return sortConfig.direction === 'asc' ? nA - nB : nB - nA;
      }

      // String sort fallback
      if (aVal === undefined) return 1;
      if (bVal === undefined) return -1;
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortConfig]);

  const totalPages = Math.ceil(sortedData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, sortedData.length);
  const currentData = sortedData.slice(startIndex, endIndex);

  const SortIcon = ({ column }: { column: keyof ShareholdingActivityItem }) => {
    if (sortConfig.key !== column || !sortConfig.direction) return <span className="opacity-20 ml-1 text-[8px]">⇅</span>;
    return sortConfig.direction === 'asc' ? <span className="text-indigo-400 ml-1 text-[8px]">▲</span> : <span className="text-indigo-400 ml-1 text-[8px]">▼</span>;
  };

  const isPositive = (val: string | number) => parseFloat(val.toString()) >= 0;

  if (data.length === 0) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center bg-slate-900/10 border border-slate-800/40 rounded-3xl p-12 text-center">
        <PieChart className="w-12 h-12 text-slate-700 mb-6 animate-pulse" />
        <h3 className="text-xl font-bold text-slate-400 mb-2 uppercase tracking-widest">No Activity Detected</h3>
        <p className="text-slate-600 text-sm max-w-md">There are no recent {investorType.toUpperCase()} {transactionType} transactions in the current period.</p>
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
            placeholder="Search symbol..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-900/40 border border-slate-800/60 rounded-2xl py-2.5 pl-12 pr-4 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-indigo-500/50 transition-all"
          />
        </div>

        <div className="flex items-center gap-3">
          <Tabs.Root
            value={viewMode}
            onValueChange={(v) => setViewMode(v as any)}
            layoutId="shareholding-view-mode-nav"
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
        <div className="bg-slate-900/20 border border-slate-800/60 rounded-3xl shadow-sm overflow-hidden overflow-x-auto no-scrollbar">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-slate-950/60 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800/50 select-none">
                <th className="py-4 pl-8 font-bold cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('symbol_name')}>Symbol <SortIcon column="symbol_name" /></th>
                <th className="py-4 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort(investorType === 'fii' ? 'change_in_fii_hold' : 'change_in_promoters_hold')}>Hold Change % <SortIcon column={investorType === 'fii' ? 'change_in_fii_hold' : 'change_in_promoters_hold'} /></th>
                <th className="py-4 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort(investorType === 'fii' ? 'fii_hold' : 'promoters_hold')}>Current Hold % <SortIcon column={investorType === 'fii' ? 'fii_hold' : 'promoters_hold'} /></th>
                <th className="py-4 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('ownership_momentum_score')}>Ownership Score <SortIcon column="ownership_momentum_score" /></th>
                <th className="py-4 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('last_trade_price')}>Price <SortIcon column="last_trade_price" /></th>
                <th className="py-4 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('change_percent')}>Change % <SortIcon column="change_percent" /></th>
                <th className="py-4 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('market_cap')}>Market Cap <SortIcon column="market_cap" /></th>
                <th className="py-4 font-bold text-center cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('roce')}>ROCE % <SortIcon column="roce" /></th>
                <th className="py-4 pr-8 text-right font-bold cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => handleSort('stock_pe')}>P/E <SortIcon column="stock_pe" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/30">
              {currentData.map((item, idx) => {
                const holdChange = investorType === 'fii' ? item.change_in_fii_hold : item.change_in_promoters_hold;
                const currentHold = investorType === 'fii' ? item.fii_hold : item.promoters_hold;
                
                return (
                  <tr 
                    key={item.symbol_name + idx}
                    className="group hover:bg-indigo-500/10 transition-all duration-200 cursor-pointer"
                  >
                    <td className="py-5 pl-8">
                      <div className="flex flex-col group/symbol">
                        <div 
                          onClick={(e) => { e.stopPropagation(); openTradingView(item.symbol_name); }}
                          className="flex items-center gap-1.5 font-black text-slate-200 tracking-tight group-hover/symbol:text-indigo-400 transition-colors text-base cursor-alias"
                        >
                          {item.symbol_name}
                          <ExternalLink size={12} className="opacity-0 group-hover/symbol:opacity-100 transition-opacity" />
                        </div>
                        <span className="text-[10px] font-bold text-slate-600 uppercase tracking-tighter mt-0.5">{item.period_date}</span>
                      </div>
                    </td>
                    <td className="py-5 text-center">
                      <span className={`px-2 py-1 rounded-lg text-[11px] font-black tracking-widest ${parseFloat(holdChange) > 0 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : parseFloat(holdChange) < 0 ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-slate-800 text-slate-500'}`}>
                        {holdChange}%
                      </span>
                    </td>
                    <td className="py-5 text-center">
                      <span className="text-sm font-black text-white">{currentHold}%</span>
                    </td>
                    <td className="py-5 text-center">
                      <span className={`text-sm font-black ${
                        (item.ownership_momentum_score || 0) > 0 
                          ? 'text-emerald-400' 
                          : (item.ownership_momentum_score || 0) < 0 
                            ? 'text-rose-400' 
                            : 'text-slate-500'
                      }`}>
                        {item.ownership_momentum_score !== undefined ? item.ownership_momentum_score.toFixed(2) : '-'}
                      </span>
                    </td>
                    <td className="py-5 text-center">
                      <span className="text-sm font-black text-white">{formatCurrency(parseFloat(item.last_trade_price))}</span>
                    </td>
                    <td className="py-5 text-center">
                      <span className={`text-[11px] font-black ${isPositive(item.change_percent) ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isPositive(item.change_percent) ? '▲' : '▼'} {Math.abs(parseFloat(item.change_percent)).toFixed(2)}%
                      </span>
                    </td>
                    <td className="py-5 text-center font-mono text-[11px] text-slate-500 font-bold">
                      {formatNumberIndian(Math.round(parseFloat(item.market_cap)))} Cr
                    </td>
                    <td className="py-5 text-center">
                      <span className={`text-sm font-black ${parseFloat(item.roce) > 15 ? 'text-indigo-400' : 'text-slate-400'}`}>
                        {item.roce}%
                      </span>
                    </td>
                    <td className="py-5 pr-8 text-right">
                      <span className="text-sm font-black text-slate-300">
                        {item.stock_pe}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {currentData.map((item, idx) => {
            const holdChange = investorType === 'fii' ? item.change_in_fii_hold : item.change_in_promoters_hold;
            const currentHold = investorType === 'fii' ? item.fii_hold : item.promoters_hold;

            return (
              <div 
                key={item.symbol_name + idx}
                className="bg-slate-900/30 border border-slate-800/60 rounded-3xl p-6 hover:border-indigo-500/40 transition-all group cursor-pointer relative overflow-hidden"
              >
                <div className={`absolute top-0 right-0 w-24 h-24 ${parseFloat(holdChange) > 0 ? 'bg-emerald-500/5' : 'bg-rose-500/5'} blur-3xl rounded-full`} />
                
                <div className="flex justify-between items-start mb-6">
                  <div className="flex flex-col group/symbol">
                    <div 
                      onClick={(e) => { e.stopPropagation(); openTradingView(item.symbol_name); }}
                      className="flex items-center gap-1.5 text-lg font-black text-white group-hover/symbol:text-indigo-400 transition-colors tracking-tight cursor-alias"
                    >
                      {item.symbol_name}
                      <ExternalLink size={12} className="opacity-0 group-hover/symbol:opacity-100 transition-opacity" />
                    </div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{item.period_date}</span>
                  </div>
                  <span className={`px-2 py-1 rounded-lg text-[9px] font-black tracking-widest border ${parseFloat(holdChange) > 0 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                    {parseFloat(holdChange) > 0 ? 'ACCUMULATING' : 'EXITING'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-6">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-slate-600 uppercase tracking-tight mb-1">Hold Change</span>
                    <span className={`text-lg font-black ${parseFloat(holdChange) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{holdChange}%</span>
                  </div>
                  <div className="flex flex-col items-center text-center">
                    <span className="text-[9px] font-bold text-slate-600 uppercase tracking-tight mb-1">Total Stake</span>
                    <span className="text-lg font-black text-white">{currentHold}%</span>
                  </div>
                  <div className="flex flex-col items-end text-right">
                    <span className="text-[9px] font-bold text-slate-600 uppercase tracking-tight mb-1">Ownership</span>
                    <span className={`text-lg font-black ${(item.ownership_momentum_score || 0) > 0 ? 'text-emerald-400' : (item.ownership_momentum_score || 0) < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                      {item.ownership_momentum_score !== undefined ? item.ownership_momentum_score.toFixed(2) : '-'}
                    </span>
                  </div>
                </div>

                <div className="flex items-end justify-between mb-6">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Price</span>
                    <span className="text-lg font-black text-white font-mono tracking-tight">{formatCurrency(parseFloat(item.last_trade_price))}</span>
                  </div>
                  <div className={`flex flex-col items-end ${isPositive(item.change_percent) ? 'text-emerald-400' : 'text-rose-400'}`}>
                    <span className="text-[11px] font-black flex items-center gap-1">
                      {isPositive(item.change_percent) ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                      {Math.abs(parseFloat(item.change_percent)).toFixed(2)}%
                    </span>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800/40 grid grid-cols-3 gap-2">
                   <div className="flex flex-col">
                     <span className="text-[8px] font-bold text-slate-600 uppercase">ROCE</span>
                     <span className="text-[11px] font-black text-slate-300">{item.roce}%</span>
                   </div>
                   <div className="flex flex-col items-center">
                     <span className="text-[8px] font-bold text-slate-600 uppercase">P/E</span>
                     <span className="text-[11px] font-black text-slate-300">{item.stock_pe}</span>
                   </div>
                   <div className="flex flex-col items-end">
                     <span className="text-[8px] font-bold text-slate-600 uppercase">MCAP (Cr)</span>
                     <span className="text-[11px] font-black text-slate-300">{formatNumberIndian(Math.round(parseFloat(item.market_cap)))}</span>
                   </div>
                </div>
              </div>
            );
          })}
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
