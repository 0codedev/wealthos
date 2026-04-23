/**
 * DemoModePill — persistent amber pill in the nav when demo data is active.
 *
 * Owned by: First-run demo + guided critical path (UX-Audit Top-10 #1).
 *
 * Renders nothing when `useFirstRunStore.demoMode === false`. Otherwise
 * shows a clickable pill (`StatusPill`-style amber) that opens a small
 * confirm popover with two actions:
 *   - "Clear demo & start fresh"  → soft-deletes demo rows + pushes Undo
 *   - "Keep demo"                  → just closes the popover
 *
 * The Clear action uses `lib/undoStack.ts` (kind: 'generic') so the user
 * can recover within 30s without re-seeding.
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Trash2, X, RotateCcw } from 'lucide-react';
import { COPY } from '../../utils/appCopy';
import { useFirstRunStore } from '../../store/firstRunStore';
import { useDemoMode, isDemoMode } from '../../lib/demoMode';
import {
  clearDemoPortfolio,
  countDemoRows,
  restoreDemoPortfolio,
} from '../../services/seedDemoPortfolio';
import { useToast } from './ToastProvider';
import { pushUndo } from '../../lib/undoStack';

export const DemoModePill: React.FC = () => {
  const { demoMode, demoRowCount } = useDemoMode();
  const setDemoRowCount = useFirstRunStore((s) => s.setDemoRowCount);
  const exitDemoMode = useFirstRunStore((s) => s.exitDemoMode);
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Re-hydrate the count from Dexie on mount + whenever the pill becomes
  // visible (in case rows were added by re-seeding elsewhere).
  useEffect(() => {
    if (demoMode) {
      countDemoRows()
        .then((n) => setDemoRowCount(n))
        .catch(() => {});
    }
  }, [demoMode, setDemoRowCount]);

  if (!demoMode) return null;

  const handleClear = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const cleared = await clearDemoPortfolio();
      const total =
        cleared.holdings + cleared.trades + cleared.reviews + cleared.mistakes + cleared.goals;
      // Snapshot for Undo before we close the pill
      pushUndo({
        kind: 'generic',
        label: 'Demo data',
        message: 'Demo data cleared',
        undo: async () => {
          await restoreDemoPortfolio();
          setDemoRowCount(await countDemoRows());
          toast.success(COPY.firstRun.toasts.demoRestored);
        },
      });
      setDemoRowCount(0);
      exitDemoMode();
      setConfirmOpen(false);
      toast.success(COPY.firstRun.toasts.demoCleared);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not clear demo data.');
    } finally {
      setBusy(false);
    }
  };

  const label = COPY.firstRun.pill.label(demoRowCount);

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[80]">
      <div className="relative">
        <motion.button
          type="button"
          initial={{ y: -8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -8, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 24 }}
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => setConfirmOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={confirmOpen}
          aria-label={label}
          className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-200 shadow-lg shadow-amber-500/10 backdrop-blur hover:bg-amber-500/25 hover:border-amber-400/70 transition-colors"
        >
          <Sparkles size={11} />
          {label}
        </motion.button>

        <AnimatePresence>
          {confirmOpen && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              role="dialog"
              aria-modal="false"
              aria-labelledby="demo-pill-title"
              className="absolute left-1/2 top-full mt-2 -translate-x-1/2 w-[320px] rounded-2xl border border-amber-400/30 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-xl"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-200">
                    <Sparkles size={14} />
                  </span>
                  <p id="demo-pill-title" className="text-sm font-bold text-white">
                    {COPY.firstRun.pill.clearTitle}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="text-white/40 hover:text-white"
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </div>
              <p className="mt-2 text-[11px] text-white/65 leading-relaxed">
                {COPY.firstRun.pill.clearBody}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={busy}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-500/90 px-3 py-2 text-[11px] font-bold text-amber-950 hover:bg-amber-400 disabled:opacity-60 transition-colors"
                >
                  <Trash2 size={12} />
                  {COPY.firstRun.pill.clearConfirm}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 px-3 py-2 text-[11px] font-semibold text-white/80 hover:bg-white/10 transition-colors"
                >
                  <RotateCcw size={12} />
                  {COPY.firstRun.pill.clearCancel}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default DemoModePill;
