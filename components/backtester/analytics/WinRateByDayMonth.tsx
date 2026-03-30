import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid } from 'recharts';
import { Calendar } from 'lucide-react';
import { SimulatedTrade } from '../../../types/backtester.types';

interface WinRateByDayMonthProps {
  trades: SimulatedTrade[];
}

export const WinRateByDayMonth: React.FC<WinRateByDayMonthProps> = ({ trades }) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const dayData = useMemo(() => {
    const stats = days.map(d => ({ name: d, wins: 0, total: 0 }));
    trades.forEach(t => {
      const dayIdx = new Date(t.date).getDay();
      stats[dayIdx].total++;
      if (t.netPnL > 0) stats[dayIdx].wins++;
    });
    return stats.filter(s => s.total > 0).map(s => ({
      name: s.name,
      winRate: parseFloat(((s.wins / s.total) * 100).toFixed(1))
    }));
  }, [trades]);

  const monthData = useMemo(() => {
    const stats = months.map(m => ({ name: m, wins: 0, total: 0 }));
    trades.forEach(t => {
      const monthIdx = new Date(t.date).getMonth();
      stats[monthIdx].total++;
      if (t.netPnL > 0) stats[monthIdx].wins++;
    });
    return stats.map(s => ({
      name: s.name,
      winRate: s.total > 0 ? parseFloat(((s.wins / s.total) * 100).toFixed(1)) : 0
    }));
  }, [trades]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 shadow-xl h-[280px] flex flex-col">
        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
          <Calendar size={12} className="text-indigo-400" /> Win Rate by Weekday (%)
        </h4>
        <div className="flex-1">
          <SafeChartContainer>
            <BarChart data={dayData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.1} />
              <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 9, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 9, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
              <Tooltip 
                cursor={{ fill: '#1e293b', opacity: 0.4 }}
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}
                itemStyle={{ color: '#f8fafc', fontWeight: 'bold', fontSize: '11px' }}
                formatter={(val: any) => [`${val}%`, 'Win Rate']}
              />
              <Bar dataKey="winRate" radius={[6, 6, 0, 0]} fill="#6366f1" fillOpacity={0.6} />
            </BarChart>
          </SafeChartContainer>
        </div>
      </div>

      <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 shadow-xl h-[280px] flex flex-col">
        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
          <Calendar size={12} className="text-purple-400" /> Win Rate by Month (%)
        </h4>
        <div className="flex-1">
          <SafeChartContainer>
            <BarChart data={monthData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.1} />
              <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 9, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 9, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
              <Tooltip 
                cursor={{ fill: '#1e293b', opacity: 0.4 }}
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}
                itemStyle={{ color: '#f8fafc', fontWeight: 'bold', fontSize: '11px' }}
                formatter={(val: any) => [`${val}%`, 'Win Rate']}
              />
              <Bar dataKey="winRate" radius={[6, 6, 0, 0]} fill="#a855f7" fillOpacity={0.6} />
            </BarChart>
          </SafeChartContainer>
        </div>
      </div>
    </div>
  );
};
