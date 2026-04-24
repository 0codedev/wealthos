/**
 * PwaInstallPrompt — A1 (Lane 7.3 of ULTIMATE_BREAKTHROUGH_FEATURES.md)
 *
 * Self-contained global component that surfaces the browser's native
 * `beforeinstallprompt` flow at the right moment, and an iOS-Safari
 * fallback for users on iOS where that event never fires.
 *
 * Gating rules:
 *  - visit count >= 3 (from localStorage)
 *  - not dismissed in the last 14 days
 *  - app is not already running in standalone mode
 *  - either a `beforeinstallprompt` event fired (Chromium) OR we're on
 *    iOS Safari (no native prompt, just instructional copy)
 *
 * Storage: two localStorage keys under the `wav2.pwaInstall` namespace.
 * No settings-store / Dexie coupling — install state is ephemeral.
 *
 * Zero new npm dependencies. Mirrors the OfflineIndicator.tsx pattern.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Download, X, Share, Plus } from 'lucide-react';
import MotionButton from '../ui/MotionButton';

// --- Storage keys (kept local; not in db.settings) ---
const KEY_VISITS = 'wav2.pwaInstall.visits';
const KEY_DISMISSED_AT = 'wav2.pwaInstall.dismissedAt';

// --- Tuning constants ---
const MIN_VISITS = 3;
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// --- iOS Safari detection (no Chrome/Firefox/Edge iOS shells) ---
function detectIosSafari(ua: string): boolean {
    return /iPhone|iPad|iPod/.test(ua)
        && /Safari/.test(ua)
        && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

// --- Standalone / installed check (works on iOS Safari + Chromium) ---
function detectAlreadyInstalled(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        const standaloneMatch = window.matchMedia?.('(display-mode: standalone)').matches;
        // iOS Safari exposes window.navigator.standalone
        const iosStandalone = (window.navigator as any)?.standalone === true;
        return Boolean(standaloneMatch || iosStandalone);
    } catch {
        return false;
    }
}

// --- localStorage helpers (defensive — jsdom/SSR/private-mode safe) ---
function readLocal<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback;
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function writeLocal(key: string, value: unknown): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Private mode / quota — silently ignore
    }
}

// --- Captured BeforeInstallPromptEvent shape (TS sees it as `Event`) ---
interface BeforeInstallPromptEvent extends Event {
    readonly platforms?: string[];
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const PwaInstallPrompt: React.FC = () => {
    const reduceMotion = useReducedMotion();

    // Render-state. Null = don't show anything.
    const [visible, setVisible] = useState(false);
    const [variant, setVariant] = useState<'native' | 'ios'>('native');
    // The captured BeforeInstallPromptEvent (or null). State, not a ref,
    // so the eval effect re-runs when it gets set by the window listener.
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    // Bump-on-mount flag — visit-counter effect writes localStorage,
    // then we re-run the eval so it reads the bumped value.
    const [visitTick, setVisitTick] = useState(0);

    // Visit counter — bumped once on mount, read on every effect pass.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const visits = readLocal<number>(KEY_VISITS, 0) + 1;
        writeLocal(KEY_VISITS, visits);
        setVisitTick(t => t + 1);
    }, []);

    // Evaluate visibility on every relevant signal.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (detectAlreadyInstalled()) {
            setVisible(false);
            return;
        }
        const dismissedAt = readLocal<number>(KEY_DISMISSED_AT, 0);
        if (dismissedAt && Date.now() - dismissedAt < DISMISS_COOLDOWN_MS) {
            setVisible(false);
            return;
        }
        const visits = readLocal<number>(KEY_VISITS, 0);
        if (visits < MIN_VISITS) {
            setVisible(false);
            return;
        }
        const isIos = detectIosSafari(window.navigator.userAgent);
        const hasNative = deferredPrompt !== null;
        if (!hasNative && !isIos) {
            setVisible(false);
            return;
        }
        setVariant(isIos ? 'ios' : 'native');
        setVisible(true);
        // Re-evaluate after a captured native prompt, after the visit counter
        // bumps on first mount, and after `appinstalled` clears state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visitTick, deferredPrompt]);

    // Wire up window listeners. The beforeinstallprompt handler captures
    // the event into state so the eval effect re-runs.
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const onBeforeInstall = (e: Event) => {
            // The event is preventable per spec; prevent default suppresses
            // the browser's own mini-infobar.
            e.preventDefault();
            setDeferredPrompt(e as BeforeInstallPromptEvent);
        };

        const onAppInstalled = () => {
            setDeferredPrompt(null);
            writeLocal(KEY_DISMISSED_AT, 0); // never re-prompt in this profile
            setVisible(false);
        };

        const onDisplayModeChange = (e: MediaQueryListEvent) => {
            if (e.matches) setVisible(false);
        };

        window.addEventListener('beforeinstallprompt', onBeforeInstall);
        window.addEventListener('appinstalled', onAppInstalled);

        const mql = window.matchMedia?.('(display-mode: standalone)');
        mql?.addEventListener?.('change', onDisplayModeChange);

        return () => {
            window.removeEventListener('beforeinstallprompt', onBeforeInstall);
            window.removeEventListener('appinstalled', onAppInstalled);
            mql?.removeEventListener?.('change', onDisplayModeChange);
        };
    }, []);

    const handleInstall = useCallback(async () => {
        const promptEvent = deferredPrompt;
        if (!promptEvent) return;
        try {
            await promptEvent.prompt();
            const choice = await promptEvent.userChoice;
            // Always dismiss for the cooldown — user either installed or
            // explicitly declined; either way we don't pester them again.
            writeLocal(KEY_DISMISSED_AT, Date.now());
            setVisible(false);
            if (choice?.outcome === 'accepted') {
                window.dispatchEvent(new CustomEvent('app-toast', {
                    detail: {
                        message: 'App installed — find it on your home screen.',
                        type: 'success',
                    },
                }));
            }
        } catch {
            // If the prompt throws (e.g. browser revocation), just hide.
            writeLocal(KEY_DISMISSED_AT, Date.now());
            setVisible(false);
        }
    }, [deferredPrompt]);

    const handleDismiss = useCallback(() => {
        writeLocal(KEY_DISMISSED_AT, Date.now());
        setVisible(false);
    }, []);

    // --- Render ---
    if (!visible) return null;

    const slideUp = reduceMotion
        ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
        : {
            initial: { y: 60, opacity: 0, scale: 0.96 },
            animate: { y: 0, opacity: 1, scale: 1 },
            exit: { y: 30, opacity: 0, scale: 0.97 },
            transition: { type: 'spring' as const, stiffness: 380, damping: 28, mass: 0.8 },
        };

    if (variant === 'ios') {
        return (
            <AnimatePresence>
                <motion.div
                    key="pwa-ios"
                    role="dialog"
                    aria-label="Install app instructions"
                    aria-live="polite"
                    data-testid="pwa-install-ios"
                    {...slideUp}
                    className="fixed bottom-36 left-1/2 -translate-x-1/2 z-50 w-[min(420px,calc(100vw-1.5rem))] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 rounded-2xl shadow-xl px-4 py-3.5 flex items-start gap-3"
                >
                    <div className="flex-shrink-0 flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                        <Share size={18} />
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                            Install Wealth Aggregator
                        </p>
                        <p className="mt-1 text-[12.5px] leading-snug text-slate-600 dark:text-slate-300">
                            Tap <Share size={11} className="inline -mt-0.5 mx-0.5" /> then choose
                            {' '}<span className="font-semibold">Add to Home Screen</span>.
                        </p>
                    </div>
                    <button
                        onClick={handleDismiss}
                        className="flex-shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
                        aria-label="Dismiss install instructions"
                    >
                        <X size={15} />
                    </button>
                </motion.div>
            </AnimatePresence>
        );
    }

    // Native (Chromium) variant
    return (
        <AnimatePresence>
            <motion.div
                key="pwa-native"
                role="dialog"
                aria-label="Install app"
                aria-live="polite"
                data-testid="pwa-install-native"
                {...slideUp}
                className="fixed bottom-36 left-1/2 -translate-x-1/2 z-50 w-[min(420px,calc(100vw-1.5rem))] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 rounded-2xl shadow-xl px-4 py-3.5 flex items-center gap-3"
            >
                <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                    <Download size={18} />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-50 leading-tight">
                        Install Wealth Aggregator
                    </p>
                    <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
                        Add to home screen for offline access
                    </p>
                </div>
                <div className="flex-shrink-0 flex items-center gap-1.5">
                    <MotionButton
                        variant="ghost"
                        size="sm"
                        onClick={handleDismiss}
                        aria-label="Dismiss install prompt"
                        icon={<X size={14} />}
                    >
                        Later
                    </MotionButton>
                    <MotionButton
                        variant="primary"
                        size="sm"
                        onClick={handleInstall}
                        icon={<Plus size={14} />}
                    >
                        Install
                    </MotionButton>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};

export default PwaInstallPrompt;
