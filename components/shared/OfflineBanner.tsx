/**
 * OfflineBanner — soft slate status strip across the top of the app,
 * visible the entire offline session. Reads as a calm status bar,
 * not an alert.
 *
 * Owned by: Offline mode (Top-10 #4).
 */
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOfflineStore } from '../../store/offlineStore';
import { COPY } from '../../utils/appCopy';

export const OfflineBanner: React.FC = () => {
  const isOffline = useOfflineStore((s) => s.isOffline);
  return (
    <AnimatePresence>
      {isOffline && (
        <motion.div
          key="offline-banner"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          role="status"
          aria-live="polite"
          className="fixed top-0 inset-x-0 z-40 bg-slate-800/85 backdrop-blur-sm shadow-[inset_0_-1px_0_0_rgba(148,163,184,0.12)]"
        >
          <div className="flex items-center justify-center gap-2 py-1.5 px-3">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-slate-400/60 opacity-60 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-slate-400/80" />
            </span>
            <p className="text-[11px] font-medium tracking-wide text-slate-300">
              <span className="font-semibold text-white/90">{COPY.network.banner.title}</span>
              <span className="text-slate-400">
                {' — '}
                {COPY.network.banner.subtitle}
              </span>
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OfflineBanner;
