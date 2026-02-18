import { useRef, useState, useEffect, useCallback, MutableRefObject } from 'react';

/**
 * Agent CC5 — Magnetic-pull hook for primary CTAs.
 *
 * When the pointer is within `radius` pixels of the button's center,
 * the button translates toward the cursor (clamped to `strength`).
 * On release, springs back to (0,0).
 *
 * Uses a single rAF loop, writes the transform via `style.transform`
 * directly (bypassing React) to keep 60fps even on lower-end devices.
 * Only re-renders when the "isOver" state actually toggles, so a
 * parent that reads `state` won't thrash.
 */

export interface MagneticState {
  isOver: boolean;
  /** 0..1 intensity, mirrors how close the cursor is to center. */
  intensity: number;
}

export interface UseMagneticButtonOptions {
  /** Pixels — activation radius. */
  radius?: number;
  /** 0..1 — max translation as a fraction of radius. */
  strength?: number;
  /** CSS transition applied on release (e.g. 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)'). */
  releaseTransition?: string;
}

export interface UseMagneticButtonReturn {
  ref: MutableRefObject<HTMLButtonElement | HTMLDivElement | null>;
  style: React.CSSProperties;
  state: MagneticState;
}

const NEUTRAL: MagneticState = { isOver: false, intensity: 0 };

export function useMagneticButton(options: UseMagneticButtonOptions = {}): UseMagneticButtonReturn {
  const {
    radius = 80,
    strength = 0.35,
    releaseTransition = 'transform 600ms cubic-bezier(0.34, 1.56, 0.64, 1)',
  } = options;

  const ref = useRef<HTMLButtonElement | HTMLDivElement | null>(null);
  const [state, setState] = useState<MagneticState>(NEUTRAL);
  const rafRef = useRef<number | null>(null);
  const liveRef = useRef<{ tx: number; ty: number; over: boolean }>({ tx: 0, ty: 0, over: false });

  const tick = useCallback(() => {
    rafRef.current = null;
    const el = ref.current;
    if (!el) return;
    const { tx, ty, over } = liveRef.current;
    // Apply direct DOM transform (no React render).
    el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
    if (over) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, []);

  const handleMove = useCallback((e: PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < radius) {
      const factor = (1 - dist / radius) * strength;
      const tx = dx * factor;
      const ty = dy * factor;
      liveRef.current = { tx, ty, over: true };
      el.style.transition = 'transform 120ms ease-out';
      const intensity = Math.max(0, Math.min(1, 1 - dist / radius));
      setState((prev) => (prev.isOver && Math.abs(prev.intensity - intensity) < 0.02 ? prev : { isOver: true, intensity }));
    } else {
      liveRef.current = { tx: 0, ty: 0, over: false };
      el.style.transition = releaseTransition;
      el.style.transform = 'translate3d(0px, 0px, 0)';
      setState((prev) => (prev.isOver ? NEUTRAL : prev));
    }
    if (rafRef.current === null && liveRef.current.over) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [radius, strength, releaseTransition, tick]);

  const handleEnter = useCallback(() => {
    setState((prev) => (prev.isOver ? prev : { isOver: true, intensity: prev.intensity }));
  }, []);
  const handleLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    liveRef.current = { tx: 0, ty: 0, over: false };
    el.style.transition = releaseTransition;
    el.style.transform = 'translate3d(0px, 0px, 0)';
    setState(NEUTRAL);
  }, [releaseTransition]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.willChange = 'transform';
    const onMove = (e: Event) => handleMove(e as PointerEvent);
    const onEnter = () => handleEnter();
    const onLeave = () => handleLeave();
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerenter', onEnter, { passive: true });
    el.addEventListener('pointerleave', onLeave, { passive: true });
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [handleMove, handleEnter, handleLeave]);

  // External style for the wrapper — needed to keep the parent's transform
  // space preserved (the button itself moves, not its container).
  return { ref, style: {}, state };
}
