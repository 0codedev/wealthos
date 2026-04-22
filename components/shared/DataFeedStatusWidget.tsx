import React, { useEffect, useState, useMemo } from 'react';
import {
  Activity, Wifi, WifiOff, Server, Zap, Database, AlertTriangle,
  CheckCircle2, RefreshCw, ChevronDown, ChevronUp, ShieldCheck,
  TrendingUp, TrendingDown, ArrowRight, Radio
} from 'lucide-react';
import { pipelineGovernor, Tier, TIER_LABEL } from '../../lib/pipelineGovernor';

interface Snapshot {
  active: Tier;
  tiers: Array<{
    tier: Tier;
    health: 'HEALTHY' | 'DEGRADED' | 'CIRCUIT_OPEN' | 'UNKNOWN';
    avgLatencyMs: number;
    errorRate: number;
    lastSuccessAt: number | null;
    consecutiveFailures: number;
    cooldownRemainingMs: number;
    totalRequests: number;
    totalSuccesses: number;
  }>;
  transitions: Array<{
    ts: number;
    from: Tier | null;
    to: Tier;
    reason: string;
    triggerLatencyMs?: number;
  }>;
}

const TIER_ICONS: Record<Tier, React.ReactNode> = {
  T1_UPSTOX: <Zap size={12} />,
  T2_NSE_YAHOO: <Server size={12} />,
  T3_YAHOO: <Activity size={12} />,
  T4_OFFLINE: <Database size={12} />,
};

const HEALTH_COLORS: Record<Snapshot['tiers'][number]['health'], { dot: string; text: string; bg: string; border: string; label: string }> = {
  HEALTHY: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    label: 'HEALTHY',
  },
  DEGRADED: {
    dot: 'bg-amber-500 animate-pulse',
    text: 'text-amber-500',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    label: 'DEGRADED',
  },
  CIRCUIT_OPEN: {
    dot: 'bg-rose-500',
    text: 'text-rose-500',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    label: 'CIRCUIT OPEN',
  },
  UNKNOWN: {
    dot: 'bg-slate-500',
    text: 'text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
    label: 'IDLE',
  },
};

function fmtAgo(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-IN', { hour12: false });
}

function timeAgoShort(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

export const DataFeedStatusWidget: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [snap, setSnap] = useState<Snapshot>(() => pipelineGovernor.getSnapshot());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const unsub = pipelineGovernor.subscribe(() => {
      setSnap(pipelineGovernor.getSnapshot());
    });
    // Refresh the "ago" counters every second
    const tick = setInterval(() => setSnap({ ...pipelineGovernor.getSnapshot() }), 1000);
    return () => {
      unsub();
      clearInterval(tick);
    };
  }, []);

  const activeTier = snap.tiers.find((t) => t.tier === snap.active);
  const activeHealthKey = activeTier?.health ?? 'UNKNOWN';
  const activeColors = HEALTH_COLORS[activeHealthKey];

  const healthyCount = useMemo(() => snap.tiers.filter((t) => t.health === 'HEALTHY').length, [snap]);
  const totalLatency = useMemo(() => {
    const healthy = snap.tiers.filter((t) => t.health !== 'UNKNOWN');
    if (healthy.length === 0) return 0;
    return healthy.reduce((s, t) => s + (t.avgLatencyMs || 0), 0) / healthy.length;
  }, [snap]);

  const recentTransitions = snap.transitions.slice(-5).reverse();

  const handleManualFailover = (tier: Tier) => {
    pipelineGovernor.setActiveTier(tier, 'user manual failover');
  };

  return (
    <div className={`relative ${className}`}>
      {/* Compact chip */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`group flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-bold border ${activeColors.bg} ${activeColors.text} ${activeColors.border} hover:brightness-110 transition-all shadow-sm`}
      >
        <Radio size={12} className="animate-pulse" />
        <span className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${activeColors.dot}`}></span>
          {TIER_LABEL[snap.active]}
        </span>
        <span className="text-[9px] opacity-70 font-mono">
          {totalLatency > 0 ? `${totalLatency.toFixed(0)}ms` : ''}
        </span>
        {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>

      {expanded && (
        <div className="absolute right-0 top-9 z-[120] w-[420px] bg-slate-950/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-4 text-slate-200 font-sans text-[11px] leading-relaxed">
          {/* Header */}
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800/80">
            <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-slate-300">
              <ShieldCheck size={14} className="text-indigo-400" />
              Data Failover Chain
            </div>
            <div className="flex items-center gap-2 font-mono text-[9px]">
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle2 size={9} />
                {healthyCount}/4 healthy
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">{snap.tiers.reduce((s, t) => s + t.totalRequests, 0)} reqs</span>
            </div>
          </div>

          {/* Active tier summary */}
          <div className={`mb-3 p-2.5 rounded-xl ${activeColors.bg} border ${activeColors.border}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="relative flex items-center justify-center w-3 h-3">
                  <span className={`absolute w-3 h-3 rounded-full ${activeColors.dot} opacity-75 animate-ping`}></span>
                  <span className={`relative w-2 h-2 rounded-full ${activeColors.dot.split(' ')[0]}`}></span>
                </div>
                <span className="font-bold uppercase tracking-wider text-[10px] text-slate-200">Active Tier</span>
              </div>
              <span className={`font-mono font-black text-[10px] uppercase ${activeColors.text}`}>{activeHealthKey}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              {TIER_ICONS[snap.active]}
              <span className="font-bold text-slate-100">{TIER_LABEL[snap.active]}</span>
            </div>
          </div>

          {/* Tier list */}
          <div className="space-y-1.5">
            {snap.tiers.map((t) => {
              const colors = HEALTH_COLORS[t.health];
              const isActive = t.tier === snap.active;
              return (
                <div
                  key={t.tier}
                  className={`group p-2 rounded-lg border ${isActive ? colors.border + ' ' + colors.bg : 'border-slate-800 bg-slate-900/40'} hover:bg-slate-800/40 transition-colors`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="relative flex items-center justify-center w-2 h-2 shrink-0">
                        <span className={`w-2 h-2 rounded-full ${colors.dot}`}></span>
                      </div>
                      <div className="flex items-center gap-1 text-slate-300">
                        {TIER_ICONS[t.tier]}
                        <span className="font-bold truncate text-[10px] uppercase tracking-wider">
                          {TIER_LABEL[t.tier]}
                        </span>
                      </div>
                      {isActive && (
                        <span className="px-1 py-0.5 rounded text-[8px] font-mono font-black bg-indigo-500/20 text-indigo-300 uppercase tracking-widest">
                          active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`font-mono font-black text-[9px] uppercase ${colors.text}`}>
                        {colors.label}
                      </span>
                      {!isActive && t.health !== 'CIRCUIT_OPEN' && (
                        <button
                          onClick={() => handleManualFailover(t.tier)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white"
                          title="Promote to active"
                        >
                          <ArrowRight size={10} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-1.5 grid grid-cols-3 gap-x-2 text-[9px] font-mono text-slate-400">
                    <div>
                      <span className="text-slate-500">lat</span>{' '}
                      <span className="text-slate-200">{t.avgLatencyMs > 0 ? `${t.avgLatencyMs.toFixed(0)}ms` : '–'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">err</span>{' '}
                      <span className={t.errorRate > 0.1 ? 'text-rose-400' : 'text-slate-200'}>
                        {(t.errorRate * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-slate-500">last</span>{' '}
                      <span className="text-slate-200">{fmtAgo(t.lastSuccessAt)}</span>
                    </div>
                  </div>

                  {t.cooldownRemainingMs > 0 && (
                    <div className="mt-1.5 flex items-center gap-1 text-rose-400 text-[9px] font-mono">
                      <AlertTriangle size={9} />
                      cooldown {Math.ceil(t.cooldownRemainingMs / 1000)}s
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Transitions feed */}
          {recentTransitions.length > 0 && (
            <div className="mt-3 pt-2 border-t border-slate-800/80">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1">
                <RefreshCw size={9} />
                Recent transitions
              </div>
              <div className="space-y-1 max-h-20 overflow-y-auto">
                {recentTransitions.map((tx, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[9px] font-mono leading-tight">
                    <span className="text-slate-500 shrink-0">{fmtTime(tx.ts)}</span>
                    <span className="shrink-0">
                      {tx.from ? <TrendingDown size={9} className="inline text-rose-400" /> : <TrendingUp size={9} className="inline text-emerald-400" />}
                    </span>
                    <span className="text-slate-400 truncate">
                      {tx.from ?? 'init'} → <span className="text-slate-200 font-bold">{tx.to}</span>
                    </span>
                    <span className="text-slate-500 truncate">· {tx.reason}</span>
                    <span className="text-slate-600 shrink-0">{timeAgoShort(tx.ts)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manual controls */}
          <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between">
            <span className="text-[9px] text-slate-500 uppercase tracking-wider">Manual failover</span>
            <div className="flex gap-1">
              {(['T1_UPSTOX', 'T2_NSE_YAHOO', 'T3_YAHOO', 'T4_OFFLINE'] as Tier[]).map((t) => (
                <button
                  key={t}
                  onClick={() => handleManualFailover(t)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border transition-colors ${
                    snap.active === t
                      ? 'bg-indigo-500/30 border-indigo-500/50 text-indigo-200'
                      : 'border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  {t.split('_')[0]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataFeedStatusWidget;
