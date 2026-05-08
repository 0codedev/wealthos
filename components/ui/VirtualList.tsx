/**
 * CC114 — List virtualization primitive.
 *
 * A small, dependency-free windowed-list primitive. Renders only the
 * visible subset of a long list, keeping DOM node count constant
 * regardless of total item count. The full API is one component.
 *
 * Why this matters:
 *   The journal's TradeHistoryTable can hold 10,000+ rows. Without
 *   virtualization, the browser keeps all 10,000 <tr> elements in the
 *   DOM, which kills scroll perf and balloon memory. With virtualization,
 *   only ~20-40 rows are mounted at any time.
 *
 * Why a custom impl vs. react-window:
 *   - No new dependencies (per Phase-14 hard rule).
 *   - The list shapes we have (cards, tables, feed items) are simple
 *     vertical windows — a 100-line custom impl covers all of them.
 *   - We can match the app's design tokens (motion, glass, focus ring)
 *     without a library override pass.
 */
import React, { useEffect, useRef, useState, useMemo, useCallback, CSSProperties } from 'react';

export interface VirtualListProps<T> {
    items: T[];
    /** Fixed height of each row in pixels. Required for the simple windowed math. */
    rowHeight: number;
    /** Height of the scroll container. Default 400. */
    height?: number | string;
    /** Number of rows to render above/below the visible window. Default 4. */
    overscan?: number;
    /** Render a single row. */
    renderRow: (item: T, index: number) => React.ReactNode;
    /** Optional className for the outer container. */
    className?: string;
    /** Optional className applied to each row. */
    rowClassName?: string;
    /** Optional stable key extractor. Default: `(_, i) => i`. */
    keyExtractor?: (item: T, index: number) => string | number;
    /** ARIA role. Default 'list'. */
    role?: string;
    /** aria-label. */
    'aria-label'?: string;
}

export function VirtualList<T>({
    items,
    rowHeight,
    height = 400,
    overscan = 4,
    renderRow,
    className = '',
    rowClassName = '',
    keyExtractor,
    role = 'list',
    ...aria
}: VirtualListProps<T>): React.ReactElement {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [containerHeight, setContainerHeight] = useState(
        typeof height === 'number' ? height : 400
    );

    // Resize observer to keep the rendered window in sync with the
    // container's actual size (handles flex parents, window resize, etc.).
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        if (typeof height === 'number') {
            setContainerHeight(height);
            return;
        }
        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerHeight(entry.contentRect.height);
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [height]);

    const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        setScrollTop(e.currentTarget.scrollTop);
    }, []);

    const { startIndex, endIndex, offsetY, totalHeight } = useMemo(() => {
        const total = items.length * rowHeight;
        const visibleStart = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
        const visibleEnd = Math.min(
            items.length,
            Math.ceil((scrollTop + containerHeight) / rowHeight) + overscan
        );
        return {
            startIndex: visibleStart,
            endIndex: visibleEnd,
            offsetY: visibleStart * rowHeight,
            totalHeight: total,
        };
    }, [items.length, rowHeight, scrollTop, containerHeight, overscan]);

    const visibleItems = useMemo(
        () => items.slice(startIndex, endIndex),
        [items, startIndex, endIndex]
    );

    const containerStyle: CSSProperties = {
        height: typeof height === 'number' ? `${height}px` : height,
        overflowY: 'auto',
        position: 'relative',
        contain: 'strict',
    };

    const innerStyle: CSSProperties = {
        height: `${totalHeight}px`,
        position: 'relative',
    };

    const windowedStyle: CSSProperties = {
        transform: `translateY(${offsetY}px)`,
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
    };

    return (
        <div
            ref={containerRef}
            onScroll={onScroll}
            style={containerStyle}
            className={`virtual-list ${className}`}
            role={role}
            aria-label={aria['aria-label']}
        >
            <div style={innerStyle}>
                <div style={windowedStyle}>
                    {visibleItems.map((item, i) => {
                        const idx = startIndex + i;
                        const key = keyExtractor ? keyExtractor(item, idx) : idx;
                        return (
                            <div
                                key={key}
                                className={rowClassName}
                                style={{ height: `${rowHeight}px` }}
                            >
                                {renderRow(item, idx)}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export default VirtualList;
