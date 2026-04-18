import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  TrendingUp, TrendingDown, ChevronRight, Activity, Grid, List, Sparkles, RefreshCw
} from 'lucide-react';
import { upstoxMarketDataService, UpstoxQuote } from '../../services/UpstoxMarketDataService';
import { SECTOR_CONSTITUENTS } from '../../data/sectorConstituents';
import DataFreshnessTag from '../shared/DataFreshnessTag';
import { isMarketHours } from '../../services/PoolMarketHours';

interface SectorQuoteInfo {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const SECTOR_METADATA: Record<string, { name: string; constituentKey: string }> = {
  'BANKNIFTY': { name: 'Nifty Bank', constituentKey: 'BANK' },
  'NIFTY IT': { name: 'Nifty IT', constituentKey: 'IT' },
  'NIFTY FMCG': { name: 'Nifty FMCG', constituentKey: 'FMCG' },
  'NIFTY AUTO': { name: 'Nifty Auto', constituentKey: 'AUTO' },
  'NIFTY PHARMA': { name: 'Nifty Pharma', constituentKey: 'PHARMA' },
  'NIFTY ENERGY': { name: 'Nifty Energy', constituentKey: 'OIL & GAS' },
  'NIFTY METAL': { name: 'Nifty Metal', constituentKey: 'METAL' },
  'NIFTY REALTY': { name: 'Nifty Realty', constituentKey: 'REALTY' },
  'NIFTY MEDIA': { name: 'Nifty Media', constituentKey: 'MEDIA' },
  'FINNIFTY': { name: 'Nifty Financial Services', constituentKey: 'FIN SERVICE' },
  'NIFTY MIDCAP 100': { name: 'Nifty Midcap 100', constituentKey: 'NIFTY MID SELECT' },
  'NIFTY SMLCAP 100': { name: 'Nifty Smallcap 100', constituentKey: 'DEFENSE' } // Fallback constituent key if not found
};

export const SectorHeatmapGrid: React.FC = () => {
  const [sectorQuotes, setSectorQuotes] = useState<Record<string, SectorQuoteInfo>>({});
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<string>('');
  const [source, setSource] = useState<'cache' | 'live'>('live');
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [constituentQuotes, setConstituentQuotes] = useState<Record<string, UpstoxQuote>>({});
  const [constituentsLoading, setConstituentsLoading] = useState(false);

  const fetchSectorQuotes = useCallback(async () => {
    try {
      const symbols = Object.keys(SECTOR_METADATA);
      const quoteMap = await upstoxMarketDataService.getFullQuotes(symbols);

      if (quoteMap) {
        const formatted: Record<string, SectorQuoteInfo> = {};
        symbols.forEach(sym => {
          const q = quoteMap[sym];
          if (q) {
            formatted[sym] = {
              symbol: sym,
              name: SECTOR_METADATA[sym].name,
              price: q.last_price || 0,
              change: q.net_change || 0,
              changePercent: q.ohlc?.close ? ((q.last_price - q.ohlc.close) / q.ohlc.close) * 100 : 0,
              open: q.ohlc?.open || 0,
              high: q.ohlc?.high || 0,
              low: q.ohlc?.low || 0,
              close: q.ohlc?.close || 0,
            };
          }
        });
        setSectorQuotes(formatted);

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
      console.error('Error fetching sector quotes:', err);
    }
  }, []);

  const fetchConstituents = useCallback(async (sectorSymbol: string) => {
    const meta = SECTOR_METADATA[sectorSymbol];
    if (!meta) return;

    setConstituentsLoading(true);
    try {
      const symbols = SECTOR_CONSTITUENTS[meta.constituentKey] || [];
      // Fetch quotes for top 8 constituents for speed and rate limits
      const topSymbols = symbols.slice(0, 8);
      if (topSymbols.length > 0) {
        const quoteMap = await upstoxMarketDataService.getFullQuotes(topSymbols);
        if (quoteMap) {
          setConstituentQuotes(quoteMap);
        }
      }
    } catch (err) {
      console.error('Error fetching constituents:', err);
    } finally {
      setConstituentsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSectorQuotes();
    let interval: ReturnType<typeof setInterval> | null = null;
    const startSectorTimer = () => {
      if (interval) clearInterval(interval);
      const delay = isMarketHours() ? 60000 : 15 * 60 * 1000;
      interval = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        void fetchSectorQuotes();
      }, delay);
    };

    if (typeof document !== 'undefined' && !document.hidden) {
      startSectorTimer();
    }

    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        void fetchSectorQuotes();
        startSectorTimer();
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
  }, [fetchSectorQuotes]);

  useEffect(() => {
    if (selectedSector) {
      fetchConstituents(selectedSector);
    }
  }, [selectedSector, fetchConstituents]);

  // Derived metric: Sector Breadth Score (B.2.3)
  const calculateBreadthScore = () => {
    const total = Object.keys(sectorQuotes).length;
    if (total === 0) return 0;
    const upCount = Object.values(sectorQuotes).filter(s => s.changePercent >= 0).length;
    return Math.round((upCount / total) * 100);
  };

  const breadthScore = calculateBreadthScore();
  const getBreadthColor = (score: number) => {
    if (score >= 75) return 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5';
    if (score <= 25) return 'text-rose-400 border-rose-500/20 bg-rose-500/5';
    return 'text-amber-400 border-amber-500/20 bg-amber-500/5';
  };

  const getHeatmapColor = (changePercent: number) => {
    if (changePercent >= 1.5) return 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/35';
    if (changePercent > 0) return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20';
    if (changePercent === 0) return 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-900';
    if (changePercent >= -1.5) return 'bg-rose-500/10 border-rose-500/20 text-rose-300 hover:bg-rose-500/20';
    return 'bg-rose-500/20 border-rose-500/40 text-rose-400 hover:bg-rose-500/35';
  };

  return (
    <div className="space-y-4">
      {/* Overview Metric Bar */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between p-4 bg-slate-950/40 rounded-xl border border-slate-900">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400 border border-indigo-500/20">
            <Activity size={18} />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-300 tracking-tight uppercase">Sector Heatmap Matrix</h3>
            <p className="text-xs text-slate-500 font-mono">Real-time sectoral index overview</p>
          </div>
        </div>

        {/* Derived Sector Breadth Metric (B.2.3) */}
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-3 px-4 py-2 rounded-xl border font-mono ${getBreadthColor(breadthScore)}`}>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 font-sans uppercase font-bold tracking-wider">Sector Breadth</span>
              <span className="text-lg font-black tracking-tight">{breadthScore}%</span>
            </div>
            <div className="h-8 w-px bg-slate-800" />
            <div className="text-xs font-bold leading-tight">
              {breadthScore >= 75 ? '🔥 Broad Market Rally' : 
               breadthScore <= 25 ? '❄️ Broad Selloff' : 
               '⚡ Selective Sentiment'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lastFetched && <DataFreshnessTag fetchedAt={lastFetched} source={source} />}
            <button 
              onClick={fetchSectorQuotes}
              className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition-colors"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid Layout - Beta Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Heatmap Grid (Left 2 columns) */}
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {loading && Object.keys(sectorQuotes).length === 0 ? (
            Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-24 bg-slate-900/30 rounded-xl border border-slate-850 animate-pulse" />
            ))
          ) : (
            Object.values(sectorQuotes).map(sector => {
              const isUp = sector.changePercent >= 0;
              const isSelected = selectedSector === sector.symbol;

              return (
                <motion.div
                  key={sector.symbol}
                  onClick={() => setSelectedSector(isSelected ? null : sector.symbol)}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className={`cursor-pointer rounded-xl border p-4 transition-all duration-300 relative overflow-hidden flex flex-col justify-between h-24 ${
                    isSelected ? 'ring-2 ring-indigo-500 border-transparent bg-slate-900' : getHeatmapColor(sector.changePercent)
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className="text-xs font-bold tracking-tight uppercase truncate max-w-[80%]">
                      {sector.name}
                    </span>
                    <ChevronRight size={14} className={`text-current opacity-40 transition-transform ${isSelected ? 'rotate-90' : ''}`} />
                  </div>

                  <div className="flex items-baseline justify-between mt-auto">
                    <span className="text-xs font-bold font-mono">
                      {sector.price.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                    </span>
                    <span className="text-xs font-black font-mono flex items-center">
                      {isUp ? '+' : ''}
                      {sector.changePercent.toFixed(2)}%
                    </span>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>

        {/* Drill-down panel (Right 1 column) */}
        <div className="bg-slate-950/20 border border-slate-900 rounded-xl p-4 flex flex-col justify-between min-h-[300px]">
          <AnimatePresence mode="wait">
            {selectedSector ? (
              <motion.div
                key={selectedSector}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4 h-full flex flex-col"
              >
                <div className="flex items-center justify-between border-b border-slate-900 pb-3">
                  <div>
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Sector Constituents</h4>
                    <h3 className="text-sm font-black text-white">{SECTOR_METADATA[selectedSector].name}</h3>
                  </div>
                  <span className="text-[10px] font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded uppercase">
                    {SECTOR_METADATA[selectedSector].constituentKey}
                  </span>
                </div>

                <div className="space-y-2 flex-grow overflow-y-auto max-h-[320px] custom-scrollbar pr-1">
                  {constituentsLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="h-10 bg-slate-900/40 rounded border border-slate-850 animate-pulse" />
                    ))
                  ) : (
                    SECTOR_CONSTITUENTS[SECTOR_METADATA[selectedSector].constituentKey]?.slice(0, 8).map(sym => {
                      const quote = constituentQuotes[sym];
                      const symChangePercent = quote && quote.ohlc?.close 
                        ? ((quote.last_price - quote.ohlc.close) / quote.ohlc.close) * 100 
                        : 0;
                      const symIsUp = symChangePercent >= 0;

                      return (
                        <div 
                          key={sym} 
                          className="flex items-center justify-between p-2 hover:bg-slate-900/60 rounded border border-slate-900 transition-colors"
                        >
                          <div className="flex flex-col">
                            <span className="text-xs font-black text-white font-mono">{sym}</span>
                          </div>
                          {quote ? (
                            <div className="text-right font-mono">
                              <div className="text-xs font-bold text-slate-300">
                                ₹{quote.last_price.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                              </div>
                              <div className={`text-[10px] font-bold flex items-center justify-end ${symIsUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {symIsUp ? <TrendingUp size={8} className="mr-0.5" /> : <TrendingDown size={8} className="mr-0.5" />}
                                {symChangePercent.toFixed(2)}%
                              </div>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-600 font-mono">No data</span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center text-center h-full py-12 space-y-3"
              >
                <div className="p-3 bg-slate-900 rounded-full border border-slate-800 text-slate-500">
                  <Grid size={24} />
                </div>
                <div>
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Select a Sector</h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-[200px]">
                    Click any sector tile on the left to inspect constituents and detail weights.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
export default SectorHeatmapGrid;
