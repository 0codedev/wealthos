import { useEffect } from 'react';

type KeyCombo = string; // e.g., 'ctrl+k', 'shift+enter', 'esc'

export const useHotkeys = (keyCombo: KeyCombo, callback: (e: KeyboardEvent) => void) => {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const keys = keyCombo.toLowerCase().split('+');
            const mainKey = keys[keys.length - 1];

            const modifiers = {
                ctrl: event.ctrlKey || event.metaKey, // Treat Cmd as Ctrl on Mac
                shift: event.shiftKey,
                alt: event.altKey,
                meta: event.metaKey
            };

            const requiredModifiers = keys.slice(0, -1);

            const modifiersMatch = requiredModifiers.every(mod => {
                if (mod === 'ctrl' || mod === 'cmd') return modifiers.ctrl;
                if (mod === 'shift') return modifiers.shift;
                if (mod === 'alt') return modifiers.alt;
                return false;
            });

            // Ensure no extra modifiers are pressed (basic check)
            // For strict mode we might check !modifiers.shift if 'shift' isn't in required

            if (modifiersMatch && event.key.toLowerCase() === mainKey) {
                // Prevent default only if it's a browser shortcut override usually
                // But let the callback decide mostly.
                callback(event);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [keyCombo, callback]);
};
