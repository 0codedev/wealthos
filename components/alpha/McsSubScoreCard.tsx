// components/alpha/McsSubScoreCard.tsx
// Single sub-score card. Bar + bullets + reason chip.

import React from 'react';
import { motion } from 'framer-motion';
import { McsSubScore } from '../../services/mce/types';
import { useInterpolatedValue } from '../../utils/mceInterpolator';

interface Props {
  label: string;
  score: McsSubScore;
  bullets: string[];
}

export const McsSubScoreCard: React.FC<Props> = ({ label, score, bullets }) => {
  const v = useInterpolatedValue(score.value * 100, 1800);
  const pct = Math.round(v);
  const tone =
    score.value >= 0.7 ? 'bg-emerald-500/30 border-emerald-400/40'
    : score.value >= 0.45 ? 'bg-amber-500/25 border-amber-400/40'
    : 'bg-rose-500/25 border-rose-400/40';

  return (
    <div className={`rounded-xl border p-4 ${tone} backdrop-blur-sm`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wider text-slate-300">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-white">
          {pct}<span className="text-slate-400 text-xs">/100</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800/60 overflow-hidden mb-3" aria-hidden>
        <motion.div
          className="h-full bg-gradient-to-r from-emerald-400 via-amber-300 to-rose-400"
          style={{ width: `${pct}%` }}
          initial={false}
        />
      </div>
      <ul className="space-y-1 text-xs text-slate-200">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-1.5">
            <span aria-hidden>•</span><span>{b}</span>
          </li>
        ))}
      </ul>
      {!score.dataAvailable && (
        <p className="mt-2 text-[10px] uppercase tracking-wider text-slate-400">
          data unavailable — assuming neutral
        </p>
      )}
    </div>
  );
};