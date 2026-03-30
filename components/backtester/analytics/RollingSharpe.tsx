import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { Activity } from 'lucide-react';
import { SimulatedTrade } from '../../../types/backtester.types';

interface RollingSharpeProps {
  trades: SimulatedTrade[];
}

export const RollingSharpe: React.FC<RollingSharpeProps> = ({ trades }) => {
  const chartData = useMemo(() => {
    if (trades.length < 20) return [];

    const windowSize = 20;
    const rollingData = [];

    for (let i = windowSize; i <= trades.length; i++) {
      const windowTrades = trades.slice(i - windowSize, i);
      const returns = windowTrades.map(t => t.netPnL / t.capitalAtRisk);
      
      const avgReturn = returns.reduce((a, b) => a + b, 0) / windowSize;
      const variance = returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / windowSize;
      const stdDev = Math.sqrt(variance);
      
      // Scaling factor: sqrt of trades per year (assuming 252)
      const annualizationFactor = Math.sqrt(252); 
      const sharpe = stdDev > 0 ? (avgReturn / stdDev) * annualizationFactor : 0;

      rollingData.push({
        tradeIdx: i,
        sharpe: parseFloat(sharpe.toFixed(2))
      });
    }

    return rollingData;
  }, [trades]);

  return (
    <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 shadow-xl h-[300px] flex flex-col">
      <h4 className="text-xs font-black text-slate-300 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
        <Activity size={14} className="text-indigo-400" /> Rolling Sharpe Ratio (20-Trade)
      </h4>
      <div className="flex-1">
        <SafeChartContainer>
          <LineChart data={chartData} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
            <XAxis 
              dataKey="tradeIdx" 
              tick={{ fill: '#64748b', fontSize: 8, fontWeight: 'bold' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis 
              tick={{ fill: '#64748b', fontSize: 8, fontWeight: 'bold' }}
              axisLine={false}
              tickLine={false}
              domain={['auto', 'auto']}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}
              itemStyle={{ color: '#f8fafc', fontWeight: 'bold', fontSize: '10px' }}
              labelStyle={{ color: '#94a3b8', fontSize: '10px', marginBottom: '4px' }}
              formatter={(value: any) => [value, 'Sharpe']}
            />
            <ReferenceLine y={1} stroke="#64748b" strokeDasharray="3 3" />
            <Line 
              type="monotone" 
              dataKey="sharpe" 
              stroke="#6366f1" 
              strokeWidth={2} 
              dot={false}
              animationDuration={1500}
            />
          </LineChart>
        </SafeChartContainer>
      </div>
    </div>
  );
};
