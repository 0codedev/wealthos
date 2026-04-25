import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import { useNetworkStatus, EffectiveType } from '../../hooks/useNetworkStatus';

/**
 * CC46 #5 — Premium resilience layer.
 *
 * Sticky pill rendered in the top-right of the main view. Visible only
 * when something is wrong with the connection — keeps a clean default
 * state for users on healthy networks.
 *
 *  - offline  → red pill: "You're offline — changes will sync when you're back"
 *  - slow     → amber pill: "Slow connection — some features may be limited"
 *  - healthy  → hidden
 */
const SLOW_TYPES = new Set<EffectiveType>(['slow-2g', '2g']);

export const ConnectionPill: React.FC = () => {
  const { isOnline, effectiveType } = useNetworkStatus();
  const isSlow = SLOW_TYPES.has(effectiveType);

  // Determine the message and tone BEFORE rendering the wrapper so
  // AnimatePresence only mounts when there's actually something to show.
  const tone = !isOnline ? 'offline' : isSlow ? 'slow' : 'ok';
  if (tone === 'ok') return null;

  const isOffline = tone === 'offline';

  return (
    <AnimatePresence>
      <motion.div
        key={tone}
        role="status"
        aria-live="polite"
        initial={{ opacity: 0, y: -8, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.96 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className={[
          'pointer-events-none fixed right-3 top-3 z-[300] flex items-center gap-2',
          'rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider',
          'shadow-lg backdrop-blur-md',
          isOffline
            ? 'border-rose-500/30 bg-rose-500/15 text-rose-200 shadow-rose-500/10'
            : 'border-amber-500/30 bg-amber-500/15 text-amber-100 shadow-amber-500/10',
        ].join(' ')}
      >
        {isOffline ? <WifiOff size={12} /> : <AlertTriangle size={12} />}
        <span>
          {isOffline
            ? "You're offline — changes will sync when you're back"
            : `Slow ${effectiveType.toUpperCase()} — some features may be limited`}
        </span>
        {!isOffline && <Wifi size={10} className="opacity-50" />}
      </motion.div>
    </AnimatePresence>
  );
};

export default ConnectionPill;
