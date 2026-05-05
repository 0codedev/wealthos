import { useEffect, useState } from 'react';

/**
 * Returns true when the user has `prefers-reduced-motion: reduce` enabled.
 * Used to disable non-essential animations and keep the app usable for
 * motion-sensitive users. Falls back to false on SSR / older browsers.
 */
export function useReducedMotion(): boolean {
    const query = '(prefers-reduced-motion: reduce)';
    const [reduced, setReduced] = useState<boolean>(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return false;
        return window.matchMedia(query).matches;
    });

    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const mq = window.matchMedia(query);
        const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    return reduced;
}
