import { useRef, useState, useEffect, useCallback, MutableRefObject } from 'react';

/**
 * Agent CC5 — Cursor-tracking hook for reactive glassmorphic effects.
 *
 * Tracks the pointer position *inside* a ref'd element and reports a
 * normalized [-0.5, 0.5] coordinate pair plus a `0..1` "presence" signal
 * that fades to 0 when the cursor leaves the element.
 *
 * All updates use rAF batching and write to a ref-backed state, so the
 * consumer can choose between re-render-on-tick (intensity-aware styles)
 * or rAF-only direct DOM mutation (zero re-render path).
 *
 * Design intent:
 *  - Cards feel "lit" by the cursor, like a glass paperweight under a
 *    single overhead light. The specular highlight follows the pointer
 *    while a soft complementary shadow falls on the opposite edge.
 *  - Use sparingly — at most one or two instances visible at once.
 */

export interface CursorState {
  /** x in [-0.5, 0.5], left→right */
  x: number;
  /** y in [-0.5, 0.5], top→bottom */
  y: number;
  /** 0 (away) → 1 (over the element) */
  presence: number;
}

export interface UseCursorLightOptions {
  /** 0..1 — how quickly presence decays when the cursor leaves (per frame). 0.08 ≈ 200ms ease-out */
  presenceFalloff?: number;
  /** 0..1 — how quickly presence rises when the cursor enters. 0.18 ≈ 100ms ease-in */
  presenceRamp?: number;
}

export interface UseCursorLightReturn {
  ref: MutableRefObject<HTMLDivElement | null>;
  state: CursorState;
  /** CSS custom-property string to spread on style: `--cx: 0.12; --cy: -0.34; --cp: 0.87;` */
  cssVars: string;
}

const INITIAL: CursorState = { x: 0, y: 0, presence: 0 };

export function useCursorLight(options: UseCursorLightOptions = {}): UseCursorLightReturn {
  const { presenceFalloff = 0.08, presenceRamp = 0.18 } = options;

  const ref = useRef<HTMLDivElement | null>(null);
  // Keep mutable state in a ref to avoid re-renders on every pointermove.
  const liveRef = useRef<CursorState>({ ...INITIAL });
  // Counter used to force a re-render only when presence "snaps" past 0 or 1,
  // so consumers can still render `style` based on cssVars.
  const [, force] = useState(0);
  const rafRef = useRef<number | null>(null);

  const tick = useCallback(() => {
    rafRef.current = null;
    const el = ref.current;
    if (el) {
      // Read last pointer + presence
      const next = { ...liveRef.current };
      // Apply frame: presence moves toward 1 or 0 based on a flag.
      // We track "isOver" with a separate ref to avoid reading the DOM.
      const isOver = (el.dataset.__cc5Over === '1');
      const target = isOver ? 1 : 0;
      const rate = isOver ? presenceRamp : presenceFalloff;
      const delta = target - next.presence;
      next.presence = Math.abs(delta) < rate ? target : next.presence + Math.sign(delta) * rate;
      liveRef.current = next;
    }
    if (rafRef.current !== null || (ref.current && (Math.abs(liveRef.current.presence) > 0.0001))) {
      rafRef.current = requestAnimationFrame(tick);
    }
    force((n) => (n + 1) & 0xfff);
  }, [presenceFalloff, presenceRamp]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      liveRef.current = { ...liveRef.current, x, y };
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    const onEnter = () => {
      el.dataset.__cc5Over = '1';
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    const onLeave = () => {
      el.dataset.__cc5Over = '0';
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerenter', onEnter, { passive: true });
    el.addEventListener('pointerleave', onLeave, { passive: true });
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [tick]);

  const state = liveRef.current;
  const cssVars = `--cx:${state.x.toFixed(3)};--cy:${state.y.toFixed(3)};--cp:${state.presence.toFixed(3)};`;
  return { ref, state, cssVars };
}
