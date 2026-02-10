/**
 * WealthOS Resilient Network Circuit Breaker
 * ==========================================
 * Prevents DevTools request storms, redundant network hammering, and console log spam
 * when auxiliary backends (Python NSE Bridge, OpenAlgo, Upstox WebSocket) are unreachable,
 * offline, or returning consecutive 5xx/404 errors.
 *
 * Rules:
 *  - Trips to OPEN after 3 consecutive failures to an endpoint pattern.
 *  - Stays OPEN for 60 seconds (cooldown).
 *  - In OPEN state, fast-fails immediately without punching the network.
 *  - Enters HALF_OPEN after cooldown to allow 1 single probe request.
 *  - Resets to CLOSED immediately upon a successful response.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreakerOpenError extends Error {
  public readonly endpoint: string;
  public readonly cooldownRemainingMs: number;

  constructor(endpoint: string, cooldownRemainingMs: number) {
    super(`[CircuitBreaker] Endpoint "${endpoint}" is OPEN (${Math.round(cooldownRemainingMs / 1000)}s cooldown remaining). Network request suppressed.`);
    this.name = 'CircuitBreakerOpenError';
    this.endpoint = endpoint;
    this.cooldownRemainingMs = cooldownRemainingMs;
  }
}

interface EndpointCircuit {
  failures: number;
  state: CircuitState;
  openedAt: number | null;
  lastFailureAt: number | null;
}

class NetworkCircuitBreaker {
  private circuits: Map<string, EndpointCircuit> = new Map();
  private maxConsecutiveFailures: number = 3;
  private cooldownMs: number = 60000; // 60s cooldown

  private normalizeKey(url: string): string {
    try {
      // Strip query parameters and hashes for route grouping
      const u = url.split('?')[0].split('#')[0];
      return u;
    } catch {
      return url;
    }
  }

  private getCircuit(key: string): EndpointCircuit {
    let circuit = this.circuits.get(key);
    if (!circuit) {
      circuit = {
        failures: 0,
        state: 'CLOSED',
        openedAt: null,
        lastFailureAt: null,
      };
      this.circuits.set(key, circuit);
    }
    return circuit;
  }

  public isOpen(url: string): boolean {
    const key = this.normalizeKey(url);
    const circuit = this.getCircuit(key);

    if (circuit.state === 'OPEN') {
      const now = Date.now();
      const elapsed = now - (circuit.openedAt || 0);
      if (elapsed >= this.cooldownMs) {
        circuit.state = 'HALF_OPEN';
        return false; // allow 1 probe through
      }
      return true;
    }

    return false;
  }

  public getRemainingCooldown(url: string): number {
    const key = this.normalizeKey(url);
    const circuit = this.getCircuit(key);
    if (circuit.state !== 'OPEN' || !circuit.openedAt) return 0;
    const elapsed = Date.now() - circuit.openedAt;
    return Math.max(0, this.cooldownMs - elapsed);
  }

  public recordSuccess(url: string): void {
    const key = this.normalizeKey(url);
    const circuit = this.getCircuit(key);
    circuit.failures = 0;
    circuit.state = 'CLOSED';
    circuit.openedAt = null;
    circuit.lastFailureAt = null;
  }

  public recordFailure(url: string): void {
    const key = this.normalizeKey(url);
    const circuit = this.getCircuit(key);
    circuit.failures++;
    circuit.lastFailureAt = Date.now();

    if (circuit.failures >= this.maxConsecutiveFailures) {
      if (circuit.state !== 'OPEN') {
        circuit.state = 'OPEN';
        circuit.openedAt = Date.now();
        console.warn(`[CircuitBreaker] Endpoint "${key}" tripped to OPEN after ${circuit.failures} consecutive failures. Cooldown 60s engaged.`);
      }
    }
  }

  public resetAll(): void {
    this.circuits.clear();
  }
}

export const circuitBreaker = new NetworkCircuitBreaker();

/**
 * Drop-in wrapper around window.fetch with circuit breaker protection.
 * If the circuit is OPEN, suppresses the HTTP call and throws CircuitBreakerOpenError.
 */
export async function resilientFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const urlString = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));

  if (circuitBreaker.isOpen(urlString)) {
    const cooldown = circuitBreaker.getRemainingCooldown(urlString);
    throw new CircuitBreakerOpenError(urlString, cooldown);
  }

  try {
    const response = await fetch(input, init);
    // 5xx and select 4xx errors count as service failures for circuit breaking
    if (!response.ok && (response.status >= 500 || response.status === 404)) {
      circuitBreaker.recordFailure(urlString);
    } else {
      circuitBreaker.recordSuccess(urlString);
    }
    return response;
  } catch (err) {
    circuitBreaker.recordFailure(urlString);
    throw err;
  }
}
