import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, CheckCircle2, Clock, X, Database } from 'lucide-react';
import { useRefreshProgressStore } from '../../store/refreshProgressStore';

export const RefreshProgressOverlay: React.FC = () => {
  const {
    activeRefresh,
    progress,
    statusText,
    steps,
    timeRemaining,
    isCache,
    cancelRefresh
  } = useRefreshProgressStore();

  if (!activeRefresh) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -15 }}
          transition={{ type: 'spring', duration: 0.4 }}
          className="relative w-full max-w-md overflow-hidden bg-slate-900/80 dark:bg-slate-950/80 border border-slate-200/10 rounded-2xl shadow-[0_0_50px_0_rgba(99,102,241,0.15)] glassmorphic-panel"
        >
          {/* Header */}
          <div className="p-5 border-b border-slate-200/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg animate-pulse">
                {isCache ? <Database size={18} /> : <RefreshCw size={18} className="animate-spin-slow" />}
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
                  Syncing System Data
                </h3>
                <p className="text-xs text-slate-400 font-medium">
                  {activeRefresh.label}
                </p>
              </div>
            </div>
            <button
              onClick={cancelRefresh}
              aria-label="Cancel Sync"
              className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Progress Bar Panel */}
          <div className="p-6 space-y-4">
            <div className="flex justify-between items-end text-xs font-semibold">
              <span className="text-indigo-400 font-mono tracking-wider">
                {progress}%
              </span>
              {timeRemaining > 0 && (
                <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                  <Clock size={12} />
                  Est. {timeRemaining}s left
                </span>
              )}
            </div>

            {/* Glowing progress line */}
            <div className="relative h-2 w-full bg-slate-800 rounded-full overflow-hidden">
              <motion.div
                className="absolute top-0 left-0 h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500 rounded-full"
                style={{ width: `${progress}%` }}
                layoutId="progressBarWidth"
                transition={{ ease: 'easeOut', duration: 0.2 }}
              />
              <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(255,255,255,0.15)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.15)_50%,rgba(255,255,255,0.15)_75%,transparent_75%,transparent)] bg-[length:1rem_1rem] animate-[progress-bar-stripes_1s_linear_infinite] opacity-30" />
            </div>

            {/* Status text */}
            <div className="text-xs font-medium text-slate-300 italic min-h-[16px] text-center">
              {statusText}
            </div>

            {/* Steps Checklist */}
            {steps.length > 0 && (
              <div className="pt-2 mt-2 border-t border-slate-200/5 space-y-2.5">
                {steps.map((step, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <span className={`font-semibold ${step.status === 'done' ? 'text-slate-400 line-through' : step.status === 'active' ? 'text-indigo-400 font-bold' : 'text-slate-500'}`}>
                      {step.label}
                    </span>
                    <div>
                      {step.status === 'done' ? (
                        <CheckCircle2 size={14} className="text-emerald-500" />
                      ) : step.status === 'active' ? (
                        <div className="w-3.5 h-3.5 border-2 border-indigo-500/25 border-t-indigo-500 rounded-full animate-spin" />
                      ) : (
                        <div className="w-3.5 h-3.5 border border-slate-700 rounded-full" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
