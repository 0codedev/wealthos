import { useEffect, useRef } from 'react';

type UnsubscribeFn = () => void;

/**
 * useSafeSubscription - Institutional lifecycle-bound subscription manager (WP07).
 * Ensures that store listeners, WebSocket handlers, and event listeners are deterministically
 * unsubscribed on component unmount, preventing V8 memory leaks and detached closures.
 *
 * @param setup Callback returning an unsubscribe function, array of unsubscribe functions, or void
 * @param deps React dependency array
 */
export function useSafeSubscription(
    setup: () => UnsubscribeFn | UnsubscribeFn[] | void,
    deps: React.DependencyList = []
): void {
    const unsubsRef = useRef<UnsubscribeFn[]>([]);

    useEffect(() => {
        const result = setup();

        if (typeof result === 'function') {
            unsubsRef.current = [result];
        } else if (Array.isArray(result)) {
            unsubsRef.current = result.filter((fn): fn is UnsubscribeFn => typeof fn === 'function');
        } else {
            unsubsRef.current = [];
        }

        return () => {
            unsubsRef.current.forEach((unsub) => {
                try {
                    unsub();
                } catch (err) {
                    console.error('[useSafeSubscription] Error during teardown:', err);
                }
            });
            unsubsRef.current = [];
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}
