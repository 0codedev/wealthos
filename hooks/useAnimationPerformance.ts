import { useEffect, useRef, useCallback, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * Enterprise-grade animation performance manager
 * Optimized for high-end machines (HP OMEN 16)
 * 
 * Features:
 * - RAF-based throttling for smooth 60fps
 * - Intersection Observer for lazy animation triggering
 * - Reduced motion support
 * - GPU acceleration hints
 * - Battery/power-aware animations
 */

// Check if device prefers reduced motion
export const usePrefersReducedMotion = (): boolean => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return prefersReducedMotion;
};

// Check for low power mode (if available)
export const usePowerMode = (): { isLowPower: boolean; isCharging: boolean } => {
  const [powerMode, setPowerMode] = useState({ isLowPower: false, isCharging: true });

  useEffect(() => {
    let batteryRef: any = null;
    let updateFn: any = null;

    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        batteryRef = battery;
        updateFn = () => {
          setPowerMode({
            isLowPower: battery.level < 0.2 && !battery.charging,
            isCharging: battery.charging,
          });
        };

        updateFn();
        battery.addEventListener('levelchange', updateFn);
        battery.addEventListener('chargingchange', updateFn);
      });
    }

    return () => {
      if (batteryRef && updateFn) {
        batteryRef.removeEventListener('levelchange', updateFn);
        batteryRef.removeEventListener('chargingchange', updateFn);
      }
    };
  }, []);

  return powerMode;
};

// Throttled scroll handler (RAF-based)
export const useThrottledScroll = (
  callback: (scrollY: number) => void,
  throttleMs: number = 16 // ~60fps
) => {
  const rafRef = useRef<number | null>(null);
  const lastScrollRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    const handleScroll = () => {
      const now = performance.now();

      // Throttle by time
      if (now - lastTimeRef.current < throttleMs) return;

      // Cancel pending RAF
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      // Schedule new RAF
      rafRef.current = requestAnimationFrame(() => {
        const scrollY = window.scrollY;
        if (scrollY !== lastScrollRef.current) {
          lastScrollRef.current = scrollY;
          lastTimeRef.current = now;
          callback(scrollY);
        }
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [callback, throttleMs]);
};

// Intersection Observer for lazy animation triggering
export const useInViewAnimation = (
  options: IntersectionObserverInit = { threshold: 0.1, rootMargin: '50px' }
) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [hasAnimated, setHasAnimated] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !hasAnimated) {
        setIsInView(true);
        setHasAnimated(true);
        observer.unobserve(element);
      }
    }, options);

    observer.observe(element);

    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAnimated, JSON.stringify(options)]);

  return { ref, isInView };
};

// Optimized list virtualization hook (for large lists)
export const useVirtualList = <T,>(
  items: T[],
  itemHeight: number,
  overscan: number = 3
) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 10 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateVisibleRange = () => {
      const scrollTop = container.scrollTop;
      const containerHeight = container.clientHeight;

      const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
      const end = Math.min(
        items.length,
        Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
      );

      setVisibleRange({ start, end });
    };

    updateVisibleRange();
    container.addEventListener('scroll', updateVisibleRange, { passive: true });

    return () => container.removeEventListener('scroll', updateVisibleRange);
  }, [items.length, itemHeight, overscan]);

  const visibleItems = items.slice(visibleRange.start, visibleRange.end);
  const totalHeight = items.length * itemHeight;
  const offsetY = visibleRange.start * itemHeight;

  return {
    containerRef,
    visibleItems,
    totalHeight,
    offsetY,
    startIndex: visibleRange.start,
  };
};

// Smooth tab switching with exit animation optimization
export const useTabTransition = (activeTab: string, tabOrder: string[] = []) => {
  const [direction, setDirection] = useState(0);
  const prevTabRef = useRef(activeTab);

  useEffect(() => {
    if (activeTab !== prevTabRef.current) {
      if (tabOrder.length > 0) {
        const prevIdx = tabOrder.indexOf(prevTabRef.current);
        const nextIdx = tabOrder.indexOf(activeTab);
        setDirection(nextIdx > prevIdx ? 1 : -1);
      } else {
        setDirection(1);
      }
      prevTabRef.current = activeTab;
    }
  }, [activeTab, tabOrder]);

  const getVariants = useCallback(() => ({
    initial: { opacity: 0, x: direction * 30 },
    animate: {
      opacity: 1,
      x: 0,
      transition: {
        type: 'spring',
        stiffness: 400,
        damping: 35,
      }
    },
    exit: {
      opacity: 0,
      x: direction * -30,
      transition: { duration: 0.15 }
    },
  }), [direction]);

  return { getVariants, direction };
};

// CSS-based animation (no JS overhead)
export const useCSSAnimation = (
  trigger: boolean,
  duration: number = 300
) => {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (trigger) {
      setIsAnimating(true);
      const timer = setTimeout(() => setIsAnimating(false), duration);
      return () => clearTimeout(timer);
    }
  }, [trigger, duration]);

  return isAnimating;
};

// Performance monitoring for animations
export const useAnimationPerformance = () => {
  const fpsRef = useRef(60);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;

    let rafId: number;

    const measureFPS = () => {
      const now = performance.now();
      frameCountRef.current++;

      if (now - lastTimeRef.current >= 1000) {
        fpsRef.current = frameCountRef.current;
        frameCountRef.current = 0;
        lastTimeRef.current = now;
      }

      rafId = requestAnimationFrame(measureFPS);
    };

    rafId = requestAnimationFrame(measureFPS);

    return () => cancelAnimationFrame(rafId);
  }, []);

  return {
    getFPS: () => fpsRef.current,
    isPerformant: () => fpsRef.current >= 55,
  };
};

// GPU acceleration CSS
export const gpuAcceleratedStyles = {
  willChange: 'transform, opacity',
  transform: 'translateZ(0)', // Force GPU layer
  backfaceVisibility: 'hidden' as const,
};

// Debounced resize handler
export const useDebouncedResize = (
  callback: () => void,
  delay: number = 250
) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleResize = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(callback, delay);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [callback, delay]);
};
