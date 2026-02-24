/**
 * CC103 — `useRovingTabIndex` keyboard navigation hook.
 *
 * Implements the W3C "roving tabindex" pattern used by production menu and
 * tab implementations. The pattern is:
 *   - The container is a single tab stop (only one child has `tabIndex=0`,
 *     the rest have `tabIndex=-1`).
 *   - Arrow keys move focus among siblings without leaving the widget.
 *   - Home/End jump to the first/last item.
 *   - Tab moves focus OUT of the widget (no nested tab stops).
 *   - Optional wraparound (default: wrap on).
 *
 * Why this matters:
 *   The default browser behavior for a list of focusable buttons is to
 *   Tab through each one. On a 12-tab sub-tab strip, that means the user
 *   has to press Tab 12 times to escape. Production apps (Material UI,
 *   Radix UI, Adobe Spectrum) all use roving tabindex for any grouped
 *   list of focusable items.
 *
 * Example:
 *   const containerRef = useRef<HTMLDivElement>(null);
 *   useRovingTabIndex(containerRef, { itemSelector: '[role="tab"]' });
 *   <div ref={containerRef}>...
 */

import { useEffect, useRef } from 'react';

export interface RovingTabIndexOptions {
    /** CSS selector for focusable items. Default: button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]) */
    itemSelector?: string;
    /** Whether arrow navigation wraps around. Default true. */
    wrap?: boolean;
    /** Whether horizontal arrows are used (Left/Right). Default true. */
    horizontal?: boolean;
    /** Whether vertical arrows are used (Up/Down). Default true. */
    vertical?: boolean;
    /** Disable the hook entirely (e.g. when the widget is not yet mounted). */
    disabled?: boolean;
}

const DEFAULT_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useRovingTabIndex<T extends HTMLElement = HTMLElement>(
    containerRef: React.RefObject<T>,
    options: RovingTabIndexOptions = {}
): void {
    const {
        itemSelector = DEFAULT_SELECTOR,
        wrap = true,
        horizontal = true,
        vertical = true,
        disabled = false,
    } = options;

    // Persist the currently-focused item across re-renders.
    const activeIndexRef = useRef<number>(0);

    useEffect(() => {
        if (disabled) return;
        const container = containerRef.current;
        if (!container) return;

        const items = (): HTMLElement[] =>
            Array.from(container.querySelectorAll<HTMLElement>(itemSelector));

        const focusItem = (idx: number) => {
            const list = items();
            if (list.length === 0) return;
            const safe = (idx + list.length) % list.length;
            const final = wrap ? safe : Math.max(0, Math.min(list.length - 1, idx));
            list[final]?.focus();
            activeIndexRef.current = final;
        };

        // Initialize the tabindex state on mount: first item 0, rest -1.
        const init = () => {
            const list = items();
            list.forEach((el, i) => {
                el.setAttribute('tabindex', i === 0 ? '0' : '-1');
            });
        };
        init();

        // Mutation observer keeps the tabindex in sync if items are added
        // or removed dynamically (e.g. a "+ Add tab" button).
        const observer = new MutationObserver(() => {
            const list = items();
            const active = list[activeIndexRef.current];
            list.forEach((el, i) => {
                if (el === active) {
                    el.setAttribute('tabindex', '0');
                } else if (el.getAttribute('tabindex') !== '-1') {
                    el.setAttribute('tabindex', '-1');
                }
            });
        });
        observer.observe(container, { childList: true, subtree: true });

        const onKeyDown = (e: KeyboardEvent) => {
            const list = items();
            if (list.length === 0) return;
            const activeEl = document.activeElement as HTMLElement | null;
            if (!activeEl || !container.contains(activeEl)) return;
            const idx = list.indexOf(activeEl);
            if (idx === -1) return;

            let next: number | null = null;
            if (horizontal && e.key === 'ArrowRight') next = idx + 1;
            else if (horizontal && e.key === 'ArrowLeft') next = idx - 1;
            else if (vertical && e.key === 'ArrowDown') next = idx + 1;
            else if (vertical && e.key === 'ArrowUp') next = idx - 1;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = list.length - 1;

            if (next !== null) {
                e.preventDefault();
                focusItem(next);
            }
        };

        const onFocusIn = (e: FocusEvent) => {
            const list = items();
            const target = e.target as HTMLElement | null;
            if (!target || !container.contains(target)) return;
            const idx = list.indexOf(target);
            if (idx === -1) return;
            activeIndexRef.current = idx;
            list.forEach((el, i) => {
                el.setAttribute('tabindex', i === idx ? '0' : '-1');
            });
        };

        container.addEventListener('keydown', onKeyDown);
        container.addEventListener('focusin', onFocusIn);

        return () => {
            observer.disconnect();
            container.removeEventListener('keydown', onKeyDown);
            container.removeEventListener('focusin', onFocusIn);
        };
    }, [containerRef, itemSelector, wrap, horizontal, vertical, disabled]);
}

export default useRovingTabIndex;
