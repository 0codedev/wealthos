import { create } from 'zustand';
import type { UpstoxTick } from '../services/UpstoxWebSocketService';

export type LiveConnectionState = 'disconnected' | 'connecting' | 'subscribing' | 'streaming' | 'stalled';

interface GlobalTickStore {
  ticks: Record<string, UpstoxTick>;
  setTick: (tick: UpstoxTick) => void;
  setTicksBatch: (ticks: UpstoxTick[], immediate?: boolean) => void;
  flushPendingTicksNow: () => void;
  isConnected: boolean;
  setConnected: (v: boolean) => void;
  
  // High-Precision Honest Telemetry
  connectionState: LiveConnectionState;
  ticksReceived: number;
  ticksPerSecond: number;
  lastTickAt: number | null;
  subscribedKeysCount: number;
  keyTickTimestamps: Record<string, number>;
  
  setConnectionState: (state: LiveConnectionState) => void;
  setTelemetry: (data: {
    ticksPerSecond?: number;
    subscribedKeysCount?: number;
    lastTickAt?: number;
  }) => void;
  isKeyFresh: (key: string, maxAgeMs?: number) => boolean;
}

// Internal high-speed mutable batch accumulator
// Accumulates ticks between screen repaints to prevent React render cascades
const pendingTicksMap = new Map<string, UpstoxTick>();
let pendingTicksCount = 0;
let rafHandle: number | null = null;

const flushBatch = () => {
  rafHandle = null;
  if (pendingTicksMap.size === 0) return;

  const now = Date.now();
  const count = pendingTicksCount;
  const tickEntries = Array.from(pendingTicksMap.entries());
  pendingTicksMap.clear();
  pendingTicksCount = 0;

  useGlobalTickStore.setState((state) => {
    const nextTicks = { ...state.ticks };
    const nextTimestamps = { ...state.keyTickTimestamps };
    for (const [key, tick] of tickEntries) {
      nextTicks[key] = tick;
      nextTimestamps[key] = now;
    }
    return {
      ticks: nextTicks,
      ticksReceived: state.ticksReceived + count,
      lastTickAt: now,
      connectionState: 'streaming',
      isConnected: true,
      keyTickTimestamps: nextTimestamps,
    };
  });
};

const scheduleFlush = () => {
  if (rafHandle !== null) return;
  if (typeof window !== 'undefined') {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      // In background tab: Throttle updates to 1000ms to eliminate CPU and battery waste
      rafHandle = window.setTimeout(flushBatch, 1000);
    } else if (typeof window.requestAnimationFrame === 'function') {
      // In active visible tab: Synchronize perfectly with 60Hz/120Hz monitor repaint cycle
      rafHandle = window.requestAnimationFrame(flushBatch);
    } else {
      rafHandle = window.setTimeout(flushBatch, 16);
    }
  } else {
    flushBatch();
  }
};

// Immediate flush on tab focus to ensure zero-latency catch-up
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pendingTicksMap.size > 0) {
      if (rafHandle !== null) {
        if (typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(rafHandle);
        } else {
          clearTimeout(rafHandle);
        }
        rafHandle = null;
      }
      flushBatch();
    }
  });
}

export const useGlobalTickStore = create<GlobalTickStore>((set, get) => ({
  ticks: {},
  isConnected: false,
  connectionState: 'disconnected',
  ticksReceived: 0,
  ticksPerSecond: 0,
  lastTickAt: null,
  subscribedKeysCount: 0,
  keyTickTimestamps: {},

  setTick: (tick) => {
    if (!tick || !tick.instrument_key) return;
    pendingTicksMap.set(tick.instrument_key, tick);
    pendingTicksCount++;
    scheduleFlush();
  },

  setTicksBatch: (incomingTicks, immediate = false) => {
    if (!incomingTicks || incomingTicks.length === 0) return;
    for (const t of incomingTicks) {
      if (t && t.instrument_key) {
        pendingTicksMap.set(t.instrument_key, t);
        pendingTicksCount++;
      }
    }
    if (immediate) {
      if (rafHandle !== null) {
        if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(rafHandle);
        } else {
          clearTimeout(rafHandle);
        }
        rafHandle = null;
      }
      flushBatch();
    } else {
      scheduleFlush();
    }
  },

  flushPendingTicksNow: () => {
    if (rafHandle !== null) {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(rafHandle);
      } else {
        clearTimeout(rafHandle);
      }
      rafHandle = null;
    }
    flushBatch();
  },

  setConnected: (v) => set((state) => ({ 
    isConnected: v, 
    connectionState: v ? (state.connectionState === 'disconnected' ? 'connecting' : state.connectionState) : 'disconnected' 
  })),

  setConnectionState: (connectionState) => set({ 
    connectionState, 
    isConnected: connectionState === 'streaming' || connectionState === 'subscribing' || connectionState === 'connecting' 
  }),

  setTelemetry: (data) => set((state) => ({ ...state, ...data })),

  isKeyFresh: (key, maxAgeMs = 15000) => {
    const ts = get().keyTickTimestamps[key];
    if (!ts) return false;
    return Date.now() - ts <= maxAgeMs;
  },
}));

/**
 * Granular instrument tick selector hook.
 * Avoids full-store re-render; only re-renders the calling component when
 * the specific instrument_key tick reference changes.
 */
export const useInstrumentTick = (instrumentKey: string | undefined): UpstoxTick | undefined => {
  return useGlobalTickStore((state) => (instrumentKey ? state.ticks[instrumentKey] : undefined));
};
