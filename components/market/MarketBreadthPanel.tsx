import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  TrendingUp, TrendingDown, Volume2, ShieldAlert, Zap, RefreshCw, BarChart2
} from 'lucide-react';
import { upstoxMarketDataService, UpstoxQuote } from '../../services/UpstoxMarketDataService';
import { isMarketHours } from '../../services/PoolMarketHours';
import { FNO_STOCKS } from '../../data/fno_stocks';
import DataFreshnessTag from '../shared/DataFreshnessTag';

interface BreadthMetrics {
  advanceCount: number;
  declineCount: number;
  aboveAvgVolCount: number;
  atDaysHighCount: number;
  atDaysLowCount: number;
  nearCircuitCount: number;
  healthScore: number;
}

export const MarketBreadthPanel: React.FC = () => {
  const [metrics, setMetrics] = useState<BreadthMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<string>('');
  const [source, setSource] = useState<'cache' | 'live'>('live');

  const fetchBreadthData = useCallback(async () => {
    try {
      // 1. Fetch volume averages for all symbols first (cached for 12h)
      const volAvgMap = await upstoxMarketDataService.getAllVolumeAverages();

      // 2. Fetch full quotes for all F&O stocks
      const fnoSymbols = FNO_STOCKS.map(s => s.symbol);
      const quotes = await upstoxMarketDataService.getFullQuotes(fnoSymbols);

      if (quotes) {
        let advances = 0;
        let declines = 0;
        let aboveAvgVol = 0;
        let atDaysHigh = 0;
        let atDaysLow = 0;
        let nearCircuit = 0;
        let validStocksCount = 0;

        fnoSymbols.forEach(sym => {
          const q = quotes[sym];
          if (!q) return;

          validStocksCount++;
          const changePercent = q.ohlc?.close ? ((q.last_price - q.ohlc.close) / q.ohlc.close) * 100 : 0;
          
          if (changePercent >= 0) {
            advances++;
          } else {
            declines++;
          }

          // Volume ratio check (B.3.1)
          const entry = volAvgMap[sym];
          const avgVol = entry ? (typeof entry === 'object' ? entry.avg_volume_20d : entry) : 0;
          if (avgVol > 0 && q.volume > avgVol) {
            aboveAvgVol++;
          }

          // At day's high check (within 0.5%)
          if (q.ohlc?.high && q.last_price >= q.ohlc.high * 0.995) {
            atDaysHigh++;
          }

          // At day's low check (within 0.5%)
          if (q.ohlc?.low && q.last_price <= q.ohlc.low * 1.005) {
            atDaysLow++;
          }

          // Circuit breaker check (within 1.5% of upper circuit)
          if (q.upper_circuit_limit && q.last_price >= q.upper_circuit_limit * 0.985) {
            nearCircuit++;
          }
        });

        // 3. Composite Market Health Score Calculation (B.3.3)
        // Formula balances: Advance/Decline (40%), Volume Surge (30%), Days High (20%), Near Circuit (10%)
        const total = validStocksCount || 1;
        const advScore = (advances / total) * 100;
        const volScore = (aboveAvgVol / total) * 100;
        const highScore = (atDaysHigh / total) * 100;
        const circScore = (nearCircuit / total) * 100;
        
        // Weighted composite score (0 - 100)
        // Normalize and scale to reflect market state
        const composite = Math.round(
          (advScore * 0.4) + 
          (volScore * 0.3) + 
          (highScore * 2.0) + // Give high momentum higher weightage
          (circScore * 5.0)
        );
        const healthScore = Math.min(100, Math.max(0, composite));

        setMetrics({
          advanceCount: advances,
          declineCount: declines,
          aboveAvgVolCount: aboveAvgVol,
          atDaysHighCount: atDaysHigh,
          atDaysLowCount: atDaysLow,
          nearCircuitCount: nearCircuit,
          healthScore
        });

        const meta = (quotes as any)._cache_meta;
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
      console.error('Error fetching market breadth:', err);
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
        await fetchBreadthData();
        scheduleNext();
      }, delay);
    };

    fetchBreadthData();
    scheduleNext();

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchBreadthData();
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
  }, [fetchBreadthData]);

  const getHealthColor = (score: number) => {
    if (score >= 70) return { text: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', glow: 'shadow-emerald-500/10' };
    if (score <= 40) return { text: 'text-rose-400', border: 'border-rose-500/30', bg: 'bg-rose-500/10', glow: 'shadow-rose-500/10' };
    return { text: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/10', glow: 'shadow-amber-500/10' };
  };

  if (loading || !metrics) {
    return (
      <div className="h-64 bg-slate-900/30 rounded-xl border border-slate-900 animate-pulse flex items-center justify-center">
        <span className="text-xs text-slate-500 font-mono">Calculating Market Breadth...</span>
      </div>
    );
  }

  const health = getHealthColor(metrics.healthScore);
  const totalStocks = metrics.advanceCount + metrics.declineCount || 1;
  const advPercentage = Math.round((metrics.advanceCount / totalStocks) * 100);

  return (
    <div className="bg-slate-950/20 border border-slate-900 rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-900 pb-3">
        <div className="flex items-center gap-2">
          <BarChart2 size={16} className="text-indigo-400" />
          <h3 className="text-xs font-black text-slate-400 tracking-wider uppercase">Market Breadth Signal</h3>
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && <DataFreshnessTag fetchedAt={lastFetched} source={source} />}
          <button 
            onClick={fetchBreadthData} 
            className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-500 hover:text-white transition-colors"
          >
            <RefreshCw size={10} />
          </button>
        </div>
      </div>

      {/* Health Score Gauge / Visual (B.3.3) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
        <div className="flex flex-col items-center justify-center p-4 bg-slate-900/30 border border-slate-900 rounded-lg relative overflow-hidden text-center">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Market Health</span>
          <span className={`text-4xl font-black font-mono tracking-tighter ${health.text}`}>
            {metrics.healthScore}
          </span>
          <span className={`text-[10px] font-black mt-2 px-2 py-0.5 rounded border ${health.text} ${health.border} ${health.bg}`}>
            {metrics.healthScore >= 70 ? 'STRONG BULLISH' : 
             metrics.healthScore <= 40 ? 'BEARISH PRESSURE' : 
             'RANGE-BOUND'}
          </span>
        </div>

        {/* Advance/Decline Ratio & Bars (B.3.2) */}
        <div className="md:col-span-2 space-y-3 font-mono">
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-400 font-sans uppercase font-black text-[10px] tracking-wider">Advances / Declines</span>
              <span className="text-white font-bold">{metrics.advanceCount} / {metrics.declineCount} ({advPercentage}%)</span>
            </div>
            <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden flex">
              <div className="h-full bg-emerald-500" style={{ width: `${advPercentage}%` }} />
              <div className="h-full bg-rose-500" style={{ width: `${100 - advPercentage}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="bg-slate-900/30 border border-slate-900 p-2.5 rounded flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Volume2 size={12} className="text-slate-500" />
                <span className="text-[10px] text-slate-400 font-sans uppercase font-bold tracking-wider">Volume Spikes</span>
              </div>
              <span className="text-xs font-black text-slate-200">{metrics.aboveAvgVolCount}</span>
            </div>

            <div className="bg-slate-900/30 border border-slate-900 p-2.5 rounded flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Zap size={12} className="text-slate-500" />
                <span className="text-[10px] text-slate-400 font-sans uppercase font-bold tracking-wider">At Day's High</span>
              </div>
              <span className="text-xs font-black text-slate-200">{metrics.atDaysHighCount}</span>
            </div>

            <div className="bg-slate-900/30 border border-slate-900 p-2.5 rounded flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <ShieldAlert size={12} className="text-slate-500" />
                <span className="text-[10px] text-slate-400 font-sans uppercase font-bold tracking-wider">Near Circuit</span>
              </div>
              <span className="text-xs font-black text-amber-400">{metrics.nearCircuitCount}</span>
            </div>

            <div className="bg-slate-900/30 border border-slate-900 p-2.5 rounded flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <TrendingDown size={12} className="text-slate-500" />
                <span className="text-[10px] text-slate-400 font-sans uppercase font-bold tracking-wider">At Day's Low</span>
              </div>
              <span className="text-xs font-black text-rose-400">{metrics.atDaysLowCount}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default MarketBreadthPanel;
