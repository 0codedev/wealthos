import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

interface VirtualListResult<T> {
    /** Items currently visible in viewport */
    visibleItems: T[];
    /** Total height of the virtual list container */
    totalHeight: number;
    /** Offset from top for first visible item */
    offsetY: number;
    /** Ref to attach to scroll container */
    containerRef: React.RefObject<HTMLDivElement | null>;
    /** Start index of visible items */
    startIndex: number;
    /** End index of visible items */
    endIndex: number;
}

/**
 * Lightweight virtual list hook for rendering large lists efficiently.
 * Only renders items currently visible in viewport + buffer.
 * 
 * @param items - Full array of items to virtualize
 * @param itemHeight - Height of each item in pixels
 * @param containerHeight - Height of scroll container (0 for auto-detect)
 * @param overscan - Number of items to render above/below viewport (default: 3)
 * 
 * @example
 * const { visibleItems, totalHeight, offsetY, containerRef } = useVirtualList(holdings, 80, 600);
 * 
 * <div ref={containerRef} style={{ height: 600, overflow: 'auto' }}>
 *   <div style={{ height: totalHeight, position: 'relative' }}>
 *     <div style={{ transform: `translateY(${offsetY}px)` }}>
 *       {visibleItems.map(item => <ItemComponent key={item.id} item={item} />)}
 *     </div>
 *   </div>
 * </div>
 */
export function useVirtualList<T>(
    items: T[],
    itemHeight: number,
    containerHeight: number = 0,
    overscan: number = 3
): VirtualListResult<T> {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [detectedHeight, setDetectedHeight] = useState(containerHeight);

    // Auto-detect container height
    useEffect(() => {
        if (containerHeight > 0) {
            setDetectedHeight(containerHeight);
            return;
        }

        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (entry) {
                setDetectedHeight(entry.contentRect.height);
            }
        });

        observer.observe(container);
        return () => observer.disconnect();
    }, [containerHeight]);

    // Handle scroll events
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleScroll = () => {
            setScrollTop(container.scrollTop);
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, []);

    // Calculate visible range
    const { startIndex, endIndex, offsetY } = useMemo(() => {
        const height = detectedHeight || 600;
        const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
        const visibleCount = Math.ceil(height / itemHeight) + 2 * overscan;
        const end = Math.min(items.length - 1, start + visibleCount);

        return {
            startIndex: start,
            endIndex: end,
            offsetY: start * itemHeight
        };
    }, [scrollTop, itemHeight, detectedHeight, items.length, overscan]);

    // Slice visible items
    const visibleItems = useMemo(() => {
        return items.slice(startIndex, endIndex + 1);
    }, [items, startIndex, endIndex]);

    const totalHeight = items.length * itemHeight;

    return {
        visibleItems,
        totalHeight,
        offsetY,
        containerRef,
        startIndex,
        endIndex
    };
}

export default useVirtualList;
