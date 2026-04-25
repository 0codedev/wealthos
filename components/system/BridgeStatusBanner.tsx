import React, { useEffect, useState, useRef } from 'react';
import { Server, ShieldAlert, CheckCircle2, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../shared/ToastProvider';

// --- CC116: Market-hours-aware polling ---
//
// The bridge's `/` endpoint now returns `next_change_in` (seconds until market
// status flips: open → close or close → next open). When the bridge is up and
// returns a reasonable number, we schedule a SINGLE check at the next change
// instead of polling every 3s forever. During outages we fall back to
// exponential backoff (3s → 6s → 12s → 24s → 30s cap) just like CC115 T2.
//
// This means a healthy dev session makes 1 network call at 9:15 IST, then
// waits until 15:30, then 1 more call. ~0 background traffic vs ~28,800/day.

const POLL_INITIAL_MS = 60000;
const POLL_MAX_MS = 60000;
const NEXT_CHANGE_MAX_MS = 12 * 60 * 60 * 1000; // 12h safety cap

const computeBackoff = (consecutiveFailures: number): number => {
  return Math.min(POLL_MAX_MS, 5000 * Math.pow(2, consecutiveFailures));
};

interface BridgeRootResponse {
  is_market_hours?: boolean;
  next_change_in?: number;
  market_status?: {
    is_open: boolean;
    seconds_until_change: number;
    reason: string;
  };
}

export const BridgeStatusBanner: React.FC = () => {
  const { toast } = useToast();
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [secondsOffline, setSecondsOffline] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const toastShownRef = useRef(false);
  const consecutiveFailuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleNext = (delayMs: number) => {
    clearTimer();
    if (typeof document !== 'undefined' && document.hidden) {
      return;
    }
    timerRef.current = setTimeout(() => { void checkBridge(); }, delayMs);
  };

  const checkBridge = async () => {
    let nextDelay: number | null = null;
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 6000);
      const res = await fetch('/api/python-nse/', { signal: controller.signal });
      clearTimeout(id);

      if (!res.ok) throw new Error('Not OK');

      const data: BridgeRootResponse = await res.json().catch(() => ({}));
      const hadFailed = consecutiveFailuresRef.current >= 2;
      const isRestored = status === 'offline' && hadFailed;
      consecutiveFailuresRef.current = 0;

      setStatus('online');
      setSecondsOffline(0);

      if (isRestored) {
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 3000);
        if (toastShownRef.current) {
          toast.success('Python Bridge connection restored.');
          toastShownRef.current = false;
        }
      }

      // --- CC116: use server-supplied next_change_in ---
      // Server tells us "next state change in N seconds". Frontend schedules
      // exactly one request at that moment instead of polling forever.
      const serverNextSecs = data.next_change_in ?? data.market_status?.seconds_until_change;
      if (typeof serverNextSecs === 'number' && serverNextSecs > 0) {
        const capped = Math.min(serverNextSecs * 1000, NEXT_CHANGE_MAX_MS);
        // Minimum 10s so we don't busy-loop on a 0/negative value edge case.
        nextDelay = Math.max(10000, capped);
      } else {
        nextDelay = POLL_INITIAL_MS;
      }
    } catch (e) {
      consecutiveFailuresRef.current += 1;
      // Only transition to offline if 2 consecutive pings fail
      if (consecutiveFailuresRef.current >= 2) {
        const wasOnline = status === 'online';
        if (wasOnline) setSecondsOffline(0);
        setStatus('offline');
        
        const added = Math.round(computeBackoff(consecutiveFailuresRef.current) / 1000);
        setSecondsOffline(prev => prev + added);

        if (!toastShownRef.current) {
          toast.warning('Python Bridge is unreachable. Retrying in background...', { duration: 6000 });
          toastShownRef.current = true;
        }
      }
      nextDelay = computeBackoff(consecutiveFailuresRef.current);
    } finally {
      scheduleNext(nextDelay ?? POLL_INITIAL_MS);
    }
  };

  useEffect(() => {
    void checkBridge();
    const onVisibilityChange = () => {
      if (!document.hidden) {
        void checkBridge();
      } else {
        clearTimer();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return (
    <div className="fixed top-[max(1rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[9999] w-full max-w-md px-4 font-sans no-select pointer-events-none">
      <AnimatePresence>
        {/* Offline Warning Banner is suppressed in favor of background retries and a single toast warning */}

        {/* Transition State (Connecting... shown during initial check or brief disconnects before 15s limit) */}
        {status === 'checking' && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-full border border-indigo-500/20 bg-slate-900/90 backdrop-blur-md text-white shadow-lg mx-auto w-fit"
          >
            <Server size={14} className="text-indigo-400 animate-pulse" />
            <span className="text-[10px] font-bold tracking-wide">Connecting to API Engine...</span>
          </motion.div>
        )}

        {/* Success Connected Banner (brief popup) */}
        {status === 'online' && showSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/90 backdrop-blur-md text-white shadow-xl mx-auto w-fit"
          >
            <CheckCircle2 size={12} className="text-emerald-400 animate-bounce" />
            <span className="text-[9px] font-black uppercase tracking-wider text-emerald-400">API Connection Restored</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
