// components/portfolio/LiveMcsMonitor.tsx
// New panel on the Portfolio tab. Above the open-positions table.
// One card per held position. Collapsed by default.
// Spec: §6.4

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, ExternalLink, TrendingUp, TrendingDown } from 'lucide-react';
import { useMceStore } from '../../store/mceStore';
import { useHoldSnapshot } from '../../hooks/useMcsSnapshot';
import { useNavigationIntentStore } from '../../store/navigationIntentStore';
import { McsHoldBadge } from '../alpha/McsHoldBadge';
import { McsSubScoreCard } from '../alpha/McsSubScoreCard';

function pickBullets(s: { reason: string }): string[] {
  return s.reason.split(';').map(p => p.trim()).filter(Boolean).slice(0, 3);
}

export const LiveMcsMonitor: React.FC = () => {
  const [open, setOpen] = useState(false);
  // 2026-06-19: do NOT call `Array.from(...)` inside the Zustand selector —
  // that returns a fresh array reference every time, which makes Zustand's
  // `Object.is` snapshot comparison always fail → infinite render loop.
  // The Map itself is a stable reference; we derive the keys via useMemo
  // off the Map. When the Map is mutated in place (the store's pattern),
  // the Map ref doesn't change, so `useMemo` doesn't re-derive. That's
  // safe because the store has no mutation that affects render output
  // without bumping the Map's identity (it replaces the Map on update).
  const positionsMap = useMceStore(s => s.holdSnapshots);
  const positions = React.useMemo(
    () => Array.from(positionsMap.keys()),
    [positionsMap]
  );

  return (
    <section className="glass-card mb-4" aria-label="Live Momentum Monitor">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="live-mcs-panel"
        className="w-full flex items-center justify-between px-5 py-3 text-left"
      >
        <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
          Live Positions · Momentum Continuation
        </span>
        <span className="flex items-center gap-2 text-xs text-slate-300">
          {positions.length} open
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="live-mcs-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5">
              {positions.length === 0 ? (
                <p className="text-xs text-slate-400">No live positions yet — open a trade to start the monitor.</p>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {positions.map(sym => (
                    <PositionMcsCard key={sym} symbol={sym} />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

const PositionMcsCard: React.FC<{ symbol: string }> = ({ symbol }) => {
  const hold = useHoldSnapshot(symbol);
  const navigate = useNavigationIntentStore(s => s.setIntent);
  if (!hold || !hold.current) return null;
  const { current, delta, holdVerdict } = hold;
  const DeltaIcon = delta >= 0 ? TrendingUp : TrendingDown;
  const deltaCls = delta >= 0 ? 'text-emerald-300' : 'text-rose-300';

  return (
    <article className="min-w-[280px] max-w-[320px] glass-card p-4 flex-shrink-0">
      <header className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-white">{symbol}</h3>
        <McsHoldBadge verdict={holdVerdict} />
      </header>
      <p className="text-xs text-slate-300 mb-3">
        MCS <span className="font-semibold text-white tabular-nums">{current.score.total}</span>
        <span className="text-slate-500"> · conf {Math.round(current.score.confidence * 100)}%</span>
      </p>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <McsSubScoreCard label="HTF"  score={current.score.subScores.htf}  bullets={pickBullets(current.score.subScores.htf)} />
        <McsSubScoreCard label="Flow" score={current.score.subScores.flow} bullets={pickBullets(current.score.subScores.flow)} />
      </div>

      {hold.fillMcs != null && (
        <p className={`text-xs flex items-center gap-1 mb-3 ${deltaCls}`}>
          <DeltaIcon className="w-3 h-3" />
          {delta >= 0 ? '+' : ''}{delta} since fill (fill MCS {hold.fillMcs})
        </p>
      )}

      <button
        type="button"
        onClick={() => navigate({
          target: 'alpha',
          action: 'focus-mcs',
          payload: { symbol },
          createdAt: Date.now(),
        })}
        className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200"
      >
        view on alpha <ExternalLink className="w-3 h-3" />
      </button>
    </article>
  );
};