import React, { useState } from 'react';
import { SimulatedTrade } from '../../types/backtester.types';
import { formatCurrency } from '../../utils/helpers';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface TradeLogTableProps {
  trades: SimulatedTrade[];
}

export const TradeLogTable: React.FC<TradeLogTableProps> = ({ trades }) => {
  const [page, setPage] = useState(1);
  const pageSize = 10;
  
  if (!trades || trades.length === 0) return null;

  const totalPages = Math.ceil(trades.length / pageSize);
  const paginatedTrades = trades.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="preset-card bg-slate-900/40 rounded-3xl border border-slate-800 overflow-hidden flex flex-col">
      <div className="p-5 border-b border-slate-800 flex justify-between items-center">
        <h3 className="text-sm font-black text-white uppercase tracking-widest">Trade Log</h3>
        <span className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">{trades.length} Trades Simulated</span>
      </div>
      
      <div className="table-scroll overflow-x-auto">
        <table className="w-full min-w-[760px] text-left border-collapse">
          <thead>
            <tr className="bg-slate-900/60 border-b border-slate-800">
              <th className="p-4 text-[10px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">Date & Time</th>
              <th className="p-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Asset</th>
              <th className="p-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Dir</th>
              <th className="p-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Entry</th>
              <th className="p-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Exit</th>
              <th className="p-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Net P&L</th>
              <th className="p-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Post-Trade Equity</th>
              <th className="p-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Reason</th>
            </tr>
          </thead>
          <tbody>
            {paginatedTrades.map((t, idx) => (
              <tr key={t.id} className={`border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors ${idx % 2 === 0 ? 'bg-transparent' : 'bg-slate-900/20'}`}>
                <td className="p-4 whitespace-nowrap">
                  <div className="text-xs font-bold text-slate-300">{new Date(t.date).toLocaleDateString()}</div>
                  {t.entryTime && <div className="text-[10px] text-slate-500">{t.entryTime} - {t.exitTime || '?'}</div>}
                </td>
                <td className="p-4 text-xs font-black text-white">{t.ticker}</td>
                <td className="p-4">
                  <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                    t.direction === 'Long' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                  }`}>
                    {t.direction}
                  </span>
                </td>
                <td className="p-4 text-xs font-bold text-slate-300 text-right">{t.entryPrice > 0 ? `₹${t.entryPrice}` : '-'}</td>
                <td className="p-4 text-xs font-bold text-slate-300 text-right">{t.exitPrice > 0 ? `₹${t.exitPrice}` : '-'}</td>
                <td className={`p-4 text-xs font-black text-right ${t.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {t.netPnL >= 0 ? '+' : ''}{formatCurrency(t.netPnL)}
                </td>
                <td className="p-4 text-xs font-mono font-bold text-slate-400 text-right">
                  {formatCurrency(t.postTradeEquity)}
                </td>
                <td className="p-4 text-[10px] font-bold text-slate-500 text-center uppercase tracking-wider">
                  {t.reason?.replace(/_/g, ' ') || 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="p-4 border-t border-slate-800 flex justify-between items-center bg-slate-900/20">
          <button 
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:bg-slate-700 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
            Page {page} of {totalPages}
          </span>
          <button 
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:bg-slate-700 disabled:opacity-30 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
};
