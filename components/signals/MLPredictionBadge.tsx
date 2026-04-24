import React, { useState, useEffect } from 'react';
import { signalMLEngine } from '../../services/SignalMLEngine';
import { ParsedSignal } from '../../database';
import { Cpu } from 'lucide-react';

interface MLPredictionBadgeProps {
  signal: ParsedSignal;
  refreshTrigger?: number;
}

export const MLPredictionBadge: React.FC<MLPredictionBadgeProps> = ({ signal, refreshTrigger }) => {
  const [prob, setProb] = useState<number | null>(null);
  const [estPnL, setEstPnL] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const runPrediction = async () => {
      setLoading(true);
      const pred = await signalMLEngine.predict(signal);
      if (active) {
        setProb(pred.probability);
        setEstPnL(pred.expectedPnL);
        setLoading(false);
      }
    };
    runPrediction();
    return () => { active = false; };
  }, [signal, refreshTrigger]);

  if (loading || prob === null) {
    return (
      <span className="text-[10px] text-slate-500 font-mono animate-pulse">
        Calculating...
      </span>
    );
  }

  // Determine color coding
  let bgClass = 'bg-slate-900/40 text-slate-400 border-slate-800/80';
  let textClass = 'text-slate-400';
  if (prob >= 65) {
    bgClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    textClass = 'text-emerald-400';
  } else if (prob >= 45) {
    bgClass = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    textClass = 'text-amber-400';
  } else {
    bgClass = 'bg-rose-500/10 text-rose-400 border-rose-500/20';
    textClass = 'text-rose-400';
  }

  const formattedPnL = estPnL !== null ? (estPnL >= 0 ? `+₹${estPnL.toLocaleString('en-IN')}` : `-₹${Math.abs(estPnL).toLocaleString('en-IN')}`) : '';

  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <span
        title={`On-device Neural Net predictions based on provider win rates & R:R. Est. PnL: ${formattedPnL}`}
        className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold flex items-center gap-1 cursor-help ${bgClass}`}
      >
        <Cpu className="w-2.5 h-2.5" />
        {prob}%
      </span>
      {estPnL !== null && (
        <span className={`text-[10px] font-bold font-mono tracking-tight ${estPnL >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
          {formattedPnL} EV
        </span>
      )}
    </div>
  );
};
