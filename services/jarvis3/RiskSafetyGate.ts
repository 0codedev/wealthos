/**
 * RiskSafetyGate — CC32
 *
 * Hard safety gate for voice-routed order intents. The gate enforces
 * per-session caps BEFORE the order reaches the broker wrapper. If any
 * cap is exceeded, the gate returns a structured "blocked" verdict with
 * the reason and the remaining headroom — the host UI uses this to
 * surface a non-recoverable toast.
 *
 * Default caps (all overridable via useSettingsStore):
 *   - sessionMarginCap:   ₹50,000  (max margin allocated via voice today)
 *   - dailyLossCap:       -₹10,000 (auto-disable voice if daily loss > cap)
 *   - ordersPerSession:   5        (max executed voice orders per session)
 *
 * State persistence: counters live in localStorage under
 * `wealth-jarvis3-risk-gate` with an IST date stamp. The gate auto-resets
 * at IST midnight (06:30 UTC the previous day... no, IST midnight is
 * 18:30 UTC). On every `evaluate()` call, the gate checks the date and
 * zeroes counters if the IST day rolled over.
 *
 * The gate is intentionally side-effect-free: it does NOT throw and does
 * NOT call the broker. The caller is responsible for routing to the
 * broker after `evaluate()` returns `allowed: true`.
 */
import { logger } from '../Logger';
import { VoiceOrderIntent } from '../VoiceOrderConduit';

export interface RiskVerdict {
  allowed: boolean;
  reason?: string;
  remainingMargin: number;
  remainingLossBudget: number;
  remainingOrders: number;
  /** Current utilization, 0..1, for the UI progress ring. */
  utilization: {
    margin: number;
    loss: number;
    orders: number;
  };
}

interface GateState {
  /** IST date string YYYY-MM-DD this state was last reset for. */
  istDate: string;
  sessionMarginUsed: number;
  dailyRealizedLoss: number;
  ordersExecuted: number;
  /** Set when dailyLossCap is breached — voice execution is disabled for the rest of the day. */
  voiceDisabled: boolean;
}

export const DEFAULT_RISK_LIMITS = {
  sessionMarginCap: 50_000,    // ₹50,000
  dailyLossCap: 10_000,        // -₹10,000
  ordersPerSession: 5,
} as const;

const STORAGE_KEY = 'wealth-jarvis3-risk-gate';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function getIstDateString(now: Date = new Date()): string {
  // IST = UTC+5:30. We slice the YYYY-MM-DD in IST.
  const istMs = now.getTime() + (5.5 * 60 - now.getTimezoneOffset()) * 60_000;
  return new Date(istMs).toISOString().slice(0, 10);
}

function loadState(): GateState {
  const fresh: GateState = {
    istDate: getIstDateString(),
    sessionMarginUsed: 0,
    dailyRealizedLoss: 0,
    ordersExecuted: 0,
    voiceDisabled: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as GateState;
    // If the IST day rolled over, return a fresh state.
    if (parsed.istDate !== fresh.istDate) return fresh;
    return parsed;
  } catch {
    return fresh;
  }
}

function saveState(state: GateState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    logger.warn('[RiskSafetyGate] Failed to persist state', err);
  }
}

class RiskSafetyGateImpl {
  private state: GateState = loadState();

  /**
   * Return a read-only view of the current gate state.
   */
  snapshot() {
    // Roll over check
    const today = getIstDateString();
    if (this.state.istDate !== today) {
      this.state = {
        istDate: today,
        sessionMarginUsed: 0,
        dailyRealizedLoss: 0,
        ordersExecuted: 0,
        voiceDisabled: false,
      };
      saveState(this.state);
    }
    return { ...this.state };
  }

  /**
   * Evaluate an intent against the current gate. Does NOT mutate state.
   * Use `recordExecution()` after a successful broker ack.
   */
  evaluate(
    intent: Pick<VoiceOrderIntent, 'symbol' | 'quantity' | 'price' | 'side'>,
    limits: { sessionMarginCap: number; dailyLossCap: number; ordersPerSession: number } = DEFAULT_RISK_LIMITS
  ): RiskVerdict {
    this.snapshot();

    const orderNotional = intent.quantity * intent.price;

    if (this.state.voiceDisabled) {
      return this.verdict(limits, `Voice execution is disabled for the day. Daily loss budget of ₹${limits.dailyLossCap.toLocaleString('en-IN')} was breached.`);
    }
    if (this.state.ordersExecuted >= limits.ordersPerSession) {
      return this.verdict(limits, `Voice order limit reached (${limits.ordersPerSession} per session). Wait until tomorrow or place the order manually.`);
    }
    if (this.state.sessionMarginUsed + orderNotional > limits.sessionMarginCap) {
      return this.verdict(limits, `Order notional ₹${orderNotional.toFixed(0)} would exceed the daily voice-margin cap of ₹${limits.sessionMarginCap.toLocaleString('en-IN')}.`);
    }
    if (this.state.dailyRealizedLoss <= -limits.dailyLossCap) {
      return this.verdict(limits, `Daily loss cap of ₹${limits.dailyLossCap.toLocaleString('en-IN')} reached. Voice execution auto-disabled.`);
    }

    return this.verdict(limits);
  }

  /**
   * Record a successful execution. Adds the order's notional to the
   * session margin and bumps the order counter.
   */
  recordExecution(notional: number) {
    this.snapshot();
    this.state.sessionMarginUsed += notional;
    this.state.ordersExecuted += 1;
    saveState(this.state);
  }

  /**
   * Record a realized P&L (e.g. after a position closes). If the loss
   * exceeds the daily cap, voice execution is auto-disabled.
   */
  recordRealizedPnL(pnl: number, limits: { dailyLossCap: number } = DEFAULT_RISK_LIMITS) {
    this.snapshot();
    this.state.dailyRealizedLoss += pnl;
    if (this.state.dailyRealizedLoss <= -limits.dailyLossCap) {
      this.state.voiceDisabled = true;
      logger.warn(`[RiskSafetyGate] Daily loss cap breached (₹${this.state.dailyRealizedLoss.toFixed(0)}). Voice execution disabled.`);
    }
    saveState(this.state);
  }

  /**
   * Reset the gate to zero (debug / manual override).
   */
  reset() {
    this.state = {
      istDate: getIstDateString(),
      sessionMarginUsed: 0,
      dailyRealizedLoss: 0,
      ordersExecuted: 0,
      voiceDisabled: false,
    };
    saveState(this.state);
  }

  private verdict(limits: { sessionMarginCap: number; dailyLossCap: number; ordersPerSession: number }, reason?: string): RiskVerdict {
    return {
      allowed: !reason,
      reason,
      remainingMargin: Math.max(0, limits.sessionMarginCap - this.state.sessionMarginUsed),
      remainingLossBudget: Math.max(0, limits.dailyLossCap + this.state.dailyRealizedLoss),
      remainingOrders: Math.max(0, limits.ordersPerSession - this.state.ordersExecuted),
      utilization: {
        margin: this.state.sessionMarginUsed / limits.sessionMarginCap,
        loss: Math.max(0, -this.state.dailyRealizedLoss / limits.dailyLossCap),
        orders: this.state.ordersExecuted / limits.ordersPerSession,
      },
    };
  }
}

export const riskSafetyGate = new RiskSafetyGateImpl();
