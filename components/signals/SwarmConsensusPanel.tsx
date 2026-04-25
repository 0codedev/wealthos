import React, { useState, useEffect } from 'react';
import { Layers, Activity, TrendingUp, TrendingDown, Users, ChevronDown, ChevronUp } from 'lucide-react';
import { swarmConsensusService, SwarmConsensusGroup } from '../../services/SwarmConsensusService';
import { usePausedInterval } from '../../hooks/usePausedInterval';

interface SwarmConsensusPanelProps {
  onAutofill?: (signal: any, provider: string) => void;
}

export const SwarmConsensusPanel: React.FC<SwarmConsensusPanelProps> = ({ onAutofill }) => {
  const [timeWindow, setTimeWindow] = useState<number>(24);
  const [consensusGroups, setConsensusGroups] = useState<SwarmConsensusGroup[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const loadConsensus = async () => {
    setLoading(true);
    const data = await swarmConsensusService.getConsensus(timeWindow);
    setConsensusGroups(data);
    setLoading(false);
  };

  useEffect(() => {
    loadConsensus();
  }, [timeWindow]);

  usePausedInterval(loadConsensus, 30000, { runImmediately: false });

  const toggleExpand = (id: string) => {
    if (expandedGroupId === id) {
      setExpandedGroupId(null);
    } else {
      setExpandedGroupId(id);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl shadow-xl">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6 pb-4 border-b border-slate-800">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-indigo-500/15 border border-indigo-500/30 rounded-xl text-indigo-400 shrink-0 mt-0.5">
            <Layers className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-bold text-white tracking-wide">
                Swarm Intelligence Consensus
              </h2>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-mono font-semibold tracking-wider uppercase">
                Consensus Engine
              </span>
            </div>
            <p className="text-xs text-slate-300 font-normal mt-1 leading-relaxed max-w-2xl">
              Aggregates overlapping signal providers, weighting consensus by historical performance &amp; recency.
            </p>
          </div>
        </div>

        {/* Time Window Selector & Storage indicator */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <span className="text-[11px] text-slate-300 font-medium flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 border border-slate-800 rounded-lg">
            <span>💾</span>
            <span>Local Disk Cache Active</span>
          </span>

          <div className="flex bg-slate-950 border border-slate-800 p-1 rounded-xl text-xs">
            {[
              { value: 6, label: '6h' },
              { value: 12, label: '12h' },
              { value: 24, label: '24h' },
              { value: 48, label: '48h' },
              { value: 168, label: '1w' },
              { value: 8760, label: 'All' }
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setTimeWindow(opt.value)}
                className={`px-3 py-1 rounded-lg text-xs font-bold uppercase transition-all cursor-pointer ${
                  timeWindow === opt.value
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : consensusGroups.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-slate-800 rounded-xl bg-slate-950/40">
          <Users className="w-10 h-10 text-slate-500 mx-auto mb-2 opacity-60" />
          <p className="text-sm font-bold text-slate-300">
            No overlapping signals in the last {
              timeWindow === 6 ? '6 hours' :
              timeWindow === 12 ? '12 hours' :
              timeWindow === 24 ? '24 hours' :
              timeWindow === 48 ? '48 hours' :
              timeWindow === 168 ? '1 week' : 'all time'
            }
          </p>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Consensus maps automatic signal overlap. Import calls for matching instruments to see swarm intelligence compile.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {consensusGroups.map(group => {
            const isBull = group.direction === 'BULL';
            const isBear = group.direction === 'BEAR';
            const isNeutral = group.direction === 'NEUTRAL';

            let directionColorClass = 'text-amber-300 bg-amber-500/15 border-amber-500/30';
            if (isBull) directionColorClass = 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30';
            if (isBear) directionColorClass = 'text-rose-300 bg-rose-500/15 border-rose-500/30';

            // SVG variables for dial
            const radius = 24;
            const circumference = 2 * Math.PI * radius;
            const strokeDashoffset = circumference - (group.convictionScore / 100) * circumference;

            return (
              <div
                key={group.instrument}
                className="bg-slate-950/60 border border-slate-800 hover:border-slate-700/80 rounded-xl p-4.5 transition-all flex flex-col justify-between shadow-sm"
              >
                <div>
                  {/* Top Bar: Instrument and Dial */}
                  <div className="flex justify-between items-start gap-2 mb-3">
                    <div>
                      <h3 className="text-base font-bold tracking-tight text-white">
                        {group.instrument}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`px-2.5 py-0.5 text-[10px] font-bold border rounded-md uppercase tracking-wider ${directionColorClass}`}>
                          {group.direction}
                        </span>
                        <span className="text-xs text-slate-300 font-medium">
                          {group.totalSignals} provider{group.totalSignals > 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>

                    {/* Conviction Dial */}
                    <div className="relative flex items-center justify-center w-14 h-14">
                      <svg className="w-full h-full transform -rotate-90">
                        {/* Background Arc */}
                        <circle
                          cx="28"
                          cy="28"
                          r={radius}
                          className="stroke-slate-800 fill-transparent"
                          strokeWidth="3.5"
                        />
                        {/* Foreground Arc */}
                        <circle
                          cx="28"
                          cy="28"
                          r={radius}
                          className={`fill-transparent transition-all duration-500 ${
                            isBull ? 'stroke-emerald-400' : isBear ? 'stroke-rose-400' : 'stroke-amber-400'
                          }`}
                          strokeWidth="3.5"
                          strokeDasharray={circumference}
                          strokeDashoffset={strokeDashoffset}
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="absolute flex flex-col items-center">
                        <span className="text-xs font-black text-white">{group.convictionScore}%</span>
                        <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold font-mono">Conv</span>
                      </div>
                    </div>
                  </div>

                  {/* Summary Metric Chips */}
                  <div className="grid grid-cols-2 gap-2.5 text-xs font-mono text-slate-300 mb-3 bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                    <div>
                      <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Entry Range</span>
                      <span className="text-slate-100 font-bold">
                        ₹{group.entryPriceRange.min.toFixed(1)} - ₹{group.entryPriceRange.max.toFixed(1)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Weighted R:R</span>
                      <span className="text-indigo-300 font-bold">{group.avgRR.toFixed(2)}x</span>
                    </div>
                    {group.stopLossRange && (
                      <div>
                        <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">SL Range</span>
                        <span className="text-rose-300 font-bold">
                          ₹{group.stopLossRange.min.toFixed(1)} - ₹{group.stopLossRange.max.toFixed(1)}
                        </span>
                      </div>
                    )}
                    {group.targetRange && (
                      <div>
                        <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Target Range</span>
                        <span className="text-emerald-300 font-bold">
                          ₹{group.targetRange.min.toFixed(1)} - ₹{group.targetRange.max.toFixed(1)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Collapsible Agreement Breakdown */}
                <div>
                  <button
                    onClick={() => toggleExpand(group.instrument)}
                    className="w-full flex items-center justify-between text-xs uppercase tracking-wider font-bold text-indigo-400 hover:text-indigo-300 py-1.5 border-t border-slate-800 cursor-pointer transition-colors"
                  >
                    <span>Provider Agreement Breakdown</span>
                    {expandedGroupId === group.instrument ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {expandedGroupId === group.instrument && (
                    <div className="space-y-1.5 mt-2 max-h-36 overflow-y-auto pool-power-scroll pr-1">
                      {group.providers.map((prov, i) => (
                        <div
                          key={`${prov.name}-${i}`}
                          className="flex justify-between items-center bg-slate-900 p-2 rounded-lg border border-slate-800 text-xs"
                        >
                          <div>
                            <span className="font-bold text-slate-200 block leading-tight">{prov.name}</span>
                            <span className="text-slate-400 font-mono text-[10px]">
                              {new Date(prov.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-right font-mono">
                              <span className={`font-bold mr-1.5 px-1.5 py-0.5 rounded text-[10px] ${
                                prov.action === 'BUY' || prov.action === 'COVER'
                                  ? 'text-emerald-300 bg-emerald-500/15 border border-emerald-500/30'
                                  : 'text-rose-300 bg-rose-500/15 border border-rose-500/30'
                              }`}>
                                {prov.action}
                              </span>
                              <span className="text-slate-200 font-bold">@₹{prov.entryPrice.toFixed(1)}</span>
                            </div>
                            <button
                              title="Load into Manual Parser"
                              onClick={() => {
                                const customEvent = new CustomEvent('signal-autofill', {
                                  detail: {
                                    provider: prov.name,
                                    parsedSignal: {
                                      tradingSymbol: group.instrument,
                                      action: prov.action,
                                      suggestedEntryPrice: prov.entryPrice,
                                      stopLoss: prov.action === 'BUY' && group.stopLossRange ? group.stopLossRange.min : 0,
                                      targets: group.targetRange ? [group.targetRange.min, group.targetRange.max] : []
                                    }
                                  }
                                });
                                window.dispatchEvent(customEvent);
                              }}
                              className="p-1 hover:text-white text-slate-500 hover:bg-indigo-950 rounded transition-all focus:outline-none"
                            >
                              <Layers className="w-3.5 h-3.5 text-indigo-400" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
