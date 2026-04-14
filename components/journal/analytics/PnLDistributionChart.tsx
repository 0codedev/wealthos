import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine } from 'recharts';
import { AlignCenterVertical, Info } from 'lucide-react';
import { Trade } from '../../../database';

interface PnLDistributionChartProps {
  trades: Trade[];
  isVisible?: boolean;
}

export const PnLDistributionChart = React.memo(({ trades, isVisible = true }: PnLDistributionChartProps) => {
  const data = useMemo(() => {
    const pnls = trades.filter(t => t.exitPrice !== undefined && t.pnl !== undefined).map(t => t.pnl!);
    if (pnls.length === 0) return [];

    const maxAbs = Math.max(...pnls.map(Math.abs));
    if (maxAbs === 0) return [];

    // Simple binning logic, targeting ~10-14 bins
    let roughStep = maxAbs / 5;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep || 1)));
    let step = Math.ceil(roughStep / magnitude) * magnitude;
    if (step === 0) step = 100;

    const binCount = Math.ceil(maxAbs / step);
    const bins: { min: number, max: number, label: string, count: number, isPositive: boolean, midpoint: number }[] = [];

    // Create symmetrical bins from negative to positive
    for (let i = -binCount; i <= binCount; i++) {
        const minDate = i * step;
        const maxDate = (i + 1) * step;
        
        // Format labels nicely
        const formatLabel = (val: number) => {
            if (val === 0) return '0';
            if (Math.abs(val) >= 1000) return `${val / 1000}k`;
            return val.toString();
        };

        bins.push({
            min: minDate,
            max: maxDate,
            label: `${formatLabel(minDate)} to ${formatLabel(maxDate)}`,
            count: 0,
            isPositive: minDate >= 0, // 0 to step is positive bin
            midpoint: minDate + (step / 2) // for gradient/coloring logic
        });
    }

    // Assign to bins
    pnls.forEach(pnl => {
        if (bins.length === 0) return;
        const bin = bins.find(b => pnl >= b.min && pnl < b.max);
        if (bin) {
            bin.count++;
        } else if (bins[bins.length - 1] && pnl === bins[bins.length - 1].max) {
             bins[bins.length - 1].count++; // Edge case: exactly hit the top
        } else if (bins[0] && pnl === bins[0].min) {
             bins[0].count++; // Edge case: explicitly min
        }
    });

    // Filter out edge blank bins if there's no data there to keep chart tight
    let firstNonEmpty = bins.findIndex(b => b.count > 0);
    let lastNonEmpty = Object.keys(bins).reverse().find(k => bins[k as any].count > 0);
    
    if (firstNonEmpty > 0) firstNonEmpty -= 1; // keep one empty bin buffer
    if (lastNonEmpty && parseInt(lastNonEmpty) < bins.length - 1) lastNonEmpty = (parseInt(lastNonEmpty) + 1).toString();
    
    return bins.slice(firstNonEmpty, lastNonEmpty ? parseInt(lastNonEmpty) + 1 : bins.length);
  }, [trades]);

  if (data.length === 0) return null;

  return (
    <div className="p-6 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl overflow-hidden relative group">
      <div className="flex items-center justify-between mb-6 relative z-10">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <AlignCenterVertical className="w-5 h-5 text-fuchsia-400" />
            Returns Distribution
          </h3>
          <p className="text-sm text-gray-400 flex items-center gap-1 mt-1">
            The Bell Curve of your Trading Edge
            <span title="Shows frequency of trade outcomes. A profitable edge skews to the right. Fat tails on the left mean poor risk management.">
              <Info className="w-3.5 h-3.5 text-gray-500 hover:text-fuchsia-400 cursor-help transition-colors" />
            </span>
          </p>
        </div>
      </div>

      <div className="h-[300px] w-full relative z-10" style={{ contain: 'layout' }}>
        <SafeChartContainer>
          <BarChart data={data} margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis 
              dataKey="label" 
              stroke="#666" 
              tick={{ fill: '#888', fontSize: 11 }}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis 
              stroke="#666" 
              tick={{ fill: '#888', fontSize: 11 }}
              label={{ value: 'Frequency (Trades)', angle: -90, position: 'insideLeft', fill: '#666', fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: 'transparent' }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-slate-900 border border-white/10 p-3 rounded-2xl shadow-xl">
                      <p className="text-gray-400 text-[10px] uppercase font-bold tracking-widest mb-2 border-b border-white/5 pb-1">PnL Bin: {data.label}</p>
                      <p className="text-white font-medium text-xs">Total Trades: <span className={`font-mono font-bold ${data.isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{data.count}</span></p>
                    </div>
                  );
                }
                return null;
              }}
            />
            
            <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={isVisible}>
              {data.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.isPositive ? '#10b981' : '#f43f5e'} 
                  fillOpacity={0.8}
                />
              ))}
            </Bar>
          </BarChart>
        </SafeChartContainer>
      </div>
    </div>
  );
});
