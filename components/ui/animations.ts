import { Variants, Transition } from 'framer-motion';

// ──────────────────────────────────────────────────────────
// Ultra-Subtle Animation System
// Philosophy: Animations should be FELT, not SEEN.
// Pure opacity fades. No blur. No scale. No y-drift.
// ──────────────────────────────────────────────────────────

// --- Easing ---
export const swiftEaseOut: [number, number, number, number] = [0.25, 0.1, 0.25, 1];
export const breathableEase: [number, number, number, number] = [0.25, 0.1, 0.25, 1];

// --- Spring Physics (for layout animations only) ---
export const springTransition: Transition = {
    type: 'spring',
    stiffness: 500,
    damping: 40,
    mass: 0.5
};

export const snappySpring: Transition = {
    type: 'spring',
    stiffness: 500,
    damping: 35,
    mass: 0.5
};

// --- Page & Tab Transitions ---
// Pure opacity crossfade — no movement, no jitter
export const pageVariants: Variants = {
    initial: {
        opacity: 0,
    },
    animate: {
        opacity: 1,
        transition: {
            duration: 0.15,
            ease: 'easeOut',
        },
    },
    exit: {
        opacity: 0,
        transition: {
            duration: 0.1,
            ease: 'easeIn',
        },
    },
};

// --- Modal Physics ---
export const modalOverlayVariants: Variants = {
    initial: { opacity: 0, backdropFilter: 'blur(0px)' },
    animate: {
        opacity: 1,
        backdropFilter: 'blur(8px)',
        transition: { duration: 0.3, ease: 'easeOut' }
    },
    exit: {
        opacity: 0,
        backdropFilter: 'blur(0px)',
        transition: { duration: 0.2, ease: 'easeIn' }
    }
};

export const modalContentVariants: Variants = {
    initial: { opacity: 0, scale: 0.97 },
    animate: {
        opacity: 1,
        scale: 1,
        transition: {
            duration: 0.2,
            ease: swiftEaseOut,
        }
    },
    exit: {
        opacity: 0,
        scale: 0.97,
        transition: { duration: 0.15, ease: 'easeIn' }
    }
};

// --- Dashboard Grid Staggers ---
// Very fast, barely noticeable cascade
export const staggerContainer: Variants = {
    hidden: { opacity: 1 },
    show: {
        opacity: 1,
        transition: {
            staggerChildren: 0.02,
            delayChildren: 0,
        },
    },
};

export const staggerItem: Variants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: {
            duration: 0.15,
            ease: 'easeOut',
        },
    },
};

// --- Tactile Hovers ---
export const tactileHover = {
    whileHover: {
        y: -1,
        transition: { duration: 0.15, ease: 'easeOut' },
    },
    whileTap: {
        scale: 0.99,
        transition: { duration: 0.1, ease: 'easeOut' },
    },
} as const;

// Layout grid hover — premium tactile feel
export const layoutTactileHover = {
    whileHover: {
        y: -2,
        scale: 1.005,
        boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
        transition: snappySpring,
    },
    whileTap: {
        scale: 0.98,
        transition: snappySpring,
    },
};
