/**
 * CC110 — useDebouncedValue hook.
 *
 * Returns `value` after it has been stable for `delay` ms. Used by every
 * search input to avoid re-running expensive filter/lookup logic on every
 * keystroke.
 *
 * Example:
 *   const [raw, setRaw] = useState('');
 *   const debounced = useDebouncedValue(raw, 200);
 *   useEffect(() => { runSearch(debounced); }, [debounced]);
 */
import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delay = 200): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(t);
    }, [value, delay]);
    return debounced;
}

export default useDebouncedValue;
