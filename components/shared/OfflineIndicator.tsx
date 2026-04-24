/**
 * OfflineIndicator — small pill in the bottom-middle.
 *
 * Behaviour:
 *   - On entry: fades+rises in, holds for 5s, fades+rises out.
 *   - If the user stays offline for more than 30s, the pill becomes
 *     persistent (visible for the entire session).
 *   - On online transition: fades+rises out via AnimatePresence.
 *
 * Reads from the offline store (driven by navigator.onLine + 30s probe).
 *
 * Owned by: Offline mode (Top-10 #4). The top strip is
 * `components/shared/OfflineBanner.tsx`.
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOfflineStore } from '../../store/offlineStore';
import { COPY } from '../../utils/appCopy';

const TOAST_DURATION_MS = 5_000;
const PERSIST_AFTER_MS = 30_000;

const OfflineIndicator: React.FC = () => {
  const isOffline = useOfflineStore((s) => s.isOffline);
  const lastTransitionAt = useOfflineStore((s) => s.lastTransitionAt);
  const [phase, setPhase] = useState<'enter' | 'hold' | 'hidden' | 'persistent'>('hidden');

  useEffect(() => {
    if (!isOffline) {
      setPhase('hidden');
      return;
    }
    // Just entered offline: show the 5s toast, then auto-hide.
    setPhase('enter');
    const hideTimer = setTimeout(() => setPhase('hidden'), TOAST_DURATION_MS);
    const persistTimer = setTimeout(() => setPhase('persistent'), PERSIST_AFTER_MS);
    return () => {
      clearTimeout(hideTimer);
      clearTimeout(persistTimer);
    };
  }, [isOffline, lastTransitionAt]);

  const visible = isOffline && (phase === 'enter' || phase === 'hold' || phase === 'persistent');

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="offline-pill"
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          role="status"
          aria-live="polite"
          className="fixed bottom-[max(5rem,calc(env(safe-area-inset-bottom)+4.25rem))] left-1/2 -translate-x-1/2 z-50 bg-slate-800/90 backdrop-blur-sm text-slate-200 px-3.5 py-1.5 rounded-full shadow-md border border-slate-700/60 flex items-center gap-2"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-slate-400/60 opacity-60 animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-slate-400/80" />
          </span>
          <span className="text-xs font-medium tracking-wide">{COPY.network.pill}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OfflineIndicator;
