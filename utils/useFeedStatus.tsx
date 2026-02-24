/**
 * CC113 — WebSocket / data-feed status indicator.
 *
 * A small, dependency-free hook + component that shows the user the
 * current state of a streaming data connection (live / reconnecting /
 * offline). The app has at least 3 separate WebSocket / polling feeds
 * (Upstox, Dhan, Telegram ear), and the current implementation shows
 * a hard-coded "Live" dot on every widget regardless of feed state.
 *
 * This module ships:
 *   1. `useFeedStatus(url, options)` — hook that tracks one feed
 *   2. `<FeedStatusDot />` — a small visual indicator
 *   3. `<FeedStatusBanner />` — a full banner with reconnect / pause actions
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff, RefreshCw, Pause, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export type FeedState = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'paused';

export interface FeedStatus {
    state: FeedState;
    /** Last successful message timestamp. */
    lastMessageAt: number | null;
    /** Number of reconnect attempts since the last live state. */
    reconnectAttempts: number;
    /** Last error message, if any. */
    error: string | null;
}

export interface UseFeedStatusOptions {
    /** WebSocket-like open function. Called initially and on every reconnect. */
    open: () => WebSocket | EventSource | null;
    /** Optional close function called on unmount or pause. */
    close?: (conn: WebSocket | EventSource | null) => void;
    /** Heartbeat: function that returns true if the latest message looks alive. */
    isAlive?: (conn: WebSocket | EventSource | null) => boolean;
    /** Reconnect delay in ms. Default 2000. */
    reconnectDelayMs?: number;
    /** Max reconnect attempts before going offline. Default 8. */
    maxAttempts?: number;
    /** Initial state. Default 'connecting'. */
    initialState?: FeedState;
}

/**
 * Tracks a single feed's connection state. Returns a `FeedStatus` object
 * that updates as the connection state changes.
 */
export function useFeedStatus(
    _url: string,
    options: UseFeedStatusOptions
): { status: FeedStatus; pause: () => void; resume: () => void; reconnect: () => void } {
    const {
        open,
        close,
        isAlive,
        reconnectDelayMs = 2000,
        maxAttempts = 8,
        initialState = 'connecting',
    } = options;

    const [status, setStatus] = useState<FeedStatus>({
        state: initialState,
        lastMessageAt: null,
        reconnectAttempts: 0,
        error: null,
    });

    const connRef = useRef<WebSocket | EventSource | null>(null);
    const pausedRef = useRef(false);
    const attemptsRef = useRef(0);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const startConnection = useCallback(() => {
        try {
            const conn = open();
            if (!conn) {
                setStatus((s) => ({ ...s, state: 'offline', error: 'Failed to open connection' }));
                return;
            }
            connRef.current = conn;

            const onOpen = () => {
                attemptsRef.current = 0;
                setStatus((s) => ({ ...s, state: 'live', reconnectAttempts: 0, error: null }));
            };
            const onMessage = () => {
                setStatus((s) => ({ ...s, lastMessageAt: Date.now() }));
            };
            const onError = (e: Event) => {
                setStatus((s) => ({ ...s, error: (e as ErrorEvent).message ?? 'Connection error' }));
            };
            const onClose = () => {
                if (pausedRef.current) return;
                if (attemptsRef.current >= maxAttempts) {
                    setStatus((s) => ({ ...s, state: 'offline' }));
                    return;
                }
                attemptsRef.current += 1;
                setStatus((s) => ({ ...s, state: 'reconnecting', reconnectAttempts: attemptsRef.current }));
                timeoutRef.current = setTimeout(() => {
                    if (!pausedRef.current) startConnection();
                }, reconnectDelayMs);
            };

            conn.addEventListener('open', onOpen);
            conn.addEventListener('message', onMessage as EventListener);
            conn.addEventListener('error', onError as EventListener);
            conn.addEventListener('close', onClose);
        } catch (e) {
            setStatus((s) => ({ ...s, state: 'offline', error: e instanceof Error ? e.message : String(e) }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, isAlive, reconnectDelayMs, maxAttempts]);

    // Mount: open the connection (unless paused).
    useEffect(() => {
        if (!pausedRef.current) startConnection();
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            if (close) close(connRef.current);
            else connRef.current?.close();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const pause = useCallback(() => {
        pausedRef.current = true;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (close) close(connRef.current);
        else connRef.current?.close();
        setStatus((s) => ({ ...s, state: 'paused' }));
    }, [close]);

    const resume = useCallback(() => {
        pausedRef.current = false;
        attemptsRef.current = 0;
        startConnection();
    }, [startConnection]);

    const reconnect = useCallback(() => {
        attemptsRef.current = 0;
        if (close) close(connRef.current);
        else connRef.current?.close();
        startConnection();
    }, [close, startConnection]);

    return { status, pause, resume, reconnect };
}

// ============================================================================
// Visual components
// ============================================================================

const STATE_COLORS: Record<FeedState, { bg: string; ring: string; label: string }> = {
    live:          { bg: 'bg-emerald-500', ring: 'ring-emerald-500/30', label: 'Live' },
    connecting:    { bg: 'bg-blue-500',    ring: 'ring-blue-500/30',    label: 'Connecting' },
    reconnecting:  { bg: 'bg-amber-500',   ring: 'ring-amber-500/30',   label: 'Reconnecting' },
    offline:       { bg: 'bg-rose-500',    ring: 'ring-rose-500/30',    label: 'Offline' },
    paused:        { bg: 'bg-slate-400',   ring: 'ring-slate-400/30',   label: 'Paused' },
};

export const FeedStatusDot: React.FC<{ state: FeedState; pulse?: boolean; className?: string }> = ({
    state,
    pulse = true,
    className = '',
}) => {
    const cfg = STATE_COLORS[state];
    return (
        <span
            role="status"
            aria-label={cfg.label}
            className={`relative inline-flex items-center ${className}`}
        >
            <span className={`absolute inline-flex h-2.5 w-2.5 rounded-full ${cfg.bg} opacity-75 ${pulse && state === 'live' ? 'animate-ping' : ''}`} />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${cfg.bg} ring-4 ${cfg.ring}`} />
        </span>
    );
};

export interface FeedStatusBannerProps {
    status: FeedStatus;
    onReconnect?: () => void;
    onPause?: () => void;
    onResume?: () => void;
    className?: string;
    /** Compact mode: single line, no actions. Default false. */
    compact?: boolean;
}

export const FeedStatusBanner: React.FC<FeedStatusBannerProps> = ({
    status,
    onReconnect,
    onPause,
    onResume,
    className = '',
    compact = false,
}) => {
    const cfg = STATE_COLORS[status.state];
    const isLive = status.state === 'live';

    if (compact) {
        return (
            <div
                role="status"
                aria-live="polite"
                className={`inline-flex items-center gap-2 ${className}`}
            >
                <FeedStatusDot state={status.state} />
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {cfg.label}
                </span>
                {status.reconnectAttempts > 0 && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono">
                        ({status.reconnectAttempts})
                    </span>
                )}
            </div>
        );
    }

    return (
        <AnimatePresence mode="wait">
            <motion.div
                key={status.state}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.18 }}
                role="status"
                aria-live="polite"
                className={`flex items-center justify-between p-3 rounded-2xl border bg-white/60 dark:bg-slate-900/60 backdrop-blur-md ${className}`}
            >
                <div className="flex items-center gap-3 min-w-0">
                    <FeedStatusDot state={status.state} />
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {cfg.label}
                        </p>
                        {status.error && status.state !== 'live' && (
                            <p className="text-[11px] text-rose-600 dark:text-rose-400 truncate">
                                {status.error}
                            </p>
                        )}
                        {isLive && status.lastMessageAt && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                Last message {Math.max(1, Math.round((Date.now() - status.lastMessageAt) / 1000))}s ago
                            </p>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    {onReconnect && status.state !== 'live' && (
                        <button
                            onClick={onReconnect}
                            aria-label="Reconnect"
                            className="p-2 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
                        >
                            <RefreshCw size={14} />
                        </button>
                    )}
                    {onPause && status.state === 'live' && (
                        <button
                            onClick={onPause}
                            aria-label="Pause feed"
                            className="p-2 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors"
                        >
                            <Pause size={14} />
                        </button>
                    )}
                    {onResume && status.state === 'paused' && (
                        <button
                            onClick={onResume}
                            aria-label="Resume feed"
                            className="p-2 rounded-lg text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors"
                        >
                            <Play size={14} />
                        </button>
                    )}
                </div>
            </motion.div>
        </AnimatePresence>
    );
};

export default useFeedStatus;
