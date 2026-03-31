import React, { useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { formatCurrency } from '../../utils/helpers';
import { MonteCarloResult } from '../../services/backtester/MonteCarloSimulator';
import { Dices, AlertTriangle, Target, ShieldAlert } from 'lucide-react';

interface MonteCarloChartProps {
  result: MonteCarloResult;
}

export const MonteCarloChart: React.FC<MonteCarloChartProps> = ({ result }) => {
  
  const chartData = useMemo(() => {
    if (!result || !result.paths || result.paths.length === 0) return [];
    
    const numTrades = result.paths[0].length;
    const formattedData = [];

    // Pivot array of arrays into array of objects for Recharts
    for (let i = 0; i < numTrades; i++) {
      const point: any = { tradeNumber: i };
      result.paths.forEach((path, pathIdx) => {
        point[`path_${pathIdx}`] = path[i];
      });
      formattedData.push(point);
    }
    return formattedData;
  }, [result]);

  if (!result || !result.paths || result.paths.length === 0) return null;

  return (
    <div className="flex flex-col h-full relative overflow-hidden p-6">
      {/* Background Watermark */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[150px] text-slate-800/10 pointer-events-none">
        <Dices />
      </div>

      <div className="flex items-center justify-between mb-6 relative z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-fuchsia-500/10 rounded-xl">
            <Dices className="text-fuchsia-400" size={20} />
          </div>
          <div>
            <h3 className="text-sm font-black text-white uppercase tracking-widest">Monte Carlo Stress Test</h3>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">1,000 Randomized Permutations</p>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="text-right">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">5th Percentile (Worst)</p>
            <p className="text-xs font-black text-rose-400">{formatCurrency(result.percentile5th)}</p>
          </div>
          <div className="text-right border-l border-slate-800 pl-4">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Risk of Ruin (-50%)</p>
            <p className="text-xs font-black text-amber-400 flex items-center gap-1 justify-end">
              {result.riskOfRuin > 0 && <AlertTriangle size={12} />}
              {result.riskOfRuin.toFixed(1)}%
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-[300px] relative z-10">
        <SafeChartContainer>
          <LineChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.3} />
            <XAxis 
              dataKey="tradeNumber" 
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              minTickGap={30}
              tickFormatter={(val) => `Trade ${val}`}
            />
            <YAxis 
              domain={['dataMin - 1000', 'auto']} 
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val) => `₹${(val/1000).toFixed(0)}k`}
              width={50}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px' }}
              itemStyle={{ display: 'none' }}
              labelStyle={{ color: '#94a3b8', fontSize: '12px', fontWeight: 'bold' }}
              formatter={() => null} // Hide the massive list of 50 paths in tooltip
              labelFormatter={(label) => `Trade #${label}`}
            />
            
            {/* Render all the randomized paths as translucent thin lines */}
            {result.paths.map((_, idx) => (
              <Line 
                key={`path_${idx}`}
                type="monotone" 
                dataKey={`path_${idx}`} 
                stroke="#d946ef" // Fuchsia color
                strokeWidth={1}
                dot={false}
                strokeOpacity={0.08} 
                isAnimationActive={false} // Disable animation for performance with 50 lines
              />
            ))}
          </LineChart>
        </SafeChartContainer>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-800 relative z-10">
        <div className="flex items-center gap-2">
          <ShieldAlert className="text-slate-500" size={14} />
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
            If this was pure luck, the fuchsia lines would drop below the start line.
          </span>
        </div>
      </div>
    </div>
  );
};
