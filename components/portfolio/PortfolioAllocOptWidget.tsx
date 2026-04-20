import React, { useMemo } from 'react';
import { ShieldCheck, PieChart } from 'lucide-react';
import { PortfolioOptimizer, AssetReturnSeries } from '../../services/ml/PortfolioOptimizer';

interface PortfolioAllocOptWidgetProps {
  assets?: { symbol: string; currentWeight: number; returns: number[] }[];
}

const DEFAULT_DEMO_ASSETS: { symbol: string; currentWeight: number; returns: number[] }[] = [
  { symbol: 'EQUITY (NIFTY)', currentWeight: 0.50, returns: [0.012, -0.008, 0.015, -0.005, 0.02, -0.01] },
  { symbol: 'MUTUAL FUNDS', currentWeight: 0.25, returns: [0.005, -0.003, 0.006, -0.002, 0.008, -0.004] },
  { symbol: 'GOLD (ETF)', currentWeight: 0.15, returns: [-0.002, 0.004, -0.001, 0.006, -0.003, 0.005] },
  { symbol: 'LIQUID CASH', currentWeight: 0.10, returns: [0.0002, 0.0002, 0.0002, 0.0002, 0.0002, 0.0002] }
];

export const PortfolioAllocOptWidget: React.FC<PortfolioAllocOptWidgetProps> = ({ assets = DEFAULT_DEMO_ASSETS }) => {
  const optimizationResult = useMemo(() => {
    const returnSeries: AssetReturnSeries[] = assets.map(a => ({
      symbol: a.symbol,
      returns: a.returns
    }));
    return PortfolioOptimizer.optimize(returnSeries);
  }, [assets]);

  return (
    <div className="bg-slate-900/60 backdrop-blur-xl border border-indigo-500/20 rounded-2xl p-5 space-y-4 shadow-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-indigo-500/10 rounded-xl text-indigo-400">
            <PieChart className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
              Portfolio DNA Optimizer
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase tracking-wider">
                Domain 2 ML
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">Minimum Variance & Risk Parity Allocation</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-mono font-bold text-emerald-400 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            Vol: {(optimizationResult.expectedVol * 100).toFixed(2)}%
          </div>
          <div className="text-[9px] text-slate-500 font-semibold uppercase">Expected Volatility</div>
        </div>
      </div>

      <div className="space-y-2.5 pt-1">
        {assets.map(asset => {
          const mlWeight = optimizationResult.weights[asset.symbol] ?? asset.currentWeight;
          const diff = mlWeight - asset.currentWeight;

          return (
            <div key={asset.symbol} className="bg-white/5 border border-white/5 rounded-xl p-3 flex items-center justify-between text-xs">
              <div className="space-y-0.5">
                <span className="font-bold text-slate-200">{asset.symbol}</span>
                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                  <span>Current: {(asset.currentWeight * 100).toFixed(0)}%</span>
                  <span>→</span>
                  <span className="text-indigo-300 font-bold">ML Target: {(mlWeight * 100).toFixed(0)}%</span>
                </div>
              </div>

              <div className="text-right">
                <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-md ${
                  diff > 0.01 
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                    : diff < -0.01 
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      : 'bg-slate-800 text-slate-400'
                }`}>
                  {diff > 0 ? `+${(diff * 100).toFixed(0)}% (BUY)` : diff < 0 ? `${(diff * 100).toFixed(0)}% (REDUCE)` : 'HOLD'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PortfolioAllocOptWidget;
