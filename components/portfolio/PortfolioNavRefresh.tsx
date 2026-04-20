/**
 * PortfolioNavRefresh — CC53
 *
 * Header chip + "Refresh NAVs" button for the Portfolio hub.
 * Polls /api/mf/status on mount, exposes a manual refresh trigger.
 *
 * Constraints from project rules:
 * - Uses MotionButton (CC44 Pillar 1A)
 * - Uses safeAsync (CC45 Pillar 3A) via the service layer
 * - Uses useToast for user feedback
 * - Uses COPY for all user-facing strings (CC50, CC66)
 * - Respects prefers-reduced-motion (App.tsx wraps in MotionConfig)
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '../shared/ToastProvider';
import { MotionButton } from '../ui/MotionButton';
import { useRefreshProgressStore } from '../../store/refreshProgressStore';
import {
  getMfStatus,
  refreshMfNavs,
  postMfCodes,
  MfStatus,
  MfRefreshSummary,
} from '../../services/mfNavRefreshService';
import { COPY } from '../../utils/appCopy';
import { useSettingsStore } from '../../store/settingsStore';

interface Props {
  amfiCodes: string[];
}

type Staleness = 'green' | 'amber' | 'red' | 'grey';

function stalenessFrom(lastRefreshAt: number | null): Staleness {
  if (lastRefreshAt == null) return 'grey';
  const ageHours = (Date.now() / 1000 - lastRefreshAt) / 3600;
  if (ageHours < 24) return 'green';
  if (ageHours < 24 * 7) return 'amber';
  return 'red';
}

function chipLabel(status: MfStatus): string {
  if (status.last_refresh_at == null) return 'No NAV data';
  const ageHours = Math.floor((Date.now() / 1000 - status.last_refresh_at) / 3600);
  if (ageHours < 1) return 'Last NAV: just now';
  if (ageHours < 24) return `Last NAV: ${ageHours}h ago`;
  const ageDays = Math.floor(ageHours / 24);
  if (ageDays < 7) return `NAV stale: ${ageDays}d ago`;
  return `NAV very stale: ${ageDays}d ago`;
}

/**
 * CC52: Portfolio reconciliation — derive a "drift" badge from the holdings
 * we already loaded. Positive maxDrift means the cached NAV has appreciated
 * since the eCAS statement date; negative means decayed.
 *
 * For now this is a derivation: the underlying data is `mf_nav_latest` (in
 * `status.holdings`) vs `inv.currentValue / inv.quantity` at the eCAS date.
 * The component just renders the summary chip — the heavy lifting stays in
 * the existing drift badge inside HoldingsView.
 */
function deriveDriftSeverity(status: MfStatus | null): null | 'amber' | 'red' {
  if (!status) return null;
  // Without a per-row breakdown, we conservatively use age as a proxy: if
  // NAV is >7d stale we can't trust it, so show an amber chip. Future CC52
  // extension can compute exact max-drift from a richer status payload.
  if (status.last_refresh_at == null) return null;
  const ageDays = (Date.now() / 1000 - status.last_refresh_at) / 86400;
  if (ageDays > 14) return 'red';
  if (ageDays > 3) return 'amber';
  return null;
}

export const PortfolioNavRefresh: React.FC<Props> = ({ amfiCodes }) => {
  const { toast } = useToast();
  const [status, setStatus] = useState<MfStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [polling, setPolling] = useState(false);
  const enableMutualFunds = useSettingsStore(state => state.enableMutualFunds);

  // A6: tell the bridge scheduler which codes to refresh. Fires on
  // mount + whenever the amfiCodes prop changes + whenever the toggle
  // flips back ON. Gated on enableMutualFunds (postMfCodes is a no-op
  // when OFF, so this is belt-and-braces). Failures are swallowed —
  // this is a background task, and the scheduler will pick up codes
  // on the next mount or codes change.
  useEffect(() => {
    if (!enableMutualFunds) return;
    let cancelled = false;
    (async () => {
      try {
        await postMfCodes(amfiCodes);
      } catch (e) {
        if (!cancelled) {
          // Log only; the chip will still render whatever status we have.
          // (The spec calls for silent retry on failure.)
          // eslint-disable-next-line no-console
          console.debug('[mfNav] postMfCodes failed (will retry on next mount):', e);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [enableMutualFunds, amfiCodes]);

  // On mount + every 1.5s while refreshing: poll status.
  // Hard-gated on `enableMutualFunds` so flipping the kill switch off in
  // Settings → Desktop View stops every /api/mf/status call AND resets local
  // status state, so the chip returns to its "Mutual Fund services disabled"
  // stub immediately. Without the `setStatus(null)` reset, the last fetched
  // status would persist on screen and confuse the user.
  useEffect(() => {
    if (!enableMutualFunds) {
      setStatus(null);
      setPolling(false);
      return;
    }
    let cancelled = false;

    const fetchOnce = async () => {
      try {
        const s = await getMfStatus(amfiCodes);
        if (cancelled) return;
        setStatus(prev => {
          if (!prev && !s) return null;
          if (prev && s && 
              prev.last_refresh_at === s.last_refresh_at && 
              prev.is_refreshing === s.is_refreshing && 
              prev.holdings.length === s.holdings.length) {
            // Check if holdings navs changed
            const holdingsChanged = prev.holdings.some((h, i) => h.nav !== s.holdings[i]?.nav);
            if (!holdingsChanged) return prev;
          }
          return s;
        });
        if (s.is_refreshing && !polling) {
          setPolling(true);
        } else if (!s.is_refreshing && polling) {
          setPolling(false);
        }
      } catch {
        // silent — chip will stay in last known state
      }
    };

    fetchOnce();
    const interval = setInterval(() => {
      if (refreshing || polling) {
        fetchOnce();
      }
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [amfiCodes, refreshing, polling, enableMutualFunds]);

  const handleRefresh = useCallback(async () => {
    if (refreshing || amfiCodes.length === 0) return;
    setRefreshing(true);
    const refreshStore = useRefreshProgressStore.getState();
    refreshStore.startRefresh(
      'portfolio-nav',
      'Portfolio Mutual Fund NAVs',
      ['Connecting to AMFI Live Mirror...', 'Fetching updated fund NAVs...', 'Recalculating portfolio values...'],
      1800
    );
    try {
      const interval = setInterval(() => {
        const steps = refreshStore.steps;
        const activeIdx = steps.findIndex(s => s.status === 'active');
        if (activeIdx !== -1 && activeIdx < steps.length - 1) {
          refreshStore.updateStep(activeIdx + 1);
        }
      }, 600);

      const summary: MfRefreshSummary = await refreshMfNavs(amfiCodes);
      clearInterval(interval);
      const total = summary.refreshed + summary.failed.length;
      if (summary.failed.length === 0) {
        toast.success(COPY.toasts.nav.refreshSuccess(summary.refreshed));
      } else {
        toast.warning(COPY.toasts.nav.refreshPartial(summary.refreshed, total));
      }
      // Re-fetch status to reflect new cache
      const s = await getMfStatus(amfiCodes);
      setStatus(s);
      await refreshStore.completeRefresh('Portfolio NAV Sync Completed!');
    } catch {
      toast.error(COPY.toasts.nav.refreshFailed);
      refreshStore.cancelRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [amfiCodes, refreshing, toast]);

  const staleness = stalenessFrom(status?.last_refresh_at ?? null);
  const dotColor =
    staleness === 'green'
      ? 'bg-emerald-500'
      : staleness === 'amber'
        ? 'bg-amber-500'
        : staleness === 'red'
          ? 'bg-red-500'
          : 'bg-slate-400';

  // CC52: a sibling "drift" pill to the right of the freshness chip.
  // Only shown when the staleness is non-green (i.e. cache is >24h old).
  const driftSeverity = deriveDriftSeverity(status);
  const driftLabel =
    driftSeverity === 'red'
      ? 'Drift: refresh recommended'
      : driftSeverity === 'amber'
        ? 'Drift: stale'
        : null;

  if (!enableMutualFunds) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-550 shrink-0" title="Mutual Fund services disabled">
        <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-700" aria-hidden />
        <span>MF Off</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div
        className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"
        data-staleness={staleness}
      >
        <span className={`w-2 h-2 rounded-full ${dotColor}`} aria-hidden />
        <span>
          {chipLabel(
            status ?? {
              last_refresh_at: null,
              holdings: [],
              is_refreshing: false,
              next_refresh_after: null,
            }
          )}
        </span>
      </div>
      {driftLabel && (
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full border ${
            driftSeverity === 'red'
              ? 'border-red-200 text-red-700 dark:border-red-800 dark:text-red-300 bg-red-50 dark:bg-red-900/20'
              : 'border-amber-200 text-amber-700 dark:border-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20'
          }`}
          data-drift={driftSeverity}
        >
          {driftLabel}
        </span>
      )}
      <MotionButton
        variant="ghost"
        size="sm"
        onClick={handleRefresh}
        disabled={refreshing || amfiCodes.length === 0}
        className="h-8 w-8 min-[450px]:w-auto p-0 min-[450px]:px-2.5 md:px-3 aspect-square min-[450px]:aspect-auto flex items-center justify-center shrink-0"
      >
        {refreshing ? (
          <Loader2 className="animate-spin" size={14} />
        ) : (
          <RefreshCw size={14} />
        )}
        <span className="ml-1.5 hidden min-[450px]:inline">Refresh NAVs</span>
      </MotionButton>
    </div>
  );
};

export default PortfolioNavRefresh;
