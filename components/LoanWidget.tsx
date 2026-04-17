
import React, { useEffect, useRef, memo } from 'react';
import { Landmark, TrendingDown, AlertTriangle, Droplet } from 'lucide-react';
import { formatCurrency } from '../utils/helpers';
import { useSettingsStore } from '../store/settingsStore';

const LoanWidget: React.FC = () => {
  const loanPrincipal = useSettingsStore(state => state.loanPrincipal);
  const loanInterest = useSettingsStore(state => state.loanInterest);

  // Calculate Daily Bleed - Guard against NaN
  const principal = Number(loanPrincipal) || 0;
  const interest = Number(loanInterest) || 0;
  const dailyInterest = (principal * (interest / 100)) / 365;
  const hourlyInterest = dailyInterest / 24;
  const interestPerSecond = hourlyInterest / 3600;

  // Direct DOM manipulation ref to bypass React Render Cycle for high-frequency updates
  const bleedRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let animationFrameId: number;

    // PERSISTENCE FIX: Check session storage for start time
    const SESSION_KEY = 'loan_bleed_start_time';
    let savedStart = sessionStorage.getItem(SESSION_KEY);

    if (!savedStart) {
      savedStart = Date.now().toString();
      sessionStorage.setItem(SESSION_KEY, savedStart);
    }

    const startTime = parseInt(savedStart, 10);

    const animate = () => {
      if (bleedRef.current) {
        // Calculate accrued interest since component mount (or session start)
        const now = Date.now();
        const elapsedSeconds = (now - startTime) / 1000;
        const accrued = elapsedSeconds * interestPerSecond;

        // Direct DOM update - No React Diffing
        bleedRef.current.innerText = `+${accrued.toFixed(5)}`;
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    // Start the loop
    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [interestPerSecond]);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-rose-100 dark:border-rose-900/30 relative overflow-hidden group h-full">
      <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
        <Landmark size={100} className="text-rose-500" />
      </div>

      <div className="relative z-10 flex flex-col h-full justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 rounded-lg">
                <Landmark size={20} />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 dark:text-white">Active Liability</h3>
                <p className="text-xs text-slate-500">Debt Manager</p>
              </div>
            </div>
            <span className="text-xs font-bold text-rose-600 dark:text-rose-500 bg-rose-50 dark:bg-rose-900/20 px-2 py-1 rounded border border-rose-200 dark:border-rose-800">
              {loanInterest}% APR
            </span>
          </div>

          <div className="mb-4">
            <p className="text-xs text-slate-500 uppercase font-bold mb-1">Outstanding Principal</p>
            <h2 className="text-2xl font-mono font-bold text-rose-600 dark:text-rose-400">
              -{formatCurrency(loanPrincipal)}
            </h2>
          </div>
        </div>

        <div>
          <div className="bg-rose-50 dark:bg-rose-950/30 rounded-xl p-3 border border-rose-100 dark:border-rose-900/50">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-rose-600 dark:text-rose-400 uppercase flex items-center gap-1">
                <TrendingDown size={14} /> The Bleed
              </span>
              <span className="text-[10px] text-rose-400">Interest Cost</span>
            </div>
            <div className="flex items-baseline justify-between">
              <div className="flex items-center gap-2">
                <div className="text-lg font-bold text-rose-600 dark:text-rose-500 flex items-center">
                  <Droplet size={12} className="text-rose-600 animate-drop mr-1 fill-rose-600" />
                  ₹{dailyInterest.toFixed(2)}
                </div>
                <span className="text-xs text-rose-400"> / day</span>
              </div>
              <div className="text-right opacity-50 text-[10px] font-mono text-rose-400">
                <span ref={bleedRef}>+0.0000</span> since session
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 text-[10px] text-slate-400 italic">
            <AlertTriangle size={12} />
            <span>This debt reduces your real Net Worth.</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Memoize to prevent re-renders from parent Dashboard updates
export default memo(LoanWidget);
