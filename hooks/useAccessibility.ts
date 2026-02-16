import { useEffect, useCallback, useRef, useState } from 'react';

/**
 * Accessibility utilities for WCAG 2.1 compliance
 */

// Check if user prefers reduced motion
export function usePrefersReducedMotion(): boolean {
    const [prefersReduced, setPrefersReduced] = useState(false);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        setPrefersReduced(mediaQuery.matches);

        const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
        mediaQuery.addEventListener('change', handler);
        return () => mediaQuery.removeEventListener('change', handler);
    }, []);

    return prefersReduced;
}

// Check if user prefers high contrast
export function usePrefersHighContrast(): boolean {
    const [prefersContrast, setPrefersContrast] = useState(false);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-contrast: more)');
        setPrefersContrast(mediaQuery.matches);

        const handler = (e: MediaQueryListEvent) => setPrefersContrast(e.matches);
        mediaQuery.addEventListener('change', handler);
        return () => mediaQuery.removeEventListener('change', handler);
    }, []);

    return prefersContrast;
}

// Screen reader announcements
export function useAnnounce() {
    const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
        const el = document.createElement('div');
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', priority);
        el.setAttribute('aria-atomic', 'true');
        el.className = 'sr-only';
        el.textContent = message;

        document.body.appendChild(el);

        // Remove after announcement
        setTimeout(() => {
            document.body.removeChild(el);
        }, 1000);
    }, []);

    return announce;
}

// Focus trap for modals
export function useFocusTrap(isActive: boolean = true) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isActive || !containerRef.current) return;

        const container = containerRef.current;
        const focusableElements = container.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        // Focus first element
        firstElement.focus();

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return;

            if (e.shiftKey) {
                if (document.activeElement === firstElement) {
                    e.preventDefault();
                    lastElement.focus();
                }
            } else {
                if (document.activeElement === lastElement) {
                    e.preventDefault();
                    firstElement.focus();
                }
            }
        };

        container.addEventListener('keydown', handleKeyDown);
        return () => container.removeEventListener('keydown', handleKeyDown);
    }, [isActive]);

    return containerRef;
}

// Return focus to trigger element after modal closes
export function useReturnFocus() {
    const triggerRef = useRef<HTMLElement | null>(null);

    const saveTrigger = useCallback(() => {
        triggerRef.current = document.activeElement as HTMLElement;
    }, []);

    const returnFocus = useCallback(() => {
        if (triggerRef.current) {
            triggerRef.current.focus();
            triggerRef.current = null;
        }
    }, []);

    return { saveTrigger, returnFocus };
}

// Accessible ID generator
let idCounter = 0;
export function useId(prefix: string = 'id'): string {
    const idRef = useRef<string | null>(null);

    if (idRef.current === null) {
        idRef.current = `${prefix}-${++idCounter}`;
    }

    return idRef.current;
}

// Focus visible detection (keyboard vs mouse)
export function useFocusVisible() {
    const [isFocusVisible, setIsFocusVisible] = useState(false);
    const [hadKeyboardEvent, setHadKeyboardEvent] = useState(false);

    useEffect(() => {
        const handleKeyDown = () => setHadKeyboardEvent(true);
        const handleMouseDown = () => setHadKeyboardEvent(false);

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handleMouseDown);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handleMouseDown);
        };
    }, []);

    const handleFocus = useCallback(() => {
        setIsFocusVisible(hadKeyboardEvent);
    }, [hadKeyboardEvent]);

    const handleBlur = useCallback(() => {
        setIsFocusVisible(false);
    }, []);

    return { isFocusVisible, handleFocus, handleBlur };
}

// Live region for dynamic content
export function useLiveRegion(mode: 'polite' | 'assertive' = 'polite') {
    const regionRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const region = document.createElement('div');
        region.setAttribute('role', 'status');
        region.setAttribute('aria-live', mode);
        region.setAttribute('aria-atomic', 'true');
        region.className = 'sr-only';
        document.body.appendChild(region);
        regionRef.current = region;

        return () => {
            if (regionRef.current) {
                document.body.removeChild(regionRef.current);
            }
        };
    }, [mode]);

    const announce = useCallback((message: string) => {
        if (regionRef.current) {
            regionRef.current.textContent = '';
            // Force reflow for screen readers
            void regionRef.current.offsetHeight;
            regionRef.current.textContent = message;
        }
    }, []);

    return announce;
}

export default {
    usePrefersReducedMotion,
    usePrefersHighContrast,
    useAnnounce,
    useFocusTrap,
    useReturnFocus,
    useId,
    useFocusVisible,
    useLiveRegion,
};
