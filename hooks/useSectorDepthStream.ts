import { useEffect, useRef } from 'react';
import { SECTOR_CONSTITUENTS } from '../data/sectorConstituents';
import { upstoxWebSocketService, type TickCallback } from '../services/UpstoxWebSocketService';
import { upstoxInstrumentService } from '../services/UpstoxInstrumentService';
import { useGlobalTickStore } from '../store/globalTickStore';
import { useSettingsStore } from '../store/settingsStore';

export function useSectorDepthStream(activeSector: string | null) {
  const setTick = useGlobalTickStore((s) => s.setTick);
  const prevKeysRef = useRef<string[]>([]);
  const callbackRef = useRef<TickCallback>((tick) => setTick(tick));

  useEffect(() => {
    if (!activeSector) return;
    const showDepth = useSettingsStore.getState().showOrderBookDepth;
    if (!showDepth) return;

    // Unsubscribe previous sector depth
    if (prevKeysRef.current.length > 0) {
      upstoxWebSocketService.unsubscribe(prevKeysRef.current, callbackRef.current);
      prevKeysRef.current = [];
    }

    // Subscribe new sector depth
    const symbols = SECTOR_CONSTITUENTS[activeSector] ?? [];
    upstoxInstrumentService.getInstrumentKeys(symbols, 'NSE_EQ').then((keysMap) => {
      const newKeys = Object.values(keysMap).slice(0, 50); // guard full_d30 50-key limit
      upstoxWebSocketService.subscribeWithDepth(newKeys, callbackRef.current);
      prevKeysRef.current = newKeys;
    });

    return () => {
      upstoxWebSocketService.unsubscribe(prevKeysRef.current, callbackRef.current);
      prevKeysRef.current = [];
    };
  }, [activeSector]);
}
