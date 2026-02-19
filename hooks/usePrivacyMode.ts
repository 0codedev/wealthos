import { useState, useEffect, useCallback, useRef } from 'react';

export type PrivacyLevel = 'OFF' | 'MASKED' | 'PERCENTAGE' | 'CAMOUFLAGE';

const PRIVACY_KEY = 'wealth_privacy_level';

/**
 * usePrivacyMode - Direct Clean Privacy Shutter Engine.
 *
 * Tiers:
 * 1. OFF: Normal visibility
 * 2. MASKED: Numbers masked (••••••) & CSS blurred
 */
export function usePrivacyMode() {
    const [privacyLevel, setPrivacyLevelState] = useState<PrivacyLevel>(() => {
        if (typeof window === 'undefined') return 'OFF';
        const saved = localStorage.getItem(PRIVACY_KEY);
        if (saved === 'MASKED' || saved === 'PERCENTAGE' || saved === 'CAMOUFLAGE') {
            return 'MASKED';
        }
        if (saved === 'OFF') return 'OFF';
        // Fallback for legacy boolean
        return localStorage.getItem('wealth_privacy_mode') === 'true' ? 'MASKED' : 'OFF';
    });

    const isTabHiddenRef = useRef<boolean>(
        typeof document !== 'undefined' ? document.hidden : false
    );

    const setPrivacyLevel = useCallback((level: PrivacyLevel) => {
        setPrivacyLevelState(level);
        localStorage.setItem(PRIVACY_KEY, level);
        localStorage.setItem('wealth_privacy_mode', level !== 'OFF' ? 'true' : 'false');
        window.dispatchEvent(new CustomEvent('privacy-mode-changed', { detail: { level, active: level !== 'OFF' } }));
    }, []);

    const togglePrivacyMode = useCallback(() => {
        setPrivacyLevelState(prev => {
            const nextLevel: PrivacyLevel = prev === 'OFF' ? 'MASKED' : 'OFF';
            localStorage.setItem(PRIVACY_KEY, nextLevel);
            localStorage.setItem('wealth_privacy_mode', nextLevel !== 'OFF' ? 'true' : 'false');
            window.dispatchEvent(new CustomEvent('privacy-mode-changed', { detail: { level: nextLevel, active: nextLevel !== 'OFF' } }));
            return nextLevel;
        });
    }, []);

    const cyclePrivacyMode = useCallback(() => {
        togglePrivacyMode();
    }, [togglePrivacyMode]);

    const enablePrivacyMode = useCallback(() => {
        setPrivacyLevel('MASKED');
    }, [setPrivacyLevel]);

    const disablePrivacyMode = useCallback(() => {
        setPrivacyLevel('OFF');
    }, [setPrivacyLevel]);

    // CC12 — visibility / window-blur auto-blur.
    useEffect(() => {
        if (typeof document === 'undefined') return;

        const handleVisibility = () => {
            isTabHiddenRef.current = document.hidden;
            document.body.classList.toggle('tab-hidden', document.hidden);
        };
        const handleWindowBlur = () => {
            isTabHiddenRef.current = true;
            document.body.classList.add('tab-hidden');
        };
        const handleWindowFocus = () => {
            isTabHiddenRef.current = document.hidden;
            document.body.classList.remove('tab-hidden');
        };

        document.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('blur', handleWindowBlur);
        window.addEventListener('focus', handleWindowFocus);

        if (document.hidden) {
            document.body.classList.add('tab-hidden');
        }

        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('blur', handleWindowBlur);
            window.removeEventListener('focus', handleWindowFocus);
        };
    }, []);

    // Apply class to body
    useEffect(() => {
        if (typeof document === 'undefined') return;
        document.body.classList.toggle('privacy-mode', privacyLevel !== 'OFF');
        document.body.classList.toggle('privacy-masked', privacyLevel === 'MASKED');
        document.body.classList.toggle('privacy-percentage', privacyLevel === 'PERCENTAGE');
        document.body.classList.toggle('privacy-camouflage', privacyLevel === 'CAMOUFLAGE');
    }, [privacyLevel]);

    return {
        isPrivacyMode: privacyLevel !== 'OFF',
        privacyLevel,
        togglePrivacyMode,
        cyclePrivacyMode,
        setPrivacyLevel,
        enablePrivacyMode,
        disablePrivacyMode,
        isTabHidden: isTabHiddenRef.current
    };
}
