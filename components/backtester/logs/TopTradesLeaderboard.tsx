import React from 'react';
import { Trophy, TrendingDown } from 'lucide-react';
import { SimulatedTrade } from '../../../types/backtester.types';
import { formatCurrency } from '../../../utils/helpers';

interface TopTradesLeaderboardProps {
  trades: SimulatedTrade[];
}

export const TopTradesLeaderboard: React.FC<TopTradesLeaderboardProps> = ({ trades }) => {
  const winners = [...trades].sort((a, b) => b.netPnL - a.netPnL).slice(0, 5);
  const losers = [...trades].sort((a, b) => a.netPnL - b.netPnL).slice(0, 5);

  const TradeCard = ({ trade, isWinner }: { trade: SimulatedTrade, isWinner: boolean }) => (
    <div className={`flex items-center justify-between p-3 rounded-xl border border-slate-800/40 bg-slate-950/30 ${isWinner ? 'hover:border-emerald-500/20' : 'hover:border-rose-500/20'} transition-all group`}>
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-[10px] ${isWinner ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
          {trade.ticker.slice(0, 2)}
        </div>
        <div>
          <h6 className="text-[10px] font-black text-white uppercase">{trade.ticker}</h6>
          <p className="text-[8px] font-bold text-slate-500 uppercase">{new Date(trade.date).toLocaleDateString()}</p>
        </div>
      </div>
      <div className="text-right">
        <p className={`text-[11px] font-black italic ${isWinner ? 'text-emerald-400' : 'text-rose-400'}`}>
          {isWinner ? '+' : ''}{formatCurrency(Math.abs(trade.netPnL))}
        </p>
        <p className="text-[8px] font-bold text-slate-600 uppercase">ROI: {((trade.netPnL / trade.capitalAtRisk) * 100).toFixed(1)}%</p>
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="space-y-4">
        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
          <Trophy size={12} className="text-emerald-400" /> Alpha Generators (Top 5)
        </h4>
        <div className="space-y-2">
          {winners.map((t, i) => <TradeCard key={i} trade={t} isWinner={true} />)}
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
          <TrendingDown size={12} className="text-rose-400" /> Tail Outliers (Bottom 5)
        </h4>
        <div className="space-y-2">
          {losers.map((t, i) => <TradeCard key={i} trade={t} isWinner={false} />)}
        </div>
      </div>
    </div>
  );
};
