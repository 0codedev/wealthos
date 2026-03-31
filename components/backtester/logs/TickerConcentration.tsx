import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { Target } from 'lucide-react';
import { SimulatedTrade } from '../../../types/backtester.types';

interface TickerConcentrationProps {
  trades: SimulatedTrade[];
}

const COLORS = ['#6366f1', '#a855f7', '#10b981', '#f59e0b', '#f43f5e', '#06b6d4'];

export const TickerConcentration: React.FC<TickerConcentrationProps> = ({ trades }) => {
  const chartData = useMemo(() => {
    const stats: Record<string, number> = {};
    trades.forEach(t => {
      stats[t.ticker] = (stats[t.ticker] || 0) + Math.abs(t.netPnL);
    });

    return Object.entries(stats)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [trades]);

  return (
    <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 shadow-xl h-full flex flex-col">
      <h4 className="text-xs font-black text-slate-300 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
        <Target size={14} className="text-indigo-400" /> Ticker Volatility Concentration
      </h4>
      <div className="flex-1">
        <SafeChartContainer>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              paddingAngle={5}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
              ))}
            </Pie>
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}
              itemStyle={{ fontSize: '10px', fontWeight: 'bold', color: '#f8fafc' }}
            />
            <Legend verticalAlign="bottom" align="center" iconType="circle" wrapperStyle={{ fontSize: '9px', fontWeight: 'bold', paddingTop: '10px' }} />
          </PieChart>
        </SafeChartContainer>
      </div>
    </div>
  );
};
