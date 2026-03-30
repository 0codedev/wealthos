import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart2, TrendingUp, Target, Zap, Clock, ShieldAlert, Layers, Shield } from 'lucide-react';
import { BacktestResult } from '../../types/backtester.types';
import { formatCurrency } from '../../utils/helpers';
import { MonthlyPnLHeatmap } from './analytics/MonthlyPnLHeatmap';
import { ReturnDistribution } from './analytics/ReturnDistribution';
import { RollingSharpe } from './analytics/RollingSharpe';
import { WinRateByDayMonth } from './analytics/WinRateByDayMonth';
import { StreakTracker } from './analytics/StreakTracker';
import { IVSurfaceChart } from './analytics/IVSurfaceChart';
import { MaxPainHistoryChart } from './analytics/MaxPainHistoryChart';

interface AdvancedAnalyticsProps {
  result: BacktestResult;
}

export const AdvancedAnalytics: React.FC<AdvancedAnalyticsProps> = ({ result }) => {
  const isOptions = result.config.strategy.assetClass === 'Options';
  const [activeSubTab, setActiveSubTab] = useState<'DIAGNOSTICS' | 'IV_SURFACE' | 'MAX_PAIN'>('DIAGNOSTICS');
  const underlying = result.config.strategy.ticker || 'NIFTY';

  return (
    <div className="space-y-8 mt-12 pb-20">
      {/* Title & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
            <TrendingUp className="text-indigo-400" size={20} />
          </div>
          <div>
            <h3 className="text-lg font-black text-white uppercase tracking-widest">Deep Edge Analysis</h3>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest italic">Quant-level performance breakdown & behavioral audit</p>
          </div>
        </div>

        {/* Conditional Sub-navigation for Options Strategies */}
        {isOptions && (
          <div className="flex bg-slate-950/50 p-1 rounded-lg border border-slate-800/50 self-start sm:self-auto">
            <button
              onClick={() => setActiveSubTab('DIAGNOSTICS')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all ${
                activeSubTab === 'DIAGNOSTICS'
                  ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                  : 'text-slate-500 hover:text-white'
              }`}
            >
              <BarChart2 size={13} />
              <span className="text-[9px] font-black uppercase tracking-wider">Diagnostics</span>
            </button>
            <button
              onClick={() => setActiveSubTab('IV_SURFACE')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all ${
                activeSubTab === 'IV_SURFACE'
                  ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                  : 'text-slate-500 hover:text-white'
              }`}
            >
              <Layers size={13} />
              <span className="text-[9px] font-black uppercase tracking-wider">IV Surface</span>
            </button>
            <button
              onClick={() => setActiveSubTab('MAX_PAIN')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all ${
                activeSubTab === 'MAX_PAIN'
                  ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                  : 'text-slate-500 hover:text-white'
              }`}
            >
              <Shield size={13} />
              <span className="text-[9px] font-black uppercase tracking-wider">Max Pain</span>
            </button>
          </div>
        )}
      </div>

      {/* Render selected sub-tab */}
      {activeSubTab === 'DIAGNOSTICS' && (
        <div className="grid grid-cols-1 xl:grid-cols-1 gap-8">
          {/* Row 1: Streak Tracker */}
          <StreakTracker trades={result.trades} />

          {/* Row 2: Heatmap */}
          <MonthlyPnLHeatmap trades={result.trades} initialCapital={result.metrics.initialCapital} />
          
          {/* Row 3: Main Charts Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-2">
              <WinRateByDayMonth trades={result.trades} />
            </div>
            <div className="xl:col-span-1">
               <ReturnDistribution trades={result.trades} />
            </div>
          </div>

          {/* Row 4: Sharpe & Velocity */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
             <div className="xl:col-span-2">
                <RollingSharpe trades={result.trades} />
             </div>
             <div className="xl:col-span-1">
                <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 shadow-xl h-full flex flex-col justify-between">
                   <h4 className="text-xs font-black text-slate-300 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                     <Zap size={14} className="text-amber-400" /> Performance Velocity
                   </h4>
                   <div className="grid grid-cols-2 gap-4 flex-1">
                      <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/40 flex flex-col justify-center">
                         <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Profit Factor</p>
                         <p className="text-lg font-black text-white">{result.metrics.profitFactor.toFixed(2)}</p>
                      </div>
                      <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/40 flex flex-col justify-center">
                         <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Expectancy</p>
                         <p className={`text-lg font-black ${result.metrics.expectancy > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(Math.abs(result.metrics.expectancy))}</p>
                      </div>
                      <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/40 flex flex-col justify-center">
                         <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Recovery Factor</p>
                         <p className="text-lg font-black text-white">{result.metrics.recoveryFactor.toFixed(2)}</p>
                      </div>
                      <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/40 flex flex-col justify-center">
                         <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Max Consecutive Wins</p>
                         <p className="text-lg font-black text-emerald-400">{result.metrics.maxConsecutiveWins}</p>
                      </div>
                   </div>
                </div>
             </div>
          </div>

          {/* Row 5: Institutional Health Panels */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
             <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 flex items-center gap-4 hover:border-indigo-500/30 transition-all cursor-default group">
                <div className="p-3 bg-indigo-500/10 rounded-2xl group-hover:scale-110 transition-transform">
                   <ShieldAlert className="text-indigo-400" size={24} />
                </div>
                <div>
                   <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Value-at-Risk (VaR 95%)</h5>
                   <p className="text-xl font-black text-white italic">{result.metrics.valueAtRisk95.toFixed(2)}%</p>
                   <p className="text-[8px] font-bold text-slate-600 uppercase tracking-tighter">95% Confidence max loss</p>
                </div>
             </div>
             <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 flex items-center gap-4 hover:border-rose-500/30 transition-all cursor-default group">
                <div className="p-3 bg-rose-500/10 rounded-2xl group-hover:scale-110 transition-transform">
                   <ShieldAlert className="text-rose-400" size={24} />
                </div>
                <div>
                   <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Conditional VaR (CVaR)</h5>
                   <p className="text-xl font-black text-rose-400 italic">{result.metrics.conditionalVaR.toFixed(2)}%</p>
                   <p className="text-[8px] font-bold text-slate-600 uppercase tracking-tighter">Expected shortfall in tail scenarios</p>
                </div>
             </div>
             <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 flex items-center gap-4 hover:border-emerald-500/30 transition-all cursor-default group">
                <div className="p-3 bg-emerald-500/10 rounded-2xl group-hover:scale-110 transition-transform">
                   <Zap className="text-emerald-400" size={24} />
                </div>
                <div>
                   <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Kelly Criterion (Optimal Size)</h5>
                   <p className="text-xl font-black text-emerald-400 italic">
                     {((result.metrics.winRate * result.metrics.payoffRatio - (1 - result.metrics.winRate)) / (result.metrics.payoffRatio || 1) * 100).toFixed(1)}%
                   </p>
                   <p className="text-[8px] font-bold text-slate-600 uppercase tracking-tighter">Maximum risk efficiency threshold</p>
                </div>
             </div>
          </div>
        </div>
      )}

      {activeSubTab === 'IV_SURFACE' && (
        <IVSurfaceChart underlying={underlying} />
      )}

      {activeSubTab === 'MAX_PAIN' && (
        <MaxPainHistoryChart underlying={underlying} />
      )}
    </div>
  );
};
