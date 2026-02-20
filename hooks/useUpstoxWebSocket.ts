import { useEffect, useState, useMemo } from 'react';
import { upstoxWebSocketService, UpstoxTick } from '../services/UpstoxWebSocketService';
import { useCentralMemoryStore } from '../store/centralMemoryStore';

const SYMBOL_BY_KEY: Record<string, string> = {
    'NSE_INDEX|Nifty 50': 'NIFTY',
    'NSE_INDEX|Nifty Bank': 'BANKNIFTY',
    'NSE_INDEX|Nifty IT': 'NIFTYIT',
    'NSE_INDEX|Nifty Auto': 'NIFTYAUTO',
    'NSE_INDEX|Nifty Pharma': 'NIFTYPHARMA',
    'NSE_INDEX|Nifty Metal': 'NIFTYMETAL',
    'NSE_INDEX|Nifty FMCG': 'NIFTYFMCG',
    'NSE_INDEX|Nifty Fin Service': 'FINNIFTY',
    'NSE_INDEX|Nifty Realty': 'NIFTYREALTY',
    'NSE_INDEX|Nifty Energy': 'NIFTYENERGY',
    'NSE_INDEX|Nifty Media': 'NIFTYMEDIA',
    'NSE_INDEX|Gift Nifty': 'GIFTNIFTY',
    'NSE_INDEX|India VIX': 'INDIAVIX',
    'BSE_INDEX|SENSEX': 'SENSEX',
};

/**
 * React hook to subscribe to real-time Upstox market data ticks.
 *
 * Beyond returning the live tick map to the calling component, this
 * hook also mirrors every tick into `useCentralMemoryStore.sharedQuotes`
 * so any cross-tab component (TickerLink, BloombergCommandBar,
 * SwarmTradesTerminal, LivePortfolioPnL) reads from a single
 * consistent in-memory price reference.
 *
 * @param instrumentKeys List of Upstox instrument keys to stream.
 */
export const useUpstoxWebSocket = (instrumentKeys: string[], mode: 'full_d30' | 'full' | 'option_greeks' | 'ltpc' = 'full') => {
    const [ticks, setTicks] = useState<Record<string, UpstoxTick>>({});
    const [status, setStatus] = useState<'connected' | 'connecting' | 'disconnected'>(
        upstoxWebSocketService.getStatus()
    );

    const keysKey = useMemo(() => [...instrumentKeys].sort().join(','), [instrumentKeys]);

    useEffect(() => {
        // 1. Subscribe to status changes
        const unsubStatus = upstoxWebSocketService.onStatusChange((newStatus) => {
            setStatus(newStatus);
        });

        if (!keysKey) {
            return unsubStatus;
        }

        const sortedKeys = keysKey.split(',');
        const setSharedQuote = useCentralMemoryStore.getState().setSharedQuote;

        // 2. Define callback to handle updates
        const onTick = (tick: UpstoxTick) => {
            if (window.performance && window.performance.mark) {
                if (!window.performance.getEntriesByName('market-context:first-shown').length) {
                    window.performance.mark('market-context:first-shown');
                }
            }
            setTicks((prev) => ({
                ...prev,
                [tick.instrument_key]: tick,
            }));

            // CC29: Mirror to central memory so cross-tab chips see the same price.
            if (tick.ltp != null) {
                const symbol =
                    SYMBOL_BY_KEY[tick.instrument_key] ||
                    tick.instrument_key.split('|').pop() ||
                    tick.instrument_key;
                const close = tick.close ?? tick.ltp;
                const change = tick.ltp - close;
                const changePercent = close > 0 ? (change / close) * 100 : 0;
                try {
                    setSharedQuote({
                        symbol,
                        price: tick.ltp,
                        change,
                        changePercent,
                        timestamp: Date.now(),
                        source: 'upstox_ws',
                    });
                } catch {
                    /* store not yet hydrated in tests — safe to ignore */
                }
            }
        };

        // 3. Subscribe to the keys
        upstoxWebSocketService.subscribe(sortedKeys, onTick, mode);

        // 4. Cleanup on unmount or keys change
        return () => {
            unsubStatus();
            upstoxWebSocketService.unsubscribe(sortedKeys, onTick);
        };
    }, [keysKey, mode]); // Sort to prevent churn on order changes

    return {
        ticks,
        status,
        isConnected: status === 'connected',
        reconnectAttempts: upstoxWebSocketService.getReconnectAttempts(),
    };
};
