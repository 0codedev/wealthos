import React, { useMemo } from 'react';
import { Zap, AlertTriangle, ArrowUpRight, ArrowDownRight, WifiOff } from 'lucide-react';
import { useLiveMarketData } from '../../hooks/live/useLiveMarketData';
import { useLiteModeStore } from '../../store/liteModeStore';

interface TickerItem {
  id: string;
  type: 'MARKET' | 'INSIGHT' | 'ALERT';
  text: string;
  value?: string;
  change?: number; // percentage
  isLive?: boolean;
}

// Format number for display
function formatPrice(value: number | string): string {
  if (typeof value === 'string') return value;
  if (value >= 10000) {
    return value.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  return value.toFixed(2);
}

export const AlphaTicker: React.FC = () => {
  const isLiteMode = useLiteModeStore(state => state.isLiteMode);
  const { getQuote, status, isConnected } = useLiveMarketData(['^NSEI', '^NSEBANK', '^INDIAVIX']);

  const tickerItems = useMemo(() => {
    const nifty = getQuote('^NSEI');
    const bankNifty = getQuote('^NSEBANK');
    const vix = getQuote('^INDIAVIX');

    const items: TickerItem[] = [];

    // Add Nifty 50
    items.push({
      id: '^NSEI',
      type: 'MARKET',
      text: 'NIFTY 50',
      value: nifty ? formatPrice(nifty.price) : '---',
      change: nifty ? nifty.changePercent : 0,
      isLive: !!nifty,
    });

    // Add BankNifty
    items.push({
      id: '^NSEBANK',
      type: 'MARKET',
      text: 'BANK NIFTY',
      value: bankNifty ? formatPrice(bankNifty.price) : '---',
      change: bankNifty ? bankNifty.changePercent : 0,
      isLive: !!bankNifty,
    });

    // Add VIX
    items.push({
      id: '^INDIAVIX',
      type: 'MARKET',
      text: 'INDIA VIX',
      value: vix ? formatPrice(vix.price) : '---',
      change: vix ? vix.changePercent : 0,
      isLive: !!vix,
    });

    // Add Insights
    items.push({ id: 'insight-1', type: 'INSIGHT', text: 'Scanning market structure for high-probability setups...', change: 0 });
    items.push({ id: 'alert-1', type: 'ALERT', text: isConnected ? 'Live Data Mesh Active' : 'Connecting to Live Mesh...', change: 0 });

    return items;
  }, [getQuote, isConnected]);

  if (isLiteMode) return null;

  return (
    <div className="w-full bg-slate-950 text-white overflow-hidden py-2 border-b border-indigo-500/20 relative z-40">
      {/* Live indicator */}
      <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center px-3 bg-gradient-to-r from-slate-950 to-transparent">
        {isConnected ? (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 rounded-full border border-emerald-500/20">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Live</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-800/50 rounded-full border border-slate-700">
            <WifiOff size={10} className="text-slate-400" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{status}</span>
          </div>
        )}
      </div>

      {/* Fade Out Edge */}
      <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-slate-950 to-transparent z-10 pointer-events-none" />

      {/* Marquee Content */}
      <div className="flex whitespace-nowrap animate-ticker hover:[animation-play-state:paused] ml-24">
        {[...tickerItems, ...tickerItems, ...tickerItems].map((item, index) => (
          <div key={`${item.id}-${index}`} className="flex items-center gap-2 mx-8 text-xs font-mono group cursor-default transition-colors hover:text-white">
            {item.type === 'MARKET' && (
              <span className="flex items-center gap-2">
                <span className="font-bold text-slate-400 group-hover:text-white transition-colors">{item.text}</span>
                <span className={`font-medium ${item.change && item.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {item.value}
                </span>
                {item.change !== undefined && (
                  <span className={`flex items-center px-1.5 py-0.5 rounded ${item.change >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                    {item.change >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                    {Math.abs(item.change).toFixed(2)}%
                  </span>
                )}
              </span>
            )}

            {item.type === 'INSIGHT' && (
              <span className="flex items-center gap-1.5 text-indigo-300/80 group-hover:text-indigo-300">
                <Zap size={12} className="text-yellow-400 fill-yellow-400" />
                <span>{item.text}</span>
              </span>
            )}

            {item.type === 'ALERT' && (
              <span className="flex items-center gap-1.5 text-slate-400 group-hover:text-slate-300">
                <AlertTriangle size={12} className="text-amber-500" />
                <span>{item.text}</span>
              </span>
            )}

            <span className="text-slate-800 ml-6 select-none opacity-20">|</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AlphaTicker;
