/**
 * FirstRunGate — the 3-button modal shown to brand-new users.
 *
 * Owned by: First-run demo + guided critical path (UX-Audit Top-10 #1).
 *
 * Reads COPY from utils/appCopy.ts (CC50). Motion reuses `appleEase` /
 * `fadeRise` variants (CC43). Status pills reused on each card for the
 * data-shape hint (CC49 design tokens).
 *
 * Mount: at the App root, conditional on `firstRunStore.firstRunComplete`
 * === false. Once the user picks a button, dismissFirstRun(path) flips
 * the store to complete.
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Sparkles, FilePlus2, Download, ArrowRight } from 'lucide-react';
import { COPY } from '../../utils/appCopy';
import { useFirstRunStore } from '../../store/firstRunStore';
import { seedDemoPortfolio, countDemoRows } from '../../services/seedDemoPortfolio';
import { useToast } from '../shared/ToastProvider';
import { useFirebaseAuth } from '../../contexts/FirebaseAuthContext';

const { gate } = COPY.firstRun;

export const FirstRunGate: React.FC = () => {
  const { user } = useFirebaseAuth();
  const firstRunComplete = useFirstRunStore((s) => s.firstRunComplete);
  const dismissFirstRun = useFirstRunStore((s) => s.dismissFirstRun);
  const setDemoRowCount = useFirstRunStore((s) => s.setDemoRowCount);
  const enterDemoMode = useFirstRunStore((s) => s.enterDemoMode);
  const { toast } = useToast();
  const [busy, setBusy] = useState<'import' | 'demo' | 'empty' | null>(null);

  // For authenticated Google users: automatically dismiss first-run onboarding
  useEffect(() => {
    if (user && !firstRunComplete) {
      dismissFirstRun('empty');
    }
  }, [user, firstRunComplete, dismissFirstRun]);

  // Defensive: if the store somehow loads with demoMode=true but the count
  // is 0 (stale localStorage), re-hydrate from Dexie on mount.
  useEffect(() => {
    if (firstRunComplete) {
      countDemoRows().then((n) => setDemoRowCount(n)).catch(() => {});
    }
  }, [firstRunComplete, setDemoRowCount]);

  if (firstRunComplete || !!user) return null;

  const handleDemo = async () => {
    if (busy) return;
    setBusy('demo');
    try {
      const result = await seedDemoPortfolio();
      const total =
        result.inserted.holdings +
        result.inserted.trades +
        result.inserted.reviews +
        result.inserted.mistakes +
        result.inserted.goals;
      enterDemoMode();
      setDemoRowCount(total);
      toast.success(
        COPY.firstRun.toasts.demoLoaded(
          result.inserted.holdings,
          result.inserted.trades,
          result.inserted.goals
        )
      );
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not load demo data.');
    } finally {
      setBusy(null);
    }
  };

  const handleEmpty = () => {
    if (busy) return;
    setBusy('empty');
    dismissFirstRun('empty');
    setBusy(null);
  };

  // "Import" — we don't open the import modal directly here (it's owned by
  // the App shell and requires Upstox/Dhan credentials wired in settings).
  // We dismiss the gate, which unblocks the dashboard where the user can
  // open the import via Settings or the empty-state CTAs.
  const handleImport = () => {
    if (busy) return;
    setBusy('import');
    dismissFirstRun('import');
    setBusy(null);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="absolute inset-0 bg-gradient-to-br from-indigo-950/95 via-slate-950/95 to-purple-950/95 backdrop-blur-xl"
        />
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 200, damping: 24 }}
          className="relative w-full max-w-3xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="first-run-title"
        >
          <div className="text-center mb-8">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-indigo-300/80 mb-2">
              {gate.eyebrow}
            </p>
            <h2
              id="first-run-title"
              className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3"
            >
              {gate.title}
            </h2>
            <p className="text-base text-white/60 max-w-xl mx-auto">{gate.subtitle}</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <GateCard
              icon={<Download size={20} />}
              tone="indigo"
              cta={gate.importCta}
              hint={gate.importHint}
              onClick={handleImport}
              loading={busy === 'import'}
            />
            <GateCard
              icon={<Sparkles size={20} />}
              tone="amber"
              cta={gate.demoCta}
              hint={gate.demoHint}
              onClick={handleDemo}
              loading={busy === 'demo'}
              recommended
            />
            <GateCard
              icon={<FilePlus2 size={20} />}
              tone="slate"
              cta={gate.emptyCta}
              hint={gate.emptyHint}
              onClick={handleEmpty}
              loading={busy === 'empty'}
            />
          </div>

          <p className="mt-6 text-center text-[11px] text-white/30 flex items-center justify-center gap-1.5">
            <Database size={11} />
            Self-hosted · IndexedDB · Your data never leaves this device.
          </p>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

interface GateCardProps {
  icon: React.ReactNode;
  tone: 'indigo' | 'amber' | 'slate';
  cta: string;
  hint: string;
  onClick: () => void;
  loading: boolean;
  recommended?: boolean;
}

const TONE_MAP: Record<GateCardProps['tone'], { bg: string; ring: string; icon: string; glow: string }> = {
  indigo: {
    bg: 'bg-gradient-to-br from-indigo-500/15 to-indigo-700/5 hover:from-indigo-500/25 hover:to-indigo-700/15',
    ring: 'ring-indigo-400/30 hover:ring-indigo-400/60',
    icon: 'bg-indigo-500/20 text-indigo-200',
    glow: 'shadow-indigo-500/10 hover:shadow-indigo-500/30',
  },
  amber: {
    bg: 'bg-gradient-to-br from-amber-500/15 to-amber-700/5 hover:from-amber-500/25 hover:to-amber-700/15',
    ring: 'ring-amber-400/30 hover:ring-amber-400/60',
    icon: 'bg-amber-500/20 text-amber-200',
    glow: 'shadow-amber-500/10 hover:shadow-amber-500/30',
  },
  slate: {
    bg: 'bg-gradient-to-br from-slate-500/10 to-slate-700/5 hover:from-slate-500/20 hover:to-slate-700/10',
    ring: 'ring-slate-400/20 hover:ring-slate-400/40',
    icon: 'bg-slate-500/20 text-slate-200',
    glow: 'shadow-slate-500/10 hover:shadow-slate-500/20',
  },
};

const GateCard: React.FC<GateCardProps> = ({
  icon,
  tone,
  cta,
  hint,
  onClick,
  loading,
  recommended,
}) => {
  const t = TONE_MAP[tone];
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={loading}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className={[
        'group relative flex flex-col items-start gap-3 rounded-2xl p-5 text-left',
        'ring-1 backdrop-blur-md transition-shadow shadow-lg',
        t.bg,
        t.ring,
        t.glow,
        loading ? 'opacity-60 cursor-wait' : 'cursor-pointer',
      ].join(' ')}
      aria-label={cta}
    >
      {recommended && (
        <span className="absolute -top-2 right-3 rounded-full bg-amber-400 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-950 shadow">
          Recommended
        </span>
      )}
      <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${t.icon}`}>
        {loading ? (
          <span className="block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
        ) : (
          icon
        )}
      </span>
      <div className="flex-1">
        <p className="text-[15px] font-bold text-white">{cta}</p>
        <p className="text-[11px] text-white/55 leading-snug mt-1">{hint}</p>
      </div>
      <ArrowRight
        size={14}
        className="absolute right-4 bottom-4 text-white/30 transition-transform group-hover:translate-x-1 group-hover:text-white/70"
      />
    </motion.button>
  );
};

export default FirstRunGate;
