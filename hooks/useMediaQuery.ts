import { useState, useEffect } from 'react';

/**
 * Custom hook to detect if a CSS media query matches.
 * Defaults to false on initial render to prevent hydration mismatches,
 * but immediately updates on mount.
 */
export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(false);

    useEffect(() => {
        const media = window.matchMedia(query);
        // Set initial value
        if (media.matches !== matches) {
            setMatches(media.matches);
        }

        // Listener for changes
        const listener = () => setMatches(media.matches);

        // Modern browsers
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', listener);
        } else {
            // Older browsers (Safari < 14)
            media.addListener(listener);
        }

        return () => {
            if (typeof media.removeEventListener === 'function') {
                media.removeEventListener('change', listener);
            } else {
                media.removeListener(listener);
            }
        };
    }, [matches, query]);

    return matches;
}

export function useIsMobile(): boolean {
    // 768px is the standard md tailwind breakpoint
    return useMediaQuery('(max-width: 768px)');
}
