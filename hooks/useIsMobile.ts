import { useState, useEffect } from 'react';

export const useIsMobile = (breakpoint: number = 768) => {
    // FIRST-PAINT FIX: initialize from the real viewport synchronously.
    // The old `useState(false)` made phones render the desktop MainLayout
    // for one frame before flipping to MobileApp (visible flash on load).
    //
    // TIER ALIGNMENT: "mobile" is < 768px, so the MobileApp shell hands off
    // to MainLayout exactly at Tailwind's md: boundary (768px = tablet tier
    // per docs/MOBILE_HARDENING_PLAN.md). max-width: 767.98px avoids the
    // off-by-one where an iPad at exactly 768px got the phone shell while
    // every md: class inside it was already in desktop mode.
    const [isMobile, setIsMobile] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return window.innerWidth < breakpoint;
    });

    useEffect(() => {
        const mql = window.matchMedia(`(max-width: ${breakpoint - 0.02}px)`);

        // Resync when breakpoint prop changes
        setIsMobile(mql.matches);

        // matchMedia fires only on actual tier crossings - cheaper than resize
        const onChange = (e: MediaQueryListEvent) => {
            setIsMobile(e.matches);
        };

        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, [breakpoint]);

    return isMobile;
};
