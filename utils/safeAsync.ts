/**
 * safeAsync — Premium error-UX wrapper for async operations.
 *
 * Wraps an async function and returns a typed discriminated-union result
 * so callers can use `if (!res.ok)` without try/catch noise. On failure it
 * shows a toast (dismissable, with a "Copy details" action that copies
 * the error message + stack to the clipboard) and preserves the original
 * error for telemetry.
 *
 * Categories: `network` | `validation` | `permission` | `unknown`.
 *
 *   const res = await safeAsync(() => fetch('/api/quote'));
 *   if (!res.ok) return;            // toast already shown
 *   setQuote(res.data);
 *
 *   // Re-throw variant: same UX, but bubbles the original error upward.
 *   try { await safeAsyncOrThrow(() => db.trades.add(t)); } catch (e) { ... }
 */
import { showToast } from '../components/shared/ToastProvider';
import { logger } from '../services/Logger';

export type ErrorCode = 'network' | 'validation' | 'permission' | 'unknown';

export type SafeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: Error; code: ErrorCode; message: string };

const COPY = {
  errors: {
    network: "Couldn't connect right now. Your data is safe offline.",
    validation: 'Some fields look off. Check the highlighted inputs and try again.',
    permission: 'You do not have permission for this action.',
    unknown: 'Something unexpected happened. We logged the details.',
  },
} as const;

/** Shape-based category inference so callers can throw plain `new Error('...')`. */
function categorize(err: unknown): ErrorCode {
  if (!err) return 'unknown';
  const e = err as { name?: string; code?: string; status?: number; message?: string };
  if (typeof e.status === 'number') {
    if (e.status === 401 || e.status === 403) return 'permission';
    if (e.status === 400 || e.status === 422) return 'validation';
  }
  if (e.code === 'PERMISSION_DENIED' || e.code === 'permission') return 'permission';
  if (e.code === 'VALIDATION' || e.code === 'validation') return 'validation';
  if (e.name === 'NetworkError' || e.name === 'AbortError' || e.code === 'NETWORK' || e.code === 'network') return 'network';
  if (e.message && /\b(offline|network|failed to fetch|fetch failed|load failed|timeout|ENOTFOUND|ECONNRESET)\b/i.test(e.message)) {
    return 'network';
  }
  return 'unknown';
}

function copyDetails(error: Error): { label: string; onClick: () => void } {
  return {
    label: 'Copy details',
    onClick: () => {
      const payload = `${error.name || 'Error'}: ${error.message}\n${error.stack || ''}`;
      // Clipboard with a non-secure-context fallback.
      try {
        if (navigator?.clipboard?.writeText) {
          navigator.clipboard.writeText(payload).catch(() => fallbackCopy(payload));
        } else {
          fallbackCopy(payload);
        }
      } catch {
        fallbackCopy(payload);
      }
    },
  };
}

function fallbackCopy(text: string) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch {
    /* noop — best effort */
  }
}

export interface SafeAsyncOptions {
  /** Override the title shown on the toast. */
  title?: string;
  /** Skip the toast entirely (still returns { ok: false }). */
  silent?: boolean;
  /** Optional logger context tag for telemetry. */
  context?: string;
  /** Custom action button (e.g. "Retry"). */
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Run an async function and return a typed result. On failure, show a toast
 * with a "Copy details" action and keep the original error for telemetry.
 */
export async function safeAsync<T>(
  fn: () => Promise<T>,
  options: SafeAsyncOptions = {}
): Promise<SafeResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (raw) {
    const error = raw instanceof Error ? raw : new Error(String(raw));
    const code = categorize(error);
    logger.warn(`safeAsync: ${code} — ${error.message}`, { stack: error.stack }, options.context ?? 'safeAsync');
    if (!options.silent) {
      showToast(COPY.errors[code], 'error', {
        title: options.title,
        duration: code === 'validation' ? 5000 : 6000,
        action: { ...copyDetails(error), onClick: copyDetails(error).onClick },
      });
      if (options.actionLabel && options.onAction) {
        // The user can also chain a Retry-style action: re-show with a new action.
        showToast('You can retry the last action.', 'info', {
          title: 'Next step',
          duration: 4500,
          action: { label: options.actionLabel, onClick: options.onAction },
        });
      }
    }
    return { ok: false, error, code, message: error.message };
  }
}

/**
 * Re-throw variant — same UX (toast + Copy details), but propagates the
 * original error after showing the toast. Use when callers need to react
 * with a custom error path (e.g. rollback, state update, rerender).
 */
export async function safeAsyncOrThrow<T>(
  fn: () => Promise<T>,
  options: SafeAsyncOptions = {}
): Promise<T> {
  try {
    return await fn();
  } catch (raw) {
    const error = raw instanceof Error ? raw : new Error(String(raw));
    const code = categorize(error);
    logger.warn(`safeAsyncOrThrow: ${code} — ${error.message}`, { stack: error.stack }, options.context ?? 'safeAsyncOrThrow');
    if (!options.silent) {
      showToast(COPY.errors[code], 'error', {
        title: options.title,
        duration: code === 'validation' ? 5000 : 6000,
        action: copyDetails(error),
      });
    }
    throw error;
  }
}
