import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  TrendingUp, TrendingDown, Clock, Activity, AlertTriangle, HelpCircle, RefreshCw
} from 'lucide-react';
import { upstoxMarketDataService, UpstoxQuote } from '../../services/UpstoxMarketDataService';
import { upstoxWebSocketService } from '../../services/UpstoxWebSocketService';
import DataFreshnessTag from '../shared/DataFreshnessTag';
import { LiveConnectionBadge } from '../shared/LiveConnectionBadge';
import { useGlobalTickStore } from '../../store/globalTickStore';
import { isMarketHours } from '../../services/PoolMarketHours';

const INDEX_KEYS = [
  'NSE_INDEX|Nifty 50',
  'NSE_INDEX|Nifty Bank',
  'BSE_INDEX|SENSEX',
  'NSE_INDEX|India VIX',
  'NSE_INDEX|Gift Nifty'
];

const KEY_TO_SYMBOL: Record<string, string> = {
  'NSE_INDEX|Nifty 50': 'NIFTY',
  'NSE_INDEX|Nifty Bank': 'BANKNIFTY',
  'BSE_INDEX|SENSEX': 'SENSEX',
  'NSE_INDEX|India VIX': 'INDIA VIX',
  'NSE_INDEX|Gift Nifty': 'GIFTNIFTY'
};

interface IndexQuoteInfo {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  close: number;
  upperCircuit?: number;
  lowerCircuit?: number;
}

const MARKET_STATUS_CACHE_KEY = 'wealthos_market_status_indices';

export const MarketStatusHeader: React.FC = () => {
  const [quotes, setQuotes] = useState<Record<string, IndexQuoteInfo>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(MARKET_STATUS_CACHE_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    }
    return {};
  });
  const [marketStatus, setMarketStatus] = useState<{
    status: string;
    openTime: string;
    closeTime: string;
  } | null>(null);
  const [countdownText, setCountdownText] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<string>('');
  const [source, setSource] = useState<'cache' | 'live'>('live');

  // Hook up real-time websocket stream
  const ticks = useGlobalTickStore((s) => s.ticks);

  // Subscribe to index websocket stream
  useEffect(() => {
    const onTick = () => {};
    upstoxWebSocketService.subscribe(INDEX_KEYS, onTick, 'ltpc');
    return () => {
      upstoxWebSocketService.unsubscribe(INDEX_KEYS, onTick);
    };
  }, []);

  // Merge live ticks into quotes
  useEffect(() => {
    if (Object.keys(ticks).length === 0) return;

    setQuotes((prev) => {
      const updated = { ...prev };
      let changed = false;

      Object.entries(ticks).forEach(([key, tick]) => {
        const symbol = KEY_TO_SYMBOL[key] || (key.includes('Nifty 50') ? 'NIFTY' : key.includes('Nifty Bank') ? 'BANKNIFTY' : key.includes('SENSEX') ? 'SENSEX' : key.includes('India VIX') ? 'INDIA VIX' : undefined);
        if (symbol && tick.ltp !== null) {
          const existing = updated[symbol];
          if (!existing || existing.price !== tick.ltp) {
            // Official closing baseline must never default to tick.ltp (which zeros out change)
            const closePrice = (tick.close && tick.close > 0)
              ? tick.close
              : (tick.ohlc?.close && tick.ohlc.close > 0)
                ? tick.ohlc.close
                : (existing?.close && existing.close > 0)
                  ? existing.close
                  : null;

            const change = (closePrice && closePrice > 0)
              ? tick.ltp - closePrice
              : (existing?.change ?? 0);

            const changePercent = (closePrice && closePrice > 0)
              ? (change / closePrice) * 100
              : (existing?.changePercent ?? 0);

            updated[symbol] = {
              symbol,
              name: existing?.name || (symbol === 'NIFTY' ? 'NIFTY 50' : symbol === 'BANKNIFTY' ? 'BANK NIFTY' : symbol),
              price: tick.ltp,
              change,
              changePercent,
              open: tick.ohlc?.open || existing?.open || 0,
              high: tick.ohlc?.high || existing?.high || 0,
              low: tick.ohlc?.low || existing?.low || 0,
              close: closePrice ?? tick.ltp,
              upperCircuit: existing?.upperCircuit,
              lowerCircuit: existing?.lowerCircuit
            };
            changed = true;
          }
        }
      });

      if (changed) {
        setSource('live');
        setLastFetched(new Date().toISOString());
        try {
          localStorage.setItem(MARKET_STATUS_CACHE_KEY, JSON.stringify(updated));
        } catch { /* ignore quota */ }
        return updated;
      }
      return prev;
    });
  }, [ticks]);

  const fetchMarketData = useCallback(async () => {
    try {
      // 1. Fetch quotes
      const quoteMap = await upstoxMarketDataService.getFullQuotes([
        'NIFTY', 'BANKNIFTY', 'SENSEX', 'INDIA VIX', 'GIFTNIFTY'
      ]);

      if (quoteMap) {
        const formatted: Record<string, IndexQuoteInfo> = {};
        
        // Helper to extract quotes safely
        const extractQuote = (key: string, name: string): IndexQuoteInfo | null => {
          const q = quoteMap[key];
          if (!q) return null;
          return {
            symbol: key,
            name,
            price: q.last_price || 0,
            change: q.net_change || 0,
            changePercent: q.ohlc?.close ? ((q.last_price - q.ohlc.close) / q.ohlc.close) * 100 : 0,
            open: q.ohlc?.open || 0,
            high: q.ohlc?.high || 0,
            low: q.ohlc?.low || 0,
            close: q.ohlc?.close || 0,
            upperCircuit: q.upper_circuit_limit,
            lowerCircuit: q.lower_circuit_limit,
          };
        };

        const nifty = extractQuote('NIFTY', 'NIFTY 50');
        const banknifty = extractQuote('BANKNIFTY', 'BANK NIFTY');
        const sensex = extractQuote('SENSEX', 'SENSEX');
        const vix = extractQuote('INDIA VIX', 'INDIA VIX');
        const giftnifty = extractQuote('GIFTNIFTY', 'GIFT NIFTY');

        if (nifty) formatted['NIFTY'] = nifty;
        if (banknifty) formatted['BANKNIFTY'] = banknifty;
        if (sensex) formatted['SENSEX'] = sensex;
        if (vix) formatted['INDIA VIX'] = vix;
        if (giftnifty) formatted['GIFTNIFTY'] = giftnifty;

        setQuotes(formatted);
        
        // Cache meta extraction
        const meta = (quoteMap as any)._cache_meta;
        if (meta) {
          setLastFetched(meta.fetched_at);
          setSource(meta.source);
        } else {
          setLastFetched(new Date().toISOString());
          setSource('live');
        }
      }

      // 2. Fetch market status
      const statusData = await upstoxMarketDataService.getMarketStatus('NSE_CM');
      if (statusData) {
        setMarketStatus({
          status: statusData.status || 'CLOSED',
          openTime: statusData.open_time || '09:15:00',
          closeTime: statusData.close_time || '15:30:00',
        });
      }
      setLoading(false);
    } catch (e) {
      console.error('Error fetching market status header quotes:', e);
    }
  }, []);

  useEffect(() => {
    fetchMarketData();
    let interval: ReturnType<typeof setInterval> | null = null;
    const startQuoteTimer = () => {
      if (interval) clearInterval(interval);
      // 15s during active market hours, 15m outside market hours and weekends
      const delay = isMarketHours() ? 15000 : 15 * 60 * 1000;
      interval = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        void fetchMarketData();
      }, delay);
    };

    if (typeof document !== 'undefined' && !document.hidden) {
      startQuoteTimer();
    }

    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        void fetchMarketData();
        startQuoteTimer();
      } else if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (interval) clearInterval(interval);
    };
  }, [fetchMarketData]);

  // Compute countdown to market open/close
  useEffect(() => {
    if (!marketStatus) return;

    const timer = setInterval(() => {
      const now = new Date();
      const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const currentMinutes = istTime.getHours() * 60 + istTime.getMinutes();
      const currentSeconds = currentMinutes * 60 + istTime.getSeconds();

      const parseTimeString = (tStr: string) => {
        const parts = tStr.split(':');
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + (parts[2] ? parseInt(parts[2]) : 0);
      };

      const openSec = parseTimeString(marketStatus.openTime);
      const closeSec = parseTimeString(marketStatus.closeTime);
      
      const day = istTime.getDay();
      const isWeekend = day === 0 || day === 6;

      if (isWeekend) {
        setCountdownText('Market opens on Monday');
        return;
      }

      if (currentSeconds < openSec) {
        const diff = openSec - currentSeconds;
        setCountdownText(`Opens in ${formatTime(diff)}`);
      } else if (currentSeconds >= openSec && currentSeconds < closeSec) {
        const diff = closeSec - currentSeconds;
        setCountdownText(`Closes in ${formatTime(diff)}`);
      } else {
        setCountdownText('Market Closed');
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [marketStatus]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;
  };

  // VIX color coding logic (B.1.2)
  const getVixColors = (vixValue: number) => {
    if (vixValue < 13) return { bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', text: 'text-emerald-400' };
    if (vixValue <= 20) return { bg: 'bg-amber-500/10 text-amber-400 border-amber-500/20', text: 'text-amber-400' };
    if (vixValue <= 25) return { bg: 'bg-orange-500/10 text-orange-400 border-orange-500/20', text: 'text-orange-400' };
    return { bg: 'bg-rose-500/10 text-rose-400 border-rose-500/20', text: 'text-rose-400' };
  };

  // Circuit breaker alarm (B.1.3)
  const renderCircuitWarning = (idx: IndexQuoteInfo) => {
    if (!idx.upperCircuit || !idx.lowerCircuit || idx.price <= 0) return null;
    const threshold = 0.02; // 2% bounds
    const distToUpper = (idx.upperCircuit - idx.price) / idx.price;
    const distToLower = (idx.price - idx.lowerCircuit) / idx.price;

    if (distToUpper < threshold) {
      return (
        <span className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse">
          <AlertTriangle size={8} /> Upper Circuit Alert
        </span>
      );
    }
    if (distToLower < threshold) {
      return (
        <span className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse">
          <AlertTriangle size={8} /> Lower Circuit Alert
        </span>
      );
    }
    return null;
  };

  if (loading && Object.keys(quotes).length === 0) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[1, 2, 3, 4, 5].map(n => (
          <div key={n} className="h-20 bg-slate-900/40 rounded-2xl border border-slate-800 animate-pulse" />
        ))}
      </div>
    );
  }

  const indicesToRender = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'GIFTNIFTY', 'INDIA VIX'];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/40 p-3 rounded-2xl border border-slate-900">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black uppercase tracking-wider ${
            marketStatus?.status === 'OPEN' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25' : 
            marketStatus?.status === 'PRE-OPEN' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/25' : 
            'bg-slate-800/40 text-slate-400 border border-slate-800'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${marketStatus?.status === 'OPEN' ? 'bg-emerald-400 animate-ping' : marketStatus?.status === 'PRE-OPEN' ? 'bg-amber-400 animate-pulse' : 'bg-slate-500'}`} />
            {marketStatus?.status || 'OFFLINE'}
          </span>
          <LiveConnectionBadge size="sm" />
          <span className="text-xs font-black text-slate-400 flex items-center gap-1 font-mono">
            <Clock size={12} className="text-slate-500" />
            {countdownText}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && (
            <DataFreshnessTag fetchedAt={lastFetched} source={source} />
          )}
          <button 
            onClick={fetchMarketData} 
            className="p-1 rounded-lg hover:bg-slate-800/80 text-slate-500 hover:text-white transition-colors"
            title="Force refresh index quotes"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {indicesToRender.map(symbol => {
          const idx = quotes[symbol];
          if (!idx) return null;

          const isVix = symbol === 'INDIA VIX';
          const vixTheme = isVix ? getVixColors(idx.price) : null;
          const isUp = idx.change >= 0;

          return (
            <div 
              key={symbol}
              className="relative overflow-hidden group bg-slate-900/60 dark:bg-slate-900/30 hover:bg-slate-900 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-4 transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/2"
            >
              {/* Background accent */}
              <div className={`absolute -right-10 -bottom-10 w-24 h-24 rounded-full bg-current opacity-[0.01] group-hover:opacity-[0.03] transition-opacity ${isVix ? vixTheme?.text : isUp ? 'text-emerald-500' : 'text-rose-500'}`} />

              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-black tracking-widest text-slate-500 uppercase">
                  {idx.name}
                </span>
                {renderCircuitWarning(idx)}
              </div>

              <div className="flex items-baseline justify-between">
                <span className={`text-lg font-black tracking-tight font-mono ${isVix ? vixTheme?.text : 'text-white'}`}>
                  {idx.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                
                {!isVix ? (
                  <span className={`text-xs font-mono font-bold flex items-center ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {isUp ? <TrendingUp size={10} className="mr-0.5" /> : <TrendingDown size={10} className="mr-0.5" />}
                    {Math.abs(idx.changePercent).toFixed(2)}%
                  </span>
                ) : (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider font-sans ${vixTheme?.bg}`}>
                    {idx.price < 13 ? 'Calm' : idx.price <= 20 ? 'Normal' : idx.price <= 25 ? 'High Risk' : 'Panic'}
                  </span>
                )}
              </div>

              {/* Sparkline stats on hover */}
              <div className="h-0 group-hover:h-8 overflow-hidden transition-all duration-300 mt-0 group-hover:mt-2 border-t border-slate-800/50 pt-0 group-hover:pt-1.5 flex justify-between items-center text-[9px] text-slate-500 font-mono">
                <div className="flex flex-col">
                  <span>H: {idx.high.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</span>
                  <span>L: {idx.low.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</span>
                </div>
                {idx.upperCircuit && idx.lowerCircuit && (
                  <div className="text-right flex flex-col opacity-60">
                    <span title="Upper Circuit Limit">UC: {idx.upperCircuit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                    <span title="Lower Circuit Limit">LC: {idx.lowerCircuit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
export default MarketStatusHeader;
