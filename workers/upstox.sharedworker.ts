/**
 * WealthOS Upstox Stream SharedWorker
 * -----------------------------------
 * Provides a single, persistent SSE market data stream across multiple tabs.
 * Survives page refreshes without tearing down the underlying socket connection.
 * Automatically sleeps after 30s of total inactivity (0 connected tabs).
 */

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
  greeks?: any;
  ohlc?: {
    open: number;
    high: number;
    low: number;
    close: number;
  };
  ohlc_intervals?: Record<string, any>;
  depth?: any;
}

function isAlphaActiveHours(date: Date = new Date()): boolean {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const istOffset = 5.5 * 60 * 60000;
  const istDate = new Date(utc + istOffset);

  const day = istDate.getDay();
  const hours = istDate.getHours();
  const minutes = istDate.getMinutes();
  const time = hours * 100 + minutes;

  const isWeekend = day === 0 || day === 6;
  const isActiveHours = time >= 900 && time <= 1545;

  return !isWeekend && isActiveHours;
}

// Global scope in SharedWorker
const _self: any = self;

// State management inside the worker
const connectedPorts: Map<string, MessagePort> = new Map();
const tabSubscriptions: Map<string, Set<string>> = new Map();
const keyRefCount: Map<string, number> = new Map();
const keyModes: Map<string, string> = new Map();
const latestTicks: Map<string, UpstoxTick> = new Map();

let eventSource: EventSource | null = null;
let connectionStatus: 'connected' | 'connecting' | 'disconnected' = 'disconnected';
let idleTimeout: any = null;
let throughputInterval: any = null;
let ticksInCurrentSecond = 0;
let lastTickAt: number | null = null;
let reconnectTimeout: any = null;
let reconnectAttempts = 0;
let forceConnect = false;
let watchdogTimeout: any = null;

const CLIENT_ID = 'wealthos_shared_worker_root';

function broadcast(msg: any) {
  connectedPorts.forEach((port) => {
    try {
      port.postMessage(msg);
    } catch {
      // Dead port
    }
  });
}

function setConnectionStatus(newStatus: 'connected' | 'connecting' | 'disconnected') {
  if (connectionStatus !== newStatus) {
    connectionStatus = newStatus;
    broadcast({ type: 'STATUS', status: newStatus });
  }
}

function resetWatchdog() {
  if (watchdogTimeout) {
    clearTimeout(watchdogTimeout);
    watchdogTimeout = null;
  }
  if (connectionStatus === 'connected' && keyRefCount.size > 0) {
    watchdogTimeout = setTimeout(() => {
      disconnectStream();
      attemptReconnect();
    }, 45000);
  }
}

function connectStream() {
  if (eventSource) return;

  if (!isAlphaActiveHours() && !forceConnect) {
    setConnectionStatus('disconnected');
    return;
  }

  setConnectionStatus('connecting');
  const sseUrl = `/api/python-nse/api/upstox/ws/stream?client_id=${CLIENT_ID}`;

  try {
    eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => {
      setConnectionStatus('connected');
      reconnectAttempts = 0;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }

      if (!throughputInterval) {
        throughputInterval = setInterval(() => {
          const tps = ticksInCurrentSecond;
          ticksInCurrentSecond = 0;
          broadcast({
            type: 'TELEMETRY',
            ticksPerSecond: tps,
            subscribedKeysCount: keyRefCount.size,
            lastTickAt,
          });
        }, 1000);
      }

      resetWatchdog();

      // Resync any active subscriptions with backend
      if (keyRefCount.size > 0) {
        syncBackendSubscriptions(Array.from(keyRefCount.keys()), 'subscribe');
      }
    };

    eventSource.onmessage = (event) => {
      resetWatchdog();
      try {
        if (event.data === 'ping') return;
        const ticks: UpstoxTick[] = JSON.parse(event.data);
        if (Array.isArray(ticks)) {
          ticksInCurrentSecond += ticks.length;
          lastTickAt = Date.now();
          for (const t of ticks) {
            if (t && t.instrument_key) {
              latestTicks.set(t.instrument_key, t);
            }
          }
          broadcast({ type: 'TICKS', ticks });
        }
      } catch {
        // Ignore parse error
      }
    };

    eventSource.onerror = () => {
      disconnectStream();
      attemptReconnect();
    };
  } catch {
    setConnectionStatus('disconnected');
    attemptReconnect();
  }
}

function disconnectStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (throughputInterval) {
    clearInterval(throughputInterval);
    throughputInterval = null;
  }
  if (watchdogTimeout) {
    clearTimeout(watchdogTimeout);
    watchdogTimeout = null;
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  ticksInCurrentSecond = 0;
  setConnectionStatus('disconnected');
}

function attemptReconnect() {
  if (reconnectTimeout || connectedPorts.size === 0) return;
  if (!isAlphaActiveHours() && !forceConnect) return;

  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    connectStream();
  }, delay);
}

async function syncBackendSubscriptions(keys: string[], action: 'subscribe' | 'unsubscribe') {
  if (keys.length === 0) return;

  if (action === 'unsubscribe') {
    try {
      await fetch('/api/python-nse/api/upstox/ws/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: CLIENT_ID, keys }),
      });
    } catch {
      // Backend offline or retryable
    }
  } else {
    const modeGroups: Record<string, string[]> = {};
    for (const k of keys) {
      const mode = keyModes.get(k) || 'full';
      if (!modeGroups[mode]) modeGroups[mode] = [];
      modeGroups[mode].push(k);
    }
    for (const [mode, kList] of Object.entries(modeGroups)) {
      try {
        await fetch('/api/python-nse/api/upstox/ws/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: CLIENT_ID, keys: kList, mode, is_visible: true }),
        });
      } catch {
        // Backend offline or retryable
      }
    }
  }
}

// Connection listener for new tabs
_self.onconnect = (e: MessageEvent) => {
  const port = e.ports[0];
  if (!port) return;

  // Clear idle timeout whenever a tab connects
  if (idleTimeout) {
    clearTimeout(idleTimeout);
    idleTimeout = null;
  }

  port.onmessage = (msgEvent: MessageEvent) => {
    const data = msgEvent.data;
    if (!data || !data.type) return;

    switch (data.type) {
      case 'REGISTER_TAB': {
        const tabId = data.tabId || `tab_${Math.random()}`;
        connectedPorts.set(tabId, port);

        // Immediate Frame-0 snapshot back to this tab
        port.postMessage({
          type: 'SNAPSHOT',
          ticks: Array.from(latestTicks.values()),
          status: connectionStatus,
          throughput: ticksInCurrentSecond,
          subscribedKeysCount: keyRefCount.size,
        });

        // Ensure stream is running if we have tabs
        if (connectedPorts.size > 0 && !eventSource) {
          connectStream();
        }
        break;
      }

      case 'UNREGISTER_TAB': {
        const tabId = data.tabId;
        if (tabId && connectedPorts.has(tabId)) {
          connectedPorts.delete(tabId);

          // Clean up subscriptions owned by this tab
          const tabKeys = tabSubscriptions.get(tabId);
          if (tabKeys && tabKeys.size > 0) {
            const keysToDeregister: string[] = [];
            tabKeys.forEach((key) => {
              const count = (keyRefCount.get(key) || 1) - 1;
              if (count <= 0) {
                keyRefCount.delete(key);
                keyModes.delete(key);
                keysToDeregister.push(key);
              } else {
                keyRefCount.set(key, count);
              }
            });
            tabSubscriptions.delete(tabId);
            if (keysToDeregister.length > 0 && connectionStatus === 'connected') {
              syncBackendSubscriptions(keysToDeregister, 'unsubscribe');
            }
          }

          // If all tabs closed, start 30s graceful disconnect timer
          if (connectedPorts.size === 0) {
            idleTimeout = setTimeout(() => {
              if (connectedPorts.size === 0) {
                disconnectStream();
              }
            }, 30000);
          }
        }
        break;
      }

      case 'SUBSCRIBE': {
        const { tabId, keys, mode = 'full' } = data;
        if (!Array.isArray(keys) || keys.length === 0) return;

        let currentTabKeys = tabSubscriptions.get(tabId);
        if (!currentTabKeys) {
          currentTabKeys = new Set();
          tabSubscriptions.set(tabId, currentTabKeys);
        }

        const keysToSync: string[] = [];
        for (const k of keys) {
          if (!k || typeof k !== 'string') continue;
          if (!currentTabKeys.has(k)) {
            currentTabKeys.add(k);
            const count = keyRefCount.get(k) || 0;
            keyRefCount.set(k, count + 1);
            keyModes.set(k, mode);
            if (count === 0) {
              keysToSync.push(k);
            }
          }
        }

        connectStream();

        if (keysToSync.length > 0 && connectionStatus === 'connected') {
          syncBackendSubscriptions(keysToSync, 'subscribe');
        }
        break;
      }

      case 'UNSUBSCRIBE': {
        const { tabId, keys } = data;
        if (!Array.isArray(keys) || keys.length === 0) return;

        const currentTabKeys = tabSubscriptions.get(tabId);
        const keysToSync: string[] = [];

        for (const k of keys) {
          if (currentTabKeys && currentTabKeys.has(k)) {
            currentTabKeys.delete(k);
            const count = (keyRefCount.get(k) || 1) - 1;
            if (count <= 0) {
              keyRefCount.delete(k);
              keyModes.delete(k);
              keysToSync.push(k);
            } else {
              keyRefCount.set(k, count);
            }
          }
        }

        if (keysToSync.length > 0 && connectionStatus === 'connected') {
          syncBackendSubscriptions(keysToSync, 'unsubscribe');
        }
        break;
      }

      case 'SET_FORCE_CONNECT': {
        forceConnect = Boolean(data.force);
        if (forceConnect && !eventSource) {
          connectStream();
        }
        break;
      }

      case 'PING': {
        port.postMessage({ type: 'PONG' });
        break;
      }
    }
  };

  port.start();
};
