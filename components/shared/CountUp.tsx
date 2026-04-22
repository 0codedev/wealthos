/**
 * CountUp — CC46
 *
 * Animate an integer/decimal value from `previous` to `value` over `duration` ms.
 * Uses requestAnimationFrame with an ease-out cubic curve. Honors
 * `prefers-reduced-motion` by rendering the final value instantly. Applies
 * `font-variant-numeric: tabular-nums` by default so digits don't reflow.
 */
import React, { useEffect, useRef, useState } from "react";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

const useReducedMotion = (): boolean => {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  return mq.matches;
};

export interface CountUpProps {
  value: number;
  previous?: number;
  duration?: number; // ms
  format?: (n: number) => string;
  className?: string;
  /** If true, do not start the animation from `previous`; start from 0. */
  startFromZero?: boolean;
  /** Decimal places to round the displayed value to (default 0). */
  decimals?: number;
  /** Optional aria-label override; defaults to formatted value. */
  ariaLabel?: string;
}

export const CountUp: React.FC<CountUpProps> = ({
  value,
  previous,
  duration = 600,
  format,
  className,
  startFromZero = false,
  decimals = 0,
  ariaLabel,
}) => {
  const reduced = useReducedMotion();
  const startValueRef = useRef<number>(previous ?? (startFromZero ? 0 : value));
  const [display, setDisplay] = useState<number>(
    reduced ? value : (previous ?? (startFromZero ? 0 : value))
  );
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }
    const from = startValueRef.current;
    const to = value;
    if (from === to) {
      setDisplay(to);
      return;
    }
    const startedAt = performance.now();
    const step = (now: number) => {
      const elapsed = now - startedAt;
      const t = Math.min(1, elapsed / duration);
      const eased = easeOutCubic(t);
      const current = from + (to - from) * eased;
      const rounded = decimals > 0
        ? Number(current.toFixed(decimals))
        : Math.round(current);
      setDisplay(rounded);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(to);
        startValueRef.current = to;
      }
    };
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration, reduced, decimals]);

  const formatted = format ? format(display) : display.toLocaleString();

  return (
    <span
      className={className}
      style={{
        fontVariantNumeric: "tabular-nums",
        fontFeatureSettings: '"tnum" 1, "lnum" 1',
      }}
      aria-label={ariaLabel ?? (format ? format(value) : value.toString())}
    >
      {formatted}
    </span>
  );
};

export default CountUp;
