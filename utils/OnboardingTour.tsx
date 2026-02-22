/**
 * CC107 — First-run onboarding tour primitive.
 *
 * A small, dependency-free tour system modeled after Driver.js / Shepherd
 * but tailored for this app's design system. Renders a focused overlay
 * spotlight + a positioned popover with title / body / Next / Back / Skip
 * actions. State is persisted to localStorage so a returning user does
 * not see the same tour again.
 *
 * The tour engine is a React component that lives at the top of the tree
 * (mounted by the App). The actual tour *steps* are declared as a plain
 * array of step descriptors; the engine renders them in order.
 *
 * Why a custom tour (vs. driver.js):
 *   - Driver.js adds ~30KB gzipped; we already have framer-motion for
 *     the spotlight transition.
 *   - We need fine-grained control over the spotlight cutout (we have
 *     a glassmorphism theme with backdrop-blur) that driver.js doesn't
 *     support cleanly.
 *   - We need persistence + a "remind me tomorrow" action that
 *     library APIs don't expose.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { safeGet, safeSet } from './safeDefaults';

export interface OnboardingStep {
    /** A CSS selector for the element to spotlight. */
    target: string;
    /** Title shown in the popover. */
    title: string;
    /** Body copy. Plain string or React node for inline formatting. */
    body: React.ReactNode;
    /** Position preference. The engine auto-flip if the popover would clip. */
    position?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
    /** Optional action button on the popover. */
    action?: { label: string; onClick: () => void };
    /** Wait this many ms after spotlighting before allowing Next. */
    dwellMs?: number;
}

export interface OnboardingTourProps {
    /** Unique ID for this tour. Used as the localStorage key. */
    tourId: string;
    /** Step sequence. Empty = tour is a no-op. */
    steps: OnboardingStep[];
    /** Force the tour to be visible even if the user has dismissed it. */
    forceOpen?: boolean;
    /** Called when the tour finishes naturally (last step's Next). */
    onComplete?: () => void;
    /** Called when the user clicks Skip or X. */
    onDismiss?: () => void;
}

const STORAGE_PREFIX = 'cc107.onboarding.';

function loadDismissed(tourId: string): boolean {
    return safeGet<boolean>(`${STORAGE_PREFIX}${tourId}`, false);
}

function saveDismissed(tourId: string, dismissed: boolean): void {
    safeSet(`${STORAGE_PREFIX}${tourId}`, dismissed);
}

interface Rect {
    top: number;
    left: number;
    width: number;
    height: number;
}

function findTargetRect(selector: string): Rect | null {
    if (typeof document === 'undefined') return null;
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({
    tourId,
    steps,
    forceOpen = false,
    onComplete,
    onDismiss,
}) => {
    const [open, setOpen] = useState(false);
    const [stepIndex, setStepIndex] = useState(0);
    const [targetRect, setTargetRect] = useState<Rect | null>(null);
    const [canAdvance, setCanAdvance] = useState(true);

    // Hydrate the dismissed flag once on mount.
    useEffect(() => {
        if (forceOpen) {
            setOpen(true);
            return;
        }
        const dismissed = loadDismissed(tourId);
        if (!dismissed) setOpen(true);
    }, [tourId, forceOpen]);

    // Recompute the spotlight rect when the step changes.
    useEffect(() => {
        if (!open) return;
        const step = steps[stepIndex];
        if (!step) return;
        const update = () => setTargetRect(findTargetRect(step.target));
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        // Re-poll once on the next frame in case the target mounts async.
        const t = setTimeout(update, 100);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
            clearTimeout(t);
        };
    }, [open, stepIndex, steps]);

    // Dwell timer for steps that need a "stay and read" before Next.
    useEffect(() => {
        const step = steps[stepIndex];
        if (!open || !step?.dwellMs) {
            setCanAdvance(true);
            return;
        }
        setCanAdvance(false);
        const t = setTimeout(() => setCanAdvance(true), step.dwellMs);
        return () => clearTimeout(t);
    }, [open, stepIndex, steps]);

    const close = useCallback(
        (dismissed: boolean) => {
            setOpen(false);
            saveDismissed(tourId, dismissed);
            if (dismissed) onDismiss?.();
        },
        [tourId, onDismiss]
    );

    const next = useCallback(() => {
        if (stepIndex + 1 < steps.length) {
            setStepIndex((i) => i + 1);
        } else {
            saveDismissed(tourId, true);
            setOpen(false);
            onComplete?.();
        }
    }, [stepIndex, steps.length, tourId, onComplete]);

    const prev = useCallback(() => {
        setStepIndex((i) => Math.max(0, i - 1));
    }, []);

    const step = useMemo(() => steps[stepIndex], [steps, stepIndex]);

    if (!open || !step) return null;

    const PAD = 12;
    const POPOVER_WIDTH = 320;
    const POPOVER_GAP = 16;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;

    // Compute the popover position.
    let popoverStyle: React.CSSProperties = { position: 'fixed', zIndex: 1000 };
    if (targetRect) {
        const pos = step.position ?? 'auto';
        const spaceBelow = vh - (targetRect.top + targetRect.height);
        const spaceAbove = targetRect.top;
        const spaceRight = vw - (targetRect.left + targetRect.width);
        const spaceLeft = targetRect.left;

        const placeBelow = pos === 'bottom' || (pos === 'auto' && spaceBelow > spaceAbove);
        const placeRight = pos === 'right' || (pos === 'auto' && spaceRight > spaceLeft);

        if (placeBelow) {
            popoverStyle.top = targetRect.top + targetRect.height + POPOVER_GAP;
        } else {
            popoverStyle.bottom = vh - targetRect.top + POPOVER_GAP;
        }
        if (placeRight) {
            popoverStyle.left = Math.min(targetRect.left, vw - POPOVER_WIDTH - PAD);
        } else {
            popoverStyle.right = Math.min(vw - (targetRect.left + targetRect.width), vw - PAD);
        }
        // Clamp left to viewport
        if (typeof popoverStyle.left === 'number') {
            popoverStyle.left = Math.max(PAD, popoverStyle.left);
        }
    } else {
        // No target found — center the popover.
        popoverStyle.top = vh / 2 - 100;
        popoverStyle.left = vw / 2 - POPOVER_WIDTH / 2;
    }

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`tour-${tourId}-title`}
            className="fixed inset-0 z-[1000] pointer-events-none"
        >
            {/* Backdrop with a cutout for the target. */}
            <svg
                className="absolute inset-0 w-full h-full"
                style={{ pointerEvents: 'auto' }}
            >
                <defs>
                    <mask id={`tour-${tourId}-mask`}>
                        <rect width="100%" height="100%" fill="white" />
                        {targetRect && (
                            <rect
                                x={targetRect.left - PAD}
                                y={targetRect.top - PAD}
                                width={targetRect.width + PAD * 2}
                                height={targetRect.height + PAD * 2}
                                rx="12"
                                fill="black"
                            />
                        )}
                    </mask>
                </defs>
                <rect
                    width="100%"
                    height="100%"
                    fill="rgba(0,0,0,0.55)"
                    mask={`url(#tour-${tourId}-mask)`}
                    onClick={() => close(true)}
                />
            </svg>

            {/* Spotlight ring */}
            {targetRect && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="absolute pointer-events-none rounded-2xl ring-2 ring-indigo-400/80 ring-offset-0 shadow-[0_0_0_9999px_rgba(0,0,0,0.0)]"
                    style={{
                        top: targetRect.top - PAD,
                        left: targetRect.left - PAD,
                        width: targetRect.width + PAD * 2,
                        height: targetRect.height + PAD * 2,
                    }}
                />
            )}

            {/* Popover */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={stepIndex}
                    initial={{ opacity: 0, y: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.97 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    style={popoverStyle}
                    className="pointer-events-auto w-[320px] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden"
                >
                    <div className="flex items-center justify-between p-4 pb-2">
                        <div className="flex items-center gap-2">
                            <Sparkles size={16} className="text-indigo-500" />
                            <h3
                                id={`tour-${tourId}-title`}
                                className="font-bold text-sm text-slate-900 dark:text-slate-100"
                            >
                                {step.title}
                            </h3>
                        </div>
                        <button
                            onClick={() => close(true)}
                            aria-label="Skip tour"
                            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                            <X size={14} />
                        </button>
                    </div>
                    <div className="px-4 pb-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                        {step.body}
                    </div>
                    {step.action && (
                        <div className="px-4 pb-3">
                            <button
                                onClick={() => {
                                    step.action!.onClick();
                                    next();
                                }}
                                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                                {step.action.label} →
                            </button>
                        </div>
                    )}
                    <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700">
                        <span className="text-xs text-slate-500 font-mono">
                            {stepIndex + 1} / {steps.length}
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={prev}
                                disabled={stepIndex === 0}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1"
                            >
                                <ChevronLeft size={12} /> Back
                            </button>
                            <button
                                onClick={next}
                                disabled={!canAdvance}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1"
                            >
                                {stepIndex + 1 === steps.length ? 'Done' : 'Next'}
                                {stepIndex + 1 < steps.length && <ChevronRight size={12} />}
                            </button>
                        </div>
                    </div>
                </motion.div>
            </AnimatePresence>
        </div>
    );
};

export default OnboardingTour;

/**
 * CC107 convenience hook — declare a tour once, drive it from anywhere.
 */
export function useOnboardingTour(
    tourId: string,
    steps: OnboardingStep[],
    options: { forceOpen?: boolean; onComplete?: () => void; onDismiss?: () => void } = {}
): { active: boolean; reset: () => void } {
    const { forceOpen, onComplete, onDismiss } = options;
    const [active, setActive] = useState(forceOpen ?? false);
    const [signature] = useState(() => `${tourId}-${Date.now()}`);

    useEffect(() => {
        if (forceOpen) {
            setActive(true);
        } else {
            const dismissed = loadDismissed(tourId);
            setActive(!dismissed);
        }
    }, [tourId, forceOpen]);

    const reset = useCallback(() => {
        saveDismissed(tourId, false);
        setActive(true);
    }, [tourId]);

    // Mount the tour component via a portal-style effect. We return
    // metadata; the consumer is responsible for rendering <OnboardingTour>
    // with these props. (Keeping the hook and component decoupled lets
    // consumers compose multiple tours.)
    void signature; void onComplete; void onDismiss;
    return { active, reset };
}
