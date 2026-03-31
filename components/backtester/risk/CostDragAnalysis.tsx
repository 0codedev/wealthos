import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { IndianRupee } from 'lucide-react';
import { SimulatedTrade } from '../../../types/backtester.types';

interface CostDragAnalysisProps {
  trades: SimulatedTrade[];
}

export const CostDragAnalysis: React.FC<CostDragAnalysisProps> = ({ trades }) => {
  const chartData = useMemo(() => {
    const years = Array.from(new Set(trades.map(t => new Date(t.date).getFullYear()))).sort();
    
    return years.map(year => {
      const yearTrades = trades.filter(t => new Date(t.date).getFullYear() === year);
      const grossProfit = yearTrades.reduce((acc, t) => acc + (t.grossPnL > 0 ? t.grossPnL : 0), 0);
      const grossLoss = yearTrades.reduce((acc, t) => acc + (t.grossPnL < 0 ? Math.abs(t.grossPnL) : 0), 0);
      const totalCosts = yearTrades.reduce((acc, t) => acc + t.totalCosts, 0);
      const netProfit = yearTrades.reduce((acc, t) => acc + t.netPnL, 0);
      
      return {
        year,
        'Gross Profit': parseFloat((grossProfit/1000).toFixed(1)),
        'Total Costs': parseFloat((totalCosts/1000).toFixed(1)),
        'Net Profit': parseFloat((netProfit/1000).toFixed(1)),
      };
    });
  }, [trades]);

  return (
    <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 shadow-xl h-full flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <h4 className="text-xs font-black text-slate-300 uppercase tracking-[0.2em] flex items-center gap-2">
          <IndianRupee size={14} className="text-emerald-400" /> NSE Cost Drag Analysis (₹k)
        </h4>
      </div>
      <div className="flex-1">
        <SafeChartContainer>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.1} />
            <XAxis dataKey="year" tick={{ fill: '#64748b', fontSize: 10, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#64748b', fontSize: 10, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
            <Tooltip 
              cursor={{ fill: '#1e293b', opacity: 0.4 }}
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px' }}
              itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', paddingTop: '20px' }} />
            <Bar dataKey="Gross Profit" stackId="a" fill="#10b981" fillOpacity={0.6} radius={[4, 4, 0, 0]} />
            <Bar dataKey="Total Costs" stackId="a" fill="#f43f5e" fillOpacity={0.6} radius={[4, 4, 0, 0]} />
            <Bar dataKey="Net Profit" fill="#6366f1" fillOpacity={0.8} radius={[4, 4, 0, 0]} />
          </BarChart>
        </SafeChartContainer>
      </div>
    </div>
  );
};
