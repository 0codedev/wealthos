import { useEffect, useRef } from 'react';
import { useGlobalTickStore } from '../store/globalTickStore';
import { upstoxWebSocketService, type TickCallback } from '../services/UpstoxWebSocketService';

export function useOptionChainStream(activeKeys: string[]) {
  const setTick = useGlobalTickStore((s) => s.setTick);
  const prevKeysRef = useRef<string[]>([]);
  const callbackRef = useRef<TickCallback>((tick) => setTick(tick));

  useEffect(() => {
    const validKeys = activeKeys.filter(k => k && k.trim() !== '');
    if (validKeys.length === 0) {
      // If no active keys, clean up previous option chain subscriptions
      if (prevKeysRef.current.length > 0) {
        upstoxWebSocketService.unsubscribe(prevKeysRef.current, callbackRef.current);
        prevKeysRef.current = [];
      }
      return;
    }

    const prevKeysKey = [...prevKeysRef.current].sort().join(',');
    const newKeysKey = [...validKeys].sort().join(',');

    if (prevKeysKey === newKeysKey) {
      // Keys are identical, do nothing
      return;
    }

    // Unsubscribe previous option chain keys
    if (prevKeysRef.current.length > 0) {
      upstoxWebSocketService.unsubscribe(prevKeysRef.current, callbackRef.current);
      prevKeysRef.current = [];
    }

    // Subscribe to new option chain keys in option_greeks mode
    upstoxWebSocketService.subscribe(validKeys, callbackRef.current, 'option_greeks');
    prevKeysRef.current = validKeys;

    return () => {
      if (prevKeysRef.current.length > 0) {
        upstoxWebSocketService.unsubscribe(prevKeysRef.current, callbackRef.current);
        prevKeysRef.current = [];
      }
    };
  }, [activeKeys]);
}
