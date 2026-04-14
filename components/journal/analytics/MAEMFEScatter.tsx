import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from 'recharts';
import { Target, Info } from 'lucide-react';
import { Trade } from '../../../database';

interface MAEMFEScatterProps {
  trades: Trade[];
  isVisible?: boolean;
}

export const MAEMFEScatter = React.memo(({ trades, isVisible = true }: MAEMFEScatterProps) => {
  const data = useMemo(() => {
    return trades
      .filter(t => t.exitPrice) // ensure closed trades
      .map(t => {
        // Calculate or estimate MAE/MFE if not explicitly provided
        // MAE is usually negative or zero. MFE is positive or zero.
        let mfe = t.mfe;
        let mae = t.mae;

        if (mfe === undefined || mae === undefined) {
          const priceDiff = t.direction === 'Long' 
            ? t.exitPrice - t.entryPrice 
            : t.entryPrice - t.exitPrice;
          
          mfe = Math.max(priceDiff * t.quantity, 0);
          mae = Math.min(priceDiff * t.quantity, 0); // Very basic estimation if missing
          // If we had a stop loss and price diff is positive, mae could be 0, or we could estimate it brushed against stop
        }

        return {
          id: t.id,
          ticker: t.ticker,
          date: new Date(t.date).toLocaleDateString(),
          mfe: Number(mfe?.toFixed(2) || 0),
          mae: Number(mae?.toFixed(2) || 0),
          pnl: t.pnl || 0,
          direction: t.direction
        };
      })
      .filter(d => d.mfe !== 0 || d.mae !== 0); // Hide trades with exactly zero for both (likely incomplete data)
  }, [trades]);

  if (data.length === 0) {
    return null;
  }

  const CustomTooltipInner = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-slate-900 border border-white/10 p-3 rounded-2xl shadow-xl">
          <p className="text-white font-bold mb-2">{data.ticker} <span className="text-gray-400 text-[10px] ml-2 font-medium uppercase tracking-widest">{data.date}</span></p>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-4">
               <span className="text-gray-400">MFE (Potential)</span>
               <span className="text-emerald-400 font-mono font-bold">₹{data.mfe.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
               <span className="text-gray-400">MAE (Pain)</span>
               <span className="text-rose-400 font-mono font-bold">₹{data.mae.toLocaleString()}</span>
            </div>
            <div className="h-[1px] bg-white/5 my-1" />
            <div className="flex items-center justify-between gap-4">
               <span className="text-gray-400">Final PnL</span>
               <span className={`font-mono font-bold ${data.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                 ₹{data.pnl.toLocaleString()}
               </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="p-6 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      
      <div className="flex items-center justify-between mb-6 relative z-10">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-indigo-400" />
            MAE / MFE Scatter
          </h3>
          <p className="text-sm text-gray-400 flex items-center gap-1 mt-1">
            Max Adverse Excursion vs Max Favorable Excursion
          <span title="Plots how much pain (MAE, left) vs how much profit potential (MFE, up) each trade experienced.">
            <Info className="w-3.5 h-3.5 text-gray-500 hover:text-indigo-400 cursor-help transition-colors" />
          </span>
          </p>
        </div>
      </div>

      <div className="h-[350px] w-full relative z-10" style={{ contain: 'layout paint' }}>
        <SafeChartContainer>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis 
              type="number" 
              dataKey="mae" 
              name="MAE" 
              stroke="#666" 
              tick={{ fill: '#888', fontSize: 12 }}
              domain={['auto', 'auto']}
              tickFormatter={(val) => `₹${val}`}
              label={{ value: 'Max Adverse Excursion (Pain)', position: 'bottom', fill: '#666', fontSize: 12 }}
            />
            <YAxis 
              type="number" 
              dataKey="mfe" 
              name="MFE" 
              stroke="#666" 
              tick={{ fill: '#888', fontSize: 12 }}
              domain={[0, 'auto']}
              tickFormatter={(val) => `₹${val}`}
              label={{ value: 'Max Favorable Excursion (Potential)', angle: -90, position: 'left', fill: '#666', fontSize: 12 }}
            />
            <Tooltip content={<CustomTooltipInner />} cursor={{ strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.2)' }} />
            
            <ReferenceLine x={0} stroke="rgba(255,255,255,0.2)" />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />

            <Scatter name="Trades" data={data} isAnimationActive={isVisible}>
              {data.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.pnl >= 0 ? '#34d399' : '#fb7185'} 
                  opacity={0.7}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </SafeChartContainer>
      </div>
      
      {/* Quadrant Helpers */}
      <div className="absolute top-20 right-6 text-xs text-white/30 font-medium tracking-wider pointer-events-none">PERFECT EXECUTIONS</div>
      <div className="absolute bottom-20 left-20 text-xs text-white/30 font-medium tracking-wider pointer-events-none">POOR EXECUTIONS</div>
    </div>
  );
});
