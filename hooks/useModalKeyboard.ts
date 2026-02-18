import { useEffect, useRef, useCallback } from 'react';

export interface UseModalKeyboardOptions {
    isOpen: boolean;
    onClose?: () => void;
    onSubmit?: () => void;
    onTabChange?: (tabIndex: number) => void;
    maxTabs?: number;
    autoFocus?: boolean;
}

/**
 * useModalKeyboard — Universal modal accessibility & keyboard shortcut hook.
 * Handles:
 * 1. Esc to close
 * 2. Focus trap (Tab / Shift+Tab cycling)
 * 3. Enter / Ctrl+Enter submit trigger (when not in a multiline textarea)
 * 4. Number keys (1..N) for tab switching when not typing in an input
 * 5. Auto-focusing first input on mount & returning focus on unmount
 */
export function useModalKeyboard({
    isOpen,
    onClose,
    onSubmit,
    onTabChange,
    maxTabs = 2,
    autoFocus = true
}: UseModalKeyboardOptions) {
    const modalRef = useRef<HTMLDivElement | null>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);

    // Save active element on open & restore on close
    useEffect(() => {
        if (isOpen) {
            previousFocusRef.current = document.activeElement as HTMLElement;

            if (autoFocus) {
                // Focus first input/button in modal on next tick
                const timer = setTimeout(() => {
                    if (!modalRef.current) return;
                    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
                        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
                    );
                    if (focusable.length > 0) {
                        focusable[0].focus();
                    }
                }, 50);
                return () => clearTimeout(timer);
            }
        } else {
            if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
                previousFocusRef.current.focus();
            }
        }
    }, [isOpen, autoFocus]);

    // Handle Keyboard events
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (!isOpen) return;

        const target = e.target as HTMLElement;
        const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
        const isTextarea = target.tagName === 'TEXTAREA';

        // 1. Esc key -> Close modal
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose?.();
            return;
        }

        // 2. Enter or Ctrl+Enter -> Submit
        if (e.key === 'Enter') {
            if (e.ctrlKey || e.metaKey || !isTextarea) {
                // Submit if Ctrl+Enter anywhere OR Enter in standard input/button
                if (onSubmit) {
                    e.preventDefault();
                    onSubmit();
                    return;
                }
            }
        }

        // 3. Tab trapping inside modal container
        if (e.key === 'Tab' && modalRef.current) {
            const focusables = Array.from(
                modalRef.current.querySelectorAll<HTMLElement>(
                    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                )
            ).filter(el => el.offsetWidth > 0 && el.offsetHeight > 0);

            if (focusables.length > 0) {
                const first = focusables[0];
                const last = focusables[focusables.length - 1];

                if (e.shiftKey) {
                    if (document.activeElement === first || !modalRef.current.contains(document.activeElement)) {
                        e.preventDefault();
                        last.focus();
                    }
                } else {
                    if (document.activeElement === last || !modalRef.current.contains(document.activeElement)) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            }
        }

        // 4. Number keys 1..N for Tab switching (Only when NOT inside text input fields)
        if (!isInput && onTabChange) {
            const num = parseInt(e.key, 10);
            if (!isNaN(num) && num >= 1 && num <= maxTabs) {
                e.preventDefault();
                onTabChange(num - 1); // 0-indexed
            }
        }
    }, [isOpen, onClose, onSubmit, onTabChange, maxTabs]);

    useEffect(() => {
        if (!isOpen) return;
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [isOpen, handleKeyDown]);

    return modalRef;
}
