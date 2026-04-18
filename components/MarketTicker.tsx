import React from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useLiveMarketData } from '../hooks/live/useLiveMarketData';
import LiveStatusBadge from './shared/LiveStatusBadge';

const MarketTicker: React.FC = () => {
  const { getQuote } = useLiveMarketData(['^NSEI', '^NSEBANK', '^INDIAVIX']);

  const nifty = getQuote('^NSEI');
  const bankNifty = getQuote('^NSEBANK');
  const vix = getQuote('^INDIAVIX');

  const formatPrice = (val: number | undefined) => {
    if (val === undefined) return '...';
    return val.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  };

  const renderItem = (label: string, quote: any) => {
    if (!quote) return (
      <span className="flex items-center gap-1">
        {label}: <span className="inline-block h-3 w-12 align-middle rounded bg-slate-800 animate-shimmer-premium" />
      </span>
    );

    const isUp = quote.change >= 0;
    const colorClass = isUp ? 'text-emerald-500 font-semibold' : 'text-rose-500 font-semibold';
    const Icon = isUp ? ArrowUpRight : ArrowDownRight;

    return (
      <span className={`flex items-center gap-1.5 font-medium select-none transition-colors duration-300 hover:text-slate-100`}>
        <span className="text-slate-400 font-semibold">{label}</span>
        <span className="font-mono text-slate-100">{formatPrice(quote.price)}</span>
        <span className={`flex items-center gap-0.5 text-xs font-mono px-1 py-0.5 rounded ${colorClass} bg-opacity-10`}>
          <Icon size={12} />
          {quote.changePercent.toFixed(2)}%
        </span>
      </span>
    );
  };

  return (
    <div className="w-full bg-slate-950 text-slate-300 text-xs py-2 px-4 overflow-hidden border-b border-slate-900 flex items-center justify-between gap-4">
      <div className="flex items-center gap-6 overflow-x-auto no-scrollbar scroll-smooth">
        <div className="flex items-center gap-1.5 text-indigo-400 font-bold shrink-0">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75 animate-breathe-green" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
          </span>
          <span>REALTIME FEED</span>
        </div>
        <div className="h-4 w-px bg-slate-800 shrink-0"></div>
        <div className="flex items-center gap-6">
          {renderItem('NIFTY 50', nifty)}
          {renderItem('BANK NIFTY', bankNifty)}
          {renderItem('INDIA VIX', vix)}
        </div>
      </div>
      <div className="shrink-0">
        <LiveStatusBadge />
      </div>
    </div>
  );
};

export default MarketTicker;
