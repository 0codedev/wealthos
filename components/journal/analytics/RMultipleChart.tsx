import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell, Legend } from 'recharts';
import { TrendingUp, Info } from 'lucide-react';
import { Trade } from '../../../database';
import { CustomTooltip } from '../../shared/CustomTooltip';

interface RMultipleChartProps {
  trades: Trade[];
  isVisible?: boolean;
}

export const RMultipleChart = React.memo(({ trades, isVisible = true }: RMultipleChartProps) => {
  const { data, stats } = useMemo(() => {
    // Only trades with a stop loss can have an R-Multiple
    const rTrades = trades
      .filter(t => t.exitPrice !== undefined && t.stopLoss !== undefined && t.stopLoss !== t.entryPrice)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (rTrades.length === 0) return { data: [], stats: null };

    const rValues: number[] = [];
    const chartData = rTrades.map((t, index) => {
      let rMultiple = 0;
      if (t.direction === 'Long') {
        const risk = t.entryPrice - t.stopLoss!;
        const reward = t.exitPrice - t.entryPrice;
        rMultiple = risk !== 0 ? reward / risk : 0;
      } else {
        const risk = t.stopLoss! - t.entryPrice;
        const reward = t.entryPrice - t.exitPrice;
        rMultiple = risk !== 0 ? reward / risk : 0;
      }

      // Limit extreme outliers (e.g. risking 1 cent and making 100)
      if (rMultiple > 20) rMultiple = 20;
      if (rMultiple < -10) rMultiple = -10;

      // Keep calculating rolling average of last 10 trades
      const windowSize = 10;
      const startIndex = Math.max(0, index - windowSize + 1);
      const recentTrades = rTrades.slice(startIndex, index + 1);

      let sumRecentR = 0;
      recentTrades.forEach(rt => {
         let r = 0;
         if (rt.direction === 'Long') r = (rt.exitPrice - rt.entryPrice) / (rt.entryPrice - rt.stopLoss!);
         else r = (rt.entryPrice - rt.exitPrice) / (rt.stopLoss! - rt.entryPrice);
         if (r > 20) r = 20; if (r < -10) r = -10;
         sumRecentR += r;
      });

      const avgR = sumRecentR / recentTrades.length;
      rValues.push(rMultiple);

      return {
        tradeId: t.id,
        ticker: t.ticker,
        date: new Date(t.date).toLocaleDateString(),
        r: Number(rMultiple.toFixed(2)),
        avgR: Number(avgR.toFixed(2))
      };
    });

    // Compute stats
    const total = rValues.length;
    const wins = rValues.filter(r => r >= 0);
    const losses = rValues.filter(r => r < 0);
    const winRate = total > 0 ? (wins.length / total) * 100 : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, r) => s + r, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, r) => s + r, 0) / losses.length) : 0;
    const expectancy = (winRate / 100 * avgWin) - ((1 - winRate / 100) * avgLoss);
    const mean = rValues.reduce((s, r) => s + r, 0) / total;
    const stdDevR = Math.sqrt(rValues.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / total);
    const sqn = stdDevR > 0 ? expectancy / stdDevR * Math.sqrt(total) : 0;
    let sqnLabel = 'POOR';
    let sqnColor = 'rose';
    if (sqn > 3) { sqnLabel = 'EXCELLENT'; sqnColor = 'emerald'; }
    else if (sqn > 2) { sqnLabel = 'GOOD'; sqnColor = 'amber'; }

    return {
      data: chartData,
      stats: { winRate, avgWin, avgLoss, expectancy, sqn, sqnLabel, sqnColor }
    };
  }, [trades]);

  if (data.length === 0 || !stats) return null;

  return (
    <div className="p-6 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl overflow-hidden relative group">
      <div className="flex items-center justify-between mb-6 relative z-10">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-sky-400" />
            The Risk-Adjusted Truth (R-Multiple)
          </h3>
          <p className="text-sm text-gray-400 flex items-center gap-1 mt-1">
            Tracking your true risk-adjusted performance
            <span title="Bars show R-Multiple per trade (Risk = 1R). Line is 10-trade rolling average. A rising line above 1.5R means statistical long-term profitability.">
              <Info className="w-3.5 h-3.5 text-gray-500 hover:text-sky-400 cursor-help transition-colors" />
            </span>
          </p>
        </div>
      </div>

      {/* Expectancy + SQN Stats */}
      <div className="flex gap-3 flex-wrap mb-6 relative z-10">
        <div className="bg-slate-800/50 rounded-xl px-4 py-2 border border-white/5">
          <p className="text-[9px] uppercase font-black tracking-widest text-slate-500 mb-0.5">Win Rate</p>
          <p className={`text-sm font-black ${stats.winRate > 55 ? 'text-emerald-400' : stats.winRate >= 40 ? 'text-amber-400' : 'text-rose-400'}`}>
            {stats.winRate.toFixed(1)}%
          </p>
        </div>
        <div className="bg-slate-800/50 rounded-xl px-4 py-2 border border-white/5">
          <p className="text-[9px] uppercase font-black tracking-widest text-slate-500 mb-0.5">Avg Win R</p>
          <p className="text-sm font-black text-emerald-400">+{stats.avgWin.toFixed(2)}R</p>
        </div>
        <div className="bg-slate-800/50 rounded-xl px-4 py-2 border border-white/5">
          <p className="text-[9px] uppercase font-black tracking-widest text-slate-500 mb-0.5">Avg Loss R</p>
          <p className="text-sm font-black text-rose-400">-{stats.avgLoss.toFixed(2)}R</p>
        </div>
        <div className="bg-slate-800/50 rounded-xl px-4 py-2 border border-white/5">
          <p className="text-[9px] uppercase font-black tracking-widest text-slate-500 mb-0.5">Expectancy</p>
          <p className="text-sm font-black text-white">
            <span className={stats.expectancy >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {stats.expectancy >= 0 ? '(+)' : '(-)'}
            </span>
            {Math.abs(stats.expectancy).toFixed(2)}R
          </p>
        </div>
        <div className="bg-slate-800/50 rounded-xl px-4 py-2 border border-white/5">
          <p className="text-[9px] uppercase font-black tracking-widest text-slate-500 mb-0.5">SQN</p>
          <div className="flex items-center gap-2">
            <p className="text-sm font-black text-white">{stats.sqn.toFixed(1)}</p>
            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-${stats.sqnColor}-500/20 text-${stats.sqnColor}-400`}>
              {stats.sqnLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="h-[350px] w-full relative z-10" style={{ contain: 'layout paint' }}>
        <SafeChartContainer>
          <ComposedChart data={data} margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis 
              dataKey="date" 
              stroke="#666" 
              tick={{ fill: '#888', fontSize: 11 }}
              tickFormatter={(val) => val.split('/')[0] + '/' + val.split('/')[1]} // MM/DD
            />
            
            <YAxis 
              stroke="#666" 
              tick={{ fill: '#888', fontSize: 11 }}
              domain={['auto', 'auto']}
              label={{ value: 'R-Multiple (Units of Risk)', angle: -90, position: 'insideLeft', fill: '#666', fontSize: 12 }}
            />
            
            <Tooltip
              cursor={{ fill: 'transparent' }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const d = payload[0].payload;
                  const barWidth = Math.min(Math.abs(d.r) / 5 * 100, 100);
                  return (
                    <div className="bg-slate-950/95 backdrop-blur-md border border-slate-700/50 p-3 rounded-xl shadow-2xl ring-1 ring-white/10">
                      <p className="text-white font-bold text-sm">{d.ticker}</p>
                      <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-2">{d.date}</p>
                      <div className="flex items-center justify-between gap-4 text-xs">
                        <span className="text-slate-400">R-Multiple</span>
                        <span className={`font-mono font-bold ${d.r >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          ({d.r > 0 ? '+' : ''}{d.r}R)
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4 text-xs">
                        <span className="text-slate-400">Rolling Avg</span>
                        <span className="text-sky-400 font-mono font-bold">{d.avgR}R</span>
                      </div>
                      <div className={`mt-2 h-1 rounded ${d.r >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${barWidth}%`, maxWidth: 120 }} />
                    </div>
                  );
                }
                return null;
              }}
            />
            
            <Legend wrapperStyle={{ fontSize: '12px', color: '#999' }} />
            
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
            <ReferenceLine y={1} stroke="rgba(52,211,153,0.2)" strokeDasharray="3 3" />
            <ReferenceLine y={2} stroke="rgba(52,211,153,0.2)" strokeDasharray="4 4" label={{ value: '2R Edge', position: 'right', fill: '#34d399', fontSize: 10 }} />
            
            <Bar dataKey="r" name="Trade R" radius={[4, 4, 0, 0]} isAnimationActive={isVisible}>
              {data.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.r >= 0 ? '#10b981' : '#f43f5e'} 
                  fillOpacity={0.6}
                />
              ))}
            </Bar>
            <Line 
              type="monotone" 
              dataKey="avgR" 
              name="10-Trade Average" 
              stroke="#0ea5e9" 
              strokeWidth={3} 
              dot={false}
              isAnimationActive={isVisible}
            />
          </ComposedChart>
        </SafeChartContainer>
      </div>
    </div>
  );
});
