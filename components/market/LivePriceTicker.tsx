// LivePriceTicker.tsx - Agent M (Phase 4)
// Animated price ticker bar for the user's top 10 holdings.
// Updates in real-time via LiveMarketFeedService.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, TrendingUp, TrendingDown, Wifi, WifiOff } from 'lucide-react';
import { liveMarketFeedService, LiveQuote, FeedStatus } from '../../services/live/LiveMarketFeedService';
import { usePortfolio } from '../../hooks/usePortfolio';

interface HoldingLite { symbol: string; name: string; quantity: number; avgPrice: number; }

interface LivePriceTickerProps {
  holdings?: HoldingLite[];
  maxItems?: number;
  className?: string;
}

const formatPrice = (n: number): string => {
  if (!isFinite(n)) return '--';
  if (n >= 1000) return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return n.toFixed(2);
};

const formatChange = (n: number): string => {
  const sign = n > 0 ? '+' : n < 0 ? '' : '';
  return sign + n.toFixed(2);
};

const formatPercent = (n: number): string => {
  const sign = n > 0 ? '+' : n < 0 ? '' : '';
  return sign + n.toFixed(2) + '%';
};

export const LivePriceTicker: React.FC<LivePriceTickerProps> = ({ holdings: holdingsProp, maxItems = 10, className = '' }) => {
  const portfolio = usePortfolio();
  const holdings = useMemo<HoldingLite[]>(() => {
    if (holdingsProp && holdingsProp.length) return holdingsProp;
    const investments = (portfolio?.investments || []) as any[];
    return investments
      .filter((inv) => inv.ticker && inv.quantity && inv.quantity > 0)
      .slice(0, maxItems)
      .map((inv) => ({ symbol: String(inv.ticker).toUpperCase(), name: inv.name || inv.ticker, quantity: inv.quantity || 0, avgPrice: inv.investedAmount / (inv.quantity || 1) }));
  }, [holdingsProp, portfolio, maxItems]);

  const [quotes, setQuotes] = useState<Map<string, LiveQuote>>(() => liveMarketFeedService.getAllQuotes());
  const [status, setStatus] = useState<FeedStatus>(() => liveMarketFeedService.getStatus());

  const symbolsKey = useMemo(() => holdings.map((h) => h.symbol).sort().join(','), [holdings]);

  useEffect(() => {
    if (holdings.length === 0) return;
    const symbols = holdings.map((h) => h.symbol);
    liveMarketFeedService.subscribe(symbols);
    const unsubQuotes = liveMarketFeedService.on((q) => setQuotes(new Map(q)));
    const unsubStatus = liveMarketFeedService.onStatusChange((s) => setStatus(s));
    return () => {
      liveMarketFeedService.unsubscribe(symbols);
      unsubQuotes();
      unsubStatus();
    };
  }, [symbolsKey, holdings.length]);

  if (holdings.length === 0) {
    return null;
  }

  const isLive = status === 'connected';
  const isFallback = status === 'fallback';
  const statusColor = isLive ? 'text-emerald-400' : isFallback ? 'text-amber-400' : 'text-slate-500';
  const StatusIcon = isLive || isFallback ? Activity : WifiOff;

  return (
    <div className={`w-full bg-slate-900/70 backdrop-blur border-b border-slate-700/50 ${className}`}>
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-3">
        <div className={`flex items-center gap-1.5 text-xs font-medium ${statusColor}`}>
          <StatusIcon className="w-3.5 h-3.5" />
          <span className="uppercase tracking-wide">{isLive ? 'LIVE' : isFallback ? 'POLLING' : 'OFFLINE'}</span>
        </div>
        <div className="flex-1 flex items-center gap-2 overflow-x-auto scrollbar-thin">
          {holdings.map((h) => {
            const q = quotes.get(h.symbol);
            const price = q?.price ?? 0;
            const change = q?.change ?? 0;
            const changePct = q?.changePercent ?? 0;
            const pnl = (price - h.avgPrice) * h.quantity;
            const positive = change >= 0;
            const lastUpdatedAgo = q ? Math.max(0, Math.floor((Date.now() - q.timestamp) / 1000)) : -1;
            return (
              <motion.div
                key={h.symbol}
                layout
                className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 bg-slate-800/60 hover:bg-slate-700/80 rounded-full border border-slate-700/50 transition-colors"
                title={lastUpdatedAgo >= 0 ? `Updated ${lastUpdatedAgo}s ago` : 'Awaiting feed'}
              >
                <div className="flex flex-col">
                  <span className="text-[10px] font-semibold text-slate-300 uppercase tracking-wider">{h.symbol}</span>
                </div>
                <AnimatePresence mode="popLayout">
                  <motion.span
                    key={price}
                    initial={{ opacity: 0, y: positive ? 6 : -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className={`text-sm font-mono font-bold tabular-nums ${positive ? 'text-emerald-400' : 'text-rose-400'}`}
                  >
                    {q ? formatPrice(price) : '—'}
                  </motion.span>
                </AnimatePresence>
                <span className={`text-[11px] font-medium ${positive ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                  {q ? formatPercent(changePct) : ''}
                </span>
                {q && h.quantity > 0 && (
                  <span className={`text-[10px] font-semibold ${pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {pnl >= 0 ? '+' : ''}\u20B9{Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default LivePriceTicker;

