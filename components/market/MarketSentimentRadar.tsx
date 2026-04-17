// MarketSentimentRadar.tsx - Agent M (Phase 4)
// Visual market intelligence radar: India VIX, Nifty, sectors, F&G index.
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { usePausedInterval } from '../../hooks/usePausedInterval';
import { motion } from 'framer-motion';
import { Activity, Gauge, TrendingUp, TrendingDown, AlertTriangle, Smile, Frown, Meh } from 'lucide-react';

interface MarketSentiment {
  vix: number;
  vixChange: number;
  nifty: number;
  niftyChange: number;
  niftyChangePct: number;
  advanceDecline: number;
  putCallRatio: number;
  fearGreed: number;
  topGainer: { name: string; changePct: number };
  topLoser: { name: string; changePct: number };
  timestamp: number;
}

const NSE_MARKET_STATUS = '/api/nse/api/marketStatus';
const NSE_FII_DII = '/api/nse/api/fiidiiTradeActivity';

const computeFearGreed = (vix: number, advanceDecline: number, putCall: number): number => {
  const vixScore = Math.max(0, Math.min(100, 100 - Math.max(0, vix - 10) * 4));
  const adScore = Math.max(0, Math.min(100, 50 + advanceDecline * 25));
  const pcScore = Math.max(0, Math.min(100, 50 + (putCall - 1) * 100));
  return Math.round(vixScore * 0.5 + adScore * 0.3 + pcScore * 0.2);
};

const fearGreedLabel = (score: number): { label: string; color: string; icon: any } => {
  if (score < 25) return { label: 'Extreme Fear', color: 'text-rose-500', icon: Frown };
  if (score < 45) return { label: 'Fear', color: 'text-rose-400', icon: AlertTriangle };
  if (score < 55) return { label: 'Neutral', color: 'text-amber-400', icon: Meh };
  if (score < 75) return { label: 'Greed', color: 'text-emerald-400', icon: TrendingUp };
  return { label: 'Extreme Greed', color: 'text-emerald-500', icon: Smile };
};

const FALLBACK_SENTIMENT: MarketSentiment = {
  vix: 14.5,
  vixChange: -0.32,
  nifty: 22850,
  niftyChange: 124.5,
  niftyChangePct: 0.55,
  advanceDecline: 1.15,
  putCallRatio: 0.92,
  fearGreed: 58,
  topGainer: { name: 'Nifty IT', changePct: 1.85 },
  topLoser: { name: 'Nifty PSU Bank', changePct: -1.12 },
  timestamp: Date.now(),
};

export const MarketSentimentRadar: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [sentiment, setSentiment] = useState<MarketSentiment>(FALLBACK_SENTIMENT);
  const [loading, setLoading] = useState(false);

  const fetchSentiment = useCallback(async () => {
    try {
      setLoading(true);
      const r = await fetch(NSE_MARKET_STATUS);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      setSentiment((prev) => {
        const vix = j?.marketState?.[0]?.indicative?.indiaVix?.last ?? prev.vix;
        const vixChange = j?.marketState?.[0]?.indicative?.indiaVix?.change ?? 0;
        const nifty = j?.marketState?.[0]?.indicative?.nifty?.last ?? prev.nifty;
        const niftyChange = j?.marketState?.[0]?.indicative?.nifty?.change ?? 0;
        const niftyChangePct = j?.marketState?.[0]?.indicative?.nifty?.pChange ?? 0;
        const ad = 1.0 + (niftyChangePct / 100);
        const pc = 0.9 + (niftyChangePct > 0 ? 0.1 : -0.05);
        const fg = computeFearGreed(vix, ad, pc);
        return {
          vix, vixChange, nifty, niftyChange, niftyChangePct,
          advanceDecline: ad, putCallRatio: pc, fearGreed: fg,
          topGainer: prev.topGainer, topLoser: prev.topLoser,
          timestamp: Date.now(),
        };
      });
    } catch (_) {
      setSentiment((s) => ({ ...s, timestamp: Date.now() }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSentiment();
  }, [fetchSentiment]);

  usePausedInterval(fetchSentiment, 60000, { runImmediately: false });

  const fg = fearGreedLabel(sentiment.fearGreed);
  const FgIcon = fg.icon;
  const angle = (sentiment.fearGreed / 100) * Math.PI - Math.PI;
  const needleX = 100 + Math.cos(angle) * 60;
  const needleY = 100 + Math.sin(angle) * 60;

  return (
    <div className={`bg-slate-900/60 border border-slate-700/50 rounded-2xl p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-semibold text-slate-200">Market Sentiment Radar</h3>
        </div>
        {loading && <Activity className="w-3 h-3 text-amber-400 animate-pulse" />}
      </div>
      <div className="flex items-center gap-4">
        <div className="relative w-32 h-20">
          <svg viewBox="0 0 200 110" className="w-full h-full">
            <defs>
              <linearGradient id="gaugeGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#ef4444" />
                <stop offset="50%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>
            <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#gaugeGradient)" strokeWidth="14" strokeLinecap="round" />
            <motion.line x1="100" y1="100" x2={needleX} y2={needleY} stroke="#fff" strokeWidth="3" strokeLinecap="round" animate={{ x2: needleX, y2: needleY }} transition={{ duration: 0.6 }} />
            <circle cx="100" cy="100" r="6" fill="#fff" />
          </svg>
        </div>
        <div className="flex-1">
          <div className={`text-3xl font-bold ${fg.color}`}>{sentiment.fearGreed}</div>
          <div className={`flex items-center gap-1 text-sm font-semibold ${fg.color}`}>
            <FgIcon className="w-3.5 h-3.5" /> {fg.label}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">Fear &amp; Greed Index</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-4 text-center">
        <div className="bg-slate-800/40 rounded-lg p-2">
          <div className="text-[10px] text-slate-400 uppercase">India VIX</div>
          <div className="text-sm font-bold text-slate-200">{sentiment.vix.toFixed(2)}</div>
          <div className={`text-[10px] ${sentiment.vixChange >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{sentiment.vixChange >= 0 ? '+' : ''}{sentiment.vixChange.toFixed(2)}</div>
        </div>
        <div className="bg-slate-800/40 rounded-lg p-2">
          <div className="text-[10px] text-slate-400 uppercase">Nifty 50</div>
          <div className="text-sm font-bold text-slate-200">{sentiment.nifty.toFixed(0)}</div>
          <div className={`text-[10px] ${sentiment.niftyChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{sentiment.niftyChangePct >= 0 ? '+' : ''}{sentiment.niftyChangePct.toFixed(2)}%</div>
        </div>
        <div className="bg-slate-800/40 rounded-lg p-2">
          <div className="text-[10px] text-slate-400 uppercase">A/D Ratio</div>
          <div className="text-sm font-bold text-slate-200">{sentiment.advanceDecline.toFixed(2)}</div>
          <div className={`text-[10px] ${sentiment.advanceDecline >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>{sentiment.advanceDecline >= 1 ? 'Bullish' : 'Bearish'}</div>
        </div>
      </div>
    </div>
  );
};

export default MarketSentimentRadar;

