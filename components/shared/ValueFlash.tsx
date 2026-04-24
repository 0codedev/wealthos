/**
 * ValueFlash — CC46
 *
 * Wraps a value to pulse its background when the value changes.
 * - 600ms color pulse on change
 * - Emerald tint when the new value is greater than the previous
 * - Rose tint when the new value is less than the previous
 * - Honors `prefers-reduced-motion` (no flash, no transition)
 */
import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const useReducedMotion = (): boolean => {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

export interface ValueFlashProps {
  value: number;
  /** Children rendered inside the flash wrapper. */
  children: React.ReactNode;
  className?: string;
  /** Round the threshold; values within `epsilon` are considered unchanged. */
  epsilon?: number;
}

export const ValueFlash: React.FC<ValueFlashProps> = ({
  value,
  children,
  className,
  epsilon = 0,
}) => {
  const reduced = useReducedMotion();
  const prevRef = useRef<number>(value);
  const [pulseKey, setPulseKey] = useState<number>(0);
  const [pulseColor, setPulseColor] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (Math.abs(value - prev) <= epsilon) return;
    if (value > prev) setPulseColor("up");
    else if (value < prev) setPulseColor("down");
    setPulseKey((k) => k + 1);
    prevRef.current = value;
  }, [value, epsilon]);

  const bgClass =
    pulseColor === "up"
      ? "bg-emerald-500/15"
      : pulseColor === "down"
      ? "bg-rose-500/15"
      : "bg-transparent";

  if (reduced) {
    return <span className={className}>{children}</span>;
  }

  return (
    <span
      className={className}
      style={{ position: "relative", display: "inline-block" }}
    >
      <AnimatePresence>
        {pulseKey > 0 && (
          <motion.span
            key={pulseKey}
            aria-hidden
            className={`${bgClass} pointer-events-none absolute inset-0 rounded`}
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            style={{ zIndex: 0 }}
          />
        )}
      </AnimatePresence>
      <span style={{ position: "relative", zIndex: 1 }}>{children}</span>
    </span>
  );
};

export default ValueFlash;
