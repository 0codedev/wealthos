import React, { useEffect, useState } from 'react';
import { monteCarloService, TradeProbabilityResult } from '../../../services/MonteCarloService';
import { Dna, Target, ShieldAlert, TrendingUp, BarChart2 } from 'lucide-react';

interface MonteCarloProbabilityPanelProps {
  symbol?: string;
}

export const MonteCarloProbabilityPanel: React.FC<MonteCarloProbabilityPanelProps> = ({ symbol = 'NIFTY' }) => {
  const [mc, setMc] = useState<TradeProbabilityResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    setIsLoading(true);
    monteCarloService
      .tradeProbability({
        symbol,
        current_price: 24000,
        target_price: 24500,
        stop_loss_price: 23800,
        daily_volatility: 0.0141,
        horizon_days: 10,
        n_simulations: 5000,
      })
      .then((res) => {
        setMc(res);
        setIsLoading(false);
      });
  }, [symbol]);

  if (isLoading || !mc) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 animate-pulse flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-slate-800 rounded-xl w-10 h-10" />
          <div className="space-y-2">
            <div className="h-4 w-36 bg-slate-800 rounded" />
            <div className="h-3 w-56 bg-slate-800/60 rounded" />
          </div>
        </div>
        <div className="h-8 w-28 bg-slate-800 rounded-xl" />
      </div>
    );
  }

  const pTarget = Math.round(mc.p_target_hit_first * 100);
  const pStop = Math.round(mc.p_stop_hit_first * 100);

  return (
    <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-xl shadow-xl flex flex-col gap-4">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-800/60 pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
            <Dna size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide">Monte Carlo First-Passage Probability Engine</h3>
            <p className="text-[10px] text-slate-400">
              5,000 GBM Simulated Price Paths · Blended VIX Volatility ({symbol})
            </p>
          </div>
        </div>
        <span className="px-3 py-1 rounded-xl text-xs font-black tracking-wider border uppercase bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
          {mc.trade_metrics.recommended_position_size}
        </span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* P(Target Hit First) */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
            <Target size={10} className="text-emerald-400" /> P(Target Hit First)
          </span>
          <div className="text-2xl font-black mt-1 text-emerald-400">{pTarget}%</div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
            <div className="h-full bg-emerald-400" style={{ width: `${pTarget}%` }} />
          </div>
        </div>

        {/* P(Stop Hit First) */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
            <ShieldAlert size={10} className="text-rose-400" /> P(Stop Hit First)
          </span>
          <div className="text-2xl font-black mt-1 text-rose-400">{pStop}%</div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
            <div className="h-full bg-rose-400" style={{ width: `${pStop}%` }} />
          </div>
        </div>

        {/* Expected Value % */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Expected Value (EV)</span>
          <div className="text-2xl font-black mt-1 text-white">
            +{mc?.trade_metrics?.expected_value_pct ?? 0}%
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">
            Kelly Fraction: {((mc?.trade_metrics?.kelly_fraction ?? 0) * 100).toFixed(1)}%
          </span>
        </div>

        {/* Price Range Percentiles */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">10-Day Expected Range</span>
          <div className="text-xs font-mono font-bold text-white mt-1">
            ₹{mc?.price_distribution?.percentile_25 != null ? mc.price_distribution.percentile_25.toLocaleString('en-IN') : '0'} - ₹{mc?.price_distribution?.percentile_75 != null ? mc.price_distribution.percentile_75.toLocaleString('en-IN') : '0'}
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">
            50% Interquartile Range (P25 - P75)
          </span>
        </div>
      </div>

      {/* SVG Price Distribution Trajectory Fan Chart */}
      <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3 space-y-2">
        <div className="flex justify-between items-center text-[10px] font-bold uppercase text-slate-500">
          <span>Monte Carlo Simulated Price Trajectory (P5, P25, Median, P75, P95)</span>
          <span className="text-indigo-400 font-mono">10-Day Horizon</span>
        </div>
        <div className="h-20 w-full relative">
          <svg className="w-full h-full" viewBox="0 0 400 80" preserveAspectRatio="none">
            {/* Background 90% Confidence Fan (P5 to P95) */}
            <polygon
              points="0,40 100,32 200,24 300,16 400,8 400,72 300,64 200,56 100,48"
              fill="rgba(99, 102, 241, 0.10)"
            />
            {/* Background 50% Confidence Fan (P25 to P75) */}
            <polygon
              points="0,40 100,36 200,30 300,24 400,18 400,62 300,56 200,50 100,44"
              fill="rgba(99, 102, 241, 0.22)"
            />
            {/* Upper P95 Line (Green) */}
            <polyline
              points="0,40 100,32 200,24 300,16 400,8"
              fill="none"
              stroke="#10b981"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
            {/* Median Path (Solid White) */}
            <polyline
              points="0,40 100,40 200,39 300,38 400,37"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2"
            />
            {/* Lower P5 Line (Red) */}
            <polyline
              points="0,40 100,48 200,56 300,64 400,72"
              fill="none"
              stroke="#f43f5e"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
          </svg>
        </div>
        <div className="flex justify-between items-center text-[9px] font-mono text-slate-400">
          <span className="text-emerald-400">P95: ₹{mc.price_distribution.percentile_95.toLocaleString('en-IN')}</span>
          <span className="text-white font-bold">Median: ₹{mc.price_distribution.median_final.toLocaleString('en-IN')}</span>
          <span className="text-rose-400">P5: ₹{mc.price_distribution.percentile_05.toLocaleString('en-IN')}</span>
        </div>
      </div>
    </div>
  );
};

