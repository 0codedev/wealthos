
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ResponsiveContainer } from 'recharts';

interface SafeChartContainerProps {
    children: React.ReactElement;
    height?: number | string;
    aspect?: number;
    minHeight?: number;
}

/**
 * SafeChartContainer - Smart wrapper for Recharts to prevent "Width -1" errors.
 * Ensures Recharts only renders while the container has a valid measurable box.
 *
 * SPRINT-0 FIX (persistent bidirectional guard):
 *  - The old "one-shot mount" disconnected the observer after first success,
 *    so when a widget later hid/collapsed (tab switch, accordion, responsive
 *    grid), NOTHING re-guarded it and Recharts' internal observer spammed
 *    "width(-1)/width(0)" into the console forever.
 *  - Now the observer stays connected for the component's lifetime and readiness
 *    toggles both directions with a small hysteresis debounce, so collapsing
 *    containers cleanly unmount their charts and expanding ones remount them.
 *  - Performance: `contain: layout paint` keeps this an isolated layout subtree;
 *    placeholder inherits minHeight so there is zero CLS swap either direction.
 */
export const SafeChartContainer: React.FC<SafeChartContainerProps> = React.memo(({
    children,
    height = "100%",
    aspect,
    minHeight = 150
}) => {
    const [isReady, setIsReady] = useState(false);
    const [isVisible, setIsVisible] = useState(true);
    const containerRef = useRef<HTMLDivElement>(null);

    const containerStyle = useMemo<React.CSSProperties>(() => ({
        minHeight: typeof height === 'number' ? height : (minHeight || 150),
        minWidth: 20,
        contain: 'layout paint' as const,
    }), [height, minHeight]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        const applyValidity = (valid: boolean) => {
            if (debounceTimer) clearTimeout(debounceTimer);
            // Hysteresis: collapse hides instantly, expand waits a beat so
            // fast layout thrash doesn't strobe the chart.
            debounceTimer = setTimeout(() => setIsReady(valid), valid ? 80 : 0);
        };

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const w = entry.contentRect.width;
                const h = entry.contentRect.height;
                applyValidity(w >= 20 && h >= 20);
            }
        });

        resizeObserver.observe(el);
        applyValidity(el.offsetWidth >= 20 && el.offsetHeight >= 20);

        // IntersectionObserver for offscreen / hidden virtualization (200px margin)
        let intersectionObserver: IntersectionObserver | null = null;
        if (typeof IntersectionObserver !== 'undefined') {
            intersectionObserver = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    setIsVisible(entry.isIntersecting);
                }
            }, { rootMargin: '200px' });
            intersectionObserver.observe(el);
        }

        return () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            resizeObserver.disconnect();
            if (intersectionObserver) intersectionObserver.disconnect();
        };
    }, []);

    const shouldRender = isReady && isVisible;

    return (
        <div
            ref={containerRef}
            className="w-full h-full overflow-hidden"
            style={containerStyle}
        >
            {shouldRender ? (
                <ResponsiveContainer 
                    width="100%" 
                    height={height as any} 
                    aspect={aspect}
                    minWidth={20}
                    minHeight={typeof height === 'number' ? height : (minHeight || 150)}
                >
                    {children}
                </ResponsiveContainer>
            ) : (
                <div className="w-full h-full flex items-center justify-center text-tf-muted text-[10px] font-medium animate-pulse">
                    Calculating dimensions...
                </div>
            )}
        </div>
    );
});

SafeChartContainer.displayName = 'SafeChartContainer';
