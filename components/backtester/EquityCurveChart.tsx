import React from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { formatCurrency } from '../../utils/helpers';

interface EquityCurveChartProps {
  data: { date: string; equity: number }[];
  drawdownData: { date: string; drawdown: number }[];
}

export const EquityCurveChart: React.FC<EquityCurveChartProps> = ({ data, drawdownData }) => {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-slate-900/40 rounded-2xl border border-slate-800">
        <p className="text-slate-500 text-sm font-bold uppercase tracking-widest">No simulation data</p>
      </div>
    );
  }

  // Calculate min and max for better Y-axis scaling
  const minEquity = Math.min(...data.map(d => d.equity));
  const maxEquity = Math.max(...data.map(d => d.equity));
  const yAxisMin = minEquity * 0.95; // 5% padding below

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Main Equity Curve */}
      <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800 flex-1 relative min-h-[300px]">
        <h3 className="text-sm font-black text-white uppercase tracking-widest mb-4">Equity Curve</h3>
        <SafeChartContainer>
          <AreaChart data={data} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.3} />
            <XAxis 
              dataKey="date" 
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              minTickGap={30}
              tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            />
            <YAxis 
              domain={[yAxisMin, 'auto']} 
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val) => `₹${(val/1000).toFixed(0)}k`}
              width={50}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px' }}
              itemStyle={{ color: '#818cf8', fontWeight: 'bold' }}
              labelStyle={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px' }}
              formatter={(value: any) => [formatCurrency(Number(value)), 'Equity']}
              labelFormatter={(label) => new Date(label).toLocaleDateString()}
            />
            <Area 
              type="monotone" 
              dataKey="equity" 
              stroke="#818cf8" 
              strokeWidth={3}
              fillOpacity={1} 
              fill="url(#colorEquity)" 
            />
          </AreaChart>
        </SafeChartContainer>
      </div>

      {/* Underwater Drawdown Chart */}
      <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800 h-48">
         <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Underwater Drawdown (%)</h3>
         <SafeChartContainer>
          <AreaChart data={drawdownData} margin={{ top: 0, right: 0, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="colorDrawdown" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.05}/>
                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.4}/>
              </linearGradient>
            </defs>
            <XAxis hide dataKey="date" />
            <YAxis hide domain={['auto', 0]} reversed />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px', padding: '4px 8px' }}
              itemStyle={{ color: '#fb7185', fontWeight: 'bold', fontSize: '12px' }}
              labelStyle={{ color: '#64748b', fontSize: '10px' }}
              formatter={(value: any) => [`-${Number(value).toFixed(2)}%`, 'Drawdown']}
              labelFormatter={(label) => new Date(label).toLocaleDateString()}
            />
            <Area 
              type="monotone" 
              dataKey="drawdown" 
              stroke="#fb7185" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorDrawdown)" 
              baseLine={0}
            />
          </AreaChart>
        </SafeChartContainer>
      </div>
    </div>
  );
};
