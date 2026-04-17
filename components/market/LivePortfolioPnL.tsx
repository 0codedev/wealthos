// LivePortfolioPnL.tsx - Agent M (Phase 4)
// Real-time portfolio P&L widget that updates as LiveMarketFeedService emits.
import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Activity, Sparkles, ArrowUp, ArrowDown } from 'lucide-react';
import { liveMarketFeedService, LiveQuote } from '../../services/live/LiveMarketFeedService';
import { usePortfolio } from '../../hooks/usePortfolio';

interface HoldingLite { symbol: string; quantity: number; avgPrice: number; name: string; }

interface LivePortfolioPnLProps {
  holdings?: HoldingLite[];
  className?: string;
}

export const LivePortfolioPnL: React.FC<LivePortfolioPnLProps> = ({ holdings: holdingsProp, className = '' }) => {
  const portfolio = usePortfolio();
  const holdings = useMemo<HoldingLite[]>(() => {
    if (holdingsProp && holdingsProp.length) return holdingsProp;
    const investments = (portfolio?.investments || []) as any[];
    return investments
      .filter((inv) => inv.ticker && inv.quantity && inv.quantity > 0)
      .map((inv) => ({ symbol: String(inv.ticker).toUpperCase(), quantity: inv.quantity || 0, avgPrice: inv.investedAmount / (inv.quantity || 1), name: inv.name || inv.ticker }));
  }, [holdingsProp, portfolio]);

  const [quotes, setQuotes] = useState<Map<string, LiveQuote>>(() => liveMarketFeedService.getAllQuotes());

  useEffect(() => {
    if (holdings.length === 0) return;
    const symbols = holdings.map((h) => h.symbol);
    liveMarketFeedService.subscribe(symbols);
    const unsub = liveMarketFeedService.on((q) => setQuotes(new Map(q)));
    return () => {
      liveMarketFeedService.unsubscribe(symbols);
      unsub();
    };
  }, [holdings.length, holdings.map((h) => h.symbol).join(',')]);

  const perHolding = useMemo(() => {
    return holdings.map((h) => {
      const q = quotes.get(h.symbol);
      const price = q?.price ?? h.avgPrice;
      const pnl = (price - h.avgPrice) * h.quantity;
      const pnlPct = h.avgPrice > 0 ? ((price - h.avgPrice) / h.avgPrice) * 100 : 0;
      return { symbol: h.symbol, name: h.name, pnl, pnlPct, price, q };
    });
  }, [holdings, quotes]);

  const totalPnL = perHolding.reduce((sum, h) => sum + h.pnl, 0);
  const totalInvested = holdings.reduce((sum, h) => sum + h.avgPrice * h.quantity, 0);
  const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
  const liveCount = perHolding.filter((h) => h.q).length;

  const sorted = [...perHolding].sort((a, b) => b.pnl - a.pnl);
  const topGainer = sorted[0];
  const topLoser = sorted[sorted.length - 1];

  const isPositive = totalPnL >= 0;
  const formatINR = (n: number) => '\u20B9' + Math.round(Math.abs(n)).toLocaleString('en-IN');

  if (holdings.length === 0) {
    return null;
  }

  return (
    <div className={`bg-slate-900/60 border border-slate-700/50 rounded-2xl p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-semibold text-slate-200">Live Portfolio P&amp;L</h3>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 uppercase">
          <Activity className="w-3 h-3" /> {liveCount}/{holdings.length} live
        </div>
      </div>
      <motion.div key={totalPnL} initial={{ scale: 0.96 }} animate={{ scale: 1 }} transition={{ duration: 0.3 }} className="text-center py-2">
        <div className={`text-3xl font-bold tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
          {isPositive ? '+' : '-'}{formatINR(totalPnL)}
        </div>
        <div className={`text-xs mt-1 font-medium ${isPositive ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
          {isPositive ? '+' : ''}{totalPnLPct.toFixed(2)}% unrealized
        </div>
      </motion.div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        {topGainer && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2">
            <div className="flex items-center gap-1 text-[10px] text-emerald-400 uppercase">
              <ArrowUp className="w-3 h-3" /> Top Gainer
            </div>
            <div className="text-sm font-semibold text-emerald-300 truncate">{topGainer.symbol}</div>
            <div className="text-xs text-emerald-400/80">+{formatINR(topGainer.pnl)}</div>
          </div>
        )}
        {topLoser && topLoser.symbol !== topGainer?.symbol && (
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">
            <div className="flex items-center gap-1 text-[10px] text-rose-400 uppercase">
              <ArrowDown className="w-3 h-3" /> Top Loser
            </div>
            <div className="text-sm font-semibold text-rose-300 truncate">{topLoser.symbol}</div>
            <div className="text-xs text-rose-400/80">-{formatINR(topLoser.pnl)}</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LivePortfolioPnL;

