import { Variants, Transition } from 'framer-motion';

// ──────────────────────────────────────────────────────────
// Shared variant library — pure motion, no styling.
// All easings are cubic-bezier control points unless noted.
// ──────────────────────────────────────────────────────────

const appleEase: [number, number, number, number] = [0.32, 0.72, 0, 1];
const smoothEase: [number, number, number, number] = [0.16, 1, 0.3, 1];

// Page-level crossfade (used by AnimatePresence in MainLayout)
export const fadeSwap: Variants = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: 0.18, ease: 'easeOut' } },
    exit:    { opacity: 0, transition: { duration: 0.12, ease: 'easeIn'  } },
};

// List container that cascades children
export const staggerParent = (delay = 0.04, initial = 0): Variants => ({
    initial: { opacity: 1 },
    animate: {
        opacity: 1,
        transition: { staggerChildren: delay, delayChildren: initial },
    },
});

// Child fade-in for stagger containers (used inside staggerParent)
export const fadeRise: Variants = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: smoothEase } },
    exit:    { opacity: 0, y: -4, transition: { duration: 0.14, ease: 'easeIn' } },
};

// Pure fade (no movement) — for tab content swaps that should not shift
export const pureFade: Variants = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: 0.15, ease: 'easeOut' } },
    exit:    { opacity: 0, transition: { duration: 0.10, ease: 'easeIn'  } },
};

// Modal scale-in
export const popIn: Variants = {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1, transition: { duration: 0.20, ease: appleEase } },
    exit:    { opacity: 0, scale: 0.97, transition: { duration: 0.15, ease: 'easeIn'  } },
};

// Drawer slide from right
export const slideFromRight: Variants = {
    initial: { x: '100%' },
    animate: { x: 0,   transition: { type: 'spring', stiffness: 280, damping: 32, mass: 0.8 } },
    exit:    { x: '100%', transition: { type: 'spring', stiffness: 320, damping: 36, mass: 0.6 } },
};

// Drawer slide from left (mirror of slideFromRight — used by the desktop shell's mobile menu drawer)
export const slideFromLeft: Variants = {
    initial: { x: '-100%' },
    animate: { x: 0,   transition: { type: 'spring', stiffness: 280, damping: 32, mass: 0.8 } },
    exit:    { x: '-100%', transition: { type: 'spring', stiffness: 320, damping: 36, mass: 0.6 } },
};

// Backdrop blur fade
export const blurBackdrop: Variants = {
    initial: { opacity: 0, backdropFilter: 'blur(0px)' },
    animate: { opacity: 1, backdropFilter: 'blur(8px)', transition: { duration: 0.22, ease: 'easeOut' } },
    exit:    { opacity: 0, backdropFilter: 'blur(0px)', transition: { duration: 0.18, ease: 'easeIn'  } },
};

// Standard spring for layout shifts (sidebar indicator, settings tabs)
export const layoutShift: Transition = {
    type: 'spring',
    stiffness: 380,
    damping: 32,
    mass: 0.6,
};

// Snappy spring for toggle/tab indicators
export const snappyLayout: Transition = {
    type: 'spring',
    stiffness: 500,
    damping: 35,
    mass: 0.5,
};

// Agent CC8 — Tab content swap (pureFade + 2px y-shift for a "settle" feel)
export const tabContentSwap: Variants = {
    initial: { opacity: 0, y: 2 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.20, ease: smoothEase } },
    exit:    { opacity: 0, y: -2, transition: { duration: 0.12, ease: 'easeIn'  } },
};

// Agent CC8 — Skeleton ↔ content crossfade (slightly longer to mask load time)
export const skeletonContentSwap: Variants = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: 0.24, ease: 'easeOut' } },
    exit:    { opacity: 0, transition: { duration: 0.18, ease: 'easeIn'  } },
};

// Agent CC8 — Luxe content slide (longer duration, larger y-shift for a
// "premium" feel on big body areas like the Portfolio Hub content panel).
export const luxeContentSwap: Variants = {
    initial: { opacity: 0, y: 12, scale: 0.995 },
    animate: { opacity: 1, y: 0,  scale: 1, transition: { duration: 0.38, ease: [0.16, 1, 0.3, 1] } },
    exit:    { opacity: 0, y: -8, scale: 0.998, transition: { duration: 0.22, ease: 'easeIn' } },
};

// Agent CC8 — Soft sliding pill (used by AnimatedTabs/AnimatedToggle for a
// more luxurious indicator slide than snappyLayout).
export const luxeLayout: Transition = {
    type: 'spring',
    stiffness: 280,
    damping: 28,
    mass: 0.85,
};
