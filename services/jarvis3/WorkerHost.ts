/**
 * WorkerHost — CC32
 *
 * Type-safe wrapper around the Jarvis 3.0 sentinel Web Worker. The host
 * owns the worker lifecycle (create, restart on crash, dispose) and
 * provides a promise-based request/response API plus a streaming
 * listener pattern for `TICK` events.
 *
 * Lifecycle:
 *   - Lazy-instantiated on first `start()` or first `request()`.
 *   - Auto-restart on `WORKER_ERROR` or unresponsive PING, max 3 retries
 *     with exponential backoff (1s, 2s, 4s).
 *   - A `generation` counter is bumped on every (re)spawn; stale
 *     responses are dropped on the host side.
 */
import { logger } from '../Logger';

export type JarvisWorkerRequest =
  | { id: string; type: 'START'; payload?: { intervalMs?: number; symbol?: string } }
  | { id: string; type: 'STOP' }
  | { id: string; type: 'PING' }
  | { id: string; type: 'EVALUATE'; payload: { closes: number[]; periodFast?: number; periodSlow?: number } }
  | { id: string; type: 'RISK_CHECK'; payload: { intent: { side: 'BUY' | 'SELL'; symbol: string; quantity: number; price: number } } };

export type JarvisWorkerResponse =
  | { id?: string; type: 'TICK'; payload?: any; generation: number }
  | { id?: string; type: 'INDICATORS'; payload?: any; generation: number }
  | { id?: string; type: 'RISK_VERDICT'; payload?: any; generation: number }
  | { id?: string; type: 'PONG'; id_?: string; generation: number }
  | { id?: string; type: 'ERROR' | 'WORKER_ERROR' | 'STARTED' | 'STOPPED'; payload?: any; generation: number; error?: string };

const MAX_RESTART_ATTEMPTS = 3;

class WorkerHostImpl {
  private worker: Worker | null = null;
  private generation = 0;
  private restartAttempts = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(msg: JarvisWorkerResponse) => void>();
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; generation: number }>();
  private isStarting = false;

  /**
   * Subscribe to all worker messages (TICK, ERROR, etc.). Returns an
   * unsubscribe function.
   */
  on(listener: (msg: JarvisWorkerResponse) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Send a request and wait for the matching response. Times out after
   * 15 seconds.
   */
  request<T = any>(msg: JarvisWorkerRequest, timeoutMs = 15_000): Promise<T> {
    if (!this.worker) this.spawn();
    if (!this.worker) return Promise.reject(new Error('Worker unavailable'));

    return new Promise<T>((resolve, reject) => {
      const generation = this.generation;
      const timer = setTimeout(() => {
        this.pending.delete(msg.id);
        reject(new Error(`Worker request '${msg.type}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(msg.id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
        generation
      });
      this.worker!.postMessage(msg);
    });
  }

  /**
   * Spawn a new worker. Bumps the generation counter and discards any
   * in-flight requests (they will reject on the next event-loop tick).
   */
  spawn() {
    if (this.isStarting) return;
    this.isStarting = true;
    try {
      if (this.worker) {
        try { this.worker.terminate(); } catch {}
        this.worker = null;
      }
      this.generation++;
      this.worker = new Worker(new URL('../../workers/jarvis3.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<JarvisWorkerResponse>) => this.handleMessage(e.data);
      this.worker.onerror = (e) => {
        logger.error('[WorkerHost] worker error', e);
        this.handleMessage({ type: 'WORKER_ERROR', error: e.message ?? 'unknown', generation: this.generation });
        this.scheduleRestart();
      };
      logger.info(`[WorkerHost] spawned worker (generation ${this.generation})`);
    } catch (err) {
      logger.error('[WorkerHost] failed to spawn worker', err);
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Start the sentinel. Convenience wrapper that spawns (if needed) and
   * sends START.
   */
  async start(config: { intervalMs?: number; symbol?: string } = {}): Promise<void> {
    if (!this.worker) this.spawn();
    await this.request({ id: this.newId(), type: 'START', payload: config });
  }

  /**
   * Stop the sentinel.
   */
  async stop(): Promise<void> {
    if (!this.worker) return;
    try {
      await this.request({ id: this.newId(), type: 'STOP' });
    } catch (err) {
      logger.warn('[WorkerHost] stop failed', err);
    }
  }

  /**
   * Tear down the worker entirely. Pending requests reject.
   */
  dispose() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    try { this.worker?.terminate(); } catch {}
    this.worker = null;
    for (const [, p] of this.pending) {
      p.reject(new Error('WorkerHost disposed'));
    }
    this.pending.clear();
  }

  // -------------------- internals --------------------

  private handleMessage(msg: JarvisWorkerResponse) {
    // Reject any pending requests belonging to a stale generation
    if (msg.generation !== this.generation) {
      return;
    }
    const anyMsg = msg as any;
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      p.resolve(anyMsg.payload ?? anyMsg);
      return;
    }
    // Otherwise, broadcast to all listeners
    this.listeners.forEach(l => {
      try { l(msg); } catch (err) {
        logger.error('[WorkerHost] listener threw', err);
      }
    });
  }

  private scheduleRestart() {
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      logger.error(`[WorkerHost] max restart attempts (${MAX_RESTART_ATTEMPTS}) reached. Worker disabled.`);
      return;
    }
    const delayMs = 1000 * Math.pow(2, this.restartAttempts);
    this.restartAttempts++;
    logger.warn(`[WorkerHost] scheduling worker restart in ${delayMs}ms (attempt ${this.restartAttempts})`);
    this.restartTimer = setTimeout(() => {
      this.spawn();
    }, delayMs);
  }

  private newId(): string {
    return `wkr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export const workerHost = new WorkerHostImpl();
export type { WorkerHostImpl };
