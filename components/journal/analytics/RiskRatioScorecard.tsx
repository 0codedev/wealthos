import React, { useMemo } from 'react';
import { Trade } from '../../../database';
import { ShieldCheck, Activity, BarChart3, Maximize, TrendingUp, TrendingDown, Scale } from 'lucide-react';
import { formatCurrency } from '../../../utils/helpers';
import { useSettingsStore } from '../../../store/settingsStore';

interface RiskRatioScorecardProps {
  trades: Trade[];
  isVisible?: boolean;
}

/**
 * Mathematically hardened risk & performance scorecard.
 *
 * All metrics are guarded against division-by-zero. Capped at 99.99 to
 * keep the visual bounded when a metric is effectively infinite.
 */
export const RiskRatioScorecard = React.memo(({ trades }: RiskRatioScorecardProps) => {
  const designPreset = useSettingsStore((s) => s.designPreset);
  const isAstryx = designPreset === 'astryx';
  const isReui = designPreset === 'reui-nova' || designPreset === 'shadcn';
  const metrics = useMemo(() => {
    const closedTrades = trades.filter(t => t.exitPrice !== undefined);
    if (closedTrades.length === 0) return null;

    let grossWin = 0;
    let grossLoss = 0;
    let totalPnL = 0;
    let winningTradesCount = 0;
    let losingTradesCount = 0;

    closedTrades.forEach(t => {
      const pnl = t.pnl || 0;
      totalPnL += pnl;
      if (pnl > 0) {
        grossWin += pnl;
        winningTradesCount++;
      } else if (pnl < 0) {
        grossLoss += Math.abs(pnl);
        losingTradesCount++;
      }
    });

    const total = closedTrades.length;

    // --- Edge-safe Profit Factor ---
    // Gross Win / Gross Loss. Cap to 99.99 if no losses (infinite).
    const rawProfitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
    const profitFactor = Number.isFinite(rawProfitFactor) ? Math.min(rawProfitFactor, 99.99) : 99.99;

    // --- Edge-safe Expectancy (₹ per trade) ---
    const winRate = winningTradesCount / total;
    const lossRate = losingTradesCount / total;
    const avgWin = winningTradesCount > 0 ? grossWin / winningTradesCount : 0;
    const avgLoss = losingTradesCount > 0 ? grossLoss / losingTradesCount : 0;
    const expectancy = (winRate * avgWin) - (lossRate * avgLoss);

    // --- Edge-safe Sharpe Ratio (per-trade, not annualized) ---
    const meanPnL = totalPnL / total;
    const variance = closedTrades.reduce((acc, t) => acc + Math.pow((t.pnl || 0) - meanPnL, 2), 0) / total;
    const stdDevPnL = Math.sqrt(variance) || 1; // guard 1 if std dev is 0
    const rawSharpe = meanPnL / stdDevPnL;
    const sharpeRatio = Math.max(-99.99, Math.min(99.99, rawSharpe));

    // --- Edge-safe Sortino Ratio ---
    const negativePnls = closedTrades.map(t => t.pnl || 0).filter(p => p < 0);
    let downsideDeviation = 1;
    if (negativePnls.length > 0) {
      const downsideMean = negativePnls.reduce((s, p) => s + p, 0) / negativePnls.length;
      const downsideVariance = negativePnls.reduce((acc, p) => acc + Math.pow(p - downsideMean, 2), 0) / negativePnls.length;
      downsideDeviation = Math.sqrt(downsideVariance) || 1;
    }
    const rawSortino = meanPnL / downsideDeviation;
    const sortinoRatio = Math.max(-99.99, Math.min(99.99, rawSortino));

    // --- Edge-safe Gain-to-Pain ---
    const rawGainToPain = grossLoss > 0 ? totalPnL / grossLoss : (totalPnL > 0 ? 99.99 : 0);
    const gainToPain = Math.max(-99.99, Math.min(99.99, rawGainToPain));

    // --- Edge-safe Max Drawdown (running peak-to-trough on cumulative P&L) ---
    let runningPeak = 0;
    let runningPnL = 0;
    let maxDrawdown = 0;
    const sortedTrades = [...closedTrades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    sortedTrades.forEach(t => {
      runningPnL += t.pnl || 0;
      if (runningPnL > runningPeak) runningPeak = runningPnL;
      const dd = runningPeak - runningPnL;
      if (dd > maxDrawdown) maxDrawdown = dd;
    });

    // --- Edge-safe Recovery Factor (Net P&L / |Max DD|) ---
    const rawRecovery = maxDrawdown > 0 ? totalPnL / maxDrawdown : (totalPnL > 0 ? 99.99 : 0);
    const recoveryFactor = Math.max(-99.99, Math.min(99.99, rawRecovery));

    return {
      profitFactor,
      expectancy,
      sharpeRatio,
      sortinoRatio,
      gainToPain,
      recoveryFactor,
      avgWin,
      avgLoss,
      maxDrawdown,
      winRate: winRate * 100,
      totalTrades: total,
    };
  }, [trades]);

  if (!metrics) return null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard isAstryx={isAstryx} isReui={isReui}
          title="Profit Factor"
          value={metrics.profitFactor.toFixed(2)}
          subtitle="Gross Win / Gross Loss"
          icon={<Activity className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />}
          good={metrics.profitFactor >= 1.5}
        />
        <MetricCard isAstryx={isAstryx} isReui={isReui}
          title="Expectancy"
          value={`₹${Math.round(metrics.expectancy).toLocaleString()}`}
          subtitle="Avg Return / Trade"
          icon={<BarChart3 className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />}
          good={metrics.expectancy > 0}
        />
        <MetricCard isAstryx={isAstryx} isReui={isReui}
          title="Recovery Factor"
          value={metrics.recoveryFactor.toFixed(2)}
          subtitle="Net P&L / Max DD"
          icon={<Scale className="w-4 h-4 text-cyan-500 dark:text-cyan-400" />}
          good={metrics.recoveryFactor >= 2}
        />
        <MetricCard isAstryx={isAstryx} isReui={isReui}
          title="Sharpe Ratio"
          value={metrics.sharpeRatio.toFixed(2)}
          subtitle="Return vs Volatility"
          icon={<Maximize className="w-4 h-4 text-amber-500 dark:text-amber-400" />}
          good={metrics.sharpeRatio > 0.15}
        />
        <MetricCard isAstryx={isAstryx} isReui={isReui}
          title="Sortino Ratio"
          value={metrics.sortinoRatio.toFixed(2)}
          subtitle="Return vs Downside"
          icon={<ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />}
          good={metrics.sortinoRatio > metrics.sharpeRatio}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SubMetricCard isAstryx={isAstryx} isReui={isReui}
          title="Avg Win"
          value={`+${formatCurrency(metrics.avgWin)}`}
          icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-500" />}
          tone="emerald"
        />
        <SubMetricCard isAstryx={isAstryx} isReui={isReui}
          title="Avg Loss"
          value={`-${formatCurrency(metrics.avgLoss)}`}
          icon={<TrendingDown className="w-3.5 h-3.5 text-rose-500" />}
          tone="rose"
        />
        <SubMetricCard isAstryx={isAstryx} isReui={isReui}
          title="Max Drawdown"
          value={formatCurrency(metrics.maxDrawdown)}
          icon={<Activity className="w-3.5 h-3.5 text-rose-500" />}
          tone="rose"
        />
        <SubMetricCard isAstryx={isAstryx} isReui={isReui}
          title="Gain to Pain"
          value={metrics.gainToPain.toFixed(2)}
          icon={<BarChart3 className="w-3.5 h-3.5 text-violet-500" />}
          tone="violet"
        />
      </div>
    </div>
  );
});

const MetricCard = ({ title, value, subtitle, icon, good, isAstryx, isReui }: any) => (
  <div className={`p-4 border transition-colors shadow-sm relative overflow-hidden group ${
    isAstryx
      ? "bg-[#1b1b1b] border-white/[0.102] rounded-[12px] font-['Figtree',sans-serif] hover:border-white/20"
      : isReui
        ? "bg-zinc-900 border-zinc-800 rounded-xl font-sans hover:border-zinc-700"
        : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-2xl hover:border-slate-300 dark:hover:border-slate-700 font-sans"
  }`}>
    <div className="flex items-center justify-between mb-2">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{title}</h4>
      {icon}
    </div>
    <p className={`text-2xl font-black tracking-tight ${good ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'}`}>
      {value}
    </p>
    <p className="text-[10px] text-slate-500 dark:text-slate-500 mt-1 uppercase tracking-wide">{subtitle}</p>
    <div className={`absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r ${good ? 'from-emerald-500/50' : 'from-slate-500/20 dark:from-slate-500/50'} to-transparent`} />
  </div>
);

const SubMetricCard = ({ title, value, icon, tone, isAstryx, isReui }: { title: string; value: string; icon: React.ReactNode; tone: 'emerald' | 'rose' | 'violet'; isAstryx?: boolean; isReui?: boolean }) => {
  const toneClasses: Record<string, string> = {
    emerald: isAstryx ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-emerald-500/20 bg-emerald-500/5',
    rose: isAstryx ? 'border-rose-500/30 bg-rose-500/10' : 'border-rose-500/20 bg-rose-500/5',
    violet: isAstryx ? 'border-violet-500/30 bg-violet-500/10' : 'border-violet-500/20 bg-violet-500/5',
  };
  const valueColor: Record<string, string> = {
    emerald: 'text-emerald-400',
    rose: 'text-rose-400',
    violet: 'text-violet-300',
  };
  return (
    <div className={`px-3 py-2.5 border ${toneClasses[tone]} flex items-center justify-between gap-3 ${
      isAstryx ? "rounded-[10px] font-['Figtree',sans-serif]" : isReui ? "rounded-lg font-sans" : "rounded-xl font-sans"
    }`}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {icon}
        {title}
      </div>
      <span className={`text-sm font-black font-mono ${valueColor[tone]}`}>{value}</span>
    </div>
  );
};
