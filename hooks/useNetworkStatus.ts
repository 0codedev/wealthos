import { useEffect, useState } from 'react';

export type EffectiveType = '2g' | '3g' | '4g' | 'slow-2g' | 'unknown';

export interface NetworkStatus {
  isOnline: boolean;
  effectiveType: EffectiveType;
  downlink: number | null;
  lastChangedAt: number;
}

/**
 * CC46 #5 — Premium resilience layer.
 *
 * Tracks `navigator.onLine` + the `navigator.connection` effectiveType.
 * Listens for `online`/`offline` events and the (non-standard but widely
 * supported) `change` event on the connection object. SSR-safe (returns
 * a safe default when `window` is undefined).
 */
const getInitial = (): NetworkStatus => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { isOnline: true, effectiveType: 'unknown', downlink: null, lastChangedAt: 0 };
  }
  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return {
    isOnline: navigator.onLine,
    effectiveType: (conn?.effectiveType as EffectiveType) ?? 'unknown',
    downlink: conn?.downlink ?? null,
    lastChangedAt: Date.now(),
  };
};

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(getInitial);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

    const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection;

    const stamp = (next: Partial<NetworkStatus>): void => {
      setStatus(prev => ({ ...prev, ...next, lastChangedAt: Date.now() }));
    };

    const onOnline = (): void => stamp({ isOnline: true });
    const onOffline = (): void => stamp({ isOnline: false });
    const onConnChange = (): void => {
      if (!conn) return;
      stamp({
        effectiveType: (conn.effectiveType as EffectiveType) ?? 'unknown',
        downlink: conn.downlink ?? null,
      });
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    conn?.addEventListener?.('change', onConnChange);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      conn?.removeEventListener?.('change', onConnChange);
    };
  }, []);

  return status;
}

interface NetworkInformation {
  effectiveType?: string;
  downlink?: number;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

export default useNetworkStatus;
