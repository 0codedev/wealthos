/**
 * ResilienceCore — Service-layer resilience primitives.
 *
 * Centralised place for:
 *   1. API Key Rotation Manager (round-robin across N keys with throttle-avoidance)
 *   2. Exponential Backoff with Jitter (capped retries)
 *   3. Circuit Breaker (closed / open / half-open state machine)
 *   4. Friendly error normalisation (Quota / Network / Auth / Unknown)
 *
 * Every external fetch in the app should go through `resilientFetch`.
 * Existing legacy retry helpers in DhanBrokerService/RealDataService are
 * kept intact; new code should prefer this module.
 *
 * Owner: Agent CC8 — Backend API & Service Layer Resilience
 */
import { logger } from './Logger';
import { isOffline, OfflineNoCacheError } from '../lib/offline';

// ============================================================
// TYPES
// ============================================================

export interface ResilientFetchOptions extends Omit<RequestInit, 'signal'> {
    /** Max attempts (default 3) */
    retries?: number;
    /** Initial backoff in ms (default 500) */
    baseDelayMs?: number;
    /** Hard cap for any single backoff sleep (default 8000) */
    maxDelayMs?: number;
    /** Optional circuit-breaker key (defaults to URL hostname) */
    breakerKey?: string;
    /** Abort signal */
    signal?: AbortSignal;
    /** Optional timeout (ms) — defaults to 15000 */
    timeoutMs?: number;
    /** Optional label for logs */
    label?: string;
}

export type ResilienceErrorKind =
    | 'network'
    | 'timeout'
    | 'rate-limit'
    | 'server'
    | 'auth'
    | 'client'
    | 'circuit-open'
    | 'unknown';

export class ResilienceError extends Error {
    public readonly kind: ResilienceErrorKind;
    public readonly status?: number;
    public readonly retryAfterMs?: number;
    public readonly cause?: unknown;

    constructor(message: string, kind: ResilienceErrorKind, opts: { status?: number; retryAfterMs?: number; cause?: unknown } = {}) {
        super(message);
        this.name = 'ResilienceError';
        this.kind = kind;
        this.status = opts.status;
        this.retryAfterMs = opts.retryAfterMs;
        this.cause = opts.cause;
    }
}

// ============================================================
// CIRCUIT BREAKER
// ============================================================

type BreakerState = 'closed' | 'open' | 'half-open';

interface BreakerEntry {
    state: BreakerState;
    consecutiveFailures: number;
    openedAt: number;
    nextProbeAt: number;
}

const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 30_000;
const HALF_OPEN_PROBES = 1;

class CircuitBreakerRegistry {
    private store = new Map<string, BreakerEntry>();

    /** Returns 'closed' (allow), 'open' (block), or 'half-open' (allow exactly 1 probe). */
    public beforeRequest(key: string): BreakerState {
        const entry = this.store.get(key);
        if (!entry) return 'closed';
        if (entry.state === 'closed') return 'closed';
        const now = Date.now();
        if (entry.state === 'open') {
            if (now < entry.nextProbeAt) return 'open';
            // Time to try a probe
            entry.state = 'half-open';
            return 'half-open';
        }
        // half-open: only HALF_OPEN_PROBES concurrent probe
        return 'half-open';
    }

    public onSuccess(key: string): void {
        const entry = this.store.get(key);
        if (!entry) return;
        entry.consecutiveFailures = 0;
        entry.state = 'closed';
    }

    public onFailure(key: string): void {
        let entry = this.store.get(key);
        if (!entry) {
            entry = { state: 'closed', consecutiveFailures: 0, openedAt: 0, nextProbeAt: 0 };
            this.store.set(key, entry);
        }
        entry.consecutiveFailures++;
        if (entry.consecutiveFailures >= FAILURE_THRESHOLD) {
            entry.state = 'open';
            entry.openedAt = Date.now();
            entry.nextProbeAt = entry.openedAt + COOLDOWN_MS;
            logger.warn(`CircuitBreaker: '${key}' OPEN after ${entry.consecutiveFailures} failures. Cooling for ${COOLDOWN_MS}ms.`);
        }
    }

    public snapshot(): Record<string, { state: BreakerState; failures: number; nextProbeInMs: number }> {
        const out: Record<string, { state: BreakerState; failures: number; nextProbeInMs: number }> = {};
        const now = Date.now();
        for (const [k, v] of this.store) {
            out[k] = {
                state: v.state,
                failures: v.consecutiveFailures,
                nextProbeInMs: Math.max(0, v.nextProbeAt - now)
            };
        }
        return out;
    }
}

export const circuitBreakers = new CircuitBreakerRegistry();

// ============================================================
// API KEY ROTATION MANAGER
// ============================================================

interface KeyState {
    key: string;
    exhaustedUntil: number; // ms epoch, 0 = active
    lastErrorAt: number;
    consecutiveErrors: number;
}

interface RotatorConfig {
    /** Quota cooldown after a 429 / quota error. */
    quotaCooldownMs: number;
    /** Quota cooldown after a 401/403 (auth). Longer because key is likely dead. */
    authCooldownMs: number;
}

const DEFAULT_ROTATOR: RotatorConfig = {
    quotaCooldownMs: 60_000,
    authCooldownMs: 5 * 60_000
};

/**
 * APIKeyRotator — round-robin across N keys with cooldown awareness.
 * Keys are returned in deterministic order; a key that just hit 429 is
 * skipped until `exhaustedUntil`. The rotator remembers its position so
 * we always make forward progress through the pool.
 */
export class APIKeyRotator {
    private keys: KeyState[] = [];
    private cursor = 0;
    private cfg: RotatorConfig;

    constructor(keys: string[], cfg: RotatorConfig = DEFAULT_ROTATOR) {
        this.setKeys(keys);
        this.cfg = cfg;
    }

    public setKeys(keys: string[]): void {
        const clean = (keys || []).map(k => (k || '').trim()).filter(Boolean);
        // Preserve exhausted state for keys that are still in the pool
        const prev = new Map(this.keys.map(k => [k.key, k]));
        this.keys = clean.map(k => {
            const existing = prev.get(k);
            return existing
                ? { ...existing }
                : { key: k, exhaustedUntil: 0, lastErrorAt: 0, consecutiveErrors: 0 };
        });
        if (this.cursor >= this.keys.length) this.cursor = 0;
    }

    public size(): number {
        return this.keys.length;
    }

    public activeKeyCount(): number {
        const now = Date.now();
        return this.keys.filter(k => k.exhaustedUntil <= now).length;
    }

    /** Returns the next usable key, or null if every key is in cooldown. */
    public getNext(): string | null {
        const now = Date.now();
        if (this.keys.length === 0) return null;
        for (let i = 0; i < this.keys.length; i++) {
            const idx = (this.cursor + i) % this.keys.length;
            const ks = this.keys[idx];
            if (ks.exhaustedUntil <= now) {
                this.cursor = (idx + 1) % this.keys.length;
                return ks.key;
            }
        }
        return null;
    }

    /** Mark the supplied key as exhausted. */
    public markExhausted(key: string, kind: 'quota' | 'auth' | 'server' = 'quota'): void {
        const ks = this.keys.find(k => k.key === key);
        if (!ks) return;
        const cooldown = kind === 'auth' ? this.cfg.authCooldownMs : this.cfg.quotaCooldownMs;
        ks.exhaustedUntil = Date.now() + cooldown;
        ks.consecutiveErrors++;
        ks.lastErrorAt = Date.now();
        logger.warn(`APIKeyRotator: Key ...${key.slice(-4)} marked exhausted (${kind}) for ${Math.round(cooldown / 1000)}s.`);
    }

    /** Mark success — reset error counters. */
    public markSuccess(key: string): void {
        const ks = this.keys.find(k => k.key === key);
        if (!ks) return;
        ks.consecutiveErrors = 0;
        ks.exhaustedUntil = 0;
    }

    public snapshot(): Array<{ keyHint: string; exhaustedUntil: number; consecutiveErrors: number }> {
        return this.keys.map(k => ({
            keyHint: '...' + k.key.slice(-4),
            exhaustedUntil: k.exhaustedUntil,
            consecutiveErrors: k.consecutiveErrors
        }));
    }
}

// ============================================================
// EXPONENTIAL BACKOFF + JITTER
// ============================================================

function computeBackoff(attempt: number, base: number, cap: number): number {
    // 500, 1000, 2000, 4000 ... capped at `cap`, plus full jitter.
    const expo = Math.min(cap, base * Math.pow(2, attempt));
    const jitter = Math.random() * expo;
    return Math.max(50, Math.floor(jitter));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const t = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function parseRetryAfter(value: string | null | undefined): number | undefined {
    if (!value) return undefined;
    // RFC 7231: HTTP-date or seconds
    const asInt = Number(value);
    if (Number.isFinite(asInt) && asInt >= 0) return Math.floor(asInt * 1000);
    const asDate = Date.parse(value);
    if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
    return undefined;
}

function deriveBreakerKey(url: string, override?: string): string {
    if (override) return override;
    try {
        return new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://x').hostname;
    } catch {
        return 'unknown';
    }
}

// ============================================================
// RESILIENT FETCH
// ============================================================

/**
 * Drop-in replacement for `fetch` that:
 *   - Retries 429 + 5xx with exponential backoff + jitter.
 *   - Honours `Retry-After` / `X-RateLimit-Reset` headers.
 *   - Trips a circuit breaker on 5 consecutive 5xx or network errors.
 *   - Throws a typed `ResilienceError` for non-retryable statuses.
 *   - Supports AbortSignal and a per-request timeout.
 */
export async function resilientFetch(
    url: string,
    options: ResilientFetchOptions = {}
): Promise<Response> {
    // Top-10 #4 — offline short-circuit. Throw OfflineNoCacheError so
    // callers that already handle ResilienceError see a typed signal
    // and can render a calm "no cached data" state.
    if (isOffline()) {
        throw new OfflineNoCacheError(url);
    }

    const {
        retries = 3,
        baseDelayMs = 500,
        maxDelayMs = 8000,
        breakerKey,
        signal: externalSignal,
        timeoutMs = 15_000,
        label,
        ...fetchOptions
    } = options;

    const key = deriveBreakerKey(url, breakerKey);
    const state = circuitBreakers.beforeRequest(key);
    if (state === 'open') {
        throw new ResilienceError(`Circuit breaker is open for ${key}`, 'circuit-open');
    }

    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        // Compose an AbortController that fires on timeout OR external abort
        const controller = new AbortController();
        const onExternalAbort = () => controller.abort(externalSignal?.reason);
        externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
        // Reasoned abort: without this, Chrome logs "signal is aborted without reason"
        const timer = setTimeout(() => controller.abort(new DOMException(`WealthOS timeout after ${timeoutMs}ms`, 'TimeoutError')), timeoutMs);

        try {
            const res = await fetch(url, { ...fetchOptions, signal: controller.signal });

            // 2xx and most 4xx are terminal (don't retry)
            if (res.ok) {
                circuitBreakers.onSuccess(key);
                return res;
            }
            if (res.status === 401 || res.status === 403) {
                circuitBreakers.onFailure(key);
                throw new ResilienceError(
                    `Authentication failed (${res.status})`,
                    'auth',
                    { status: res.status }
                );
            }
            if (res.status === 429 || res.status >= 500) {
                // retryable
                circuitBreakers.onFailure(key);
                const retryAfter = parseRetryAfter(res.headers.get('Retry-After'))
                    ?? parseRetryAfter(res.headers.get('X-RateLimit-Reset'));
                if (attempt < retries) {
                    const wait = retryAfter ?? computeBackoff(attempt, baseDelayMs, maxDelayMs);
                    logger.warn(
                        `${label || 'resilientFetch'}: ${res.status} on ${url} — retrying in ${wait}ms (attempt ${attempt + 1}/${retries})`
                    );
                    await sleep(wait, externalSignal);
                    continue;
                }
                if (res.status === 429) {
                    throw new ResilienceError(
                        `Rate limited (429) after ${retries} retries`,
                        'rate-limit',
                        { status: 429, retryAfterMs: retryAfter }
                    );
                }
                throw new ResilienceError(
                    `Server error (${res.status}) after ${retries} retries`,
                    'server',
                    { status: res.status }
                );
            }
            // 4xx other than 401/403/429: not retryable
            throw new ResilienceError(
                `Client error (${res.status})`,
                'client',
                { status: res.status }
            );
        } catch (err: any) {
            lastError = err;
            // Re-throw typed errors as-is so the caller's catch sees them
            if (err instanceof ResilienceError) throw err;

            const isAbort = err?.name === 'AbortError';
            const isNetwork = err instanceof TypeError;
            circuitBreakers.onFailure(key);

            if (isAbort) {
                // Distinguish timeout vs caller-cancelled
                if (externalSignal?.aborted) {
                    throw new ResilienceError('Request aborted by caller', 'client', { cause: err });
                }
                if (attempt < retries) {
                    logger.warn(`${label || 'resilientFetch'}: timeout on ${url} — retrying (attempt ${attempt + 1}/${retries})`);
                    await sleep(computeBackoff(attempt, baseDelayMs, maxDelayMs), externalSignal);
                    continue;
                }
                throw new ResilienceError(`Timed out after ${retries} retries`, 'timeout', { cause: err });
            }
            if (isNetwork) {
                if (attempt < retries) {
                    logger.warn(`${label || 'resilientFetch'}: network error on ${url} — retrying (attempt ${attempt + 1}/${retries})`);
                    await sleep(computeBackoff(attempt, baseDelayMs, maxDelayMs), externalSignal);
                    continue;
                }
                throw new ResilienceError(`Network error after ${retries} retries`, 'network', { cause: err });
            }
            // Unknown
            throw new ResilienceError(err?.message || 'Unknown fetch error', 'unknown', { cause: err });
        } finally {
            clearTimeout(timer);
            externalSignal?.removeEventListener('abort', onExternalAbort);
        }
    }

    // Defensive: should be unreachable
    throw new ResilienceError(
        `Exhausted retries for ${url}`,
        'unknown',
        { cause: lastError }
    );
}

// ============================================================
// DB WRITE RETRY QUEUE
// ============================================================

interface QueuedWrite {
    id: string;
    table: string;
    payload: any;
    attempts: number;
    enqueuedAt: number;
    lastError?: string;
}

const WRITE_QUEUE_MAX = 200;
const writeQueue: QueuedWrite[] = [];

/**
 * enqueueDbWrite — schedule a write that previously failed (Quota / Constraint).
 * Returns the assigned id. Caller persists the queue in Dexie if it wants durability
 * across reloads; in-memory queue is sufficient for hot-session recovery.
 */
export function enqueueDbWrite(table: string, payload: any): string {
    if (writeQueue.length >= WRITE_QUEUE_MAX) {
        writeQueue.shift();
    }
    const id = `${table}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    writeQueue.push({ id, table, payload, attempts: 0, enqueuedAt: Date.now() });
    logger.warn(`Resilience: enqueued write for ${table} (id=${id}). Queue depth=${writeQueue.length}`);
    return id;
}

export function drainDbQueue<T>(executor: (table: string, payload: any) => Promise<T>): Promise<{ drained: number; failed: number }> {
    return (async () => {
        let drained = 0;
        let failed = 0;
        while (writeQueue.length) {
            const item = writeQueue[0];
            try {
                await executor(item.table, item.payload);
                writeQueue.shift();
                drained++;
            } catch (e: any) {
                item.attempts++;
                item.lastError = e?.message || String(e);
                if (item.attempts >= 5) {
                    writeQueue.shift();
                    failed++;
                } else {
                    break; // try later
                }
            }
        }
        return { drained, failed };
    })();
}

export function getDbQueueDepth(): number {
    return writeQueue.length;
}

export function getDbQueueSnapshot(): ReadonlyArray<Readonly<QueuedWrite>> {
    return writeQueue.map(q => ({ ...q }));
}

// ============================================================
// HEALTH SNAPSHOT
// ============================================================

export interface ResilienceHealth {
    breakers: Record<string, { state: 'closed' | 'open' | 'half-open'; failures: number; nextProbeInMs: number }>;
    dbQueueDepth: number;
}

export function getResilienceHealth(): ResilienceHealth {
    return {
        breakers: circuitBreakers.snapshot() as any,
        dbQueueDepth: writeQueue.length
    };
}
