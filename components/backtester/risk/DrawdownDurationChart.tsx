import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid } from 'recharts';
import { ShieldAlert } from 'lucide-react';
import { DrawdownPoint } from '../../../types/backtester.types';

interface DrawdownDurationChartProps {
  data: DrawdownPoint[];
}

export const DrawdownDurationChart: React.FC<DrawdownDurationChartProps> = ({ data }) => {
  const episodes = useMemo(() => {
    const results: { start: string; maxDepth: number; duration: number }[] = [];
    let currentEpisode: { start: string; maxDepth: number; duration: number } | null = null;
    
    data.forEach((p, i) => {
      if (p.drawdown > 0) {
        if (!currentEpisode) {
          currentEpisode = { start: p.date, maxDepth: p.drawdown, duration: 1 };
        } else {
          currentEpisode.maxDepth = Math.max(currentEpisode.maxDepth, p.drawdown);
          currentEpisode.duration++;
        }
      } else if (currentEpisode) {
        // Drawdown recovered
        results.push(currentEpisode);
        currentEpisode = null;
      }
    });
    
    if (currentEpisode) results.push(currentEpisode);

    // Sort by duration and take top 10
    return results
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10)
      .map(e => ({
        date: new Date(e.start).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
        duration: e.duration,
        depth: parseFloat(e.maxDepth.toFixed(2))
      }));
  }, [data]);

  return (
    <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 shadow-xl h-full flex flex-col">
      <h4 className="text-xs font-black text-slate-300 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
        <ShieldAlert size={14} className="text-rose-400" /> Major Drawdown Duration (Days)
      </h4>
      <div className="flex-1">
        <SafeChartContainer>
          <BarChart data={episodes} layout="vertical" margin={{ top: 0, right: 30, left: 40, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#334155" opacity={0.1} />
            <XAxis type="number" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis 
              type="category" 
              dataKey="date" 
              tick={{ fill: '#94a3b8', fontSize: 9, fontWeight: 'black' }} 
              axisLine={false} 
              tickLine={false} 
            />
            <Tooltip 
              cursor={{ fill: '#1e293b', opacity: 0.4 }}
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px' }}
              itemStyle={{ color: '#fb7185', fontWeight: 'bold', fontSize: '11px' }}
              formatter={(val: any, name: any, props: any) => [
                `${val} Days (Depth: ${props.payload.depth}%)`, 
                'Duration'
              ]}
            />
            <Bar dataKey="duration" radius={[0, 4, 4, 0]} fill="#f43f5e" fillOpacity={0.6}>
              {episodes.map((entry, index) => (
                <Cell key={`cell-${index}`} fillOpacity={0.4 + (entry.depth / 20)} />
              ))}
            </Bar>
          </BarChart>
        </SafeChartContainer>
      </div>
    </div>
  );
};
