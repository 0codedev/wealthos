/**
 * Idempotency keys — short-lived (60s) de-duplication for mutation actions.
 *
 * Why: networks, double-clicks, optimistic-UI re-renders and React 18 strict
 * mode can cause a "submit" handler to fire more than once. The naive fix is
 * a `submitting` boolean, but that breaks on retries. An idempotency key
 * stored in `sessionStorage` is replay-safe: the same key + same scope can be
 * looked up to short-circuit a second submission, and a stored value lets us
 * return the cached response instead of double-mutating the database.
 *
 *   const key = newIdempotencyKey('add-investment');
 *   const cached = checkAndStoreIdempotencyKey('add-investment', key);
 *   if (cached) return cached; // already ran in the last 60s
 *
 *   // ...do the real mutation...
 *   storeIdempotencyResponse('add-investment', key, result);
 *
 * No external dependency. Storage layer is a thin wrapper around
 * `sessionStorage` so it can be mocked in tests.
 */

const TTL_MS = 60 * 1000;
const PREFIX = 'idem:v1:';

interface Entry<T> {
  expires: number;
  response?: T;
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function fullKey(scope: string, key: string) {
  return `${PREFIX}${scope}::${key}`;
}

function read<T>(scope: string, key: string): Entry<T> | null {
  const s = storage();
  if (!s) return null;
  const raw = s.getItem(fullKey(scope, key));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Entry<T>;
    if (!parsed || typeof parsed.expires !== 'number') return null;
    if (parsed.expires < Date.now()) {
      s.removeItem(fullKey(scope, key));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function write<T>(scope: string, key: string, entry: Entry<T>) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(fullKey(scope, key), JSON.stringify(entry));
  } catch {
    /* quota or disabled storage — best effort */
  }
}

/**
 * Mint a fresh idempotency key for `scope`. The combination of scope + key
 * is what callers persist alongside the mutation; the same pair replays
 * will be de-duplicated for the next 60 seconds.
 */
export function newIdempotencyKey(scope: string): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const key = `${scope}.${rand}`;
  write(scope, key, { expires: Date.now() + TTL_MS });
  return key;
}

/**
 * Look up a stored response for `(scope, key)`. Returns the cached value
 * when present, otherwise `undefined`. The first call reserves the key
 * for the TTL window (so concurrent re-submits collide and bail out).
 */
export function checkAndStoreIdempotencyKey<T = unknown>(
  scope: string,
  key: string
): T | undefined {
  const entry = read<T>(scope, key);
  if (entry && 'response' in entry) {
    return entry.response;
  }
  // No response yet — reserve the key so a duplicate request short-circuits.
  write(scope, key, { expires: Date.now() + TTL_MS });
  return undefined;
}

/**
 * Attach a successful response to an existing key so that later replays
 * can short-circuit with the same value.
 */
export function storeIdempotencyResponse<T = unknown>(
  scope: string,
  key: string,
  response: T
) {
  write(scope, key, { expires: Date.now() + TTL_MS, response });
}

/** Manually invalidate a key (e.g. when the user explicitly retries). */
export function clearIdempotencyKey(scope: string, key: string) {
  const s = storage();
  if (!s) return;
  s.removeItem(fullKey(scope, key));
}
