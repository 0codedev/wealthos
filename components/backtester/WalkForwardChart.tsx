import React, { useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceLine } from 'recharts';
import { WalkForwardResult } from '../../services/backtester/WalkForwardOptimizer';
import { formatCurrency } from '../../utils/helpers';
import { FastForward, ShieldCheck, AlertOctagon } from 'lucide-react';

interface WalkForwardChartProps {
  result: WalkForwardResult;
}

export const WalkForwardChart: React.FC<WalkForwardChartProps> = ({ result }) => {
  
  const chartData = useMemo(() => {
    if (!result || !result.windows) return [];
    
    return result.windows.map(w => ({
      name: w.id,
      netProfit: w.metrics.netProfit,
      winRate: w.metrics.winRate * 100,
      trades: w.tradeCount,
      startDate: new Date(w.startDate).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
      endDate: new Date(w.endDate).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
    }));
  }, [result]);

  if (!result || result.windows.length === 0) return null;

  const isRobust = result.robustnessScore >= 80; // 80% of windows profitable

  return (
    <div className="flex flex-col h-full p-6">
      
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 rounded-xl">
            <FastForward className="text-amber-400" size={20} />
          </div>
          <div>
            <h3 className="text-sm font-black text-white uppercase tracking-widest">Walk-Forward Robustness</h3>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Market Regime Consistency</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Robustness Score</p>
            <div className={`flex items-center gap-1 justify-end ${isRobust ? 'text-emerald-400' : 'text-amber-400'}`}>
              {isRobust ? <ShieldCheck size={14} /> : <AlertOctagon size={14} />}
              <span className="text-lg font-black">{result.robustnessScore.toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-[250px]">
        <SafeChartContainer>
          <BarChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.3} />
            <XAxis 
              dataKey="name" 
              tick={{ fill: '#64748b', fontSize: 10, fontWeight: 'bold' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis 
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val) => `₹${(val/1000).toFixed(0)}k`}
              width={50}
            />
            <Tooltip 
              cursor={{ fill: '#1e293b', opacity: 0.4 }}
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}
              itemStyle={{ fontWeight: 'bold', color: '#f8fafc' }}
              labelStyle={{ color: '#94a3b8', fontSize: '10px', textTransform: 'uppercase', marginBottom: '4px' }}
              formatter={(value: any, name: any) => {
                if (name === 'netProfit') return [formatCurrency(value || 0), 'Net Profit'];
                return [value, name];
              }}
              labelFormatter={(label, payload) => {
                if (payload && payload.length > 0) {
                  const data = payload[0].payload;
                  return `${label} (${data.startDate} - ${data.endDate}) | ${data.trades} Trades`;
                }
                return label;
              }}
            />
            <ReferenceLine y={0} stroke="#334155" strokeWidth={2} />
            <Bar dataKey="netProfit" radius={[4, 4, 4, 4]}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.netProfit >= 0 ? '#34d399' : '#fb7185'} />
              ))}
            </Bar>
          </BarChart>
        </SafeChartContainer>
      </div>
      
      <div className="mt-4 pt-4 border-t border-slate-800">
        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest text-center">
          {isRobust 
            ? "✅ Strategy maintains its edge across different market environments." 
            : "⚠️ Strategy is curve-fitted to specific market conditions. Expect failure in live markets."}
        </p>
      </div>

    </div>
  );
};
