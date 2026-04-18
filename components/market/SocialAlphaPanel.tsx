import React, { useState, useEffect } from 'react';
import { Share2, Activity, ArrowUpRight, ArrowDownRight, MessageSquare, Flame, ShieldAlert } from 'lucide-react';
import { socialAlphaService, SocialMomentumSignal } from '../../services/SocialAlphaService';

export const SocialAlphaPanel: React.FC = () => {
  const [signals, setSignals] = useState<SocialMomentumSignal[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const loadData = async () => {
    setLoading(true);
    const list = await socialAlphaService.fetchSocialAlpha();
    setSignals(list);
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const sentimentColor = (sentiment: string) => {
    if (sentiment === 'BULLISH') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    if (sentiment === 'BEARISH') return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
    return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
  };

  return (
    <div className="bg-slate-900 rounded-2xl border border-indigo-500/20 p-6 text-white shadow-xl">
      <div className="flex items-center justify-between mb-6 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400 border border-indigo-500/20">
            <Share2 size={22} />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight">Social Alpha Discovery Engine</h2>
            <p className="text-xs text-slate-400">Scan public retail discussion threads on Reddit (r/IndiaInvestments, r/IndianStockMarket) for sentiment shifts and divergence.</p>
          </div>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="bg-slate-950 border border-slate-800 hover:bg-slate-905 px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-slate-400 hover:text-white"
        >
          {loading ? 'Scanning...' : 'Scan Forums'}
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-3">
          <Activity className="animate-spin text-indigo-500" size={32} />
          <p className="text-sm font-mono">Parsing JSON feed trees and regex matching tickers...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Heatmap summary row */}
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Flame size={14} className="text-orange-500" /> Forum Mentions Heatmap
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-3">
              {signals.map((sig) => {
                const heatOpacity = Math.min(100, sig.postCount * 7);
                return (
                  <div
                    key={sig.ticker}
                    className="p-3 bg-slate-950 border border-slate-850 rounded-xl flex flex-col items-center justify-center text-center relative overflow-hidden transition-all hover:scale-105"
                  >
                    <div
                      className="absolute inset-0 bg-indigo-600/10 pointer-events-none"
                      style={{ opacity: heatOpacity / 100 }}
                    />
                    <span className="font-mono font-bold text-sm text-slate-200 z-10">{sig.ticker}</span>
                    <span className="text-[10px] text-slate-500 mt-1 font-bold z-10">{sig.postCount} Mentions</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detailed Feed List */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Momentum Divergence Feed</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {signals.map((sig) => {
                const isBull = sig.avgSentiment === 'BULLISH';
                return (
                  <div
                    key={sig.ticker}
                    className="bg-slate-950 border border-slate-850 p-5 rounded-2xl flex flex-col justify-between hover:border-slate-800 transition-all gap-4"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-extrabold text-base text-white">{sig.ticker}</span>
                          <span className={`text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-bold ${sentimentColor(sig.avgSentiment)}`}>
                            {sig.avgSentiment}
                          </span>
                          {sig.isDivergent && (
                            <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                              <ShieldAlert size={10} /> Divergent
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`text-sm font-bold font-mono flex items-center justify-end ${sig.priceDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {sig.priceDelta >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                          {sig.priceDelta > 0 ? `+${sig.priceDelta}` : sig.priceDelta}%
                        </span>
                        <span className="text-[10px] text-slate-500 uppercase font-black">Price Change</span>
                      </div>
                    </div>

                    {/* Stats details */}
                    <div className="grid grid-cols-3 gap-2 bg-slate-900/40 p-2.5 rounded-xl border border-slate-900 text-center font-mono">
                      <div>
                        <span className="block text-[9px] text-slate-500 uppercase">Mentions</span>
                        <span className="text-xs font-bold text-slate-200">{sig.postCount}</span>
                      </div>
                      <div>
                        <span className="block text-[9px] text-slate-500 uppercase">Velocity</span>
                        <span className="text-xs font-bold text-indigo-400">+{sig.velocityDelta}%</span>
                      </div>
                      <div>
                        <span className="block text-[9px] text-slate-500 uppercase flex items-center justify-center gap-0.5">
                          <MessageSquare size={9} /> Upvotes
                        </span>
                        <span className="text-xs font-bold text-slate-200">{sig.engagementScore}</span>
                      </div>
                    </div>

                    {/* Catalyst description */}
                    {sig.catalystReason && (
                      <div className="p-3 bg-slate-900 rounded-xl text-xs text-indigo-300 leading-relaxed font-medium">
                        {sig.catalystReason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SocialAlphaPanel;
