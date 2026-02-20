import { useShallow } from 'zustand/react/shallow';
import type { UseBoundStore, StoreApi } from 'zustand';

/**
 * Wraps a zustand selector with useShallow so consumers only re-render
 * when the *selected* slice changes. Use this for selectors that return
 * an object or array, where reference equality would otherwise force a
 * re-render on every store update.
 *
 * @example
 *   const { investments, stats } = useShallowStore(
 *     usePortfolioStore,
 *     s => ({ investments: s.investments, stats: s.stats })
 *   );
 */
export function useShallowStore<T, U>(
  store: UseBoundStore<StoreApi<T>>,
  selector: (state: T) => U,
): U {
  return store(useShallow(selector));
}
