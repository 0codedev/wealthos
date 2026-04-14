import React, { useMemo, useState } from 'react';
import { CalendarDays, Info } from 'lucide-react';
import { Trade } from '../../../database';

interface MonthlyHeatmapCalendarProps {
  trades: Trade[];
}

export const MonthlyHeatmapCalendar = React.memo(({ trades }: MonthlyHeatmapCalendarProps) => {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const yearsOptions = useMemo(() => {
    const years = Array.from(new Set(trades.map(t => new Date(t.date).getFullYear())));
    if (!years.includes(currentYear)) years.push(currentYear);
    return years.sort((a, b) => b - a);
  }, [trades, currentYear]);

  const data = useMemo(() => {
    // We create a grid: 12 months x 31 days
    // Store net PnL and trade count per day
    const grid = Array.from({ length: 12 }, () => 
      Array.from({ length: 31 }, () => ({ pnl: 0, count: 0, dateStr: '' }))
    );

    let maxAbsPnL = 0;
    let hasData = false;

    trades.forEach(t => {
      const d = new Date(t.date);
      if (d.getFullYear() === selectedYear && t.pnl !== undefined) {
        hasData = true;
        const month = d.getMonth(); // 0-11
        const day = d.getDate() - 1; // 0-30
        
        grid[month][day].pnl += t.pnl;
        grid[month][day].count += 1;
        grid[month][day].dateStr = d.toLocaleDateString();

        maxAbsPnL = Math.max(maxAbsPnL, Math.abs(grid[month][day].pnl));
      }
    });

    if (!hasData) return null;

    return { grid, maxAbsPnL: maxAbsPnL || 1 }; // prevent div by zero
  }, [trades, selectedYear]);

  if (!data) return null;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = Array.from({ length: 31 }, (_, i) => i + 1);

  const getColorScale = (pnl: number, maxAbs: number) => {
    if (pnl === 0) return 'bg-[#1a1a1a] border-white/5';
    const intensity = Math.min(Math.abs(pnl) / maxAbs, 1);
    
    if (pnl > 0) {
      if (intensity < 0.2) return 'bg-emerald-900 border-emerald-800';
      if (intensity < 0.5) return 'bg-emerald-700 border-emerald-600';
      if (intensity < 0.8) return 'bg-emerald-500 border-emerald-400';
      return 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)] border-emerald-300';
    } else {
      if (intensity < 0.2) return 'bg-rose-900 border-rose-800';
      if (intensity < 0.5) return 'bg-rose-700 border-rose-600';
      if (intensity < 0.8) return 'bg-rose-500 border-rose-400';
      return 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.5)] border-rose-300';
    }
  };

  return (
    <div className="p-6 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl relative overflow-x-auto overflow-y-hidden">
      <div className="flex items-center justify-between mb-8 sticky left-0">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-orange-400" />
            Seasonal Profitability Heatmap
          </h3>
          <p className="text-sm text-gray-400 flex items-center gap-1 mt-1">
            Visualizing your PnL rhythm across the year
            <span title="Rows are months, columns are days of the month. Perfect for spotting specific 'death weeks' or highly profitable seasons.">
              <Info className="w-3.5 h-3.5 text-gray-500 hover:text-orange-400 cursor-help transition-colors" />
            </span>
          </p>
        </div>
        
        {/* Year Selector */}
        <select 
          value={selectedYear}
          onChange={(e) => setSelectedYear(parseInt(e.target.value))}
          className="bg-black/40 border border-white/10 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-orange-500/50"
        >
          {yearsOptions.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <div className="min-w-[800px]">
        {/* Day Headers (1 to 31) */}
        <div className="flex ml-12 mb-2">
          {days.map(d => (
            <div key={d} className="flex-1 text-center text-[10px] text-gray-500 w-6">
              {d % 5 === 0 || d === 1 ? d : ''}
            </div>
          ))}
        </div>

        {/* Heatmap Grid */}
        <div className="space-y-1">
          {months.map((month, mIndex) => (
            <div key={month} className="flex items-center gap-2">
              <div className="w-10 text-xs font-medium text-gray-400 uppercase tracking-wider text-right">
                {month}
              </div>
              <div className="flex flex-1 gap-1">
                {data.grid[mIndex].map((dayData, dIndex) => {
                  // Determine if this day actually exists (e.g., Feb 30th doesn't)
                  const testDate = new Date(selectedYear, mIndex, dIndex + 1);
                  const exists = testDate.getMonth() === mIndex;

                  if (!exists) {
                    return <div key={dIndex} className="w-6 h-6 rounded-sm opacity-0 flex-1" />;
                  }

                  return (
                    <div 
                      key={dIndex} 
                      className={`w-6 h-6 flex-1 rounded-sm border transition-all duration-300 relative group hover:z-[100]
                        ${getColorScale(dayData.pnl, data.maxAbsPnL)}
                      `}
                    >
                      {/* Tooltip */}
                      {dayData.count > 0 && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50">
                          <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 p-3 rounded-xl shadow-xl whitespace-nowrap text-xs text-slate-800 dark:text-slate-200">
                            <p className="text-slate-500 dark:text-slate-400 mb-1">{months[mIndex]} {dIndex + 1}, {selectedYear}</p>
                            <p className={dayData.pnl >= 0 ? "text-emerald-500 dark:text-emerald-400 font-bold" : "text-rose-500 dark:text-rose-400 font-bold"}>
                              ₹{dayData.pnl.toLocaleString()}
                            </p>
                            <p className="text-slate-500 dark:text-slate-500 mt-1">{dayData.count} trades</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
