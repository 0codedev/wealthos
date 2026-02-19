import { useState, useEffect, useRef } from 'react';

export interface MarketTick {
    exchange_segment: string;
    security_id: string;
    last_price: number;
    ohlc?: {
        open: number;
        high: number;
        low: number;
        close: number;
    };
    oi?: number;
    oi_pcr?: number;
    timestamp: string;
}

/**
 * Consumes real-time NIFTY/SENSEX market data from the Pulse Bridge.
 * Use this in components like OptionChainIntel for low-latency updates.
 */
export const usePulseBridgeMarketData = () => {
    const [ticks, setTicks] = useState<Record<string, MarketTick>>({});
    const [isConnected, setIsConnected] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        const connect = () => {
            const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
            const host = typeof window !== 'undefined' ? window.location.host : 'localhost:8000';
            const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
            const wsUrl = isLocal ? 'ws://localhost:8000/ws' : `${isHttps ? 'wss:' : 'ws:'}//${host}/api/python-nse/ws`;

            console.log(`🔌 [Pulse Bridge] Connecting to market data stream: ${wsUrl}`);
            let ws: WebSocket;
            try {
                ws = new WebSocket(wsUrl);
            } catch (err) {
                console.warn('[Pulse Bridge] WebSocket creation failed:', err);
                return;
            }
            wsRef.current = ws;

            ws.onopen = () => {
                setIsConnected(true);
                console.log('✅ [Pulse Bridge] Connected to market feed');
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    
                    if (msg.type === 'TICKS' && Array.isArray(msg.data)) {
                        setTicks(prev => {
                            const newTicks = { ...prev };
                            msg.data.forEach((tick: any) => {
                                // Unique key for security (segment:id)
                                const key = `${tick.exchange_segment}:${tick.security_id}`;
                                newTicks[key] = {
                                    ...tick,
                                    timestamp: new Date().toISOString()
                                };
                            });
                            return newTicks;
                        });
                    } else if (msg.type === 'HEARTBEAT') {
                        // Heartbeat keeps connection alive, can be used for latency monitoring
                        // console.log('💓 Bridge Heartbeat');
                    }
                } catch (e) {
                    console.error('Error parsing market tick', e);
                }
            };

            ws.onclose = () => {
                setIsConnected(false);
                console.log('🔌 [Pulse Bridge] Disconnected. Retrying in 5s...');
                setTimeout(connect, 5000);
            };

            ws.onerror = () => {
                ws.close();
            };
        };

        connect();

        return () => {
            if (wsRef.current) {
                wsRef.current.onclose = null;
                wsRef.current.close();
            }
        };
    }, []);

    return { ticks, isConnected };
};
