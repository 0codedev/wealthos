import { useState, useEffect, useMemo, useRef } from 'react';

interface UseVirtualScrollProps {
    itemHeight: number;
    itemsCount: number;
    overscan?: number;
    containerHeight?: number;
}

export const useVirtualScroll = ({ itemHeight, itemsCount, overscan = 3, containerHeight = 400 }: UseVirtualScrollProps) => {
    const [scrollTop, setScrollTop] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    // If containerHeight is not fixed, we might need ResizeObserver, 
    // but for this lightweight version we assume standard fixed height or full flex height manually passed or detected.

    // Calculate visible range
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(itemsCount, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan);

    const visibleItems = useMemo(() => {
        const items = [];
        for (let i = startIndex; i < endIndex; i++) {
            items.push(i);
        }
        return items;
    }, [startIndex, endIndex]);

    // Handle scroll
    const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
        setScrollTop(e.currentTarget.scrollTop);
    };

    const totalHeight = itemsCount * itemHeight;
    const offsetY = startIndex * itemHeight;

    return {
        containerRef,
        onScroll,
        visibleItems,
        totalHeight,
        offsetY,
        startIndex
    };
};
