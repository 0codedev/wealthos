import React, { useEffect, useState } from 'react';
import { liquidityService, LiquidityAlertResult, PreTradeCostResult } from '../../../services/LiquidityService';
import { Droplets, ShieldCheck, AlertTriangle, ShieldAlert, DollarSign } from 'lucide-react';

interface LiquidityMonitorPanelProps {
  symbol?: string;
}

export const LiquidityMonitorPanel: React.FC<LiquidityMonitorPanelProps> = ({ symbol = 'NIFTY' }) => {
  const [alert, setAlert] = useState<LiquidityAlertResult | null>(null);
  const [cost, setCost] = useState<PreTradeCostResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      liquidityService.getAlert(symbol),
      liquidityService.getPreTradeCost({
        symbol,
        trade_size_shares: 500,
        current_price: 24000,
        current_adv: 5000000,
        ann_volatility: 0.20,
      }),
    ]).then(([alertData, costData]) => {
      setAlert(alertData);
      setCost(costData);
      setIsLoading(false);
    });
  }, [symbol]);

  if (isLoading) {
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

  const isNormal = alert?.alert_level === 'NORMAL';
  const isCaution = alert?.alert_level === 'L1_CAUTION';
  const isHigh = alert?.alert_level === 'L2_HIGH';
  const isCritical = alert?.alert_level === 'L3_CRITICAL';

  const badgeColor = isNormal
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : isCaution
    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    : 'bg-rose-500/15 text-rose-400 border-rose-500/30';

  return (
    <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-xl shadow-xl flex flex-col gap-4">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-800/60 pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-cyan-500/10 text-cyan-400 rounded-xl border border-cyan-500/20">
            <Droplets size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide">Liquidity & Market Impact Monitor</h3>
            <p className="text-[10px] text-slate-400">
              Amihud Illiquidity Ratio · Kyle √ Law Impact · Entry Gate Check 8 ({symbol})
            </p>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-xl text-xs font-black tracking-wider border uppercase ${badgeColor}`}>
          {alert?.alert_level.replace('_', ' ') || 'NORMAL'}
        </span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Entry Gate Check 8 */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Entry Gate Check 8</span>
          <div className="flex items-center justify-between mt-1">
            <span className={`text-lg font-black ${isNormal ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isNormal ? 'PASSED (Normal)' : 'BLOCKED (Illiquid)'}
            </span>
            {isNormal ? <ShieldCheck size={18} className="text-emerald-400" /> : <ShieldAlert size={18} className="text-rose-400" />}
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">
            Amihud Ratio vs 95th Percentile Limit
          </span>
        </div>

        {/* Pre-trade Market Impact */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Pre-Trade Impact (bps)</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-black text-cyan-400">
              {cost?.impact?.blended_bps != null ? `${cost.impact.blended_bps.toFixed(1)} bps` : '--'}
            </span>
            <span className="text-xs font-bold text-slate-400">
              {cost?.impact?.cost_inr != null ? `₹${cost.impact.cost_inr.toLocaleString('en-IN')}` : '--'}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">
            Kyle √ Law 60/40 Huber blended estimate
          </span>
        </div>

        {/* Execution Strategy */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Execution Protocol</span>
          <div className="text-xs font-bold text-white mt-1.5 leading-snug">
            {cost?.execution_strategy || 'SINGLE ORDER'}
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">
            Optimal routing for minimum slippage
          </span>
        </div>
      </div>
    </div>
  );
};
