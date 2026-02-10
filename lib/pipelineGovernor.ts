/**
 * PipelineGovernor — 4-tier Data Failover Chain with Connection Health Monitor
 * and dynamic concurrency governor.
 *
 * This replaces the static `limitConcurrency(5)` and the bare `try/catch`
 * fallback sequence in AlphaEngineService with a self-aware, observability-
 * first ingestion layer.
 *
 * Design pillars:
 *  1. Four explicit tiers, each with a contract that the pipeline can probe.
 *       T1 — Upstox (real-time WebSocket / HTTP)
 *       T2 — NSE Python Bridge (raw scrape) + Yahoo Finance Spark bulk enrichment
 *       T3 — Direct Yahoo Finance Bulk Spark queries
 *       T4 — Dexie/IndexedDB cache + local mock delta simulation
 *
 *  2. Connection Health Monitor — every tier exposes a typed state
 *       (HEALTHY / DEGRADED / CIRCUIT_OPEN) and a sliding-window latency
 *       sample. A circuit breaker opens when error-rate crosses a threshold
 *       (default 50% over 6 attempts) and stays open for `cooldownMs`.
 *
 *  3. Dynamic concurrency governor — every in-flight request updates
 *       a rolling latency average. The governor scales the active
 *       parallelism up (toward `maxConcurrency`) when latency stays
 *       low, and down (toward `minConcurrency`) when it climbs.
 *       429 responses immediately drop concurrency to 1 and back-off
 *       based on Retry-After.
 *
 *  4. Stale-on-error — when all live tiers fail, Tier 4 returns the
 *       cached payload and a synthetic "delta" derived from the most
 *       recent two snapshots so the UI never shows an empty grid.
 *
 *  5. Source transitions are appended to an in-memory ring buffer
 *       (last 50 events) so the status board can render a feed
 *       timeline of which tier took over, when, and why.
 *
 *  No external dependencies; vanilla TypeScript.
 */

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type Tier = 'T1_UPSTOX' | 'T2_NSE_YAHOO' | 'T3_YAHOO' | 'T4_OFFLINE';

export type TierHealth = 'HEALTHY' | 'DEGRADED' | 'CIRCUIT_OPEN' | 'UNKNOWN';

export interface TierStatus {
  tier: Tier;
  health: TierHealth;
  /** Rolling 30-sample latency (ms). */
  avgLatencyMs: number;
  /** Error rate (0..1) over the rolling window. */
  errorRate: number;
  /** Last time this tier successfully produced a result. */
  lastSuccessAt: number | null;
  /** Number of consecutive failures. */
  consecutiveFailures: number;
  /** Milliseconds until the circuit breaker allows a probe. */
  cooldownRemainingMs: number;
  /** Number of times this tier has been used as the active source. */
  totalRequests: number;
  /** Total successful requests. */
  totalSuccesses: number;
}

export interface TransitionEvent {
  ts: number;
  from: Tier | null;
  to: Tier;
  reason: string;
  /** Wall-clock latency of the failed tier that triggered the switch. */
  triggerLatencyMs?: number;
}

export interface PipelineGovernorOptions {
  /** Maximum concurrent requests allowed. */
  maxConcurrency: number;
  /** Minimum concurrent requests when throttled. */
  minConcurrency: number;
  /** Error rate threshold (0..1) that opens the circuit. */
  circuitErrorThreshold: number;
  /** Sliding window size for the rolling health metrics. */
  windowSize: number;
  /** Cooldown (ms) when a circuit opens. */
  cooldownMs: number;
  /** Concurrency ramp-up step when latency is stable. */
  rampStep: number;
}

const DEFAULT_OPTS: PipelineGovernorOptions = {
  maxConcurrency: 8,
  minConcurrency: 1,
  circuitErrorThreshold: 0.5,
  windowSize: 6,
  cooldownMs: 30_000,
  rampStep: 1,
};

// ────────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────────

interface LatencyWindow {
  samples: number[];           // recent latencies
  errors: number[];            // recent 0/1 outcomes
}

interface TierMeta extends LatencyWindow {
  tier: Tier;
  health: TierHealth;
  lastSuccessAt: number | null;
  consecutiveFailures: number;
  cooldownUntil: number;
  totalRequests: number;
  totalSuccesses: number;
  currentConcurrency: number;
  /** Rolling latency average (ms), cached for O(1) snapshot reads. */
  avgLatencyMs: number;
  /** Rolling error rate (0..1), cached for O(1) snapshot reads. */
  errorRate: number;
}

const TIER_ORDER: Tier[] = ['T1_UPSTOX', 'T2_NSE_YAHOO', 'T3_YAHOO', 'T4_OFFLINE'];

const TIER_LABEL: Record<Tier, string> = {
  T1_UPSTOX: 'Upstox (real-time)',
  T2_NSE_YAHOO: 'NSE Bridge + Yahoo',
  T3_YAHOO: 'Yahoo Spark',
  T4_OFFLINE: 'Offline Cache',
};

function makeTierMeta(tier: Tier, maxConcurrency: number): TierMeta {
  return {
    tier,
    health: 'UNKNOWN',
    samples: [],
    errors: [],
    lastSuccessAt: null,
    consecutiveFailures: 0,
    cooldownUntil: 0,
    totalRequests: 0,
    totalSuccesses: 0,
    currentConcurrency: maxConcurrency,
    avgLatencyMs: 0,
    errorRate: 0,
  };
}

function ringPush<T>(arr: T[], value: T, max: number): void {
  arr.push(value);
  if (arr.length > max) arr.shift();
}

function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i] ?? 0;
  return s / arr.length;
}

// ────────────────────────────────────────────────────────────────────────────
// PipelineGovernor
// ────────────────────────────────────────────────────────────────────────────

export class PipelineGovernor {
  private opts: PipelineGovernorOptions;
  private tiers: Map<Tier, TierMeta> = new Map();
  private activeTier: Tier = 'T4_OFFLINE';
  private transitions: TransitionEvent[] = [];
  private listeners: Set<() => void> = new Set();

  private makeTierMeta(tier: Tier, maxConcurrency: number): TierMeta {
    return makeTierMeta(tier, maxConcurrency);
  }

  constructor(opts: Partial<PipelineGovernorOptions> = {}) {
    this.opts = { ...DEFAULT_OPTS, ...opts };
    for (const t of TIER_ORDER) {
      this.tiers.set(t, this.makeTierMeta(t, this.opts.maxConcurrency));
    }
  }

  // ── Public Observability API ──────────────────────────────────────────────

  /** Subscribe to status changes. Returns unsubscribe. */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Snapshot of all tier statuses for the status board. */
  getSnapshot(): { active: Tier; tiers: TierStatus[]; transitions: TransitionEvent[] } {
    const tiers: TierStatus[] = TIER_ORDER.map((t) => {
      const m = this.tiers.get(t)!;
      return this.toStatus(m);
    });
    return {
      active: this.activeTier,
      tiers,
      transitions: this.transitions.slice(-50),
    };
  }

  getActiveTier(): Tier { return this.activeTier; }
  getTierLabel(tier: Tier): string { return TIER_LABEL[tier]; }

  /** Manually promote a tier (manual failover switch). */
  setActiveTier(tier: Tier, reason = 'manual override'): void {
    this.switchTo(tier, reason);
  }

  // ── Concurrency governor ──────────────────────────────────────────────────

  /**
   * Acquire a concurrency slot for `tier`, returning the granted
   * concurrency level. The governor scales dynamically: when the
   * tier is HEALTHY and latency is stable, it returns the maximum;
   * when DEGRADED, it throttles. When the circuit is OPEN it returns 0.
   */
  acquire(tier: Tier): number {
    const m = this.tiers.get(tier);
    if (!m) return this.opts.minConcurrency;
    if (m.health === 'CIRCUIT_OPEN' && Date.now() < m.cooldownUntil) {
      return 0;
    }
    if (Date.now() >= m.cooldownUntil && m.health === 'CIRCUIT_OPEN') {
      // Cooldown elapsed — half-open probe.
      m.health = 'DEGRADED';
      m.cooldownUntil = 0;
    }
    return m.currentConcurrency;
  }

  /**
   * Backoff slot for one tier — used when the caller receives a 429 or
   * explicit "too many requests" error. Drops concurrency to 1 and
   * shortens the cooldown window so we recover quickly.
   */
  throttle(tier: Tier, retryAfterMs: number): void {
    const m = this.tiers.get(tier);
    if (!m) return;
    m.currentConcurrency = this.opts.minConcurrency;
    m.health = 'DEGRADED';
    const until = Date.now() + Math.min(Math.max(retryAfterMs, 1_000), 120_000);
    m.cooldownUntil = until;
    this.recordTransition(this.activeTier, tier, `throttled (retry-after ${retryAfterMs}ms)`);
    this.notify();
  }

  // ── Outcome recording ─────────────────────────────────────────────────────

  /** Record a successful tier outcome. */
  recordSuccess(tier: Tier, latencyMs: number): void {
    const m = this.tiers.get(tier);
    if (!m) return;
    ringPush(m.samples, latencyMs, this.opts.windowSize);
    ringPush(m.errors, 0, this.opts.windowSize);
    m.lastSuccessAt = Date.now();
    m.consecutiveFailures = 0;
    m.totalRequests += 1;
    m.totalSuccesses += 1;
    this.refreshHealth(m);
    this.maybeRampUp(m);
    if (tier !== this.activeTier && m.health === 'HEALTHY') {
      this.switchTo(tier, `tier ${tier} recovered (${latencyMs.toFixed(0)}ms)`);
    }
    this.notify();
  }

  /** Record a failure. May trip the circuit breaker. */
  recordFailure(tier: Tier, latencyMs: number, reason: string): void {
    const m = this.tiers.get(tier);
    if (!m) return;
    ringPush(m.samples, latencyMs, this.opts.windowSize);
    ringPush(m.errors, 1, this.opts.windowSize);
    m.consecutiveFailures += 1;
    m.totalRequests += 1;
    this.refreshHealth(m);
    this.maybeRampDown(m);
    if (tier === this.activeTier) {
      const nextTier = this.firstHealthyBelow(tier);
      if (nextTier) {
        this.switchTo(nextTier, `${tier} failed: ${reason}`);
      }
    }
    this.notify();
  }

  // ── Bulk execution helper ─────────────────────────────────────────────────

  /**
   * Run a list of tasks with dynamically governed concurrency for
   * the supplied tier. The function returns the array of results in
   * the original order. Failures are captured as `null` (matching
   * the legacy `limitConcurrency` contract).
   */
  async runWithGovernance<T>(
    tier: Tier,
    tasks: (() => Promise<T>)[],
  ): Promise<Array<T | null>> {
    const results: Array<T | null> = new Array(tasks.length);
    if (tasks.length === 0) return results;

    const granted = Math.max(this.acquire(tier), this.opts.minConcurrency);
    let active = 0;
    let next = 0;
    let aborted = false;

    return new Promise((resolve) => {
      const tryNext = () => {
        if (aborted) return;
        while (active < granted && next < tasks.length) {
          const idx = next++;
          const task = tasks[idx]!;
          active += 1;
          const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          task()
            .then((res) => {
              const end = (typeof performance !== 'undefined' ? performance.now() : Date.now());
              this.recordSuccess(tier, end - start);
              results[idx] = res;
            })
            .catch((err) => {
              const end = (typeof performance !== 'undefined' ? performance.now() : Date.now());
              this.recordFailure(tier, end - start, err?.message ?? String(err));
              results[idx] = null;
            })
            .finally(() => {
              active -= 1;
              if (next >= tasks.length && active === 0) {
                aborted = true;
                resolve(results);
              } else {
                tryNext();
              }
            });
        }
        if (next >= tasks.length && active === 0 && !aborted) {
          aborted = true;
          resolve(results);
        }
      };
      tryNext();
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private refreshHealth(m: TierMeta): void {
    const errRate = average(m.errors);
    const avg = average(m.samples);
    m.avgLatencyMs = avg;
    m.errorRate = errRate;

    if (errRate >= this.opts.circuitErrorThreshold || m.consecutiveFailures >= this.opts.windowSize) {
      m.health = 'CIRCUIT_OPEN';
      m.cooldownUntil = Date.now() + this.opts.cooldownMs;
    } else if (errRate > 0 || m.consecutiveFailures > 0) {
      m.health = 'DEGRADED';
    } else if (m.samples.length > 0) {
      m.health = 'HEALTHY';
    } else {
      m.health = 'UNKNOWN';
    }
  }

  private maybeRampUp(m: TierMeta): void {
    if (m.health !== 'HEALTHY') return;
    if (m.currentConcurrency < this.opts.maxConcurrency) {
      m.currentConcurrency = Math.min(this.opts.maxConcurrency, m.currentConcurrency + this.opts.rampStep);
    }
  }

  private maybeRampDown(m: TierMeta): void {
    if (m.health === 'CIRCUIT_OPEN') {
      m.currentConcurrency = 0;
    } else if (m.health === 'DEGRADED') {
      m.currentConcurrency = Math.max(this.opts.minConcurrency, Math.floor(m.currentConcurrency / 2));
    }
  }

  private firstHealthyBelow(tier: Tier): Tier | null {
    const idx = TIER_ORDER.indexOf(tier);
    for (let i = idx + 1; i < TIER_ORDER.length; i++) {
      const t = TIER_ORDER[i]!;
      const m = this.tiers.get(t)!;
      if (m.health !== 'CIRCUIT_OPEN') return t;
    }
    // Fall back to Tier 4 even if the circuit is open — it's offline
    // by definition and always "available" with cached data.
    return 'T4_OFFLINE';
  }

  private switchTo(tier: Tier, reason: string): void {
    if (this.activeTier === tier) return;
    const prev = this.activeTier;
    this.activeTier = tier;
    this.recordTransition(prev, tier, reason);
    this.notify();
  }

  private recordTransition(from: Tier | null, to: Tier, reason: string, triggerLatencyMs?: number): void {
    const ev: TransitionEvent = { ts: Date.now(), from, to, reason };
    if (triggerLatencyMs !== undefined) ev.triggerLatencyMs = triggerLatencyMs;
    this.transitions.push(ev);
    if (this.transitions.length > 100) this.transitions.shift();
  }

  private notify(): void {
    this.listeners.forEach((cb) => {
      try { cb(); } catch { /* swallow listener errors */ }
    });
  }

  private toStatus(m: TierMeta): TierStatus {
    const cooldownRemainingMs = m.cooldownUntil > Date.now() ? m.cooldownUntil - Date.now() : 0;
    return {
      tier: m.tier,
      health: m.health,
      avgLatencyMs: Number((m.avgLatencyMs ?? 0).toFixed(1)),
      errorRate: Number((m.errorRate ?? 0).toFixed(2)),
      lastSuccessAt: m.lastSuccessAt,
      consecutiveFailures: m.consecutiveFailures,
      cooldownRemainingMs,
      totalRequests: m.totalRequests,
      totalSuccesses: m.totalSuccesses,
    };
  }
}

export const pipelineGovernor = new PipelineGovernor();

// Tier label helper for UI.
export { TIER_LABEL };
