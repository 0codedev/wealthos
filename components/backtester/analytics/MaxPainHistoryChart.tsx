import React, { useState, useEffect } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { HelpCircle, Shield, Award, Activity } from 'lucide-react';

interface MaxPainHistoryChartProps {
  underlying: string;
}

export const MaxPainHistoryChart: React.FC<MaxPainHistoryChartProps> = ({ underlying }) => {
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [viewAll, setViewAll] = useState<boolean>(false);
  const [count, setCount] = useState<number>(12);

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(
          `/api/python-nse/api/backtest/max-pain-history?underlying=${encodeURIComponent(
            underlying
          )}&count=${count}&view_all=${viewAll}`
        );
        if (!response.ok) {
          throw new Error('Failed to load Max Pain history.');
        }
        const data = await response.json();
        setHistoryData(data.history || []);
      } catch (err: unknown) {
        console.error(err);
        const message = err instanceof Error ? err.message : String(err);
        setError(message || 'Failed to load Max Pain historical data.');
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [underlying, count, viewAll]);

  // Compute metrics: % of expiries closing within 1% of Max Pain
  const stats = React.useMemo(() => {
    if (historyData.length === 0) return { within1Pct: 0, avgGap: 0, total: 0 };
    const closeMatches = historyData.filter(d => Math.abs(d.gapPercent) <= 1.0).length;
    const avgAbsGap = historyData.reduce((acc, d) => acc + Math.abs(d.gapPercent), 0) / historyData.length;
    return {
      within1Pct: Math.round((closeMatches / historyData.length) * 100),
      avgGap: avgAbsGap.toFixed(2),
      total: historyData.length
    };
  }, [historyData]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-slate-900/40 rounded-3xl border border-slate-800/60 min-h-[400px]">
        <HelpCircle size={48} className="text-slate-600 mb-4 animate-bounce" />
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest text-center">{error}</p>
      </div>
    );
  }

  if (loading || historyData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-slate-900/40 rounded-3xl border border-slate-800/60 min-h-[400px]">
        <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-4" />
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] animate-pulse">
          Computing Max Pain Expiry Settlements...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Expiry / Filter Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-950/40 p-6 rounded-2xl border border-slate-800/50">
        <div>
          <h4 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2">
            <Shield size={14} className="text-indigo-400" />
            Historical Max Pain Settlement Analysis
          </h4>
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">
            Tracks closing price alignment against option writer maximum loss strikes
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Type</span>
            <button
              onClick={() => setViewAll(false)}
              className={`px-3 py-1 text-[10px] font-bold rounded-lg transition-all ${
                !viewAll ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-500 hover:text-white'
              }`}
            >
              Monthly Only
            </button>
            <button
              onClick={() => setViewAll(true)}
              className={`px-3 py-1 text-[10px] font-bold rounded-lg transition-all ${
                viewAll ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-500 hover:text-white'
              }`}
            >
              All (Inc. Weekly)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="lookback-select"
              className="text-[9px] font-black text-slate-400 uppercase tracking-widest cursor-pointer"
            >
              Lookback
            </label>
            <select
              id="lookback-select"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors"
            >
              <option value={6}>Last 6 Expiries</option>
              <option value={12}>Last 12 Expiries</option>
              <option value={24}>Last 24 Expiries</option>
            </select>
          </div>
        </div>
      </div>

      {/* Summary Indicator Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/60 backdrop-blur-md flex items-center gap-4">
          <div className="p-3 bg-emerald-500/10 rounded-2xl">
            <Award size={20} className="text-emerald-400" />
          </div>
          <div>
            <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">Settlement Alignment</span>
            <span className="text-xl font-black text-white italic tracking-tighter block mt-0.5">
              {stats.within1Pct}% within 1%
            </span>
          </div>
        </div>

        <div className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/60 backdrop-blur-md flex items-center gap-4">
          <div className="p-3 bg-indigo-500/10 rounded-2xl">
            <Activity size={20} className="text-indigo-400" />
          </div>
          <div>
            <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">Average Deviation</span>
            <span className="text-xl font-black text-white italic tracking-tighter block mt-0.5">
              {stats.avgGap}% absolute gap
            </span>
          </div>
        </div>

        <div className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/60 backdrop-blur-md flex items-center gap-4">
          <div className="p-3 bg-pink-500/10 rounded-2xl">
            <Shield size={20} className="text-pink-400" />
          </div>
          <div>
            <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">Total Cycles Audited</span>
            <span className="text-xl font-black text-white italic tracking-tighter block mt-0.5">
              {stats.total} Expiry settlements
            </span>
          </div>
        </div>
      </div>

      {/* Dual Axis Line & step chart */}
      <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-6 md:p-8 flex flex-col gap-6">
        <div className="h-[400px]">
          <SafeChartContainer>
            <ComposedChart data={historyData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.3} />
              <XAxis
                dataKey="expiry"
                tick={{ fill: '#64748b', fontSize: 9, fontWeight: 'bold' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fill: '#64748b', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(val) => val.toLocaleString('en-IN')}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '16px', padding: '12px' }}
                labelFormatter={(label) => `Expiry: ${new Date(label).toLocaleDateString('en-IN')}`}
              />
              <Legend verticalAlign="top" height={36} iconType="circle" />
              <Line
                name="Index Close Price"
                type="monotone"
                dataKey="actualClose"
                stroke="#6366f1"
                strokeWidth={3}
                dot={{ r: 4, strokeWidth: 2, fill: '#0f172a' }}
              />
              <Line
                name="Max Pain Strike"
                type="stepAfter"
                dataKey="maxPain"
                stroke="#fb7185"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ r: 3, fill: '#fb7185' }}
              />
            </ComposedChart>
          </SafeChartContainer>
        </div>

        {/* Deviation Gap Bar Chart */}
        <div className="h-[180px]">
          <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">
            Settlement Gap Deviation (%)
          </h5>
          <SafeChartContainer>
            <ComposedChart data={historyData} margin={{ top: 0, right: 10, left: 10, bottom: 5 }}>
              <XAxis dataKey="expiry" hide />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 9 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(val) => `${val}%`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', padding: '8px' }}
                formatter={(value: any) => [`${Number(value).toFixed(2)}%`, 'Gap']}
              />
              <Bar
                name="Percentage Gap"
                dataKey="gapPercent"
                radius={[4, 4, 0, 0]}
                fill="#34d399"
              />
            </ComposedChart>
          </SafeChartContainer>
        </div>
      </div>
    </div>
  );
};
