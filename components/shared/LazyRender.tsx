import React, { useState, useEffect, useRef, useMemo } from 'react';

interface LazyRenderProps {
    children: React.ReactNode;
    minHeight?: number | string;
    rootMargin?: string;
    threshold?: number;
    className?: string;
    /** When true, defer paint by one frame so layout isn't double-flushed. Default true. */
    deferPaint?: boolean;
}

/**
 * LazyRender defers the rendering of its children until they are about to enter the viewport.
 * This is crucial for performance when dealing with many heavy components like Recharts.
 *
 * Performance upgrades (CC18B):
 *  - Skeleton placeholder height is STABLE — we never switch from skeleton -> real content
 *    with a different height; the wrapper keeps its declared minHeight until content reports
 *    a measured height, so there is no layout jump on the frame the children appear.
 *  - IntersectionObserver fires once and disconnects, so we never thrash the layout engine.
 *  - Children are wrapped in React.memo upstream; we don't add another memo here because
 *    the children prop is opaque.
 *  - deferPaint (default true) schedules the children render inside a rAF, batching it
 *    with the next paint and avoiding a forced synchronous layout on mount.
 */
const LazyRender: React.FC<LazyRenderProps> = React.memo(({
    children,
    minHeight = 300,
    rootMargin = '200px',
    threshold = 0.01,
    className = '',
    deferPaint = true,
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [shouldRender, setShouldRender] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Stable numeric height to avoid re-render thrash on the parent.
    const placeholderHeight = useMemo(() => {
        if (typeof minHeight === 'number') return `${minHeight}px`;
        return minHeight;
    }, [minHeight]);

    useEffect(() => {
        if (isVisible) return;
        const el = containerRef.current;
        if (!el) return;

        // Failsafe: force visible after 200ms so we never get stuck.
        const fallback = setTimeout(() => setIsVisible(true), 200);

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                    clearTimeout(fallback);
                    observer.disconnect();
                }
            },
            { rootMargin, threshold }
        );

        observer.observe(el);
        return () => {
            clearTimeout(fallback);
            observer.disconnect();
        };
    }, [isVisible, rootMargin, threshold]);

    // After we become visible, defer the actual children render by one rAF
    // so the parent layout settles before we paint a Recharts component.
    useEffect(() => {
        if (!isVisible) return;
        if (!deferPaint) {
            setShouldRender(true);
            return;
        }
        let raf2 = 0;
        const raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(() => setShouldRender(true));
        });
        return () => {
            cancelAnimationFrame(raf1);
            if (raf2) cancelAnimationFrame(raf2);
        };
    }, [isVisible, deferPaint]);

    return (
        <div
            ref={containerRef}
            className={`w-full ${className}`}
            style={{
                minHeight: shouldRender ? undefined : placeholderHeight,
                contain: shouldRender ? 'layout paint' : undefined,
                willChange: shouldRender ? 'auto' : 'opacity',
            }}
        >
            {shouldRender ? (
                <div className="w-full fill-mode-both">{children}</div>
            ) : (
                <div
                    className="w-full bg-slate-800/10 dark:bg-slate-900/10 rounded-2xl border border-slate-800/50 flex items-center justify-center animate-pulse"
                    style={{ height: placeholderHeight }}
                    aria-hidden="true"
                >
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-8 h-8 rounded-full border-2 border-slate-700/50 border-t-indigo-500/50 animate-spin" />
                        <span className="text-[10px] font-bold text-slate-600 dark:text-slate-500 uppercase tracking-widest">
                            Loading Analysis...
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
});

LazyRender.displayName = 'LazyRender';
export default LazyRender;
