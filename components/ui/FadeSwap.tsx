
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { pureFade, tabContentSwap, skeletonContentSwap } from './motion/variants';
import { useReducedMotion } from './motion/useReducedMotion';

/**
 * Agent CC8 — FadeSwap
 *
 * A one-liner AnimatePresence wrapper for tab content and skeleton↔content
 * crossfades. Pass a stable `activeKey` (e.g. the active tab id, or "loading"
 * vs "ready") and the children inside the matching branch.
 *
 *   <FadeSwap activeKey={tab}>
 *     {tab === 'overview' && <OverviewPanel />}
 *     {tab === 'details' && <DetailsPanel />}
 *   </FadeSwap>
 *
 * Variants:
 *  - "fade"        (default) — pureFade, no y-shift. Use for tab content.
 *  - "tab"         — tabContentSwap, 2px y-shift for a "settle" feel.
 *  - "skeleton"    — skeletonContentSwap, longer duration to mask load time.
 *
 * Reduced motion: falls back to instant render (no AnimatePresence wrapping).
 * GPU: only `opacity` and a tiny `transform: translateY` — both compositor-only.
 */

export type FadeSwapVariant = 'fade' | 'tab' | 'skeleton';

export interface FadeSwapProps {
    activeKey: string;
    variant?: FadeSwapVariant;
    className?: string;
    children: React.ReactNode;
}

const variantMap = {
    fade: pureFade,
    tab: tabContentSwap,
    skeleton: skeletonContentSwap,
};

export const FadeSwap: React.FC<FadeSwapProps> = ({
    activeKey,
    variant = 'fade',
    className,
    children,
}) => {
    const reduced = useReducedMotion();
    const v = variantMap[variant];

    if (reduced) {
        return <div className={className}>{children}</div>;
    }

    return (
        <AnimatePresence mode="wait" initial={false}>
            <motion.div
                key={activeKey}
                variants={v}
                initial="initial"
                animate="animate"
                exit="exit"
                className={className}
            >
                {children}
            </motion.div>
        </AnimatePresence>
    );
};

export default FadeSwap;
