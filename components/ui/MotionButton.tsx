/**
 * MotionButton — CC46
 *
 * Drop-in <button> replacement with framer-motion interactions:
 *   - whileHover: y -1 (subtle lift)
 *   - whileTap:   scale 0.97
 *   - Built-in loading state (spinner replaces the leading icon)
 *   - variant / size / icon / trailingIcon props
 *
 * Public API: a small, additive <MotionButton> that accepts every
 * native <button> prop plus a few extras (variant, size, loading,
 * icon, trailingIcon). The class lookup table keeps Tailwind soup
 * out of call sites.
 */
import React, { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { Loader2 } from "lucide-react";

export type MotionButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type MotionButtonSize = "sm" | "md" | "lg";

export interface MotionButtonProps
  extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: MotionButtonVariant;
  size?: MotionButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  children?: React.ReactNode;
  /** Optional className passthrough for layout-level overrides. */
  className?: string;
}

const SIZE_CLASSES: Record<MotionButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-md",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-12 px-5 text-base gap-2.5 rounded-xl",
};

const VARIANT_CLASSES: Record<MotionButtonVariant, string> = {
  primary:
    "bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-indigo-400/60",
  secondary:
    "bg-slate-200 text-slate-900 hover:bg-slate-300 active:bg-slate-400 disabled:bg-slate-200/60 " +
    "dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 dark:active:bg-slate-900",
  ghost:
    "bg-transparent text-slate-700 hover:bg-slate-100 active:bg-slate-200 " +
    "dark:text-slate-200 dark:hover:bg-slate-800 dark:active:bg-slate-900",
  danger:
    "bg-rose-600 text-white shadow-sm hover:bg-rose-500 active:bg-rose-700 disabled:bg-rose-400/60",
};

const ICON_SIZE: Record<MotionButtonSize, number> = {
  sm: 14,
  md: 16,
  lg: 18,
};

const cn = (...parts: Array<string | false | undefined | null>) =>
  parts.filter(Boolean).join(" ");

export const MotionButton = forwardRef<HTMLButtonElement, MotionButtonProps>(
  function MotionButton(
    {
      variant = "primary",
      size = "md",
      loading = false,
      icon,
      trailingIcon,
      className,
      children,
      disabled,
      type = "button",
      ...rest
    },
    ref
  ) {
    const isDisabled = disabled || loading;
    const base =
      "btn relative inline-flex items-center justify-center font-medium select-none " +
      "transition-colors duration-150 focus-visible:outline-none " +
      "disabled:opacity-60 disabled:cursor-not-allowed";
    const classes = cn(
      base,
      SIZE_CLASSES[size],
      VARIANT_CLASSES[variant],
      className
    );

    return (
      <motion.button
        ref={ref}
        type={type}
        className={classes}
        disabled={isDisabled}
        whileHover={isDisabled ? undefined : { y: -1 }}
        whileTap={isDisabled ? undefined : { scale: 0.97 }}
        transition={{ type: "spring", stiffness: 500, damping: 30, mass: 0.5 }}
        {...rest}
      >
        {loading ? (
          <Loader2 size={ICON_SIZE[size]} className="animate-spin" />
        ) : icon ? (
          <span className="inline-flex items-center" aria-hidden>
            {icon}
          </span>
        ) : null}
        {children != null && <span>{children}</span>}
        {trailingIcon && !loading ? (
          <span className="inline-flex items-center" aria-hidden>
            {trailingIcon}
          </span>
        ) : null}
      </motion.button>
    );
  }
);

export default MotionButton;
