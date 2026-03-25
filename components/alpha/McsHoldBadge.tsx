// components/alpha/McsHoldBadge.tsx
// Coloured chip showing HOLD / ADD_ELIGIBLE / TRIM_WATCH / EXIT_CANDIDATE.

import React from 'react';
import { McsHoldVerdict } from '../../services/mce/types';
import { TrendingUp, Pause, AlertTriangle, LogOut } from 'lucide-react';

const map: Record<McsHoldVerdict, { label: string; cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
  HOLD:           { label: 'HOLD',          cls: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40', Icon: Pause },
  ADD_ELIGIBLE:   { label: 'ADD ELIGIBLE',  cls: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40',          Icon: TrendingUp },
  TRIM_WATCH:     { label: 'TRIM WATCH',    cls: 'bg-amber-500/20 text-amber-200 border-amber-400/40',       Icon: AlertTriangle },
  EXIT_CANDIDATE: { label: 'EXIT',          cls: 'bg-rose-500/25 text-rose-200 border-rose-400/40',           Icon: LogOut },
};

export const McsHoldBadge: React.FC<{ verdict: McsHoldVerdict }> = ({ verdict }) => {
  const { label, cls, Icon } = map[verdict];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold tracking-wide ${cls}`}>
      <Icon className="w-3 h-3" /> {label}
    </span>
  );
};