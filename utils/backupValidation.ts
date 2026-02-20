/**
 * backupValidation.ts
 * -----------------------------------------------------------------------------
 * Strict, side-effect-free validators + sanitizers used by BackupService
 * (services/BackupService.ts) when restoring data from an arbitrary JSON
 * file. Every backup import flows through these helpers BEFORE hitting
 * `db.table.bulkPut(...)` so the IndexedDB store can never be poisoned with:
 *
 *   - NaN / Infinity numeric values
 *   - Invalid date strings (Date.parse → NaN)
 *   - Non-arrays masquerading as table rows
 *   - Prototype-polluted objects ({ "__proto__": … })
 *   - Blobs / Files (which IndexedDB stores fine but JSON.stringify cannot
 *     rehydrate)
 *
 * The default behaviour is **coerce-and-keep**: invalid values are replaced
 * with a sensible default rather than throwing, because the common case is
 * "minor schema drift" rather than "malicious file". Callers that need
 * strict-mode can opt in via `strict: true`.
 * -----------------------------------------------------------------------------
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const SAFE_PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type SanitizeMode = 'coerce' | 'strict';

export interface SanitizeOptions {
    /** 'coerce' replaces bad values with safe defaults; 'strict' throws. */
    mode?: SanitizeMode;
    /** When true, strip keys that could pollute prototypes. */
    stripProtoKeys?: boolean;
    /** Field-level override: e.g. { investedAmount: { default: 0, allowNegative: true } } */
    fieldDefaults?: Record<string, { default: number | string | null }>;
}

const NUMERIC_FIELDS_DEFAULT: Record<string, number> = {
    quantity: 0,
    investedAmount: 0,
    currentValue: 0,
    realizedPnL: 0,
    unrealizedPnL: 0,
    pnl: 0,
    fees: 0,
    price: 0,
    amount: 0,
    targetAmount: 0,
    currentAmount: 0,
    limit: 0,
    score: 0,
    rating: 0,
    weight: 0,
    allocation: 0,
};

/** True for any number that is safe to round-trip through JSON. */
export function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/** True for any value that looks like a valid ISO date string or Date object. */
export function isValidDate(value: unknown): value is string | Date {
    if (value instanceof Date) return !isNaN(value.getTime());
    if (typeof value !== 'string') return false;
    if (value.length === 0) return false;
    // Accept loose YYYY-MM-DD as a quick check; the full parse below is authoritative.
    if (!ISO_DATE_RE.test(value)) {
        // Allow JS `new Date().toString()` style — fallback to Date.parse.
        return !isNaN(Date.parse(value));
    }
    const t = Date.parse(value);
    return !isNaN(t);
}

/** Convert any value to a finite number (or fallback). */
export function toFiniteNumber(value: unknown, fallback: number = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    if (typeof value === 'boolean') return value ? 1 : 0;
    return fallback;
}

/** Convert any value to a valid date string, or return `null`. */
export function toValidDateString(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) {
        return isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (typeof value === 'string') {
        const t = Date.parse(value);
        return isNaN(t) ? null : new Date(t).toISOString();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return new Date(value).toISOString();
    }
    return null;
}

/**
 * Sanitize a single row object before insertion. Returns a *new* object —
 * does not mutate the input.
 *
 *   - Removes prototype-pollution keys
 *   - Coerces numeric fields to finite numbers
 *   - Coerces date fields to ISO strings
 *   - Strips NaN / Infinity values
 */
export function sanitizeBackupRow<T extends Record<string, unknown>>(
    row: unknown,
    options: SanitizeOptions = {}
): T | null {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
    const { mode = 'coerce', stripProtoKeys = true, fieldDefaults = {} } = options;

    const input = row as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const key of Object.keys(input)) {
        if (stripProtoKeys && SAFE_PROTO_KEYS.has(key)) continue;
        let value: unknown = input[key];

        // Numeric coercion
        if (
            (NUMERIC_FIELDS_DEFAULT[key] !== undefined ||
                fieldDefaults[key]?.default !== undefined) &&
            value !== null &&
            value !== undefined
        ) {
            if (!isFiniteNumber(value)) {
                if (mode === 'strict') {
                    throw new Error(`Field "${key}" is not a finite number (got ${typeof value})`);
                }
                const fallback =
                    fieldDefaults[key]?.default ?? NUMERIC_FIELDS_DEFAULT[key] ?? 0;
                value = typeof fallback === 'number' ? fallback : Number(fallback);
            }
            // Even if "isFiniteNumber" is true, also guard against very large values
            // that could blow up IndexedDB or downstream numeric code.
            if (typeof value === 'number' && (value > 1e15 || value < -1e15)) {
                if (mode === 'strict') {
                    throw new Error(`Field "${key}" out of safe numeric range: ${value}`);
                }
                value = 0;
            }
        }

        // Date coercion — only for known date fields
        if (
            /date|at$|timestamp/i.test(key) &&
            value !== null &&
            value !== undefined
        ) {
            const dateStr = toValidDateString(value);
            if (dateStr === null && value !== '' && value !== null) {
                if (mode === 'strict') {
                    throw new Error(`Field "${key}" is not a valid date (got ${JSON.stringify(value)})`);
                }
                value = null;
            } else if (dateStr !== null) {
                value = dateStr;
            }
        }

        // Strip undefined (Dexie treats undefined as "no change" which
        // can produce silent partial updates during bulkPut).
        if (value === undefined) continue;

        out[key] = value;
    }

    return out as T;
}

/**
 * Sanitize an entire array of rows. Drops rows that are completely
 * unparseable (not objects) and returns both the surviving rows and the
 * drop count for telemetry.
 */
export function sanitizeBackupRows<T extends Record<string, unknown>>(
    rows: unknown,
    options: SanitizeOptions = {}
): { rows: T[]; dropped: number; errors: string[] } {
    if (!Array.isArray(rows)) return { rows: [], dropped: 0, errors: ['Input is not an array'] };
    const errors: string[] = [];
    let dropped = 0;
    const safe: T[] = [];
    for (let i = 0; i < rows.length; i++) {
        try {
            const clean = sanitizeBackupRow<T>(rows[i], options);
            if (clean !== null) safe.push(clean);
            else dropped++;
        } catch (e: any) {
            if (options.mode === 'strict') {
                throw new Error(`Row ${i}: ${e?.message || String(e)}`);
            }
            errors.push(`Row ${i}: ${e?.message || String(e)}`);
            dropped++;
        }
    }
    return { rows: safe, dropped, errors };
}

/** Quick "is this blob a sane Dexie table name?" check. */
export function isSafeTableName(name: unknown): name is string {
    if (typeof name !== 'string') return false;
    // Dexie table names must match /^[$a-zA-Z_][$a-zA-Z0-9_]*$/ and be < 50 chars.
    return /^[A-Za-z_$][A-Za-z0-9_$]{0,49}$/.test(name);
}
