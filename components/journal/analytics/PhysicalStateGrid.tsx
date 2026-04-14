import React, { useMemo } from 'react';
import { HeartPulse, Focus, Info } from 'lucide-react';
import { Trade } from '../../../database';

interface PhysicalStateGridProps {
  trades: Trade[];
  isVisible?: boolean;
}

export const PhysicalStateGrid = React.memo(({ trades }: PhysicalStateGridProps) => {
  const data = useMemo(() => {
    const closedTrades = trades.filter(t => t.exitPrice !== undefined && t.pnl !== undefined);
    
    // Aggregate by Physical State
    const physicalMap = new Map<string, { count: number, wins: number, totalPnL: number }>();
    const focusMap = new Map<string, { count: number, wins: number, totalPnL: number }>();
    
    let hasData = false;

    closedTrades.forEach(t => {
      if (t.physicalState) {
        hasData = true;
        const current = physicalMap.get(t.physicalState) || { count: 0, wins: 0, totalPnL: 0 };
        current.count++;
        current.totalPnL += t.pnl!;
        if (t.pnl! > 0) current.wins++;
        physicalMap.set(t.physicalState, current);
      }
      if (t.focusState) {
        hasData = true;
        const current = focusMap.get(t.focusState) || { count: 0, wins: 0, totalPnL: 0 };
        current.count++;
        current.totalPnL += t.pnl!;
        if (t.pnl! > 0) current.wins++;
        focusMap.set(t.focusState, current);
      }
    });

    if (!hasData) return null;

    const processMap = (map: Map<string, any>) => Array.from(map.entries())
      .map(([state, stats]) => ({
        state,
        count: stats.count,
        winRate: (stats.wins / stats.count) * 100,
        avgPnL: stats.totalPnL / stats.count
      }))
      .sort((a, b) => b.avgPnL - a.avgPnL);

    return {
      physical: processMap(physicalMap),
      focus: processMap(focusMap)
    };
  }, [trades]);

  if (!data) return null;

  const StateRow = ({ item }: { item: any }) => (
    <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
      <div className="flex-1">
        <p className="text-sm font-medium text-white">{item.state}</p>
        <p className="text-xs text-gray-400 mt-0.5">{item.count} Trades</p>
      </div>
      <div className="text-right">
        <p className={`text-sm font-bold tracking-tight ${item.avgPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          ₹{item.avgPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })} avg
        </p>
        <p className="text-xs text-gray-500 mt-0.5">{item.winRate.toFixed(0)}% WR</p>
      </div>
    </div>
  );

  return (
    <div className="p-6 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl relative">
      <div className="flex items-center justify-between mb-6 relative z-10">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <HeartPulse className="w-5 h-5 text-cyan-400" />
            Bio-State Performance
          </h3>
          <p className="text-sm text-gray-400 flex items-center gap-1 mt-1">
            How your biology dictates your PnL
            <span title="Identifies if you consistently lose money when sleep-deprived, sick, or highly caffeinated.">
              <Info className="w-3.5 h-3.5 text-gray-500 hover:text-cyan-400 cursor-help transition-colors" />
            </span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
        {/* Physical States Column */}
        {data.physical.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1.5 mb-2">
              <HeartPulse className="w-3.5 h-3.5" /> Physical Condition
            </h4>
            <div className="space-y-2">
              {data.physical.map(item => <StateRow key={item.state} item={item} />)}
            </div>
          </div>
        )}

        {/* Focus States Column */}
        {data.focus.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1.5 mb-2">
              <Focus className="w-3.5 h-3.5" /> Mental Focus Level
            </h4>
            <div className="space-y-2">
              {data.focus.map(item => <StateRow key={item.state} item={item} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
