import { useEffect, useRef } from 'react';

export interface ShortcutDefinition {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean; // Cmd on Mac
  shiftKey?: boolean;
  altKey?: boolean;
  description: string;
  category: string;
  action: () => void;
  disabled?: boolean;
  allowInInputs?: boolean;
}

/**
 * useKeyboardShortcuts - Registers global keyboard event listeners.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutDefinition[]): void {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || 
                      target.tagName === 'TEXTAREA' || 
                      target.tagName === 'SELECT' ||
                      target.isContentEditable;

      // Find matching shortcut
      const matched = shortcutsRef.current.find(s => {
        if (s.disabled) return false;

        // Input exception check
        if (isInput && !s.allowInInputs) {
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

      // Execute action
      if (matched) {
        event.preventDefault();
        matched.action();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
