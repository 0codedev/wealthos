import { logger } from './Logger';
import { useSettingsStore } from '../store/settingsStore';
import { isAlphaActiveHours } from '../types/trust';
import { uid } from '../utils/uid';
import { useGlobalTickStore } from '../store/globalTickStore';


export interface DepthLevel {
  price: number;
  quantity: number;
  orders: number;
}

export interface UpstoxTick {
  instrument_key: string;
  timestamp: string;
  ltp: number | null;
  close: number | null;
  volume: number | null;
  oi: number | null;
  iv: number | null;
  ltt?: number | null;
  ltq?: number | null;
  atp?: number | null;
  upperCircuit?: number | null;
  lowerCircuit?: number | null;
  greeks: {
    delta?: number;
    theta?: number;
    gamma?: number;
    vega?: number;
    rho?: number;
  } | null;
  ohlc?: {
    open: number;
    high: number;
    low: number;
    close: number;
  };
  ohlc_intervals?: Record<string, {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp: number;
  }>;
  depth?: {
    buy: DepthLevel[];
    sell: DepthLevel[];
  };
}

export type TickCallback = (tick: UpstoxTick) => void;

export interface WSHealthMetrics {
  isConnected: boolean;
  subscriptionCount: number;
  subscriptions: string[];
  keyModes: Record<string, string>;
  ticksReceived: number;
  lastTickAt: number | null;
  reconnectCount: number;
  budgetRemaining: number;
  modeCounts: {
    ltpc: number;
    full: number;
    option_greeks: number;
    full_d30: number;
  };
  modeBudgets: {
    ltpc: number;
    full: number;
    option_greeks: number;
    full_d30: number;
  };
}

class UpstoxWebSocketService {
  private eventSource: EventSource | null = null;
  private callbacks: Map<string, Set<TickCallback>> = new Map();
  private subscribedKeys: Set<string> = new Set();
  private statusListeners: Set<(status: 'connected' | 'connecting' | 'disconnected') => void> = new Set();
  private connectionStatus: 'connected' | 'connecting' | 'disconnected' = 'disconnected';
  private reconnectTimeout: number | null = null;
  private reconnectAttempts = 0;
  private pendingSubscribes: Set<string> = new Set();
  private pendingUnsubscribes: Set<string> = new Set();
  private syncTimeout: number | null = null;
  private watchdogTimeout: number | null = null;
  private stallTimeout: number | null = null;
  private throughputInterval: number | null = null;
  private ticksInCurrentSecond = 0;

  private ticksReceived = 0;
  private lastTickAt: number | null = null;

  // P0#4: Session-persisted Client ID so page reloads immediately reattach to the same client session
  private clientId: string = (() => {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        const existing = window.sessionStorage.getItem('wealthos_tab_client_id');
        if (existing) return existing;
        const newId = uid();
        window.sessionStorage.setItem('wealthos_tab_client_id', newId);
        return newId;
      } catch {
        return uid();
      }
    }
    return uid();
  })();

  private keyModes: Map<string, string> = new Map();
  private settingsUnsubscribe: (() => void) | null = null;

  // Resilient Multi-Tab & Refresh-Proof SharedWorker
  private worker: SharedWorker | null = null;
  private workerPort: MessagePort | null = null;
  private isUsingWorker = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    // Subscribe to settings change to handle showOrderBookDepth toggle
    this.settingsUnsubscribe = useSettingsStore.subscribe((state, prevState) => {
      if (state.showOrderBookDepth !== prevState.showOrderBookDepth) {
        this.handleDepthToggleChange(state.showOrderBookDepth);
      }
    });

    // Multi-Device Sync: Reconnect automatically when token is restored from Cloud VPS
    if (typeof window !== 'undefined') {
      window.addEventListener('wealthos-upstox-token-restored', () => {
        logger.info('🔑 [Upstox WebSocket] Token restored via multi-device sync. Connecting stream immediately...');
        this.disconnect();
        this.connect();
      });
    }

    // Initialize SharedWorker if supported by the browser environment
    if (typeof window !== 'undefined' && typeof (window as any).SharedWorker !== 'undefined') {
      try {
        this.worker = new SharedWorker(
          new URL('../workers/upstox.sharedworker.ts', import.meta.url),
          { type: 'module', name: 'wealthos-upstox-stream' }
        );
        this.workerPort = this.worker.port;
        this.workerPort.onmessage = this.handleWorkerMessage;
        this.workerPort.start();
        this.isUsingWorker = true;
        if ((window as any).__WS_FORCE_CONNECT__) {
          this.workerPort.postMessage({ type: 'SET_FORCE_CONNECT', force: true });
        }
        this.workerPort.postMessage({ type: 'REGISTER_TAB', tabId: this.clientId });

        const unregister = () => {
          this.workerPort?.postMessage({ type: 'UNREGISTER_TAB', tabId: this.clientId });
        };
        window.addEventListener('pagehide', unregister);
        window.addEventListener('beforeunload', unregister);
        logger.info('🚀 [Upstox WebSocket] Initialized resilient SharedWorker stream (multi-tab & refresh-proof).');
      } catch (err) {
        logger.warn('⚠️ [Upstox WebSocket] SharedWorker initialization failed. Falling back to direct SSE:', err);
        this.isUsingWorker = false;
      }
    }
  }

  private handleWorkerMessage = (e: MessageEvent) => {
    const data = e.data;
    if (!data || !data.type) return;

    switch (data.type) {
      case 'SNAPSHOT': {
        if (Array.isArray(data.ticks) && data.ticks.length > 0) {
          useGlobalTickStore.getState().setTicksBatch(data.ticks, true);
          data.ticks.forEach((tick: UpstoxTick) => {
            const cbs = this.callbacks.get(tick.instrument_key);
            if (cbs) cbs.forEach((cb) => cb(tick));
          });
        }
        if (data.status) {
          this.setStatus(data.status);
        }
        break;
      }
      case 'TICKS': {
        const ticks: UpstoxTick[] = data.ticks;
        if (Array.isArray(ticks)) {
          this.ticksReceived += ticks.length;
          this.lastTickAt = Date.now();
          useGlobalTickStore.getState().setTicksBatch(ticks);
          ticks.forEach((tick) => {
            const cbs = this.callbacks.get(tick.instrument_key);
            if (cbs) cbs.forEach((cb) => cb(tick));
          });
        }
        break;
      }
      case 'STATUS': {
        this.setStatus(data.status);
        break;
      }
      case 'TELEMETRY': {
        useGlobalTickStore.getState().setTelemetry({
          ticksPerSecond: data.ticksPerSecond,
          subscribedKeysCount: data.subscribedKeysCount,
          lastTickAt: data.lastTickAt,
        });
        break;
      }
    }
  };

  /**
   * Complete teardown of the service instance
   */
  public dispose() {
    this.disconnect();
    
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    
    if (this.settingsUnsubscribe) {
      this.settingsUnsubscribe();
      this.settingsUnsubscribe = null;
    }
    
    if (this.syncTimeout) {
      window.clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }

    if (this.stallTimeout) {
      window.clearTimeout(this.stallTimeout);
      this.stallTimeout = null;
    }

    if (this.throughputInterval) {
      window.clearInterval(this.throughputInterval);
      this.throughputInterval = null;
    }
    
    this.callbacks.clear();
    this.subscribedKeys.clear();
    this.statusListeners.clear();
    this.keyModes.clear();
    this.pendingSubscribes.clear();
    this.pendingUnsubscribes.clear();
    useGlobalTickStore.getState().setConnectionState('disconnected');
    useGlobalTickStore.getState().setTelemetry({ ticksPerSecond: 0, subscribedKeysCount: 0 });
  }

  private handleDepthToggleChange(showDepth: boolean) {
    if (!showDepth) {
      logger.info('📉 [Upstox WebSocket] showOrderBookDepth toggled OFF. Downgrading full_d30 subscriptions...');
      const keysToResync: string[] = [];
      this.keyModes.forEach((mode, key) => {
        if (mode === 'full_d30') {
          this.keyModes.set(key, 'full');
          keysToResync.push(key);
        }
      });
      if (keysToResync.length > 0) {
        this.syncSubscriptions(keysToResync, 'subscribe');
      }
    }
  }

  private handleVisibilityChange = () => {
    const isVisible = document.visibilityState === 'visible';
    logger.info(`👁️ [Upstox WebSocket] Tab visibility changed: ${isVisible ? 'visible' : 'hidden'}. Resyncing subscription visibility states...`);
    if (isVisible) {
      // Mobile wake check: If stream was closed or disconnected while backgrounded, reconnect immediately
      const isDead = this.connectionStatus !== 'connected' || (this.eventSource && this.eventSource.readyState === EventSource.CLOSED);
      if (isDead) {
        logger.info('📱 [Upstox WebSocket] Foreground return detected with inactive stream. Reconnecting stream...');
        this.disconnect();
        this.connect();
      } else if (this.subscribedKeys.size > 0) {
        this.subscribedKeys.forEach((key) => {
          this.pendingSubscribes.add(key);
        });
        this.syncSubscriptions([], 'subscribe');
      }
    }
  };

  /**
   * Returns current connection status
   */
  getStatus(): 'connected' | 'connecting' | 'disconnected' {
    return this.connectionStatus;
  }

  /**
   * Returns reconnect attempts count
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * Returns websocket health metrics
   */
  getHealthMetrics(): WSHealthMetrics {
    const counts = {
      ltpc: 0,
      full: 0,
      option_greeks: 0,
      full_d30: 0
    };

    this.keyModes.forEach((mode) => {
      if (mode === 'ltpc') counts.ltpc++;
      else if (mode === 'full') counts.full++;
      else if (mode === 'option_greeks') counts.option_greeks++;
      else if (mode === 'full_d30') counts.full_d30++;
    });

    const budgets = {
      ltpc: Math.max(0, 5000 - counts.ltpc),
      full: Math.max(0, 2000 - counts.full),
      option_greeks: Math.max(0, 3000 - counts.option_greeks),
      full_d30: Math.max(0, 50 - counts.full_d30)
    };

    return {
      isConnected: this.connectionStatus === 'connected',
      subscriptionCount: this.subscribedKeys.size,
      subscriptions: Array.from(this.subscribedKeys),
      keyModes: Object.fromEntries(this.keyModes),
      ticksReceived: this.ticksReceived,
      lastTickAt: this.lastTickAt,
      reconnectCount: this.reconnectAttempts,
      budgetRemaining: budgets.ltpc + budgets.full + budgets.option_greeks + budgets.full_d30,
      modeCounts: counts,
      modeBudgets: budgets
    };
  }

  /**
   * Register a listener for connection status changes
   */
  onStatusChange(listener: (status: 'connected' | 'connecting' | 'disconnected') => void) {
    this.statusListeners.add(listener);
    listener(this.connectionStatus);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setStatus(newStatus: 'connected' | 'connecting' | 'disconnected') {
    if (this.connectionStatus !== newStatus) {
      this.connectionStatus = newStatus;
      this.statusListeners.forEach((listener) => listener(newStatus));
      logger.info(`🔌 [Upstox WebSocket] Connection status: ${newStatus}`);

      if (newStatus === 'connecting') {
        useGlobalTickStore.getState().setConnectionState('connecting');
      } else if (newStatus === 'disconnected') {
        useGlobalTickStore.getState().setConnectionState('disconnected');
        useGlobalTickStore.getState().setTelemetry({ ticksPerSecond: 0 });
      } else if (newStatus === 'connected') {
        useGlobalTickStore.getState().setConnectionState('subscribing');
      }
    }
  }

  /**
   * Connect to the SSE endpoint
   */
  private handleOnline = () => {
    logger.info('🌐 [Upstox WebSocket] Network back online. Resyncing stream...');
    this.disconnect();
    this.connect();
  };

  private resetWatchdog() {
    if (this.watchdogTimeout) {
      window.clearTimeout(this.watchdogTimeout);
      this.watchdogTimeout = null;
    }
    if (this.stallTimeout) {
      window.clearTimeout(this.stallTimeout);
      this.stallTimeout = null;
    }
    
    // Only run watchdog if we are connected and have active subscriptions
    if (this.connectionStatus === 'connected' && this.subscribedKeys.size > 0) {
      // 12s stall detector
      this.stallTimeout = window.setTimeout(() => {
        if (this.connectionStatus === 'connected' && this.subscribedKeys.size > 0) {
          useGlobalTickStore.getState().setConnectionState('stalled');
          useGlobalTickStore.getState().setTelemetry({ ticksPerSecond: 0 });
        }
      }, 12000);

      // 45s hard watchdog for reconnect
      this.watchdogTimeout = window.setTimeout(() => {
        logger.warn('⚠️ [Upstox WebSocket] Watchdog timeout: no tick data received for 45s. Forcing reconnect...');
        this.watchdogTimeout = null;
        this.disconnect();
        this.attemptReconnect();
      }, 45000);
    }
  }

  connect(force: boolean = false) {
    if (this.isUsingWorker && this.workerPort) {
      if (force || (window as any).__WS_FORCE_CONNECT__) {
        this.workerPort.postMessage({ type: 'SET_FORCE_CONNECT', force: true });
      }
      this.workerPort.postMessage({ type: 'REGISTER_TAB', tabId: this.clientId });
      return;
    }

    const isUpstoxEnabled = useSettingsStore.getState().isUpstoxEnabled;
    if (!isUpstoxEnabled) {
      this.setStatus('disconnected');
      return;
    }

    if (!isAlphaActiveHours()) {
      const forceConnect = (window as any).__WS_FORCE_CONNECT__;
      if (!forceConnect) {
        logger.info('🔌 [Upstox WebSocket] Paused connection outside active market hours (Mon-Fri 9:00 AM - 3:45 PM IST). Set window.__WS_FORCE_CONNECT__ = true to override.');
        this.setStatus('disconnected');
        return;
      }
      logger.info('🔌 [Upstox WebSocket] Active hours override detected (window.__WS_FORCE_CONNECT__ = true). Proceeding with connection...');
    }

    if (this.eventSource) {
      return;
    }

    this.setStatus('connecting');
    const sseUrl = `/api/python-nse/api/upstox/ws/stream?client_id=${this.clientId}`;
    
    try {
      this.eventSource = new EventSource(sseUrl);
      
      // Bind network change event
      window.addEventListener('online', this.handleOnline);

      this.eventSource.onopen = () => {
        this.setStatus('connected');
        this.reconnectAttempts = 0;
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }

        // Start throughput ticker interval
        if (!this.throughputInterval && typeof window !== 'undefined') {
          this.throughputInterval = window.setInterval(() => {
            const tps = this.ticksInCurrentSecond;
            this.ticksInCurrentSecond = 0;
            useGlobalTickStore.getState().setTelemetry({
              ticksPerSecond: tps,
              subscribedKeysCount: this.subscribedKeys.size,
              lastTickAt: this.lastTickAt ?? undefined,
            });
          }, 1000);
        }
        
        // Start/reset watchdog
        this.resetWatchdog();
        
        // Sync existing subscriptions on reconnect
        if (this.subscribedKeys.size > 0) {
          this.syncSubscriptions(Array.from(this.subscribedKeys), 'subscribe');
        }
      };

      this.eventSource.onmessage = (event) => {
        // Reset watchdog upon receiving data
        this.resetWatchdog();
        
        try {
          if (event.data === 'ping') return;
          
          const ticks: UpstoxTick[] = JSON.parse(event.data);
          if (Array.isArray(ticks)) {
            this.ticksReceived += ticks.length;
            this.ticksInCurrentSecond += ticks.length;
            this.lastTickAt = Date.now();

            // Sync batch to global tick store for 0-latency UI updates & telemetry
            useGlobalTickStore.getState().setTicksBatch(ticks);

            ticks.forEach((tick) => {
              const key = tick.instrument_key;
              const keyCallbacks = this.callbacks.get(key);
              if (keyCallbacks) {
                keyCallbacks.forEach((cb) => cb(tick));
              }
            });
          }
        } catch (err) {
          logger.error('Failed to parse SSE payload:', err);
        }
      };

      this.eventSource.onerror = (err) => {
        logger.error('Upstox SSE Error:', err);
        this.disconnect();
        this.attemptReconnect();
      };
    } catch (err) {
      logger.error('Error establishing Upstox SSE connection:', err);
      this.setStatus('disconnected');
      this.attemptReconnect();
    }
  }

  /**
   * Disconnect from the SSE endpoint
   */
  disconnect() {
    if (this.isUsingWorker && this.workerPort) {
      this.workerPort.postMessage({ type: 'UNREGISTER_TAB', tabId: this.clientId });
      this.setStatus('disconnected');
      return;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    
    // Clean up online listener
    window.removeEventListener('online', this.handleOnline);
    
    // Clean up watchdog timer
    if (this.watchdogTimeout) {
      window.clearTimeout(this.watchdogTimeout);
      this.watchdogTimeout = null;
    }

    if (this.stallTimeout) {
      window.clearTimeout(this.stallTimeout);
      this.stallTimeout = null;
    }

    if (this.throughputInterval) {
      window.clearInterval(this.throughputInterval);
      this.throughputInterval = null;
    }
    this.ticksInCurrentSecond = 0;

    // Clean up reconnect timer
    if (this.reconnectTimeout) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.reconnectAttempts = 0;
    
    this.setStatus('disconnected');
  }

  private attemptReconnect() {
    if (this.reconnectTimeout) return;

    if (!isAlphaActiveHours()) {
      logger.info('🔌 [Upstox WebSocket] Paused reconnection attempts outside active market hours.');
      this.setStatus('disconnected');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Max 30s delay
    logger.info(`Attempting Upstox WebSocket reconnect #${this.reconnectAttempts} in ${delay}ms...`);
    
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  private compareModes(m1: string, m2: string): number {
    const priorities: Record<string, number> = {
      'full_d30': 4,
      'full': 3,
      'option_greeks': 2,
      'ltpc': 1
    };
    return (priorities[m1] || 1) - (priorities[m2] || 1);
  }

  /**
   * Subscribe to real-time tick updates with L2 order book depth
   */
  subscribeWithDepth(keys: string[], callback: TickCallback) {
    this.subscribe(keys, callback, 'full_d30');
  }

  /**
   * Subscribe to real-time tick updates for specific keys in a specific mode
   */
  subscribe(keys: string[], callback: TickCallback, mode: string = 'full') {
    const validKeys = keys.filter(k => k && k.trim() !== '');
    if (validKeys.length === 0) return;

    const showOrderBookDepth = useSettingsStore.getState().showOrderBookDepth;
    const targetMode = (mode === 'full_d30' && !showOrderBookDepth) ? 'full' : mode;

    if (this.isUsingWorker && this.workerPort) {
      validKeys.forEach((key) => {
        let keySet = this.callbacks.get(key);
        if (!keySet) {
          keySet = new Set();
          this.callbacks.set(key, keySet);
        }
        keySet.add(callback);
        this.subscribedKeys.add(key);
        this.keyModes.set(key, targetMode);
      });
      useGlobalTickStore.getState().setTelemetry({ subscribedKeysCount: this.subscribedKeys.size });

      this.workerPort.postMessage({
        type: 'SUBSCRIBE',
        tabId: this.clientId,
        keys: validKeys,
        mode: targetMode,
      });
      return;
    }

    // Ensure connection is active
    this.connect();

    const keysToRegister: string[] = [];

    validKeys.forEach((key) => {
      let keySet = this.callbacks.get(key);
      if (!keySet) {
        keySet = new Set();
        this.callbacks.set(key, keySet);
      }
      
      keySet.add(callback);

      // Track the mode for this key
      const currentMode = this.keyModes.get(key);
      if (!currentMode || this.compareModes(targetMode, currentMode) > 0) {
        this.keyModes.set(key, targetMode);
        // Force register/resync if mode got upgraded
        if (this.subscribedKeys.has(key)) {
          keysToRegister.push(key);
        }
      }

      // If this is a new subscription key, sync with backend
      if (!this.subscribedKeys.has(key)) {
        this.subscribedKeys.add(key);
        keysToRegister.push(key);
      }
    });

    if (keysToRegister.length > 0) {
      useGlobalTickStore.getState().setTelemetry({ subscribedKeysCount: this.subscribedKeys.size });
      this.resetWatchdog();
      if (this.connectionStatus === 'connected') {
        this.syncSubscriptions(keysToRegister, 'subscribe');
      }
    }
  }

  /**
   * Unsubscribe from updates
   */
  unsubscribe(keys: string[], callback: TickCallback) {
    const keysToDeregister: string[] = [];

    keys.forEach((key) => {
      const keySet = this.callbacks.get(key);
      if (keySet) {
        keySet.delete(callback);
        if (keySet.size === 0) {
          this.callbacks.delete(key);
          this.subscribedKeys.delete(key);
          this.keyModes.delete(key);
          keysToDeregister.push(key);
        }
      }
    });

    useGlobalTickStore.getState().setTelemetry({ subscribedKeysCount: this.subscribedKeys.size });

    if (this.isUsingWorker && this.workerPort) {
      if (keysToDeregister.length > 0) {
        this.workerPort.postMessage({
          type: 'UNSUBSCRIBE',
          tabId: this.clientId,
          keys: keysToDeregister,
        });
      }
      return;
    }

    if (keysToDeregister.length > 0) {
      this.resetWatchdog();
      if (this.connectionStatus === 'connected') {
        this.syncSubscriptions(keysToDeregister, 'unsubscribe');
      }
    }
  }

  private syncSubscriptions(keys: string[], action: 'subscribe' | 'unsubscribe') {
    if (action === 'subscribe') {
      keys.forEach(k => {
        this.pendingSubscribes.add(k);
        this.pendingUnsubscribes.delete(k); // Cancel out any pending unsubscribe for this key
      });
    } else {
      keys.forEach(k => {
        this.pendingUnsubscribes.add(k);
        this.pendingSubscribes.delete(k); // Cancel out any pending subscribe for this key
      });
    }

    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
    }

    this.syncTimeout = window.setTimeout(() => {
      this.syncTimeout = null;
      this.flushSubscriptions();
    }, 250);
  }

  private async flushSubscriptions() {
    const isUpstoxEnabled = useSettingsStore.getState().isUpstoxEnabled;
    if (!isUpstoxEnabled) {
      this.pendingSubscribes.clear();
      this.pendingUnsubscribes.clear();
      return;
    }

    const subs = Array.from(this.pendingSubscribes);
    const unsubs = Array.from(this.pendingUnsubscribes);

    this.pendingSubscribes.clear();
    this.pendingUnsubscribes.clear();

    if (unsubs.length > 0) {
      try {
        const response = await fetch('/api/python-nse/api/upstox/ws/unsubscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            client_id: this.clientId,
            keys: unsubs 
          }),
        });
        if (!response.ok) {
          logger.error('Failed to sync batch unsubscribe with backend:', response.statusText);
        }
      } catch (err) {
        logger.error('Network error syncing batch unsubscribe with backend:', err);
      }
    }

    if (subs.length > 0) {
      // Group subs by requested mode
      const modeGroups: Record<string, string[]> = {};
      subs.forEach((key) => {
        const mode = this.keyModes.get(key) || 'full';
        if (!modeGroups[mode]) {
          modeGroups[mode] = [];
        }
        modeGroups[mode].push(key);
      });

      const isVisible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;

      for (const [mode, keys] of Object.entries(modeGroups)) {
        try {
          const response = await fetch('/api/python-nse/api/upstox/ws/subscribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
              client_id: this.clientId,
              keys: keys,
              mode: mode,
              is_visible: isVisible
            }),
          });
          if (!response.ok) {
            logger.error(`Failed to sync batch subscribe for mode ${mode} with backend:`, response.statusText);
          }
        } catch (err) {
          logger.error(`Network error syncing batch subscribe for mode ${mode} with backend:`, err);
        }
      }
    }
  }
}

export const upstoxWebSocketService = new UpstoxWebSocketService();
