import React, { useMemo } from 'react';
import { Target, Info } from 'lucide-react';
import { Trade, SetupGrade } from '../../../database';

interface ExecutionHeatmapProps {
  trades: Trade[];
  isVisible?: boolean;
}

export const ExecutionHeatmap = React.memo(({ trades }: ExecutionHeatmapProps) => {
  const data = useMemo(() => {
    // We analyze discipline per Grade
    const gradeOrder: SetupGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
    const gradeMap = new Map<SetupGrade, any>();
    
    gradeOrder.forEach(g => {
      gradeMap.set(g, { total: 0, stopMoved: 0, highTilt: 0, mistakes: 0, compliant: 0 });
    });

    let hasData = false;

    trades.forEach(t => {
      if (t.grade && gradeMap.has(t.grade)) {
        hasData = true;
        const current = gradeMap.get(t.grade);
        current.total++;
        if (t.stopLossMoved) current.stopMoved++;
        if ((t.tiltScore || 0) > 5) current.highTilt++;
        if ((t.mistakes || []).length > 0) current.mistakes++;
        if ((t.complianceScore || 0) >= 80) current.compliant++;
      }
    });

    if (!hasData) return [];

    return Array.from(gradeMap.entries())
      .map(([grade, stats]) => ({
        grade,
        total: stats.total,
        stopMovedPct: stats.total > 0 ? (stats.stopMoved / stats.total) * 100 : 0,
        highTiltPct: stats.total > 0 ? (stats.highTilt / stats.total) * 100 : 0,
        mistakesPct: stats.total > 0 ? (stats.mistakes / stats.total) * 100 : 0,
        compliantPct: stats.total > 0 ? (stats.compliant / stats.total) * 100 : 0,
      }))
      .filter(d => d.total > 0); // Only show grades with actual trades
  }, [trades]);

  if (data.length === 0) return null;

  // Helper to color bad metrics (Red scale). Higher % = redder.
  const getBadColorScale = (pct: number) => {
    if (pct === 0) return 'bg-white/5 text-gray-500';
    if (pct < 20) return 'bg-rose-500/20 text-rose-300';
    if (pct < 50) return 'bg-rose-500/40 text-rose-200';
    if (pct < 80) return 'bg-rose-500/60 text-white';
    return 'bg-rose-500/80 text-white font-bold';
  };

  // Helper to color good metrics (Emerald scale). Higher % = greener.
  const getGoodColorScale = (pct: number) => {
    if (pct === 0) return 'bg-white/5 text-gray-500';
    if (pct < 40) return 'bg-emerald-500/20 text-emerald-300';
    if (pct < 70) return 'bg-emerald-500/40 text-emerald-200';
    return 'bg-emerald-500/70 text-white font-bold';
  };

  const MetricCell = ({ label, pct, type }: { label: string, pct: number, type: 'good' | 'bad' }) => (
    <div className={`flex flex-col items-center justify-center p-3 rounded-lg border border-white/5 transition-colors ${type === 'good' ? getGoodColorScale(pct) : getBadColorScale(pct)}`}>
      <span className="text-sm font-semibold tracking-tight">{pct.toFixed(0)}%</span>
      <span className="text-[10px] uppercase tracking-wider opacity-70 mt-1">{label}</span>
    </div>
  );

  return (
    <div className="p-6 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl relative">
      <div className="flex items-center justify-between mb-6 relative z-10">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-rose-400" />
            Execution Discipline Matrix
          </h3>
          <p className="text-sm text-gray-400 flex items-center gap-1 mt-1">
            Are you sabotaging your best setups?
            <span title="Breaks down execution mistakes by setup grade. If your A+ setups have high stop-moved rates, you're ruining your edge.">
              <Info className="w-3.5 h-3.5 text-gray-500 hover:text-rose-400 cursor-help transition-colors" />
            </span>
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {data.map(row => (
          <div key={row.grade} className="flex flex-col md:flex-row md:items-center gap-4 bg-white/[0.02] p-4 rounded-xl border border-white/5">
            <div className="w-24 shrink-0 flex items-center justify-between md:flex-col md:items-start md:justify-center">
              <span className={`text-xl font-bold bg-gradient-to-br ${
                  row.grade === 'A+' || row.grade === 'A' ? 'from-emerald-400 to-emerald-600' :
                  row.grade === 'B' || row.grade === 'C' ? 'from-yellow-400 to-yellow-600' :
                  'from-rose-400 to-rose-600'
                } bg-clip-text text-transparent`}>
                {row.grade}
              </span>
              <span className="text-xs text-gray-500 font-medium">{row.total} Trades</span>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
              <MetricCell label="Stop Moved" pct={row.stopMovedPct} type="bad" />
              <MetricCell label="High Tilt (>5)" pct={row.highTiltPct} type="bad" />
              <MetricCell label="Has Mistakes" pct={row.mistakesPct} type="bad" />
              <MetricCell label="Compliant" pct={row.compliantPct} type="good" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
