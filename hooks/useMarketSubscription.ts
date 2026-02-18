import { useEffect } from 'react';
import { upstoxWebSocketService, UpstoxTick } from '../services/UpstoxWebSocketService';

/**
 * Custom React hook to subscribe to Upstox market data with a requested mode.
 * Automatically handles batch subscription on mount and unsubscription on unmount.
 * 
 * @param keys List of instrument keys to stream.
 * @param onTick Callback triggered when a new tick is received.
 * @param mode Mode of subscription: 'full_d30' | 'full' | 'option_greeks' | 'ltpc' (default: 'full')
 */
export function useMarketSubscription(
  keys: string[],
  onTick: (tick: UpstoxTick) => void,
  mode: 'full_d30' | 'full' | 'option_greeks' | 'ltpc' = 'full'
) {
  useEffect(() => {
    if (!keys || keys.length === 0) return;
    
    const sortedKeys = [...keys].sort();
    upstoxWebSocketService.subscribe(sortedKeys, onTick, mode);
    
    return () => {
      upstoxWebSocketService.unsubscribe(sortedKeys, onTick);
    };
  }, [JSON.stringify([...keys].sort()), onTick, mode]);
}
