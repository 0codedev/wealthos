import { Variants, Transition } from 'framer-motion';

/**
 * Enterprise-grade animation presets
 * Optimized for high-performance machines (HP OMEN 16 spec)
 * 
 * Principles:
 * 1. Use transform/opacity only (GPU accelerated)
 * 2. Avoid filter animations (blur, brightness) - CPU intensive
 * 3. Use spring physics for natural feel
 * 4. Memoized configs - no object recreation
 * 5. Stagger children for polished feel
 */

// Base transitions
export const fastSpring: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 30,
  mass: 0.8,
};

export const smoothSpring: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 25,
  mass: 1,
};

export const snappySpring: Transition = {
  type: 'spring',
  stiffness: 500,
  damping: 35,
  mass: 0.6,
};

export const gentleEase: Transition = {
  type: 'tween',
  ease: [0.25, 0.1, 0.25, 1], // Custom cubic-bezier
  duration: 0.25,
};

// Page/Tabs - NO blur filters
export const tabTransition: Variants = {
  initial: { 
    opacity: 0, 
    x: 20,
  },
  animate: { 
    opacity: 1, 
    x: 0,
    transition: {
      type: 'spring',
      stiffness: 400,
      damping: 30,
    }
  },
  exit: { 
    opacity: 0, 
    x: -20,
    transition: {
      duration: 0.15,
    }
  },
};

// Cards/Modals
export const cardTransition: Variants = {
  initial: { 
    opacity: 0, 
    y: 20,
    scale: 0.98,
  },
  animate: { 
    opacity: 1, 
    y: 0,
    scale: 1,
    transition: smoothSpring,
  },
  exit: { 
    opacity: 0, 
    y: -10,
    scale: 0.98,
    transition: { duration: 0.15 },
  },
};

// Fade only - fastest
export const fadeTransition: Variants = {
  initial: { opacity: 0 },
  animate: { 
    opacity: 1,
    transition: { duration: 0.2 },
  },
  exit: { 
    opacity: 0,
    transition: { duration: 0.15 },
  },
};

// Slide up - for lists
export const slideUpTransition: Variants = {
  initial: { opacity: 0, y: 15 },
  animate: { 
    opacity: 1, 
    y: 0,
    transition: fastSpring,
  },
  exit: { 
    opacity: 0, 
    y: -10,
    transition: { duration: 0.1 },
  },
};

// Scale - for buttons/interactive
export const scaleTransition: Variants = {
  initial: { scale: 0.95, opacity: 0 },
  animate: { 
    scale: 1, 
    opacity: 1,
    transition: snappySpring,
  },
  exit: { 
    scale: 0.95, 
    opacity: 0,
    transition: { duration: 0.1 },
  },
};

// Stagger container
export const staggerContainer: Variants = {
  animate: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

// Stagger item
export const staggerItem: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { 
    opacity: 1, 
    y: 0,
    transition: fastSpring,
  },
};

// Button hover - CSS-based, no Framer Motion
export const buttonHover = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.98 },
  transition: { duration: 0.1 },
};

// List item - optimized for large lists
export const listItem: Variants = {
  initial: { opacity: 0, x: -10 },
  animate: { 
    opacity: 1, 
    x: 0,
    transition: { 
      type: 'spring',
      stiffness: 350,
      damping: 25,
    },
  },
  exit: { 
    opacity: 0, 
    x: 10,
    transition: { duration: 0.1 },
  },
};

// Modal backdrop
export const backdropTransition: Variants = {
  initial: { opacity: 0 },
  animate: { 
    opacity: 1,
    transition: { duration: 0.2 },
  },
  exit: { 
    opacity: 0,
    transition: { duration: 0.15 },
  },
};

// Hub transitions (like MarketInsightsHub)
export const hubTransition: Variants = {
  initial: { opacity: 0, y: 20 },
  animate: { 
    opacity: 1, 
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 25,
      staggerChildren: 0.1,
    },
  },
};

// Hub card - matching MarketInsightsHub style
export const hubCard: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { 
    opacity: 1, 
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 400,
      damping: 30,
    },
  },
};

// Number counter animation
export const counterTransition = {
  duration: 0.5,
  ease: 'easeOut',
};

// Performance-optimized animation props
export const performanceProps = {
  // Disable layout animations for better performance
  layout: false,
  // Use transform for GPU acceleration
  style: { willChange: 'transform, opacity' },
};

// Reduced motion support
export const reducedMotionVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0 } },
  exit: { opacity: 0, transition: { duration: 0 } },
};
