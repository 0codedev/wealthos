import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { BrainCircuit, Info } from 'lucide-react';
import { Trade } from '../../../database';
import { CustomTooltip } from '../../shared/CustomTooltip';

interface ConvictionAnalyzerProps {
  trades: Trade[];
  isVisible?: boolean;
}

export const ConvictionAnalyzer = React.memo(({ trades, isVisible = true }: ConvictionAnalyzerProps) => {
  const data = useMemo(() => {
    // Group by Conviction Level (1-10)
    const convictionMap = new Map<number, { count: number, totalPnL: number }>();
    
    // Initialize 1-10 to ensure x-axis exists even if empty (optional, but good for UX)
    for(let i=1; i<=10; i++) {
        convictionMap.set(i, { count: 0, totalPnL: 0 });
    }

    let hasData = false;

    trades.forEach(t => {
      // Assuming convictionLevel is a number 1-10. If not, map or skip.
      const level = Number(t.convictionLevel);
      if (level >= 1 && level <= 10 && t.exitPrice !== undefined && t.pnl !== undefined) {
        hasData = true;
        const current = convictionMap.get(level)!;
        current.count++;
        current.totalPnL += t.pnl;
      }
    });

    if (!hasData) return [];

    return Array.from(convictionMap.entries())
      .map(([level, stats]) => ({
        level: `Level ${level}`,
        rawLevel: level,
        count: stats.count,
        avgPnL: stats.count > 0 ? Number((stats.totalPnL / stats.count).toFixed(2)) : null
      }))
      .sort((a, b) => a.rawLevel - b.rawLevel);
  }, [trades]);

  if (data.length === 0) return null;

  return (
    <div className="p-6 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl overflow-hidden relative group opacity-90 hover:opacity-100 transition-opacity duration-300">
      <div className="flex items-center justify-between mb-6 relative z-10">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-yellow-400" />
            The Certainty Trap (Conviction)
          </h3>
          <p className="text-sm text-gray-400 flex items-center gap-1 mt-1">
            Does high conviction actually equal high PnL?
            <span title="Bars show how many trades you took at each conviction level. Line shows the average PnL for those trades.">
              <Info className="w-3.5 h-3.5 text-gray-500 hover:text-yellow-400 cursor-help transition-colors" />
            </span>
          </p>
        </div>
      </div>

      <div className="h-[300px] w-full relative z-10" style={{ contain: 'layout' }}>
        <SafeChartContainer>
          <ComposedChart data={data} margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis 
              dataKey="level" 
              stroke="#666" 
              tick={{ fill: '#888', fontSize: 11 }}
            />
            
            {/* Left Y Axis for Bar (Volume) */}
            <YAxis 
              yAxisId="left" 
              stroke="#666" 
              tick={{ fill: '#888', fontSize: 11 }}
              label={{ value: '# of Trades', angle: -90, position: 'insideLeft', fill: '#666', fontSize: 12 }}
            />
            
            {/* Right Y Axis for Line (Price) */}
            <YAxis 
              yAxisId="right" 
              orientation="right" 
              stroke="#666" 
              tick={{ fill: '#888', fontSize: 11 }}
              tickFormatter={(val) => `₹${val}`}
              label={{ value: 'Avg PnL', angle: 90, position: 'insideRight', fill: '#666', fontSize: 12 }}
            />
            
            <Tooltip
              cursor={{ fill: 'transparent' }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-slate-900 border border-white/10 p-3 rounded-2xl shadow-xl min-w-[140px]">
                      <p className="text-white font-bold mb-2 border-b border-white/10 pb-2 text-sm">{data.level}</p>
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-4">
                           <span className="text-gray-400">Trade Volume</span>
                           <span className="text-indigo-400 font-mono font-bold tracking-tight">{data.count}</span>
                        </div>
                        {data.avgPnL !== null && (
                            <div className="flex items-center justify-between gap-4">
                               <span className="text-gray-400">Average PnL</span>
                               <span className={`font-mono font-bold ${data.avgPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                 ₹{data.avgPnL.toLocaleString()}
                               </span>
                            </div>
                        )}
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            
            <Legend wrapperStyle={{ fontSize: '12px', color: '#999' }} />
            
            <Bar yAxisId="left" dataKey="count" name="Trade Volume" fill="#4f46e5" radius={[4, 4, 0, 0]} barSize={30} fillOpacity={0.4} isAnimationActive={isVisible} />
            <Line yAxisId="right" type="monotone" dataKey="avgPnL" name="Avg PnL" stroke="#facc15" strokeWidth={3} dot={{ r: 4, fill: '#facc15' }} connectNulls={false} isAnimationActive={isVisible} />
          </ComposedChart>
        </SafeChartContainer>
      </div>
    </div>
  );
});
