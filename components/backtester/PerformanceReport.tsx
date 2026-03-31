import React from 'react';
import { BacktestMetrics } from '../../types/backtester.types';
import { formatCurrency } from '../../utils/helpers';
import { TrendingUp, TrendingDown, Target, Activity, Zap, ShieldAlert, BarChart2 } from 'lucide-react';

interface PerformanceReportProps {
  metrics: BacktestMetrics;
}

interface MetricCardProps {
  title: string;
  value: string;
  subtext?: string;
  icon: React.ElementType;
  trend?: 'up' | 'down' | 'neutral';
}

export const PerformanceReport: React.FC<PerformanceReportProps> = ({ metrics }) => {
  if (!metrics) return null;

  const MetricCard = ({ title, value, subtext, icon: Icon, trend }: MetricCardProps) => (
    <div className="bg-slate-900/40 rounded-2xl p-5 border border-slate-800 flex flex-col justify-between h-full">
      <div className="flex justify-between items-start mb-4">
        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{title}</h4>
        <div className={`p-1.5 rounded-lg ${trend === 'up' ? 'bg-emerald-500/10 text-emerald-400' : trend === 'down' ? 'bg-rose-500/10 text-rose-400' : 'bg-indigo-500/10 text-indigo-400'}`}>
          <Icon size={14} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <p className={`text-xl font-black truncate ${trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-rose-400' : 'text-white'}`} title={value}>
          {value}
        </p>
        {subtext && <p className="text-[9px] text-slate-500 font-bold uppercase tracking-tight truncate" title={subtext}>{subtext}</p>}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4">
      <MetricCard 
        title="Net Profit" 
        value={formatCurrency(metrics.netProfit)} 
        subtext={`${metrics.totalReturnPercent.toFixed(2)}% ROI`}
        icon={metrics.netProfit >= 0 ? TrendingUp : TrendingDown}
        trend={metrics.netProfit >= 0 ? 'up' : 'down'}
      />
      <MetricCard 
        title="Win Rate" 
        value={`${(metrics.winRate * 100).toFixed(1)}%`} 
        subtext={`${metrics.winningTrades}W / ${metrics.losingTrades}L`}
        icon={Target}
        trend={metrics.winRate >= 0.5 ? 'up' : 'down'}
      />
      <MetricCard 
        title="Max Drawdown" 
        value={`${(metrics.maxDrawdownPercent * 100).toFixed(2)}%`} 
        subtext={formatCurrency(metrics.maxDrawdownAmount)}
        icon={ShieldAlert}
        trend="down"
      />
      <MetricCard 
        title="Expectancy" 
        value={formatCurrency(metrics.expectancy)} 
        subtext="Avg Trade P&L"
        icon={Zap}
        trend={metrics.expectancy > 0 ? 'up' : 'down'}
      />
      
      <MetricCard 
        title="Sharpe" 
        value={metrics.sharpeRatio.toFixed(2)} 
        subtext="Risk Adjusted"
        icon={Activity}
        trend={metrics.sharpeRatio > 1 ? 'up' : 'neutral'}
      />
      <MetricCard 
        title="Sortino" 
        value={metrics.sortinoRatio.toFixed(2)} 
        subtext="Downside Risk"
        icon={Activity}
        trend={metrics.sortinoRatio > 1.5 ? 'up' : 'neutral'}
      />
      <MetricCard 
        title="Profit Factor" 
        value={metrics.profitFactor.toFixed(2)} 
        subtext="Win/Loss Ratio"
        icon={BarChart2}
        trend={metrics.profitFactor > 1.5 ? 'up' : 'neutral'}
      />
      <MetricCard 
        title="Taxes & Fees" 
        value={formatCurrency(metrics.totalBrokeragePaid)} 
        subtext="Total Leakage"
        icon={TrendingDown}
        trend="down"
      />
      {/*
        T6.4 — THE "ML FIT TEST" CARD IS GONE.

        It read:
          value   = fitResult?.isOverfit ? 'OVERFIT' : 'VALID EDGE'
          subtext = fitResult ? `p-value: ${(fitResult.pValue ?? 0.02)}` : 'Permutations 500'
          trend   = fitResult?.isOverfit ? 'down' : 'up'

        With no `fitResult` present, all three resolved to the PASSING branch: the
        card rendered "VALID EDGE", printed a p-value of 0.020 that no test had
        produced, and drew an upward trend arrow. It could not display a red
        state and it manufactured the evidence for the green one.

        Its replacement is `FalsificationGatePanel`, which renders ten gates
        computed by the engine -- including Bonferroni and Deflated Sharpe --
        each of which can fail, and which shows "not yet scored" rather than a
        verdict when nothing has been evaluated.
      */}
    </div>
  );
};
