import React, { useState, useEffect } from 'react';
import { KeyPoolManager } from '../../services/llm/keyPool';
import { Cpu, RefreshCw, Key, ShieldCheck, Activity } from 'lucide-react';
import { AIProvider } from '../../types/ai';

export const QuotaMonitor: React.FC = () => {
  const [stats, setStats] = useState<Record<AIProvider, { callsToday: number; totalKeys: number; activeKeys: number }> | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = () => {
    setRefreshing(true);
    try {
      const currentStats = KeyPoolManager.getInstance().getCallStats();
      setStats(currentStats);
    } catch (e) {
      console.error("[QuotaMonitor] Failed to get call stats", e);
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 10000); // refresh stats every 10s
    return () => clearInterval(interval);
  }, []);

  if (!stats) return null;

  const providerNames: Record<AIProvider, string> = {
    omniroute: 'OmniRoute Gateway',
    gemini: 'Google Gemini',
    groq: 'Groq Llama',
    cerebras: 'Cerebras Speed',
    mistral: 'Mistral AI',
    openrouter: 'OpenRouter',
    github: 'GitHub Model Inference',
    cloudflare: 'Cloudflare Workers AI',
    cohere: 'Cohere'
  };

  const providerLimits: Record<AIProvider, number> = {
    omniroute: 100000,
    gemini: 1500, // standard free tier limits
    groq: 14400,
    cerebras: 14400,
    mistral: 1000,
    openrouter: 50,
    github: 150,
    cloudflare: 10000,
    cohere: 1000
  };

  return (
    <div className="rounded-[26px] border border-slate-800 bg-slate-900/40 p-6 backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-slate-850 pb-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20">
            <Cpu size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">AI Key Pool & Quota Monitor</h3>
            <p className="text-[10px] text-slate-500">Live multi-account call statistics and key rotation health.</p>
          </div>
        </div>
        <button
          onClick={loadStats}
          disabled={refreshing}
          className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-slate-400 hover:text-white transition-all hover:bg-slate-800"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(stats).map(([key, providerStats]) => {
          const provider = key as AIProvider;
          const { callsToday, totalKeys, activeKeys } = providerStats;
          
          if (totalKeys === 0) return null;

          const limit = providerLimits[provider] * totalKeys;
          const percentage = Math.min(100, Math.round((callsToday / limit) * 100)) || 0;

          // Determine status color
          let progressColor = 'bg-indigo-500';
          let textColor = 'text-indigo-400';
          if (activeKeys === 0) {
            progressColor = 'bg-rose-500';
            textColor = 'text-rose-400';
          } else if (percentage > 80) {
            progressColor = 'bg-amber-500';
            textColor = 'text-amber-400';
          } else if (percentage > 0) {
            progressColor = 'bg-emerald-500';
            textColor = 'text-emerald-400';
          }

          return (
            <div
              key={provider}
              className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-4 transition-colors hover:border-slate-750"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-white">{providerNames[provider]}</h4>
                  <p className="mt-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500">{provider}</p>
                </div>
                <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-400">
                  <Key size={10} />
                  <span>{activeKeys} / {totalKeys} active</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-4">
                <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                  <span>Calls: {callsToday} / {limit}</span>
                  <span className={`font-bold ${textColor}`}>{percentage}% used</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-850">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-slate-900 pt-2.5 text-[9px]">
                <span className="text-slate-500">Status</span>
                <span className={`font-bold flex items-center gap-1 ${activeKeys > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {activeKeys > 0 ? (
                    <>
                      <ShieldCheck size={10} /> Rotational Active
                    </>
                  ) : (
                    <>
                      <Activity size={10} className="animate-pulse" /> All Keys Cool-down
                    </>
                  )}
                </span>
              </div>
            </div>
          );
        })}

        {/* If no key pool configured */}
        {Object.values(stats).every(p => p.totalKeys === 0) && (
          <div className="col-span-full py-8 text-center text-slate-500">
            <Key className="mx-auto mb-2 text-slate-650" size={24} />
            <p className="text-xs font-semibold">No Multi-Key Pools Configured</p>
            <p className="mt-1 text-[10px] text-slate-600">Enter multiple keys in the Logic Configuration settings to activate rotation.</p>
          </div>
        )}
      </div>
    </div>
  );
};
