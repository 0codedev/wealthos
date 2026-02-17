import { useEffect, useRef } from 'react';
import { ShortcutDefinition } from './useKeyboardShortcuts';

export interface LocalShortcutDefinition extends ShortcutDefinition {
    allowInInputs?: boolean;
}

export interface UseLocalShortcutsOptions {
    enabled?: boolean;
}

/**
 * useLocalShortcuts — Component-scoped keyboard shortcut listener.
 * Active only while the host component is mounted and enabled is true.
 */
export function useLocalShortcuts(
    shortcuts: LocalShortcutDefinition[],
    options: UseLocalShortcutsOptions = {}
): void {
    const { enabled = true } = options;
    const shortcutsRef = useRef(shortcuts);
    shortcutsRef.current = shortcuts;

    useEffect(() => {
        if (!enabled) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' ||
                            target.tagName === 'TEXTAREA' ||
                            target.tagName === 'SELECT' ||
                            target.isContentEditable;

            const matched = shortcutsRef.current.find(s => {
                if (s.disabled) return false;

                // Check input exception
                if (isInput && !s.allowInInputs) {
                    // Allow Ctrl+K or explicitly permitted shortcuts
                    const isSpecialKey = s.key.toLowerCase() === 'k' && (s.ctrlKey || s.metaKey);
                    if (!isSpecialKey) return false;
                }

                const isSpace = s.key === ' ' || s.key.toLowerCase() === 'space';
                const keyMatch = isSpace
                    ? (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space')
                    : event.key.toLowerCase() === s.key.toLowerCase();
                const ctrlMatch = !!s.ctrlKey === (event.ctrlKey || event.metaKey);
                const shiftMatch = !!s.shiftKey === event.shiftKey;
                const altMatch = !!s.altKey === event.altKey;

                return keyMatch && ctrlMatch && shiftMatch && altMatch;
            });

            if (matched) {
                event.preventDefault();
                event.stopPropagation();
                matched.action();
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [enabled]);
}
