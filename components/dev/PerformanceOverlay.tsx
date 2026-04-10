import React, { useEffect, useState } from 'react';
import { Clock, Copy, Shield, X, ChevronUp, ChevronDown } from 'lucide-react';
import { upstoxWebSocketService } from '../../services/UpstoxWebSocketService';
import { LiveConnectionBadge } from '../shared/LiveConnectionBadge';

interface Metric {
  name: string;
  duration: number | null;
  status: 'green' | 'yellow' | 'red' | 'pending';
}

export const PerformanceOverlay: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [rawMarks, setRawMarks] = useState<Record<string, number>>({});
  const [wsMetrics, setWsMetrics] = useState<any>(null);

  const calculateMetrics = () => {
    if (typeof window === 'undefined' || !window.performance) return;

    const marks = window.performance.getEntriesByType('mark');
    const marksMap: Record<string, number> = {};
    marks.forEach(m => {
      marksMap[m.name] = m.startTime;
    });
    setRawMarks(marksMap);

    const getDuration = (startMark: string, endMark: string): number | null => {
      if (marksMap[startMark] !== undefined && marksMap[endMark] !== undefined) {
        return Math.max(0, marksMap[endMark] - marksMap[startMark]);
      }
      return null;
    };

    const determineStatus = (duration: number | null, greenThreshold: number, yellowThreshold: number): 'green' | 'yellow' | 'red' | 'pending' => {
      if (duration === null) return 'pending';
      if (duration <= greenThreshold) return 'green';
      if (duration <= yellowThreshold) return 'yellow';
      return 'red';
    };

    const definitions = [
      { name: 'Vite & Bundle Load', start: 'launcher:start', end: 'frontend:reachable', green: 400, yellow: 1200 },
      { name: 'React Mount (Shell)', start: 'frontend:reachable', end: 'shell:first-render', green: 300, yellow: 800 },
      { name: 'Auth State Resolved', start: 'shell:first-render', end: 'auth:resolved', green: 200, yellow: 600 },
      { name: 'Portfolio Cache Hydrated', start: 'auth:resolved', end: 'portfolio:cached-shown', green: 300, yellow: 1000 },
      { name: 'First Active Tab Render', start: 'portfolio:cached-shown', end: 'active-tab:hydrated', green: 200, yellow: 500 },
      { name: 'Python Bridge Handshake', start: 'frontend:reachable', end: 'bridge:reachable', green: 1000, yellow: 3000 },
      { name: 'First Market Tick (WS)', start: 'bridge:reachable', end: 'market-context:first-shown', green: 1500, yellow: 4000 }
    ];

    const computedMetrics = definitions.map(def => {
      const dur = getDuration(def.start, def.end);
      return {
        name: def.name,
        duration: dur,
        status: determineStatus(dur, def.green, def.yellow)
      };
    });

    setMetrics(computedMetrics);
  };

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // Run initial scan
    calculateMetrics();

    // Check periodically for updates as new marks are loaded
    const interval = setInterval(calculateMetrics, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV || !isOpen) return;
    const updateWS = () => {
      setWsMetrics(upstoxWebSocketService.getHealthMetrics());
    };
    updateWS();
    const interval = setInterval(updateWS, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  const copyToClipboard = () => {
    const report = {
      timestamp: new Date().toISOString(),
      rawMarks,
      durations: metrics.reduce((acc, m) => {
        acc[m.name] = m.duration !== null ? `${m.duration.toFixed(1)}ms` : 'Pending';
        return acc;
      }, {} as Record<string, string>)
    };
    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    alert('Performance telemetry report copied to clipboard!');
  };

  if (!import.meta.env.DEV) return null;

  return (
    <div className="fixed bottom-4 left-20 z-[9999] font-sans">
      {isOpen ? (
        <div className="w-80 bg-slate-900/95 border border-indigo-500/30 rounded-2xl p-4 shadow-2xl backdrop-blur-md text-white select-none">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-3">
            <span className="flex items-center gap-1.5 text-xs font-bold text-indigo-400">
              <Clock size={14} /> System Startup Telemetry
            </span>
            <div className="flex gap-2">
              <button 
                onClick={copyToClipboard}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                title="Copy Metrics JSON"
              >
                <Copy size={12} />
              </button>
              <button 
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {metrics.map((m, idx) => {
              const statusColors = {
                green: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
                yellow: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
                red: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
                pending: 'text-slate-400 bg-slate-800/50 border-slate-700/50'
              };

              return (
                <div key={idx} className={`flex justify-between items-center text-[10px] p-1.5 rounded-lg border ${statusColors[m.status]}`}>
                  <span className="font-semibold">{m.name}:</span>
                  <span className="font-mono font-bold">
                    {m.duration !== null ? `${m.duration.toFixed(0)} ms` : 'Awaiting...'}
                  </span>
                </div>
              );
            })}
          </div>

          {/* WebSocket Metrics */}
          {wsMetrics && (
            <div className="mt-3 pt-3 border-t border-slate-800 space-y-2">
              <div className="text-[10px] font-bold text-indigo-400 flex justify-between items-center">
                <span>WS BUDGET MONITOR</span>
                <LiveConnectionBadge size="xs" />
              </div>
              <div className="grid grid-cols-2 gap-2 text-[9px] font-mono">
                <div className="bg-slate-950/40 p-1.5 rounded border border-slate-800/40">
                  <span className="text-slate-500 block text-[7px] uppercase font-bold">LTPC (Max 5k)</span>
                  <span className="text-white font-bold">{wsMetrics.modeCounts.ltpc}</span>
                  <span className="text-slate-500 block text-[6px]">{wsMetrics.modeBudgets.ltpc} left</span>
                </div>
                <div className="bg-slate-950/40 p-1.5 rounded border border-slate-800/40">
                  <span className="text-slate-500 block text-[7px] uppercase font-bold">Quotes (Max 2k)</span>
                  <span className="text-white font-bold">{wsMetrics.modeCounts.full}</span>
                  <span className="text-slate-500 block text-[6px]">{wsMetrics.modeBudgets.full} left</span>
                </div>
                <div className="bg-slate-950/40 p-1.5 rounded border border-slate-800/40">
                  <span className="text-slate-500 block text-[7px] uppercase font-bold">Greeks (Max 3k)</span>
                  <span className="text-white font-bold">{wsMetrics.modeCounts.option_greeks}</span>
                  <span className="text-slate-500 block text-[6px]">{wsMetrics.modeBudgets.option_greeks} left</span>
                </div>
                <div className="bg-slate-950/40 p-1.5 rounded border border-slate-800/40">
                  <span className="text-slate-500 block text-[7px] uppercase font-bold">L2 Depth (Max 50)</span>
                  <span className="text-white font-bold">{wsMetrics.modeCounts.full_d30}</span>
                  <span className="text-slate-500 block text-[6px]">{wsMetrics.modeBudgets.full_d30} left</span>
                </div>
              </div>
              <div className="flex justify-between items-center text-[8px] text-slate-400 bg-slate-950/20 px-2 py-1 rounded">
                <span>Ticks Inbound: {wsMetrics.ticksReceived.toLocaleString()}</span>
                {wsMetrics.lastTickAt && (
                  <span>Last: {new Date(wsMetrics.lastTickAt).toLocaleTimeString()}</span>
                )}
              </div>
            </div>
          )}

          <div className="mt-3 pt-2 border-t border-slate-800 text-[8px] text-slate-500 flex justify-between items-center">
            <span>Dev Mode Telemetry Overlay</span>
            <span className="flex items-center gap-0.5 text-indigo-400 font-semibold"><Shield size={8} /> Local Sandbox</span>
          </div>
        </div>
      ) : (
        <div className="w-12 h-12 flex items-center justify-center group">
          <button
            onClick={() => setIsOpen(true)}
            className="flex items-center justify-center w-8 h-8 bg-slate-900/90 hover:bg-indigo-950/60 hover:text-indigo-400 text-white rounded-full border border-indigo-500/20 shadow-lg transition-all opacity-0 group-hover:opacity-100 duration-300 cursor-pointer"
            title="Startup Telemetry"
          >
            <Clock size={14} className="text-indigo-400" />
          </button>
        </div>
      )}
    </div>
  );
};
