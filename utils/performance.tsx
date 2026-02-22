import React, { useMemo, useCallback, memo } from 'react';

/**
 * Performance Utilities
 * 
 * This file provides utilities for optimizing React component performance.
 * Use these patterns to reduce unnecessary re-renders.
 */

// ==================== MEMOIZATION HELPERS ====================

/**
 * Create a memoized selector for derived data.
 * Useful for computing expensive values from state.
 */
export function createSelector<T, R>(
    inputSelector: (state: T) => any[],
    resultFunc: (...args: any[]) => R
): (state: T) => R {
    let lastInputs: any[] | null = null;
    let lastResult: R;

    return (state: T): R => {
        const inputs = inputSelector(state);

        // Check if inputs have changed (shallow comparison)
        if (
            lastInputs !== null &&
            inputs.length === lastInputs.length &&
            inputs.every((input, i) => input === lastInputs![i])
        ) {
            return lastResult;
        }

        lastInputs = inputs;
        lastResult = resultFunc(...inputs);
        return lastResult;
    };
}

// ==================== CHART DATA MEMOIZATION ====================

/**
 * Hook for memoizing chart data transformations.
 * Prevents recalculation on every render.
 */
export function useChartData<T, R>(
    rawData: T[],
    transformer: (data: T[]) => R[],
    deps: React.DependencyList = []
): R[] {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => {
        if (!rawData || rawData.length === 0) return [];
        return transformer(rawData);
    }, [rawData, JSON.stringify(deps)]);
}

// ==================== DEBOUNCED CALLBACK ====================

/**
 * Hook for debouncing callbacks
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
    callback: T,
    delay: number
): T {
    const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

    React.useEffect(() => {
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    return useCallback(
        ((...args: Parameters<T>) => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = setTimeout(() => {
                callback(...args);
            }, delay);
        }) as T,
        [callback, delay]
    );
}

// ==================== THROTTLED CALLBACK ====================

/**
 * Hook for throttling callbacks
 */
export function useThrottledCallback<T extends (...args: any[]) => any>(
    callback: T,
    delay: number
): T {
    const lastCallRef = React.useRef<number>(0);
    const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

    return useCallback(
        ((...args: Parameters<T>) => {
            const now = Date.now();
            const timeSinceLastCall = now - lastCallRef.current;

            if (timeSinceLastCall >= delay) {
                lastCallRef.current = now;
                callback(...args);
            } else if (!timeoutRef.current) {
                timeoutRef.current = setTimeout(() => {
                    lastCallRef.current = Date.now();
                    callback(...args);
                    timeoutRef.current = null;
                }, delay - timeSinceLastCall);
            }
        }) as T,
        [callback, delay]
    );
}

// ==================== LAZY COMPONENT WRAPPER ====================

/**
 * Creates a lazy-loaded component with loading fallback
 */
export function createLazyComponent<T extends React.ComponentType<any>>(
    importFunc: () => Promise<{ default: T }>,
    LoadingComponent?: React.ReactNode
) {
    const LazyComponent = React.lazy(importFunc);

    return function WrappedLazyComponent(props: React.ComponentProps<T>) {
        return (
            <React.Suspense
                fallback={LoadingComponent || (
                    <div className="h-48 flex items-center justify-center" >
                        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                )
                }
            >
                <LazyComponent {...props} />
            </React.Suspense>
        );
    };
}

// ==================== COMPARISON UTILITIES ====================

/**
 * Shallow comparison for memo
 */
export function shallowEqual<T extends Record<string, any>>(objA: T, objB: T): boolean {
    if (objA === objB) return true;
    if (!objA || !objB) return false;

    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
        if (objA[key] !== objB[key]) return false;
    }

    return true;
}

/**
 * Deep comparison for complex props
 */
export function deepEqual(a: any, b: any, seen = new WeakMap()): boolean {
    if (a === b) return true;

    if (typeof a !== typeof b) return false;

    if (typeof a !== 'object' || a === null || b === null) {
        return false;
    }

    if (seen.has(a) || seen.has(b)) return true; // Break cycle gracefully
    seen.set(a, true);
    seen.set(b, true);

    if (Array.isArray(a) !== Array.isArray(b)) return false;

    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        return a.every((item, index) => deepEqual(item, b[index], seen));
    }

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    return keysA.every(key => deepEqual(a[key], b[key], seen));
}

// ==================== PERFORMANCE MONITORING ====================

/**
 * Simple performance monitor for debugging
 */
export const perfMonitor = {
    marks: new Map<string, number>(),

    start(label: string) {
        this.marks.set(label, performance.now());
    },

    end(label: string): number {
        const start = this.marks.get(label);
        if (!start) {
            console.warn(`Performance mark "${label}" not found`);
            return 0;
        }
        const duration = performance.now() - start;
        this.marks.delete(label);

        if (process.env.NODE_ENV === 'development') {
            console.log(`⚡ ${label}: ${duration.toFixed(2)}ms`);
        }

        return duration;
    },

    measure<T>(label: string, fn: () => T): T {
        this.start(label);
        const result = fn();
        this.end(label);
        return result;
    }
};

// ==================== HIGHER ORDER COMPONENTS ====================

/**
 * HOC to add performance logging (dev only)
 */
export function withPerformanceLogging<P extends object>(
    Component: React.ComponentType<P>,
    componentName: string
): React.FC<P> {
    if (process.env.NODE_ENV !== 'development') {
        return Component as React.FC<P>;
    }

    return function PerformanceWrappedComponent(props: P) {
        const renderCount = React.useRef(0);
        renderCount.current++;

        React.useEffect(() => {
            console.log(`📊 ${componentName} rendered (count: ${renderCount.current})`);
        });

        return <Component {...props} />;
    };
}

/**
 * HOC to memoize with deep comparison
 */
export function memoWithDeepCompare<P extends object>(
    Component: React.ComponentType<P>
): React.MemoExoticComponent<React.ComponentType<P>> {
    return memo(Component, deepEqual);
}

export default {
    createSelector,
    useChartData,
    useDebouncedCallback,
    useThrottledCallback,
    createLazyComponent,
    shallowEqual,
    deepEqual,
    perfMonitor,
    withPerformanceLogging,
    memoWithDeepCompare
};
