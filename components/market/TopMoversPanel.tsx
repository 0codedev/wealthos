import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Flame, BarChart3, RefreshCw
} from 'lucide-react';
import { upstoxMarketDataService, UpstoxQuote } from '../../services/UpstoxMarketDataService';
import { isMarketHours } from '../../services/PoolMarketHours';
import { FNO_STOCKS } from '../../data/fno_stocks';
import DataFreshnessTag from '../shared/DataFreshnessTag';

interface MoverItem {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  oi: number;
  volumeRatio?: number;
}

export const TopMoversPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'gainers' | 'losers' | 'volume' | 'oi'>('gainers');
  const [movers, setMovers] = useState<{
    gainers: MoverItem[];
    losers: MoverItem[];
    volume: MoverItem[];
    oi: MoverItem[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<string>('');
  const [source, setSource] = useState<'cache' | 'live'>('live');

  const fetchMoversData = useCallback(async () => {
    try {
      const volAvgMap = await upstoxMarketDataService.getAllVolumeAverages();

      // 2. Fetch all F&O quotes
      const symbols = FNO_STOCKS.map(s => s.symbol);
      const quoteMap = await upstoxMarketDataService.getFullQuotes(symbols);

      if (quoteMap) {
        const allItems: MoverItem[] = [];

        symbols.forEach(sym => {
          const q = quoteMap[sym];
          if (!q) return;

          const changePercent = q.ohlc?.close ? ((q.last_price - q.ohlc.close) / q.ohlc.close) * 100 : 0;
          const entry = volAvgMap[sym];
          const avgVol = entry ? (typeof entry === 'object' ? entry.avg_volume_20d : entry) : 0;
          const volRatio = avgVol > 0 ? q.volume / avgVol : 1.0;

          allItems.push({
            symbol: sym,
            price: q.last_price || 0,
            change: q.net_change || 0,
            changePercent,
            volume: q.volume || 0,
            oi: q.oi || 0,
            volumeRatio: volRatio
          });
        });

        // Sort gainers (highest % change)
        const gainers = [...allItems]
          .sort((a, b) => b.changePercent - a.changePercent)
          .slice(0, 10);

        // Sort losers (lowest % change)
        const losers = [...allItems]
          .sort((a, b) => a.changePercent - b.changePercent)
          .slice(0, 10);

        // Sort volume surges (highest ratio vs 20d avg)
        const volumeSurges = [...allItems]
          .filter(item => (item.volumeRatio || 0) > 1.0)
          .sort((a, b) => (b.volumeRatio || 0) - (a.volumeRatio || 0))
          .slice(0, 10);

        // Sort by Open Interest
        const oiLeaders = [...allItems]
          .sort((a, b) => b.oi - a.oi)
          .slice(0, 10);

        setMovers({
          gainers,
          losers,
          volume: volumeSurges,
          oi: oiLeaders
        });

        const meta = (quoteMap as any)._cache_meta;
        if (meta) {
          setLastFetched(meta.fetched_at);
          setSource(meta.source);
        } else {
          setLastFetched(new Date().toISOString());
          setSource('live');
        }
      }
      setLoading(false);
    } catch (err) {
      console.error('Error fetching movers:', err);
    }
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    let isMounted = true;

    const scheduleNext = () => {
      if (!isMounted) return;
      if (document.hidden) return;
      const delay = isMarketHours() ? 30000 : 15 * 60 * 1000;
      timer = setTimeout(async () => {
        await fetchMoversData();
        scheduleNext();
      }, delay);
    };

    fetchMoversData();
    scheduleNext();

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchMoversData();
        scheduleNext();
      } else if (timer) {
        clearTimeout(timer);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchMoversData]);

  if (loading || !movers) {
    return (
      <div className="h-96 bg-slate-900/30 rounded-xl border border-slate-900 animate-pulse flex items-center justify-center">
        <span className="text-xs text-slate-500 font-mono">Loading Market Movers...</span>
      </div>
    );
  }

  const tabList = [
    { id: 'gainers', label: 'Top Gainers', icon: TrendingUp, color: 'text-emerald-400' },
    { id: 'losers', label: 'Top Losers', icon: TrendingDown, color: 'text-rose-400' },
    { id: 'volume', label: 'Volume Surge', icon: Flame, color: 'text-amber-400' },
    { id: 'oi', label: 'Open Interest', icon: BarChart3, color: 'text-indigo-400' }
  ] as const;

  const currentList = movers[activeTab];

  return (
    <div className="bg-slate-950/20 border border-slate-900 rounded-xl p-5 space-y-4">
      {/* Header controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-900 pb-3">
        <div>
          <h3 className="text-xs font-black text-slate-400 tracking-wider uppercase">Market Movers Scanner</h3>
          <p className="text-[10px] text-slate-500 font-mono">Top performers, volume spikes & OI changes</p>
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && <DataFreshnessTag fetchedAt={lastFetched} source={source} />}
          <button 
            onClick={fetchMoversData} 
            className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-500 hover:text-white transition-colors"
          >
            <RefreshCw size={10} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 p-1 bg-slate-900/40 rounded-lg border border-slate-900">
        {tabList.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                isActive 
                  ? 'bg-slate-800 text-white border border-slate-700/60 shadow-lg' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon size={12} className={isActive ? tab.color : 'text-slate-500'} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Moversion list */}
      <div className="overflow-x-auto min-h-[380px] custom-scrollbar">
        <table className="w-full font-mono text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-900 text-slate-500 text-[10px] font-sans uppercase font-black tracking-wider pb-2">
              <th className="py-2.5 px-2">Symbol</th>
              <th className="py-2.5 px-2 text-right">LTP</th>
              <th className="py-2.5 px-2 text-right">Change %</th>
              {activeTab === 'volume' ? (
                <th className="py-2.5 px-2 text-right">Surge Ratio</th>
              ) : activeTab === 'oi' ? (
                <th className="py-2.5 px-2 text-right">Open Interest</th>
              ) : (
                <th className="py-2.5 px-2 text-right">Volume</th>
              )}
              <th className="py-2.5 px-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence mode="popLayout">
              {currentList.map((item, idx) => {
                const isUp = item.changePercent >= 0;
                const isHighSurge = (item.volumeRatio || 0) > 2.5;

                return (
                  <motion.tr
                    key={item.symbol}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: idx * 0.02 }}
                    className="border-b border-slate-900/40 hover:bg-slate-900/20 transition-colors"
                  >
                    <td className="py-3 px-2 font-sans font-black text-white flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-600 font-mono w-4">#{idx+1}</span>
                      {item.symbol}
                    </td>
                    <td className="py-3 px-2 text-right text-slate-300 font-bold">
                      ₹{item.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className={`py-3 px-2 text-right font-black ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                      <span className="inline-flex items-center">
                        {isUp ? <ArrowUpRight size={10} className="mr-0.5" /> : <ArrowDownRight size={10} className="mr-0.5" />}
                        {Math.abs(item.changePercent).toFixed(2)}%
                      </span>
                    </td>
                    
                    {activeTab === 'volume' ? (
                      <td className="py-3 px-2 text-right text-amber-400 font-bold">
                        {item.volumeRatio?.toFixed(2)}x
                      </td>
                    ) : activeTab === 'oi' ? (
                      <td className="py-3 px-2 text-right text-indigo-400 font-bold">
                        {item.oi.toLocaleString('en-IN')}
                      </td>
                    ) : (
                      <td className="py-3 px-2 text-right text-slate-400">
                        {(item.volume / 100000).toFixed(1)}L
                      </td>
                    )}

                    <td className="py-3 px-2 text-right">
                      {activeTab === 'volume' && isHighSurge ? (
                        <span className="inline-flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-sm animate-pulse">
                          🔥 Surge Alert
                        </span>
                      ) : activeTab === 'gainers' && item.changePercent >= 4.0 ? (
                        <span className="inline-flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-sm">
                          ⚡ Breakout
                        </span>
                      ) : activeTab === 'losers' && item.changePercent <= -4.0 ? (
                        <span className="inline-flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-sm">
                          ⚠️ Breakdown
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-600">Stable</span>
                      )}
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </div>
  );
};
export default TopMoversPanel;
