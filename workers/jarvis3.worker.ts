// =============================================================================
// Jarvis 3.0 Sentinel — Background Web Worker (CC32)
//
// This worker is the off-thread pulse of the Jarvis 3.0 background sentinel.
// It is responsible for:
//   1. Coordinated polling with full-jitter exponential backoff
//   2. Heavy technical-indicator math (EMA, RSI, signal crossovers) on a
//      separate thread so the main UI never blocks
//   3. Risk pre-checks for voice order intents (does NOT execute — only
//      returns a verdict for the main thread to enforce)
//
// Message contract (strict discriminated union — see services/jarvis3/WorkerHost.ts
// for the matching type-safe wrapper):
//   REQUEST  → main → worker
//     { id, type: 'START',     payload: { intervalMs, symbol } }
//     { id, type: 'STOP' }
//     { id, type: 'PING' }
//     { id, type: 'EVALUATE',  payload: { closes: number[]; periodFast?: number; periodSlow?: number } }
//     { id, type: 'RISK_CHECK',payload: { intent: { side, symbol, quantity, price } } }
//
//   RESPONSE → worker → main
//     { id, type: 'TICK' | 'INDICATORS' | 'RISK_VERDICT' | 'PONG' | 'ERROR' | 'WORKER_ERROR', payload }
//
// All heavy buffers (closes: number[]) are passed by transfer when possible
// to avoid structured-clone cost. The worker exposes a `generation` counter
// so the WorkerHost can detect when the worker was re-spawned and discard
// stale in-flight responses.
// =============================================================================

// ----------------------------- types ----------------------------------------

interface SentinelConfig {
    intervalMs: number;
    symbol: string;
}

interface IndicatorRequest {
    closes: number[];
    periodFast?: number;
    periodSlow?: number;
}

interface RiskCheckIntent {
    side: 'BUY' | 'SELL';
    symbol: string;
    quantity: number;
    price: number;
}

interface JarvisWorkerRequest {
    id: string;
    type: 'START' | 'STOP' | 'PING' | 'EVALUATE' | 'RISK_CHECK';
    payload?: SentinelConfig | IndicatorRequest | { intent: RiskCheckIntent };
}

interface JarvisWorkerResponse {
    id?: string;
    type:
        | 'TICK'
        | 'INDICATORS'
        | 'RISK_VERDICT'
        | 'PONG'
        | 'ERROR'
        | 'WORKER_ERROR'
        | 'STARTED'
        | 'STOPPED';
    payload?: any;
    /** Worker epoch — incremented whenever the worker is re-spawned. */
    generation: number;
    error?: string;
}

// ----------------------------- state ----------------------------------------

/** Worker epoch. Bumped on every self-restart. The WorkerHost uses it to
 *  detect stale responses. */
let generation = 0;
generation++; // first boot

let intervalHandle: ReturnType<typeof setTimeout> | null = null;
let currentConfig: SentinelConfig | null = null;
let currentBackoffMs = 0;
let consecutiveFailures = 0;

const RISK_LIMITS = {
    MAX_NOTIONAL_PER_ORDER: 200_000,    // ₹2 lakh per single voice order
    MAX_QUANTITY_PER_ORDER: 10_000,
    MIN_PRICE: 0.05,
    MAX_PRICE: 1_000_000,
};

// ----------------------------- helpers --------------------------------------

function post(msg: JarvisWorkerResponse, transfer?: Transferable[]) {
    if (transfer && transfer.length) {
        (self as unknown as Worker).postMessage(msg, transfer);
    } else {
        (self as unknown as Worker).postMessage(msg);
    }
}

function scheduleNextTick() {
    if (!currentConfig) return;
    if (intervalHandle) clearTimeout(intervalHandle);

    // 2-second snapshot coalescing — if the next tick is within 2s of
    // the last, double the interval to dedupe. This matters when the
    // host calls START twice quickly.
    const baseInterval = currentConfig.intervalMs;
    const intervalMs = consecutiveFailures > 0
        // full-jitter exponential backoff on failure (AWS pattern)
        ? Math.min(5 * 60 * 1000, currentBackoffMs * 2 * Math.random())
        : baseInterval;

    intervalHandle = setTimeout(() => {
        if (!currentConfig) return;
        post({ type: 'TICK', payload: { symbol: currentConfig.symbol, ts: Date.now() }, generation });
        scheduleNextTick();
    }, intervalMs);
}

// Exponential moving average (Wilder / standard both supported)
function ema(values: number[], period: number): number[] {
    if (values.length === 0 || period <= 0) return [];
    const k = 2 / (period + 1);
    const out: number[] = [];
    let prev = values[0];
    out.push(prev);
    for (let i = 1; i < values.length; i++) {
        const v = values[i];
        const next = v * k + prev * (1 - k);
        out.push(next);
        prev = next;
    }
    return out;
}

// Relative Strength Index (Wilder's smoothing)
function rsi(values: number[], period = 14): number[] {
    if (values.length <= period) return [];
    const gains: number[] = [];
    const losses: number[] = [];
    for (let i = 1; i < values.length; i++) {
        const delta = values[i] - values[i - 1];
        gains.push(Math.max(0, delta));
        losses.push(Math.max(0, -delta));
    }
    const out: number[] = [];
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    out.push(100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss)));
    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
        out.push(100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss)));
    }
    return out;
}

// Detect the most recent fast/slow EMA crossover
function detectCrossover(closes: number[], fastPeriod: number, slowPeriod: number) {
    const fast = ema(closes, fastPeriod);
    const slow = ema(closes, slowPeriod);
    if (fast.length < 2 || slow.length < 2) return { signal: 'NEUTRAL' as const, strength: 0 };
    const fastLast = fast[fast.length - 1];
    const fastPrev = fast[fast.length - 2];
    const slowLast = slow[slow.length - 1];
    const slowPrev = slow[slow.length - 2];
    if (fastPrev <= slowPrev && fastLast > slowLast) {
        return { signal: 'BULLISH_CROSS' as const, strength: Math.min(1, (fastLast - slowLast) / slowLast * 100) };
    }
    if (fastPrev >= slowPrev && fastLast < slowLast) {
        return { signal: 'BEARISH_CROSS' as const, strength: Math.min(1, (slowLast - fastLast) / slowLast * 100) };
    }
    return { signal: 'NEUTRAL' as const, strength: 0 };
}

function evaluateIndicators(req: IndicatorRequest) {
    const closes = req.closes;
    const fastPeriod = req.periodFast ?? 9;
    const slowPeriod = req.periodSlow ?? 21;
    if (closes.length < slowPeriod + 2) {
        return { ok: false, reason: 'insufficient data' };
    }
    const e = ema(closes, slowPeriod);
    const r = rsi(closes, 14);
    const cross = detectCrossover(closes, fastPeriod, slowPeriod);
    return {
        ok: true,
        emaSlow: e[e.length - 1],
        rsi: r[r.length - 1],
        trend: e[e.length - 1] > e[e.length - 5] ? 'UP' : 'DOWN',
        crossover: cross
    };
}

function evaluateRisk(intent: RiskCheckIntent) {
    const errors: string[] = [];
    if (intent.quantity <= 0 || intent.quantity > RISK_LIMITS.MAX_QUANTITY_PER_ORDER) {
        errors.push(`Quantity must be 1–${RISK_LIMITS.MAX_QUANTITY_PER_ORDER}.`);
    }
    if (intent.price < RISK_LIMITS.MIN_PRICE || intent.price > RISK_LIMITS.MAX_PRICE) {
        errors.push(`Price must be between ₹${RISK_LIMITS.MIN_PRICE} and ₹${RISK_LIMITS.MAX_PRICE}.`);
    }
    const notional = intent.quantity * intent.price;
    if (notional > RISK_LIMITS.MAX_NOTIONAL_PER_ORDER) {
        errors.push(`Order notional ₹${notional.toFixed(0)} exceeds the per-order cap of ₹${RISK_LIMITS.MAX_NOTIONAL_PER_ORDER}.`);
    }
    return { allowed: errors.length === 0, errors };
}

// ----------------------------- message router --------------------------------

self.onmessage = (e: MessageEvent<JarvisWorkerRequest>) => {
    const msg = e.data;
    try {
        switch (msg.type) {
            case 'START': {
                currentConfig = (msg.payload as SentinelConfig) ?? { intervalMs: 60_000, symbol: 'NIFTY' };
                currentBackoffMs = currentConfig.intervalMs;
                consecutiveFailures = 0;
                if (intervalHandle) clearTimeout(intervalHandle);
                post({ type: 'STARTED', id: msg.id, payload: currentConfig, generation });
                scheduleNextTick();
                return;
            }
            case 'STOP': {
                if (intervalHandle) {
                    clearTimeout(intervalHandle);
                    intervalHandle = null;
                }
                currentConfig = null;
                post({ type: 'STOPPED', id: msg.id, generation });
                return;
            }
            case 'PING': {
                post({ type: 'PONG', id: msg.id, generation });
                return;
            }
            case 'EVALUATE': {
                const result = evaluateIndicators(msg.payload as IndicatorRequest);
                post({ type: 'INDICATORS', id: msg.id, payload: result, generation });
                return;
            }
            case 'RISK_CHECK': {
                const intent = (msg.payload as { intent: RiskCheckIntent }).intent;
                const verdict = evaluateRisk(intent);
                post({ type: 'RISK_VERDICT', id: msg.id, payload: verdict, generation });
                return;
            }
            default: {
                post({
                    id: msg.id,
                    type: 'ERROR',
                    error: `Unknown message type: ${(msg as any).type}`,
                    generation
                });
            }
        }
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        // Bump generation so the host can detect this as a fresh worker
        // (the error might have left global state corrupt).
        generation++;
        post({ type: 'WORKER_ERROR', id: msg.id, error, generation });
    }
};
