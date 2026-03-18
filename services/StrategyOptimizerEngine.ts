/**
 * Quantum Phase 12 — Strategy Optimizer service.
 *
 * CC36 wraps the pure math in `QuantumMath.runStrategyOptimizer` with a
 * thin in-memory cache + a debounced async runner so that the heavy
 * 1k-path MC × strike × DTE sweep does not block the UI thread.
 */
import { runStrategyOptimizer } from './QuantumMath';
import type { OptimizerRow, OptimizerRequest, OptimizerResult, StrategyKind } from '../types/quantum';
import { logger } from './Logger';

interface CacheEntry {
    request: OptimizerRequest;
    result: OptimizerResult;
    expiresAt: number;
}

const CACHE_TTL_MS = 30_000; // 30s
const cache = new Map<string, CacheEntry>();

function keyOf(req: OptimizerRequest): string {
    return [req.underlying, req.spot, req.strategy, req.iv ?? 0.16, req.strikeRangePct ?? 0.04, ...(req.dteGrid ?? [7, 14, 21, 30])].join('|');
}

export class StrategyOptimizerEngine {
    private static instance: StrategyOptimizerEngine;
    private listeners = new Set<(r: OptimizerResult) => void>();
    private running = false;
    private queue: OptimizerRequest | null = null;

    static getInstance(): StrategyOptimizerEngine {
        if (!StrategyOptimizerEngine.instance) StrategyOptimizerEngine.instance = new StrategyOptimizerEngine();
        return StrategyOptimizerEngine.instance;
    }

    onResult(cb: (r: OptimizerResult) => void): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    /**
     * Run the optimizer for the given request, returning a Promise.
     * The heavy math is dispatched through `setTimeout(0)` so the UI
     * has a chance to render a spinner between the trigger and the
     * result.
     */
    run(req: OptimizerRequest): Promise<OptimizerResult> {
        const k = keyOf(req);
        const cached = cache.get(k);
        if (cached && cached.expiresAt > Date.now()) {
            logger.info(`[StrategyOptimizer] cache hit for ${k}`);
            // Notify listeners asynchronously
            setTimeout(() => this.notify(cached.result), 0);
            return Promise.resolve(cached.result);
        }
        this.queue = req;
        if (this.running) return new Promise((resolve) => {
            const onResult = (r: OptimizerResult) => {
                if (keyOf(r.request) === k) {
                    this.listeners.delete(onResult);
                    resolve(r);
                }
            };
            this.listeners.add(onResult);
        });
        this.running = true;
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                try {
                    const result = runStrategyOptimizer(req);
                    cache.set(k, { request: req, result, expiresAt: Date.now() + CACHE_TTL_MS });
                    this.notify(result);
                    resolve(result);
                } catch (err) {
                    logger.error('[StrategyOptimizer] failed', err);
                    reject(err);
                } finally {
                    this.running = false;
                    this.queue = null;
                }
            }, 0);
        });
    }

    private notify(result: OptimizerResult) {
        this.listeners.forEach(cb => {
            try { cb(result); } catch (err) {
                logger.warn('[StrategyOptimizer] listener threw', err);
            }
        });
    }

    /** Manually invalidate (debug). */
    invalidate() {
        cache.clear();
    }
}

export const strategyOptimizerEngine = StrategyOptimizerEngine.getInstance();

/** Canonical spot prices for the major Indian indices. */
export const INDEX_SPOT_HINTS: Record<string, number> = {
    NIFTY: 23500,
    BANKNIFTY: 51000,
    FINNIFTY: 24500,
    MIDCPNIFTY: 13000,
};

/** Default IV per index (decimal). */
export const INDEX_IV_HINTS: Record<string, number> = {
    NIFTY: 0.14,
    BANKNIFTY: 0.18,
    FINNIFTY: 0.16,
    MIDCPNIFTY: 0.20,
};

export const STRATEGY_LABELS: Record<StrategyKind, { label: string; description: string; icon: string }> = {
    LONG_CALL:        { label: 'Long Call',          description: 'Bullish single-leg.', icon: 'CE' },
    LONG_PUT:         { label: 'Long Put',           description: 'Bearish single-leg.', icon: 'PE' },
    SHORT_CALL:       { label: 'Short Call',         description: 'Naked call — high risk.', icon: 'CE' },
    SHORT_PUT:        { label: 'Short Put',          description: 'Naked put — high risk.', icon: 'PE' },
    BULL_CALL_SPREAD: { label: 'Bull Call Spread',   description: 'Defined-risk bullish.', icon: 'CS' },
    BEAR_PUT_SPREAD:  { label: 'Bear Put Spread',    description: 'Defined-risk bearish.', icon: 'PS' },
    STRADDLE:         { label: 'Long Straddle',      description: 'High-vol play, both sides.', icon: 'ST' },
    STRANGLE:         { label: 'Long Strangle',      description: 'Cheaper straddle, wider wings.', icon: 'SG' },
    IRON_CONDOR:      { label: 'Iron Condor',        description: 'Range-bound premium harvest.', icon: 'IC' },
    BUTTERFLY:        { label: 'Butterfly',          description: 'Pin-the-strike precision.', icon: 'BF' },
    CALENDAR:         { label: 'Calendar Spread',    description: 'Time-decay differential.', icon: 'CL' },
    RATIO_SPREAD:     { label: 'Ratio Spread',       description: 'Skewed risk profile.', icon: 'RS' },
};

export type { OptimizerRow };
