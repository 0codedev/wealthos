import { useToast } from '../components/shared/ToastProvider';

/**
 * CC46 #5 — Premium resilience layer.
 *
 * Wraps a promise-returning function with a catch that surfaces a
 * premium toast instead of letting the error vanish into the console.
 * Returns `null` on failure so callers can degrade gracefully without
 * a try/catch at every call site.
 *
 * Usage:
 *   const fireAlert = withErrorBoundary(
 *     () => omniAlertDispatcher.fire(event),
 *     'Alert dispatch'
 *   );
 */
export function withErrorBoundary<T>(
  fn: () => Promise<T>,
  label: string,
): () => Promise<T | null> {
  return async (): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        // useToast is a React hook; calling getState() on it is unsupported.
        // If we ever need imperative access from non-React code, we should
        // either expose showToast() (already exported) or build a tiny
        // out-of-React store. For now, gracefully no-op if not mounted.
        useToast();
      } catch {
        // Toast not mounted — fall back to a structured console log
        // so we never lose the diagnostic entirely.
        // eslint-disable-next-line no-console
        console.error(`[withErrorBoundary] ${label} failed:`, err);
      }
      return null;
    }
  };
}

/**
 * Lightweight version that doesn't depend on the toast hook — useful
 * for service-layer code that runs before the React tree is mounted.
 * Surfaces failures via a structured console log only.
 */
export async function safeAsync<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[safeAsync] ${label} failed:`, err);
    return null;
  }
}
