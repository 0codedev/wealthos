import { useState, useEffect } from 'react';

export interface Breakpoints {
    isMobile: boolean;
    isTablet: boolean;
    isDesktop: boolean;
    active: 'mobile' | 'tablet' | 'desktop';
}

export const useBreakpoint = (): Breakpoints => {
    const [breakpoints, setBreakpoints] = useState<Breakpoints>({
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        active: 'desktop',
    });

    useEffect(() => {
        const checkBreakpoints = () => {
            const width = window.innerWidth;
            const isMobile = width < 768;
            const isTablet = width >= 768 && width < 1024;
            const isDesktop = width >= 1024;
            
            const active = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';

            setBreakpoints({
                isMobile,
                isTablet,
                isDesktop,
                active,
            });
        };

        // Run on mount
        checkBreakpoints();

        // Listen for window resize
        window.addEventListener('resize', checkBreakpoints);

        return () => {
            window.removeEventListener('resize', checkBreakpoints);
        };
    }, []);

    return breakpoints;
};
