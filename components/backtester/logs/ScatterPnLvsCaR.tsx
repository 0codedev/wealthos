import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, Cell, CartesianGrid } from 'recharts';
import { Activity } from 'lucide-react';
import { SimulatedTrade } from '../../../types/backtester.types';

interface ScatterPnLvsCaRProps {
  trades: SimulatedTrade[];
}

export const ScatterPnLvsCaR: React.FC<ScatterPnLvsCaRProps> = ({ trades }) => {
  const chartData = useMemo(() => {
    return trades.map(t => ({
      x: t.capitalAtRisk,
      y: t.netPnL,
      ticker: t.ticker,
      isPositive: t.netPnL > 0
    }));
  }, [trades]);

  return (
    <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 shadow-xl h-full flex flex-col">
      <h4 className="text-xs font-black text-slate-300 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
        <Activity size={14} className="text-indigo-400" /> PnL vs Capital-at-Risk Scatter
      </h4>
      <div className="flex-1">
        <SafeChartContainer>
          <ScatterChart margin={{ top: 0, right: 20, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={true} stroke="#334155" opacity={0.1} />
            <XAxis 
              type="number" 
              dataKey="x" 
              name="Capital" 
              tick={{ fill: '#64748b', fontSize: 9 }} 
              axisLine={false} 
              tickLine={false}
              label={{ value: 'Capital At Risk (₹)', position: 'insideBottom', offset: -5, fill: '#475569', fontSize: 8, fontWeight: 'bold' }}
            />
            <YAxis 
              type="number" 
              dataKey="y" 
              name="PnL" 
              tick={{ fill: '#64748b', fontSize: 9 }} 
              axisLine={false} 
              tickLine={false}
              label={{ value: 'Net PnL (₹)', angle: -90, position: 'insideLeft', offset: 10, fill: '#475569', fontSize: 8, fontWeight: 'bold' }}
            />
            <ZAxis type="number" range={[40, 40]} />
            <Tooltip 
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}
              itemStyle={{ fontSize: '10px', fontWeight: 'bold', color: '#f8fafc' }}
              formatter={(value: any, name: any) => [name === 'PnL' ? `₹${value?.toLocaleString()}` : `₹${value?.toLocaleString()}`, name]}
            />
            <Scatter name="Trades" data={chartData}>
              {chartData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.isPositive ? '#10b981' : '#f43f5e'} 
                  fillOpacity={0.5}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </SafeChartContainer>
      </div>
    </div>
  );
};
