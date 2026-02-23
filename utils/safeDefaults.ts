/**
 * CC102 — Safe defaults & crash resilience utilities.
 *
 * A small set of helpers that catch the most common runtime crashes the
 * app has shipped in the past:
 *   1. `safe()` — try/catch wrapper that returns a fallback on error
 *   2. `safeJSON()` — JSON.parse with a typed fallback
 *   3. `safeNumber()` — coerces a value to a finite number (NaN → fallback)
 *   4. `safeGet()` — localStorage read with try/catch + JSON parse
 *   5. `safeSet()` — localStorage write with try/catch + quota guard
 *   6. `withDefault()` — replaces null/undefined with a default
 *   7. `crashBoundary()` — wraps an async function with a final fallback
 *
 * Why this matters in production:
 *   The Phase-22 / Phase-23 reports flagged several sites that call
 *   `parseInt(JSON.parse(localStorage.getItem(...))?.foo || 0)` and
 *   similar chains. Each step in the chain can throw; each step needs
 *   its own guard. These helpers flatten the chain to a single call.
 */

export type Result<T, E = Error> =
    | { ok: true; value: T }
    | { ok: false; error: E };

/**
 * Try a function and return either its value or a fallback. Catches both
 * sync throws and `undefined` returns. The `fallback` is lazy — only
 * evaluated when needed (so a no-throw call doesn't pay the cost).
 */
export function safe<T>(fn: () => T, fallback: T | (() => T) = null as unknown as T): T {
    try {
        const v = fn();
        if (v === undefined || v === null) {
            return typeof fallback === 'function' ? (fallback as () => T)() : fallback;
        }
        return v;
    } catch {
        return typeof fallback === 'function' ? (fallback as () => T)() : fallback;
    }
}

/**
 * `safe` that returns a Result object. Useful when the caller wants to
 * distinguish "value" from "error" without throwing.
 */
export function safeResult<T>(fn: () => T): Result<T> {
    try {
        const v = fn();
        if (v === undefined || v === null) {
            return { ok: false, error: new Error('Result was null or undefined') };
        }
        return { ok: true, value: v };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
    }
}

/**
 * Parse JSON with a typed fallback. Catches SyntaxError, returns fallback.
 */
export function safeJSON<T>(text: string | null | undefined, fallback: T): T {
    if (text == null) return fallback;
    try {
        return JSON.parse(text) as T;
    } catch {
        return fallback;
    }
}

/**
 * Coerce an unknown to a finite number. Handles strings, numbers, NaN,
 * Infinity, null, and undefined. The fallback is returned whenever the
 * value cannot be meaningfully interpreted as a number.
 */
export function safeNumber(value: unknown, fallback: number = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    if (typeof value === 'boolean') return value ? 1 : 0;
    return fallback;
}

/**
 * Read a JSON value from localStorage with full try/catch. The fallback
 * is returned on:
 *   - `localStorage` not available (SSR, private browsing)
 *   - key not present
 *   - parse error
 *   - the parsed value is null/undefined
 */
export function safeGet<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined' || !window.localStorage) return fallback;
    try {
        const raw = window.localStorage.getItem(key);
        if (raw == null) return fallback;
        const parsed = JSON.parse(raw) as unknown;
        if (parsed == null) return fallback;
        return parsed as T;
    } catch {
        return fallback;
    }
}

/**
 * Write a JSON value to localStorage with try/catch. Returns true on
 * success, false on:
 *   - `localStorage` not available
 *   - quota exceeded (most common cause in practice)
 *   - circular reference
 *   - any other thrown error
 */
export function safeSet(key: string, value: unknown): boolean {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

/**
 * Replace null/undefined with a default. For nested objects, pair with
 * `safeGet` or use directly:
 *   const name = withDefault(user?.name, 'Anonymous');
 */
export function withDefault<T>(value: T | null | undefined, fallback: T): T {
    return value == null ? fallback : value;
}

/**
 * Wrap an async function so a thrown error becomes a fallback value
 * instead of an unhandled promise rejection. Logs the error to console
 * with a `[crashBoundary]` prefix so the issue is still visible during
 * development. The fallback is lazy.
 */
export async function crashBoundary<T>(
    fn: () => Promise<T>,
    fallback: T | (() => T) = null as unknown as T,
    context?: string
): Promise<T> {
    try {
        return await fn();
    } catch (e) {
        if (typeof console !== 'undefined') {
            console.error(`[crashBoundary${context ? `:${context}` : ''}]`, e);
        }
        return typeof fallback === 'function' ? (fallback as () => T)() : fallback;
    }
}

/**
 * `Object.entries` that never returns null. Some older browsers / SSR
 * contexts can return `null` for `Object.entries(null)`; this normalizes
 * to an empty array.
 */
export function safeEntries<T extends object>(obj: T | null | undefined): [string, unknown][] {
    if (obj == null || typeof obj !== 'object') return [];
    try {
        return Object.entries(obj);
    } catch {
        return [];
    }
}

/**
 * `Array.prototype.find` that returns the fallback instead of `undefined`.
 * Avoids the `?? defaultValue` ceremony at every call site.
 */
export function safeFind<T, D>(
    arr: T[] | null | undefined,
    predicate: (item: T, index: number) => boolean,
    fallback: D
): T | D {
    if (!Array.isArray(arr)) return fallback;
    const found = arr.find(predicate);
    return found === undefined ? fallback : found;
}
