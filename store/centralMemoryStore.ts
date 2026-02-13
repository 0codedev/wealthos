/**
 * Central Memory Store - Phase 9 / CC20
 *
 * Unified workspace state hub for the Wealth Dashboard V2.
 * Tracks the globally selected ticker, option expiry, shared real-time
 * quotes, and AI context. Broadcasts updates across browser tabs via
 * BroadcastChannel so multiple open tabs stay in lock-step.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { logger } from '../services/Logger';
import { useSettingsStore } from './settingsStore';

// ============================================================
// TYPES
// ============================================================

export interface SharedQuote {
    symbol: string;
    price: number;
    change: number;
    changePercent: number;
    timestamp: number;
    source?: string;
}

export interface CentralMemoryState {
    // The currently focused ticker across the app.
    activeTicker: string | null;
    // Optional expiry used by options / payoff views.
    activeOptionExpiry: string | null;
    // Symbol → most recent quote (used for cross-tab high-density chips).
    sharedQuotes: Record<string, SharedQuote>;
    // A short string describing what the user is currently doing; the
    // Ambient AI brain reads this to inject context.
    aiActiveContext: string;
    // True when the store state originated from another tab — used to
    // avoid echoing messages back to peers.
    lastSyncedAt: number;

    // ---- Actions
    setActiveTicker: (ticker: string | null) => void;
    setActiveOptionExpiry: (expiry: string | null) => void;
    setSharedQuote: (quote: SharedQuote) => void;
    setSharedQuotes: (quotes: SharedQuote[]) => void;
    setAiActiveContext: (ctx: string) => void;
    clearActiveTicker: () => void;
    /** Apply a remote update (from another browser tab) without rebroadcasting. */
    applyRemote: (snapshot: Partial<CentralMemoryState>) => void;
    resetWorkspace: () => void;
}

// ============================================================
// BROADCAST CHANNEL
// ============================================================

const CHANNEL_NAME = 'wealth_dashboard_workspace_channel';
const THEME_CHANNEL_NAME = 'wealth_dashboard_theme_channel';

interface WorkspaceMessage {
    kind: 'state' | 'ping' | 'pong' | 'reset';
    source: string;
    timestamp: number;
    payload?: Partial<CentralMemoryState>;
}

interface ThemeMessage {
    kind: 'theme';
    source: string;
    timestamp: number;
    payload?: {
        isDarkMode?: boolean;
        activeTheme?: string;
    };
}

const TAB_ID = (() => {
    try {
        return (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
            ? crypto.randomUUID()
            : `tab_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    } catch {
        return `tab_${Date.now()}`;
    }
})();

let channel: BroadcastChannel | null = null;
let themeChannel: BroadcastChannel | null = null;
let suppressBroadcast = false;
let lastBroadcastSnapshot = '';

// ============================================================
// STORE
// ============================================================

export const useCentralMemoryStore = create<CentralMemoryState>()(
    subscribeWithSelector((set, get) => ({
        activeTicker: null,
        activeOptionExpiry: null,
        sharedQuotes: {},
        aiActiveContext: 'idle',
        lastSyncedAt: 0,

        setActiveTicker: (ticker) => {
            const normalized = ticker ? ticker.toUpperCase().trim() : null;
            set({ activeTicker: normalized });
            broadcastState(get());
        },

        setActiveOptionExpiry: (expiry) => {
            set({ activeOptionExpiry: expiry });
            broadcastState(get());
        },

        setSharedQuote: (quote) => {
            if (!quote || !quote.symbol) return;
            const next = { ...get().sharedQuotes, [quote.symbol.toUpperCase()]: { ...quote, timestamp: Date.now() } };
            set({ sharedQuotes: next });
            // Only broadcast the keys we just touched to keep the payload small.
            broadcastState(get(), { partial: { sharedQuotes: { [quote.symbol.toUpperCase()]: next[quote.symbol.toUpperCase()] } } });
        },

        setSharedQuotes: (quotes) => {
            if (!Array.isArray(quotes) || quotes.length === 0) return;
            const next = { ...get().sharedQuotes };
            quotes.forEach((q) => {
                if (q && q.symbol) next[q.symbol.toUpperCase()] = { ...q, timestamp: Date.now() };
            });
            set({ sharedQuotes: next });
            broadcastState(get());
        },

        setAiActiveContext: (ctx) => {
            set({ aiActiveContext: ctx });
            broadcastState(get());
        },

        clearActiveTicker: () => {
            set({ activeTicker: null });
            broadcastState(get());
        },

        applyRemote: (snapshot) => {
            suppressBroadcast = true;
            try {
                set((prev) => {
                    const next: Partial<CentralMemoryState> = { ...prev, lastSyncedAt: Date.now() };
                    if (snapshot.activeTicker !== undefined) next.activeTicker = snapshot.activeTicker;
                    if (snapshot.activeOptionExpiry !== undefined) next.activeOptionExpiry = snapshot.activeOptionExpiry;
                    if (snapshot.sharedQuotes !== undefined) {
                        next.sharedQuotes = { ...prev.sharedQuotes, ...snapshot.sharedQuotes };
                    }
                    if (snapshot.aiActiveContext !== undefined) next.aiActiveContext = snapshot.aiActiveContext;
                    return next as CentralMemoryState;
                });
            } finally {
                // Allow subsequent local writes to broadcast again.
                setTimeout(() => { suppressBroadcast = false; }, 50);
            }
        },

        resetWorkspace: () => {
            set({
                activeTicker: null,
                activeOptionExpiry: null,
                aiActiveContext: 'idle',
            });
            broadcastState(get(), { reset: true });
        },
    }))
);

// ============================================================
// HELPERS
// ============================================================

function snapshotForBroadcast(state: CentralMemoryState): string {
    // Strip volatile fields that don't need to round-trip.
    const compact = {
        activeTicker: state.activeTicker,
        activeOptionExpiry: state.activeOptionExpiry,
        aiActiveContext: state.aiActiveContext,
    };
    return JSON.stringify(compact);
}

function broadcastState(state: CentralMemoryState, opts: { partial?: Partial<CentralMemoryState>; reset?: boolean } = {}) {
    if (suppressBroadcast) return;
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
    if (!channel) ensureChannel();
    if (!channel) return;

    const payload = opts.partial ?? {
        activeTicker: state.activeTicker,
        activeOptionExpiry: state.activeOptionExpiry,
        aiActiveContext: state.aiActiveContext,
    };

    const snapshot = snapshotForBroadcast(state);
    if (!opts.reset && snapshot === lastBroadcastSnapshot) return;
    lastBroadcastSnapshot = snapshot;

    const message: WorkspaceMessage = {
        kind: opts.reset ? 'reset' : 'state',
        source: TAB_ID,
        timestamp: Date.now(),
        payload,
    };
    try {
        channel.postMessage(message);
    } catch (err) {
        logger.warn('[CentralMemory] Broadcast failed', err);
    }
}

function ensureChannel(): BroadcastChannel | null {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
    try {
        if (!channel) {
            channel = new BroadcastChannel(CHANNEL_NAME);
            channel.addEventListener('message', handleChannelMessage);
        }
        if (!themeChannel) {
            themeChannel = new BroadcastChannel(THEME_CHANNEL_NAME);
            themeChannel.addEventListener('message', handleThemeMessage);
        }
    } catch (err) {
        logger.warn('[CentralMemory] BroadcastChannel unavailable', err);
        channel = null;
        themeChannel = null;
    }
    return channel;
}

function handleChannelMessage(event: MessageEvent<WorkspaceMessage>) {
    const data = event.data;
    if (!data || data.source === TAB_ID) return;
    if (data.kind === 'reset') {
        useCentralMemoryStore.getState().resetWorkspace();
        return;
    }
    if (data.kind === 'state' && data.payload) {
        useCentralMemoryStore.getState().applyRemote(data.payload);
    }
}

function handleThemeMessage(event: MessageEvent<ThemeMessage>) {
    const data = event.data;
    if (!data || data.source === TAB_ID) return;
    if (data.kind === 'theme' && data.payload) {
        const settings = useSettingsStore.getState() as any;
        if (typeof data.payload.isDarkMode === 'boolean' && data.payload.isDarkMode !== settings.isDarkMode) {
            settings.updateSetting('isDarkMode', data.payload.isDarkMode);
        }
        if (data.payload.activeTheme && data.payload.activeTheme !== settings.activeTheme) {
            settings.updateSetting('activeTheme', data.payload.activeTheme);
        }
    }
}

// ============================================================
// PUBLIC HELPERS (used by hooks and components)
// ============================================================

/**
 * Initialize the central memory system. Idempotent.
 * - Sets up the BroadcastChannel listeners
 * - Wires up the theme broadcast listener
 * - Returns a cleanup function (used in tests / hot-reload)
 */
export function initializeCentralMemory(): () => void {
    const ch = ensureChannel();
    if (!ch) return () => undefined;

    // Announce our presence so other tabs can re-broadcast their state if needed.
    try {
        ch.postMessage({ kind: 'ping', source: TAB_ID, timestamp: Date.now() } satisfies WorkspaceMessage);
    } catch { /* ignore */ }

    // Cross-tab theme listener
    const settings = useSettingsStore.getState() as any;
    let lastTheme = `${settings.isDarkMode}|${settings.activeTheme}`;
    const settingsUnsub = useSettingsStore.subscribe((state) => {
        const signature = `${state.isDarkMode}|$ {(state as any).activeTheme}`;
        if (signature === lastTheme) return;
        lastTheme = signature;
        if (!themeChannel) return;
        try {
            themeChannel.postMessage({
                kind: 'theme',
                source: TAB_ID,
                timestamp: Date.now(),
                payload: { isDarkMode: state.isDarkMode, activeTheme: (state as any).activeTheme },
            } satisfies ThemeMessage);
        } catch (err) {
            logger.warn('[CentralMemory] Theme broadcast failed', err);
        }
    });

    return () => {
        settingsUnsub();
        if (channel) {
            try { channel.close(); } catch { /* ignore */ }
            channel = null;
        }
        if (themeChannel) {
            try { themeChannel.close(); } catch { /* ignore */ }
            themeChannel = null;
        }
    };
}

/** Broadcast theme changes from a manual call site. */
export function broadcastThemeChange(isDarkMode: boolean, activeTheme: string): void {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
    if (!themeChannel) ensureChannel();
    if (!themeChannel) return;
    try {
        themeChannel.postMessage({
            kind: 'theme',
            source: TAB_ID,
            timestamp: Date.now(),
            payload: { isDarkMode, activeTheme },
        } satisfies ThemeMessage);
    } catch (err) {
        logger.warn('[CentralMemory] Theme broadcast failed', err);
    }
}

/** Convenience selector: get the active ticker or null. */
export const selectActiveTicker = (s: CentralMemoryState) => s.activeTicker;

/** Convenience selector: get the quote for the active ticker (if any). */
export const selectActiveQuote = (s: CentralMemoryState) => {
    if (!s.activeTicker) return null;
    return s.sharedQuotes[s.activeTicker] || null;
};

/** Tab id used to identify the broadcasting tab. */
export const getCentralMemoryTabId = (): string => TAB_ID;
