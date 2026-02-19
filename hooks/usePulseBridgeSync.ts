import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { useToast } from '../components/shared/ToastProvider';

/**
 * Automates the handshake between the React Frontend and the Local Pulse Bridge.
 * Whenever a new Dhan Access Token is generated (daily TOTP refresh), this hook
 * sends it to the telegram-ear.js proxy which writes it to the Python bridge's .env.
 */
const PULSE_SYNCED_KEY = 'wealthos_dhan_pulse_last_synced_token_v2';
let isSyncInProgress = false;

export const usePulseBridgeSync = () => {
    const { dhanAccessToken, dhanClientId } = useSettingsStore();
    const { toast } = useToast();
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        if (!dhanAccessToken) return;

        // Persistent check: never sync again if this exact token has already been synced
        const storedLastSynced = typeof window !== 'undefined' ? localStorage.getItem(PULSE_SYNCED_KEY) : null;
        if (storedLastSynced === dhanAccessToken) return;
        if (isSyncInProgress) return;

        isSyncInProgress = true;

        const syncToken = () => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                console.log('🔄 [Pulse Bridge] Syncing token with proxy...');
                wsRef.current.send(JSON.stringify({
                    type: 'TOKEN_UPDATE',
                    clientId: dhanClientId,
                    accessToken: dhanAccessToken
                }));
                if (typeof window !== 'undefined') {
                    localStorage.setItem(PULSE_SYNCED_KEY, dhanAccessToken);
                }
                isSyncInProgress = false;
            } else {
                // Dynamic protocol-aware host detection
                const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
                const host = typeof window !== 'undefined' ? window.location.host : 'localhost:8081';
                const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
                
                const wsUrl = isLocal ? 'ws://localhost:8081' : `${isHttps ? 'wss:' : 'ws:'}//${host}/ws/telegram-ear/`;
                const httpRestartUrl = isLocal ? 'http://localhost:8000/restart' : `${window.location.protocol}//${host}/api/python-nse/restart`;

                wsRef.current = new WebSocket(wsUrl);
                
                wsRef.current.onopen = () => {
                    syncToken();
                };

                wsRef.current.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.type === 'TOKEN_SYNC_SUCCESS') {
                            if (typeof window !== 'undefined') {
                                localStorage.setItem(PULSE_SYNCED_KEY, dhanAccessToken);
                            }
                            isSyncInProgress = false;
                            toast.success('Dhan Pulse Bridge synced successfully');
                            // Trigger Python bridge restart
                            fetch(httpRestartUrl, { method: 'POST' }).catch(() => {
                                console.warn('Bridge restart signal failed (Is bridge running?)');
                            });
                        }
                    } catch (e) {
                        console.error('Error parsing bridge sync response', e);
                        isSyncInProgress = false;
                    }
                };

                wsRef.current.onerror = () => {
                    isSyncInProgress = false;
                    if (!(window as any).__pulseBridgeWarned) {
                        (window as any).__pulseBridgeWarned = true;
                        console.warn('Could not connect to telegram-ear proxy for token sync (ear server offline?). Further attempts silent.');
                    }
                };
            }
        };

        syncToken();

        return () => {
            // Cleanup on unmount if needed
        };
    }, [dhanAccessToken, dhanClientId, toast]);
};
