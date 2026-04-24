import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Terminal, Settings2, X, Eye, EyeOff } from 'lucide-react';

export type UxMode = 'beginner' | 'advanced';
export type UxDensity = 'comfortable' | 'compact';

const STORAGE_KEY = 'wa:ux-mode';
const DENSITY_KEY = 'wa:ux-density';

interface UxModeContext {
    mode: UxMode;
    density: UxDensity;
    setMode: (m: UxMode) => void;
    setDensity: (d: UxDensity) => void;
    /** True when in 'beginner' — used by widgets to hide advanced-only fields. */
    isBeginner: boolean;
    /** True when in 'advanced' — used to hide beginner-only helper copy. */
    isAdvanced: boolean;
}

const noop = () => {};

/**
 * UxModeProvider — listens to localStorage and writes data-ux-mode
 * and data-ux-density on the document element so CSS rules can scope
 * `.beginner-only` / `.advanced-only` visibility.
 *
 * No React context needed; the data-attribute approach keeps
 * non-React code (CSS, third-party widgets) in sync.
 */
export const UxModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    useEffect(() => {
        const root = document.documentElement;
        const initial = (localStorage.getItem(STORAGE_KEY) as UxMode) || 'advanced';
        const initialDensity = (localStorage.getItem(DENSITY_KEY) as UxDensity) || 'comfortable';
        root.setAttribute('data-ux-mode', initial);
        root.setAttribute('data-ux-density', initialDensity);
    }, []);

    return <>{children}</>;
};

/**
 * useUxMode — read/write hook. Persists to localStorage and
 * mirrors to data-ux-mode / data-ux-density on <html>.
 */
export const useUxMode = (): UxModeContext => {
    const [mode, setModeState] = useState<UxMode>(() => {
        if (typeof window === 'undefined') return 'advanced';
        return (localStorage.getItem(STORAGE_KEY) as UxMode) || 'advanced';
    });
    const [density, setDensityState] = useState<UxDensity>(() => {
        if (typeof window === 'undefined') return 'comfortable';
        return (localStorage.getItem(DENSITY_KEY) as UxDensity) || 'comfortable';
    });

    const setMode = (m: UxMode) => {
        setModeState(m);
        try { localStorage.setItem(STORAGE_KEY, m); } catch { /* SSR / private mode */ }
        document.documentElement.setAttribute('data-ux-mode', m);
    };
    const setDensity = (d: UxDensity) => {
        setDensityState(d);
        try { localStorage.setItem(DENSITY_KEY, d); } catch { /* SSR / private mode */ }
        document.documentElement.setAttribute('data-ux-density', d);
    };

    return {
        mode,
        density,
        setMode,
        setDensity,
        isBeginner: mode === 'beginner',
        isAdvanced: mode === 'advanced',
    };
};

/**
 * UxModeToggle — a small chip that flips between Beginner (warm, fewer
 * metrics, more copy) and Advanced (dense, all quant data).
 * Renders as a header button by default; can also be embedded inline.
 */
interface UxModeToggleProps {
    className?: string;
    showLabel?: boolean;
}

export const UxModeToggle: React.FC<UxModeToggleProps> = ({ className = '', showLabel = true }) => {
    const { mode, setMode } = useUxMode();
    const isBeginner = mode === 'beginner';

    return (
        <button
            type="button"
            onClick={() => setMode(isBeginner ? 'advanced' : 'beginner')}
            aria-pressed={isBeginner}
            title={isBeginner ? 'Switch to Advanced view' : 'Switch to Beginner view'}
            aria-label={isBeginner ? 'Switch to Advanced view' : 'Switch to Beginner view'}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border ${
                isBeginner
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                    : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/20'
            } ${className}`}
        >
            {isBeginner ? <Sparkles size={11} /> : <Terminal size={11} />}
            {showLabel && (isBeginner ? 'Beginner' : 'Advanced')}
        </button>
    );
};

/**
 * WidgetPresetCard — the per-widget preset picker that lives in
 * widget settings. Allows the user to switch an individual widget
 * to Beginner, Advanced, or Auto (inherits the global mode).
 */
export type WidgetPreset = 'auto' | 'beginner' | 'advanced';

interface WidgetPresetCardProps {
    widgetName: string;
    value: WidgetPreset;
    onChange: (v: WidgetPreset) => void;
    /** Optional list of metric keys to disable in beginner mode. */
    advancedOnlyFields?: string[];
    open: boolean;
    onClose: () => void;
}

const PRESET_DESCRIPTIONS: Record<WidgetPreset, string> = {
    auto: 'Follows your global Beginner / Advanced preference.',
    beginner: 'Hides advanced metrics. Adds plain-language tooltips and bigger numbers.',
    advanced: 'Shows all quantitative fields, denser layout, raw numbers preferred.',
};

export const WidgetPresetCard: React.FC<WidgetPresetCardProps> = ({
    widgetName,
    value,
    onChange,
    advancedOnlyFields = [],
    open,
    onClose,
}) => {
    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.96 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="absolute right-0 top-full mt-2 z-50 w-72 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl shadow-indigo-500/10 overflow-hidden"
                >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-2">
                            <Settings2 size={14} className="text-indigo-500" />
                            <span className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
                                {widgetName} Preset
                            </span>
                        </div>
                        <button
                            type="button"
                            aria-label="Close widget settings"
                            onClick={onClose}
                            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                        >
                            <X size={14} />
                        </button>
                    </div>
                    <div className="p-2 space-y-1">
                        {(['auto', 'beginner', 'advanced'] as WidgetPreset[]).map((preset) => {
                            const Icon = preset === 'auto' ? Eye : preset === 'beginner' ? Sparkles : Terminal;
                            const isActive = value === preset;
                            return (
                                <button
                                    type="button"
                                    key={preset}
                                    aria-pressed={isActive}
                                    onClick={() => { onChange(preset); onClose(); }}
                                    className={`w-full flex items-start gap-3 p-3 rounded-xl text-left transition-all ${
                                        isActive
                                            ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800'
                                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 border border-transparent'
                                    }`}
                                >
                                    <div className={`p-1.5 rounded-lg flex-shrink-0 ${
                                        isActive ? 'bg-indigo-100 dark:bg-indigo-800 text-indigo-600 dark:text-indigo-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                                    }`}>
                                        <Icon size={14} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold capitalize text-slate-800 dark:text-white">{preset}</p>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
                                            {PRESET_DESCRIPTIONS[preset]}
                                        </p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                    {advancedOnlyFields.length > 0 && (
                        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                                Hidden in Beginner
                            </p>
                            <div className="flex flex-wrap gap-1">
                                {advancedOnlyFields.map(f => (
                                    <span
                                        key={f}
                                        className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                                    >
                                        {f}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default UxModeToggle;
