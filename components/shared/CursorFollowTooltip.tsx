import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CustomTooltip, CustomTooltipProps } from './CustomTooltip';

/**
 * CursorFollowTooltip — SPRINT 1.2 "tooltip physics" fix.
 *
 * THE PROBLEM (user-reported): on pie/donut charts, moving between slices made
 * the tooltip unmount and re-mount, re-animating from the top-left corner every
 * time — a jarring visual jump instead of a smooth glide.
 *
 * THE FIX:
 *  - Renders through a PORTAL into document.body at fixed viewport coords that
 *    track the cursor via one shared passive mousemove listener.
 *  - The DOM node NEVER remounts while hovering the chart: values morph in place
 *    (React updates text nodes only), and hiding is an opacity fade — so moving
 *    slice→slice glides instead of teleporting.
 *  - rAF loop drives transform directly (no React re-render per frame).
 *  - pointer-events-none so it can never steal hover from the chart.
 *
 * USAGE (drop-in replacement inside any Recharts chart):
 *   <Tooltip content={<CursorFollowTooltip isPrivacyMode={x} />} isAnimationActive={false} />
 * IMPORTANT: pair with `isAnimationActive={false}` so recharts' own wrapper
 * animation doesn't fight the portal positioning.
 */

// Module-scoped cursor tracker: one listener for every chart instance.
let cursorX = 0;
let cursorY = 0;
let listenerAttached = false;

function ensureCursorListener() {
    if (listenerAttached || typeof window === 'undefined') return;
    listenerAttached = true;
    window.addEventListener('mousemove', (e) => {
        cursorX = e.clientX;
        cursorY = e.clientY;
    }, { passive: true });
}

export const CursorFollowTooltip: React.FC<CustomTooltipProps> = (props) => {
    ensureCursorListener();

    const nodeRef = useRef<HTMLDivElement>(null);
    // Hold last visible props so content morphs in place during slice transitions
    const lastVisibleProps = useRef<CustomTooltipProps | null>(null);

    const isActive = !!(props.active && props.payload && props.payload.length);
    if (isActive) {
        lastVisibleProps.current = props;
    }

    useEffect(() => {
        let raf = 0;
        const tick = () => {
            if (nodeRef.current) {
                const el = nodeRef.current;
                const w = el.offsetWidth || 220;
                const h = el.offsetHeight || 90;
                // Flip near right/bottom edges to stay on screen
                let x = cursorX + 16;
                let y = cursorY + 18;
                if (x + w > window.innerWidth - 12) x = cursorX - w - 14;
                if (y + h > window.innerHeight - 12) y = cursorY - h - 14;
                if (x < 8) x = 8;
                if (y < 8) y = 8;
                el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, []);

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            ref={nodeRef}
            aria-hidden="true"
            className="fixed left-0 top-0 z-[9999] pointer-events-none will-change-transform"
            style={{
                opacity: isActive ? 1 : 0,
                transition: 'opacity 130ms ease',
            }}
        >
            {/* Render last-known payload so DOM persists across slice gaps */}
            {lastVisibleProps.current ? <CustomTooltip {...lastVisibleProps.current} /> : null}
        </div>,
        document.body
    );
};

CursorFollowTooltip.displayName = 'CursorFollowTooltip';
