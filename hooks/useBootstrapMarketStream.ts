import { useEffect } from 'react';
import { useGlobalTickStore } from '../store/globalTickStore';
import { buildTier1Keys, buildTier2Keys } from '../utils/streamingKeys';
import { upstoxWebSocketService, type UpstoxTick } from '../services/UpstoxWebSocketService';

export function useBootstrapMarketStream() {
  const setTick = useGlobalTickStore((s) => s.setTick);
  const setConnected = useGlobalTickStore((s) => s.setConnected);

  useEffect(() => {
    const unsubscribeStatus = upstoxWebSocketService.onStatusChange((status) => {
      setConnected(status === 'connected');
    });

    let active = true;
    let registeredTier1: string[] = [];
    let registeredTier2: string[] = [];
    
    const callback = (tick: UpstoxTick) => {
      setTick(tick);
    };

    Promise.all([buildTier1Keys(), buildTier2Keys()]).then(([tier1Keys, tier2Keys]) => {
      if (!active) return;

      if (tier1Keys.length > 0) {
        registeredTier1 = tier1Keys;
        upstoxWebSocketService.subscribe(tier1Keys, callback, 'ltpc');
      }

      if (tier2Keys.length > 0) {
        registeredTier2 = tier2Keys;
        upstoxWebSocketService.subscribe(tier2Keys, callback, 'full');
      }
    });

    return () => {
      active = false;
      unsubscribeStatus();
      if (registeredTier1.length > 0) {
        upstoxWebSocketService.unsubscribe(registeredTier1, callback);
      }
      if (registeredTier2.length > 0) {
        upstoxWebSocketService.unsubscribe(registeredTier2, callback);
      }
    };
  }, [setTick, setConnected]);
}
