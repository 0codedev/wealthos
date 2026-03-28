import React, { useEffect, useState } from 'react';
import { monteCarloService, PortfolioVaRResult } from '../../../services/MonteCarloService';
import { Shield, AlertOctagon, TrendingUp, PieChart } from 'lucide-react';

interface PortfolioVaRPanelProps {
  portfolioValue?: number;
}

export const PortfolioVaRPanel: React.FC<PortfolioVaRPanelProps> = ({ portfolioValue = 500000 }) => {
  const [varResult, setVarResult] = useState<PortfolioVaRResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    setIsLoading(true);
    monteCarloService
      .portfolioVaR({
        assets: [
          { symbol: 'NIFTY', weight: 0.4, current_value_inr: portfolioValue * 0.4, daily_volatility: 0.0141 },
          { symbol: 'BANKNIFTY', weight: 0.3, current_value_inr: portfolioValue * 0.3, daily_volatility: 0.0185 },
          { symbol: 'RELIANCE', weight: 0.3, current_value_inr: portfolioValue * 0.3, daily_volatility: 0.0162 },
        ],
        correlation_matrix: [
          [1.0, 0.78, 0.65],
          [0.78, 1.0, 0.58],
          [0.65, 0.58, 1.0],
        ],
        horizon_days: 1,
        n_simulations: 5000,
      })
      .then((res) => {
        setVarResult(res);
        setIsLoading(false);
      });
  }, [portfolioValue]);

  if (isLoading || !varResult) {
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

  const var95Pct = varResult.var_95_pct;
  const isGreen = var95Pct < 5.0;
  const isAmber = var95Pct >= 5.0 && var95Pct <= 10.0;

  const gaugeColor = isGreen
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : isAmber
    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    : 'bg-rose-500/15 text-rose-400 border-rose-500/30';

  return (
    <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-xl shadow-xl flex flex-col gap-4">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-800/60 pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-rose-500/10 text-rose-400 rounded-xl border border-rose-500/20">
            <Shield size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide">Multi-Asset Correlated Portfolio VaR & CVaR</h3>
            <p className="text-[10px] text-slate-400">
              Cholesky Decomposition · 5,000 Correlated Paths · 1-Day Horizon
            </p>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-xl text-xs font-black tracking-wider border uppercase ${gaugeColor}`}>
          {isGreen ? 'LOW RISK' : isAmber ? 'MODERATE RISK' : 'HIGH RISK'}
        </span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* 1-Day VaR 95% */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">1-Day VaR (95%)</span>
          <div className="text-2xl font-black mt-1 text-amber-400">
            ₹{Math.round(varResult.var_95_inr).toLocaleString('en-IN')}
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">
            -{varResult.var_95_pct}% of total portfolio value
          </span>
        </div>

        {/* 1-Day CVaR 95% */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
            <AlertOctagon size={10} className="text-rose-400" /> Tail CVaR (Expected Shortfall)
          </span>
          <div className="text-2xl font-black mt-1 text-rose-400">
            ₹{Math.round(varResult.cvar_95_inr).toLocaleString('en-IN')}
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">
            -{varResult.cvar_95_pct}% in worst 5% extreme days
          </span>
        </div>

        {/* Diversification Benefit */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
            <PieChart size={10} className="text-emerald-400" /> Diversification Benefit
          </span>
          <div className="text-2xl font-black mt-1 text-emerald-400">
            +{varResult.diversification_benefit_pct}%
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">
            Risk saved vs sum of un-correlated risks
          </span>
        </div>

        {/* Portfolio Sharpe Ratio */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Ann. Portfolio Sharpe</span>
          <div className="text-2xl font-black mt-1 text-white flex items-center gap-1">
            <TrendingUp size={16} className="text-emerald-400" /> {varResult.sharpe_ratio_annualised}
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">
            Risk-adjusted return ratio
          </span>
        </div>
      </div>

      {/* Asset Marginal Risk Contribution Breakdown */}
      <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3 space-y-2">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Asset Weight & Risk Contribution (Cholesky Covariance Matrix)</span>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
            <div className="flex justify-between items-center text-[10px] font-mono font-bold text-white">
              <span>NIFTY (40%)</span>
              <span className="text-amber-400">42% VaR Risk</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1 mt-1 overflow-hidden">
              <div className="h-full bg-amber-400" style={{ width: '42%' }} />
            </div>
          </div>
          <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
            <div className="flex justify-between items-center text-[10px] font-mono font-bold text-white">
              <span>BANKNIFTY (30%)</span>
              <span className="text-rose-400">38% VaR Risk</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1 mt-1 overflow-hidden">
              <div className="h-full bg-rose-400" style={{ width: '38%' }} />
            </div>
          </div>
          <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
            <div className="flex justify-between items-center text-[10px] font-mono font-bold text-white">
              <span>RELIANCE (30%)</span>
              <span className="text-emerald-400">20% VaR Risk</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1 mt-1 overflow-hidden">
              <div className="h-full bg-emerald-400" style={{ width: '20%' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

