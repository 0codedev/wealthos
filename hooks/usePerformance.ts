import { useEffect, useRef } from 'react';

interface PerformanceOptions {
    /** Component name for logging */
    name: string;
    /** Threshold in ms to log (default: 16ms) */
    threshold?: number;
    /** Whether to log all renders (default: false) */
    logAll?: boolean;
}

/**
 * Development-only hook to monitor component render performance.
 * Logs slow renders (>16ms) to console with helpful debugging info.
 * 
 * @param options - Configuration for performance monitoring
 * 
 * @example
 * usePerformance({ name: 'DashboardTab' });
 */
export function usePerformance({ name, threshold = 16, logAll = false }: PerformanceOptions) {
    const renderCount = useRef(0);
    const lastRenderTime = useRef(performance.now());

    useEffect(() => {
        // Only run in development
        if (process.env.NODE_ENV !== 'development') return;

        const now = performance.now();
        const renderTime = now - lastRenderTime.current;
        renderCount.current++;

        if (logAll || renderTime > threshold) {
            const style = renderTime > threshold
                ? 'color: red; font-weight: bold;'
                : 'color: gray;';

            console.log(
                `%c[Perf] ${name} - Render #${renderCount.current}: ${renderTime.toFixed(2)}ms`,
                style
            );

            if (renderTime > 100) {
                console.warn(`⚠️ Slow render detected in ${name}! Consider memoization.`);
            }
        }

        lastRenderTime.current = now;
    });
}

/**
 * Measure and log time for async operations.
 * 
 * @example
 * const result = await measureAsync('API Call', () => fetchData());
 */
export async function measureAsync<T>(
    label: string,
    fn: () => Promise<T>
): Promise<T> {
    if (process.env.NODE_ENV !== 'development') {
        return fn();
    }

    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;

    const style = duration > 1000 ? 'color: red;' : duration > 500 ? 'color: orange;' : 'color: green;';
    console.log(`%c[Perf] ${label}: ${duration.toFixed(2)}ms`, style);

    return result;
}

/**
 * Create a debounced version of a function.
 * Useful for expensive operations triggered by user input.
 */
export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: ReturnType<typeof setTimeout>;

    return (...args: Parameters<T>) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
}

/**
 * Create a throttled version of a function.
 * Limits execution to at most once per interval.
 */
export function throttle<T extends (...args: any[]) => any>(
    fn: T,
    interval: number
): (...args: Parameters<T>) => void {
    let lastCall = 0;

    return (...args: Parameters<T>) => {
        const now = Date.now();
        if (now - lastCall >= interval) {
            lastCall = now;
            fn(...args);
        }
    };
}

export default usePerformance;
