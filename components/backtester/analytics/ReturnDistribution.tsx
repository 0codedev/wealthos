import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { Target } from 'lucide-react';
import { SimulatedTrade } from '../../../types/backtester.types';

interface ReturnDistributionProps {
  trades: SimulatedTrade[];
}

export const ReturnDistribution: React.FC<ReturnDistributionProps> = ({ trades }) => {
  const chartData = useMemo(() => {
    if (trades.length === 0) return [];

    // Calculate PnL distribution buckets
    const pnls = trades.map(t => t.netPnL);
    const minPnL = Math.min(...pnls);
    const maxPnL = Math.max(...pnls);
    
    // Create 10 buckets
    const bucketCount = 10;
    const range = maxPnL - minPnL;
    const bucketSize = range / bucketCount;
    
    const buckets = Array(bucketCount).fill(0).map((_, i) => ({
      min: minPnL + (i * bucketSize),
      max: minPnL + ((i + 1) * bucketSize),
      count: 0,
      label: ''
    }));

    trades.forEach(trade => {
      const bucketIdx = Math.min(Math.floor((trade.netPnL - minPnL) / bucketSize), bucketCount - 1);
      buckets[bucketIdx].count++;
    });

    return buckets.map(b => ({
      name: `₹${(b.min/1000).toFixed(1)}k`,
      count: b.count,
      isPositive: (b.min + b.max) / 2 > 0
    }));
  }, [trades]);

  return (
    <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 shadow-xl h-[300px] flex flex-col">
      <h4 className="text-xs font-black text-slate-300 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
        <Target size={14} className="text-indigo-400" /> Return Distribution
      </h4>
      <div className="flex-1">
        <SafeChartContainer>
          <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <XAxis 
              dataKey="name" 
              tick={{ fill: '#64748b', fontSize: 8, fontWeight: 'bold' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis 
              tick={{ fill: '#64748b', fontSize: 8, fontWeight: 'bold' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip 
              cursor={{ fill: '#1e293b', opacity: 0.4 }}
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}
              itemStyle={{ color: '#f8fafc', fontWeight: 'bold', fontSize: '10px' }}
              labelStyle={{ color: '#94a3b8', fontSize: '10px', marginBottom: '4px' }}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.isPositive ? '#10b981' : '#f43f5e'} 
                  fillOpacity={0.6}
                />
              ))}
            </Bar>
          </BarChart>
        </SafeChartContainer>
      </div>
    </div>
  );
};
