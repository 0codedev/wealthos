import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion, LayoutGroup } from 'framer-motion';
import { X, CheckCircle, AlertTriangle, Info, XCircle, Undo2 } from 'lucide-react';
import { popIn } from '../ui/motion/variants';
import { useSettingsStore } from '../../store/settingsStore';

// --- Types ---
type ToastType = 'success' | 'error' | 'warning' | 'info' | 'undo';

interface ToastAction {
    label: string;
    onClick: () => void;
}

interface ToastOptions {
    duration?: number;
    action?: ToastAction;
    title?: string;
}

interface Toast {
    id: string;
    message: string;
    title?: string;
    type: ToastType;
    duration: number;
    action?: ToastAction;
    // CC104: timestamp captured at add-time so dedup can compare in O(n) without
    // re-reading the system clock for every queued toast.
    addedAt: number;
}

interface ToastContextValue {
    toasts: Toast[];
    toast: {
        success: (message: string, options?: ToastOptions) => void;
        error: (message: string, options?: ToastOptions) => void;
        warning: (message: string, options?: ToastOptions) => void;
        info: (message: string, options?: ToastOptions) => void;
        undo: (message: string, options?: ToastOptions) => void;
        custom: (message: string, type?: ToastType, options?: ToastOptions) => void;
    };
    removeToast: (id: string) => void;
}

const MAX_VISIBLE = 4;
const DEFAULT_DURATION = 4000;
const UNDO_DURATION = 7000;
// CC104: dedup window — if the same (type, message) pair fires within this
// many ms, treat it as a duplicate and skip the add. Catches the "the user
// spammed Save three times" case so we don't stack 4 identical toasts.
const DEDUP_WINDOW_MS = 1500;

// --- Context ---
const ToastContext = createContext<ToastContextValue | undefined>(undefined);

// --- Hook ---
export const useToast = (): ToastContextValue => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

// --- Global helper for non-React files ---
export function showToast(message: string, type: ToastType = 'info', options?: { duration?: number; action?: ToastAction; title?: string }) {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('app-toast', {
            detail: { message, type, options }
        }));
    }
}

// --- Visual config per type ---
// Centralized palette + icon mapping so the JSX stays a flat list of styles.
// Each type owns: a colored left strip, an icon "pill" with bg+fg, the
// countdown bar color, and a fallback eyebrow label.
type TypeConfig = {
    icon: (size: number) => React.ReactNode;
    accent: string;
    iconBg: string;
    iconColor: string;
    bar: string;
    label: string;
};

const TYPE_CONFIG: Record<ToastType, TypeConfig> = {
    success: {
        icon: (s) => <CheckCircle size={s} />,
        accent: 'bg-emerald-500',
        iconBg: 'bg-emerald-100 dark:bg-emerald-500/15',
        iconColor: 'text-emerald-600 dark:text-emerald-400',
        bar: 'bg-emerald-500',
        label: 'Success',
    },
    error: {
        icon: (s) => <XCircle size={s} />,
        accent: 'bg-red-500',
        iconBg: 'bg-red-100 dark:bg-red-500/15',
        iconColor: 'text-red-600 dark:text-red-400',
        bar: 'bg-red-500',
        label: 'Error',
    },
    warning: {
        icon: (s) => <AlertTriangle size={s} />,
        accent: 'bg-amber-500',
        iconBg: 'bg-amber-100 dark:bg-amber-500/15',
        iconColor: 'text-amber-600 dark:text-amber-400',
        bar: 'bg-amber-500',
        label: 'Warning',
    },
    info: {
        icon: (s) => <Info size={s} />,
        accent: 'bg-blue-500',
        iconBg: 'bg-blue-100 dark:bg-blue-500/15',
        iconColor: 'text-blue-600 dark:text-blue-400',
        bar: 'bg-blue-500',
        label: 'Info',
    },
    undo: {
        icon: (s) => <Undo2 size={s} />,
        accent: 'bg-violet-500',
        iconBg: 'bg-violet-100 dark:bg-violet-500/15',
        iconColor: 'text-violet-600 dark:text-violet-400',
        bar: 'bg-violet-500',
        label: 'Undo',
    },
};

// --- Toast Component ---
const bgColors: Record<ToastType, string> = {
    success: 'bg-emerald-50/90 dark:bg-emerald-900/30 border-emerald-200/80 dark:border-emerald-800/80',
    error: 'bg-red-50/90 dark:bg-red-900/30 border-red-200/80 dark:border-red-800/80',
    warning: 'bg-amber-50/90 dark:bg-amber-900/30 border-amber-200/80 dark:border-amber-800/80',
    info: 'bg-blue-50/90 dark:bg-blue-900/30 border-blue-200/80 dark:border-blue-800/80',
    undo: 'bg-violet-50/90 dark:bg-violet-900/30 border-violet-200/80 dark:border-violet-800/80',
};

const ToastItem: React.FC<{ toast: Toast; onClose: () => void }> = ({ toast, onClose }) => {
    const reduceMotion = useReducedMotion();
    const config = TYPE_CONFIG[toast.type];
    const showProgress = toast.duration > 0 && !reduceMotion;
    const progressSeconds = Math.max(toast.duration, 100) / 1000;

    const designPreset = useSettingsStore(s => s.designPreset) || 'wealthos-classic';
    const isAstryx = designPreset === 'astryx';
    const isReui = designPreset === 'reui-nova' || designPreset === 'shadcn';

    const isUndo = toast.type === 'undo';
    // Use a sensible default title per type unless the caller provided one.
    const titleText = toast.title ?? (isUndo ? 'Action completed' : config.label);

    const handleAction = useCallback(() => {
        if (toast.action) {
            toast.action.onClick();
        }
        onClose();
    }, [toast.action, onClose]);

    // Render desktop card according to active design preset
    const renderDesktopCard = () => {
        // 1. Meta Astryx Official Notification Spec
        if (isAstryx) {
            return (
                <motion.div
                    layout
                    variants={reduceMotion ? undefined : popIn}
                    initial={reduceMotion ? { opacity: 0 } : undefined}
                    animate={reduceMotion ? { opacity: 1 } : undefined}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, transition: { duration: 0.18, ease: 'easeIn' } }}
                    className="hidden sm:flex relative w-full overflow-hidden rounded-[10px] border border-[rgba(255,255,255,0.102)] bg-[#262626] text-white shadow-xl min-w-[280px] sm:min-w-[320px] max-w-[420px] font-['Figtree'] p-3.5 items-start gap-3"
                >
                    <div className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.08] text-white mt-0.5">
                        {config.icon(15)}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-white tracking-wide">{titleText}</p>
                        <p className="mt-0.5 text-xs text-[#9e9e9e] leading-snug break-words">{toast.message}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        {toast.action && (
                            <button
                                type="button"
                                onClick={handleAction}
                                className="px-2.5 py-1 rounded-full text-xs font-semibold bg-white text-[#111111] hover:bg-slate-200 transition-all shadow-sm"
                            >
                                {toast.action.label}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1 rounded-full text-[#9e9e9e] hover:text-white hover:bg-white/[0.08] transition-colors"
                            aria-label="Close notification"
                        >
                            <X size={14} />
                        </button>
                    </div>
                </motion.div>
            );
        }

        // 2. Pure ReUI Notification Spec
        if (isReui) {
            return (
                <motion.div
                    layout
                    variants={reduceMotion ? undefined : popIn}
                    initial={reduceMotion ? { opacity: 0 } : undefined}
                    animate={reduceMotion ? { opacity: 1 } : undefined}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, transition: { duration: 0.18, ease: 'easeIn' } }}
                    className="hidden sm:flex relative w-full overflow-hidden rounded-xl border border-white/[0.09] bg-[#0E101A]/95 text-white shadow-[0_20px_45px_-10px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-2xl min-w-[280px] sm:min-w-[320px] max-w-[420px] font-['Inter'] p-3.5 items-start gap-3"
                >
                    <div className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 mt-0.5">
                        {config.icon(16)}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white tracking-tight">{titleText}</p>
                        <p className="mt-0.5 text-xs text-slate-400 leading-snug break-words">{toast.message}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        {toast.action && (
                            <button
                                type="button"
                                onClick={handleAction}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                            >
                                {toast.action.label}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                            aria-label="Close notification"
                        >
                            <X size={14} />
                        </button>
                    </div>
                    {showProgress && (
                        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-slate-800 overflow-hidden">
                            <motion.div
                                className="h-full bg-indigo-500 origin-left"
                                initial={{ scaleX: 1 }}
                                animate={{ scaleX: 0 }}
                                transition={{ duration: progressSeconds, ease: 'linear' }}
                            />
                        </div>
                    )}
                </motion.div>
            );
        }

        // 3. WealthOS Glassmorphic Card (Default Desktop)
        return (
            <motion.div
                layout
                variants={reduceMotion ? undefined : popIn}
                initial={reduceMotion ? { opacity: 0 } : undefined}
                animate={reduceMotion ? { opacity: 1 } : undefined}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, transition: { duration: 0.18, ease: 'easeIn' } }}
                transition={reduceMotion ? { duration: 0 } : { layout: { type: 'spring', stiffness: 420, damping: 32, mass: 0.7 } }}
                className={`
                    hidden sm:block relative w-full overflow-hidden rounded-2xl border shadow-lg backdrop-blur-md
                    min-w-[280px] sm:min-w-[320px] max-w-[420px]
                    ${bgColors[toast.type]}
                `}
            >
                {/* Left accent strip */}
                <span
                    aria-hidden="true"
                    className={`absolute left-0 top-0 bottom-0 w-1.5 ${config.accent}`}
                />

                {/* Body */}
                <div className="flex items-start gap-3 pl-4 pr-3 py-3.5">
                    <div className={`flex-shrink-0 flex h-9 w-9 items-center justify-center rounded-xl ${config.iconBg} ${config.iconColor}`}>
                        {config.icon(18)}
                    </div>

                    <div className="flex-1 min-w-0 pt-0.5">
                        <p className="text-[15px] font-semibold leading-tight text-slate-900 dark:text-slate-50">
                            {titleText}
                        </p>
                        <p className="mt-1 text-[13px] leading-snug text-slate-600 dark:text-slate-300 break-words">
                            {toast.message}
                        </p>
                    </div>

                    <div className="flex-shrink-0 flex items-center gap-1.5 pl-1">
                        {toast.action && (
                            <button
                                onClick={handleAction}
                                className={`
                                    px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide
                                    transition-all active:scale-95
                                    ${isUndo
                                        ? 'bg-violet-600 hover:bg-violet-500 text-white shadow-sm'
                                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-600/30'}
                                `}
                            >
                                {toast.action.label}
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
                            aria-label="Close notification"
                        >
                            <X size={15} />
                        </button>
                    </div>
                </div>

                {/* Countdown bar */}
                {showProgress && (
                    <div className="absolute bottom-0 left-1.5 right-0 h-[3px] bg-slate-200/60 dark:bg-slate-700/60 overflow-hidden">
                        <motion.div
                            className={`h-full ${config.bar} origin-left`}
                            initial={{ scaleX: 1 }}
                            animate={{ scaleX: 0 }}
                            transition={{ duration: progressSeconds, ease: 'linear' }}
                        />
                    </div>
                )}
            </motion.div>
        );
    };

    // Universal Toast rendering: Mobile capsule on <sm, Preset Card on sm+
    return (
        <>
            {/* Mobile View (<sm): ReUI-style Sleek Slim Horizontal Bubble / Dynamic Island Capsule */}
            <motion.div
                layout
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -20, scale: 0.94 }}
                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.94, transition: { duration: 0.16 } }}
                transition={reduceMotion ? { duration: 0 } : { layout: { type: 'spring', stiffness: 450, damping: 30, mass: 0.8 } }}
                className={`
                    sm:hidden relative w-auto max-w-[94vw] mx-auto overflow-hidden rounded-full border shadow-xl backdrop-blur-2xl
                    px-3 py-1.5 flex items-center gap-2 text-white
                    ${bgColors[toast.type]}
                `}
            >
                <div className={`flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full ${config.iconBg} ${config.iconColor}`}>
                    {config.icon(12)}
                </div>

                <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden text-left">
                    {titleText && titleText !== toast.message && (
                        <span className="text-[11px] font-bold text-white shrink-0">
                            {titleText}:
                        </span>
                    )}
                    <span className="text-[11px] text-slate-200 truncate">
                        {toast.message}
                    </span>
                </div>

                <div className="flex-shrink-0 flex items-center gap-1">
                    {toast.action && (
                        <button
                            onClick={handleAction}
                            className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm"
                        >
                            {toast.action.label}
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="p-1 rounded-full text-slate-400 hover:text-white transition-colors"
                        aria-label="Close notification"
                    >
                        <X size={12} />
                    </button>
                </div>

                {showProgress && (
                    <div className="absolute bottom-0 left-3 right-3 h-[1.5px] bg-white/10 rounded-full overflow-hidden">
                        <motion.div
                            className={`h-full ${config.bar} origin-left`}
                            initial={{ scaleX: 1 }}
                            animate={{ scaleX: 0 }}
                            transition={{ duration: progressSeconds, ease: 'linear' }}
                        />
                    </div>
                )}
            </motion.div>

            {/* Desktop View (sm+): Full Rich Card */}
            <motion.div
                layout
                variants={reduceMotion ? undefined : popIn}
                initial={reduceMotion ? { opacity: 0 } : undefined}
                animate={reduceMotion ? { opacity: 1 } : undefined}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, transition: { duration: 0.18, ease: 'easeIn' } }}
                transition={reduceMotion ? { duration: 0 } : { layout: { type: 'spring', stiffness: 420, damping: 32, mass: 0.7 } }}
                className={`
                    hidden sm:block relative w-full overflow-hidden rounded-2xl border shadow-lg backdrop-blur-md
                    min-w-[280px] sm:min-w-[320px] max-w-[420px]
                    ${bgColors[toast.type]}
                `}
            >
                {/* Left accent strip */}
                <span
                    aria-hidden="true"
                    className={`absolute left-0 top-0 bottom-0 w-1.5 ${config.accent}`}
                />

                {/* Body — icon + title + sub-message + action/close slot. */}
                <div className="flex items-start gap-3 pl-4 pr-3 py-3.5">
                    <div className={`flex-shrink-0 flex h-9 w-9 items-center justify-center rounded-xl ${config.iconBg} ${config.iconColor}`}>
                        {config.icon(18)}
                    </div>

                    <div className="flex-1 min-w-0 pt-0.5">
                        <p className="text-[15px] font-semibold leading-tight text-slate-900 dark:text-slate-50">
                            {titleText}
                        </p>
                        <p className="mt-1 text-[13px] leading-snug text-slate-600 dark:text-slate-300 break-words">
                            {toast.message}
                        </p>
                    </div>

                    <div className="flex-shrink-0 flex items-center gap-1.5 pl-1">
                        {toast.action && (
                            <button
                                onClick={handleAction}
                                className={`
                                    px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide
                                    transition-all active:scale-95
                                    ${isUndo
                                        ? 'bg-violet-600 hover:bg-violet-500 text-white shadow-sm'
                                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-600/30'}
                                `}
                            >
                                {toast.action.label}
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
                            aria-label="Close notification"
                        >
                            <X size={15} />
                        </button>
                    </div>
                </div>

                {/* Countdown bar */}
                {showProgress && (
                    <div className="absolute bottom-0 left-1.5 right-0 h-[3px] bg-slate-200/60 dark:bg-slate-700/60 overflow-hidden">
                        <motion.div
                            className={`h-full ${config.bar} origin-left`}
                            initial={{ scaleX: 1 }}
                            animate={{ scaleX: 0 }}
                            transition={{ duration: progressSeconds, ease: 'linear' }}
                        />
                    </div>
                )}
            </motion.div>
        </>
    );
};

// --- Sound Player Helper ---
const playNotificationSound = (type: ToastType) => {
    // Only play sound for success, error, and warning. Mute for info and undo.
    if (type === 'info' || type === 'undo') return;

    try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;
        const ctx = new AudioContextClass();
        const now = ctx.currentTime;
        
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'sine';
        
        // Gentle, soft low-mid frequencies (E4 to G4) to keep it pleasant and not sharp
        osc.frequency.setValueAtTime(329.63, now); // E4
        osc.frequency.exponentialRampToValueAtTime(392.00, now + 0.12); // G4
        
        gain.gain.setValueAtTime(0, now);
        // Very low gain (3%) for a highly subtle, unobtrusive chime
        gain.gain.linearRampToValueAtTime(0.03, now + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(now);
        osc.stop(now + 0.4);
    } catch (e) {
        console.warn('Subtle notification sound blocked or failed:', e);
    }
};

// --- Provider ---
interface ToastProviderProps {
    children: ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    // Track dismiss timers by id so manual close + new add both clear stale ones.
    const dismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    // CC104: keep an always-current mirror of `toasts` so dedup can read it
    // synchronously inside `addToast` without depending on the state callback.
    const toastsRef = useRef<Toast[]>([]);
    useEffect(() => { toastsRef.current = toasts; }, [toasts]);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
        const timer = dismissTimers.current.get(id);
        if (timer) {
            clearTimeout(timer);
            dismissTimers.current.delete(id);
        }
    }, []);

    const addToast = useCallback((message: string, type: ToastType, options?: ToastOptions) => {
        // CC104: dedup check — if a matching (type, message) is still in the
        // queue AND was added within the dedup window, skip the add. We do
        // NOT extend the lifetime; we just refuse to add a second copy. This
        // matches what production toast systems (react-hot-toast, sonner)
        // do under the hood.
        const now = Date.now();
        const isDuplicate = toastsRef.current.some(
            t => t.type === type && t.message === message && (now - t.addedAt) < DEDUP_WINDOW_MS
        );
        if (isDuplicate) return;

        // Play subtle sound for non-duplicate toasts
        playNotificationSound(type);

        const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        // `undo` type auto-extends to ~7s so users have a real chance to react.
        const defaultDuration = type === 'undo' ? UNDO_DURATION : DEFAULT_DURATION;
        const duration = options?.duration ?? defaultDuration;

        setToasts(prev => {
            // Cap visible toasts: drop the oldest when at limit.
            if (prev.length >= MAX_VISIBLE) {
                const dropped = prev[0];
                if (dropped) {
                    const timer = dismissTimers.current.get(dropped.id);
                    if (timer) {
                        clearTimeout(timer);
                        dismissTimers.current.delete(dropped.id);
                    }
                }
                return [
                    ...prev.slice(prev.length - (MAX_VISIBLE - 1)),
                    { id, message, title: options?.title, type, duration, action: options?.action, addedAt: now },
                ];
            }
            return [...prev, { id, message, title: options?.title, type, duration, action: options?.action, addedAt: now }];
        });

        if (duration > 0) {
            const timer = setTimeout(() => removeToast(id), duration);
            dismissTimers.current.set(id, timer);
        }
    }, [removeToast]);

    const toast = useMemo(() => ({
        success: (message: string, options?: ToastOptions) => addToast(message, 'success', options),
        error: (message: string, options?: ToastOptions) => addToast(message, 'error', options),
        warning: (message: string, options?: ToastOptions) => addToast(message, 'warning', options),
        info: (message: string, options?: ToastOptions) => addToast(message, 'info', options),
        undo: (message: string, options?: ToastOptions) => addToast(message, 'undo', options),
        custom: (message: string, type: ToastType = 'info', options?: ToastOptions) => addToast(message, type, options),
    }), [addToast]);

    // Clean up dangling timers on unmount to avoid setState on a dead tree.
    useEffect(() => {
        return () => {
            dismissTimers.current.forEach(t => clearTimeout(t));
            dismissTimers.current.clear();
            toastsRef.current = [];
        };
    }, []);

    // Listen for global custom events fired by the showToast() helper.
    useEffect(() => {
        const handleGlobalToast = (e: Event) => {
            const customEvent = e as CustomEvent<{ message: string; type: ToastType; options?: ToastOptions }>;
            if (customEvent.detail && customEvent.detail.message) {
                const { message, type, options } = customEvent.detail;
                if (TYPE_CONFIG[type]) {
                    addToast(message, type, options);
                } else {
                    addToast(message, 'info', options);
                }
            }
        };
        window.addEventListener('app-toast', handleGlobalToast);
        return () => {
            window.removeEventListener('app-toast', handleGlobalToast);
        };
    }, [addToast]);

    return (
        <ToastContext.Provider value={{ toasts, toast, removeToast }}>
            {children}

            {/* Toast container - top on mobile (<sm) to avoid obstructing bottom nav, FAB, and drawers; top-right on sm+.
                Uses flex-col so notifications drop down from the top naturally. */}
            <div
                className="fixed z-[9999] pointer-events-none
                    inset-x-0 top-0 flex flex-col items-center gap-2 px-3 pt-[max(4rem,calc(env(safe-area-inset-top)+3.75rem))]
                    sm:inset-auto sm:top-4 sm:right-4 sm:bottom-auto sm:left-auto sm:p-0 sm:pt-0 sm:items-end sm:flex-col sm:gap-2.5"
                role="region"
                aria-label="Notifications"
                aria-live="polite"
            >
                <LayoutGroup>
                    <AnimatePresence mode="popLayout" initial={false}>
                        {toasts.map(t => (
                            <div
                                key={t.id}
                                className="pointer-events-auto w-full sm:w-auto"
                                role="alert"
                                aria-live={t.type === 'error' || t.type === 'warning' ? 'assertive' : 'polite'}
                            >
                                <ToastItem
                                    toast={t}
                                    onClose={() => removeToast(t.id)}
                                />
                            </div>
                        ))}
                    </AnimatePresence>
                </LayoutGroup>
            </div>
        </ToastContext.Provider>
    );
};

export default ToastProvider;
