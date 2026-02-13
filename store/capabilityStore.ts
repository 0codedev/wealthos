import { create } from 'zustand';

export type CapabilityName = 
  | 'quotes'
  | 'pcr'
  | 'news'
  | 'fundamentals'
  | 'smartlists'
  | 'market-timings'
  | 'ipo'
  | 'websocket';

export type CapabilityState = 'available' | 'degraded' | 'unavailable' | 'demo_only';

export interface CapabilityInfo {
  name: CapabilityName;
  state: CapabilityState;
  reason?: string;
}

interface CapabilityStoreState {
  capabilities: Record<CapabilityName, CapabilityInfo>;
  
  // Actions
  setCapabilityState: (name: CapabilityName, state: CapabilityState, reason?: string) => void;
  resetCapability: (name: CapabilityName) => void;
  resetAll: () => void;
  checkAndNotifyDegraded: (name: CapabilityName) => void;
  hydrateCapabilities: () => Promise<void>;
}

// Throttling mechanism for notifications to avoid spamming
const lastNotificationTimes: Record<string, number> = {};

function triggerThrottledToast(name: CapabilityName, state: CapabilityState, reason?: string) {
  // Silent state transition: log to console to keep UI clean and free of toast avalanche
  console.info(`[Capability] '${name}' -> ${state}${reason ? ` (${reason})` : ''}`);
}

export const useCapabilityStore = create<CapabilityStoreState>((set) => ({
  capabilities: {
    'quotes': { name: 'quotes', state: 'available' },
    'pcr': { name: 'pcr', state: 'available' },
    'news': { name: 'news', state: 'available' },
    'fundamentals': { name: 'fundamentals', state: 'available' },
    'smartlists': { name: 'smartlists', state: 'available' },
    'market-timings': { name: 'market-timings', state: 'available' },
    'ipo': { name: 'ipo', state: 'available' },
    'websocket': { name: 'websocket', state: 'available' },
  },
  
  setCapabilityState: (name, state, reason) => set((prev) => {
    const prevCap = prev.capabilities[name];
    
    // Lock degraded states: do not allow automatic recovery to 'available'
    if (prevCap.state !== 'available' && state === 'available') {
      return prev;
    }
    
    if (prevCap.state !== state) {
      if (state !== 'available') {
        triggerThrottledToast(name, state, reason);
      }
    }
    return {
      capabilities: {
        ...prev.capabilities,
        [name]: { name, state, reason }
      }
    };
  }),
  
  resetCapability: (name) => set((prev) => ({
    capabilities: {
      ...prev.capabilities,
      [name]: { name, state: 'available', reason: undefined }
    }
  })),
  
  resetAll: () => set((prev) => {
    const updated = { ...prev.capabilities };
    (Object.keys(updated) as CapabilityName[]).forEach((key) => {
      updated[key] = { name: key, state: 'available', reason: undefined };
    });
    return { capabilities: updated };
  }),
  
  checkAndNotifyDegraded: (name) => {
    const cap = useCapabilityStore.getState().capabilities[name];
    if (cap && cap.state !== 'available') {
      triggerThrottledToast(name, cap.state, cap.reason);
    }
  },
  
  hydrateCapabilities: async () => {
    try {
      const response = await fetch('/api/python-nse/api/capabilities');
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          const mappedCaps: Partial<Record<CapabilityName, CapabilityState>> = {};
          
          data.forEach((cap: any) => {
            if (cap.provider === 'upstox') {
              const name = cap.capability;
              let mappedName: CapabilityName | null = null;
              
              if (name === 'quotes') mappedName = 'quotes';
              else if (name === 'fundamentals') mappedName = 'fundamentals';
              else if (name === 'news') mappedName = 'news';
              else if (name === 'smartlists') mappedName = 'smartlists';
              else if (name === 'ipo') mappedName = 'ipo';
              else if (name === 'websocket_market_feed') mappedName = 'websocket';
              
              if (mappedName) {
                let state: CapabilityState = 'available';
                if (cap.state === 'unavailable' || cap.state === 'oauth_required') {
                  state = 'unavailable';
                } else if (cap.state === 'degraded') {
                  state = 'degraded';
                } else if (cap.state === 'demo_only') {
                  state = 'demo_only';
                }
                mappedCaps[mappedName] = state;
              }
            }
          });

          set((prev) => {
            const updated = { ...prev.capabilities };
            (Object.keys(mappedCaps) as CapabilityName[]).forEach((key) => {
              const newState = mappedCaps[key];
              if (newState && updated[key]) {
                updated[key] = {
                  ...updated[key],
                  state: newState
                };
              }
            });
            return { capabilities: updated };
          });
        }
      }
    } catch (err: unknown) {
      console.error('Failed to hydrate capabilities from bridge:', err);
    }
  }
}));
