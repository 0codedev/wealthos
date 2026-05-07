import * as React from "react";
import { cn } from "@/lib/utils";

export interface ToggleProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  variant?: "default" | "outline";
  size?: "sm" | "md" | "lg";
}

export const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(
  (
    {
      className,
      pressed: controlledPressed,
      onPressedChange,
      variant = "default",
      size = "md",
      onClick,
      children,
      ...props
    },
    ref
  ) => {
    const [uncontrolledPressed, setUncontrolledPressed] = React.useState(false);
    const isControlled = controlledPressed !== undefined;
    const isPressed = isControlled ? controlledPressed : uncontrolledPressed;

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      const next = !isPressed;
      if (!isControlled) setUncontrolledPressed(next);
      onPressedChange?.(next);
      onClick?.(e);
    };

    const sizeClasses = {
      sm: "h-8 px-2 text-xs",
      md: "h-9 px-3 text-xs",
      lg: "h-10 px-4 text-sm",
    };

    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={isPressed}
        onClick={handleClick}
        className={cn(
          "inline-flex items-center justify-center rounded-xl font-medium transition-all select-none",
          sizeClasses[size],
          variant === "default" && [
            isPressed
              ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
              : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white",
          ],
          variant === "outline" && [
            "border",
            isPressed
              ? "border-indigo-500 bg-indigo-500/20 text-indigo-300"
              : "border-white/10 bg-transparent text-slate-400 hover:border-white/20 hover:text-white",
          ],
          // Presets
          "[data-design-preset=wealthos-classic]_&:rounded-xl",
          "[data-design-preset=reui-nova]_&:rounded-xl [data-design-preset=reui-nova]_&:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
          "[data-design-preset=shadcn]_&:rounded-md",
          "",
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Toggle.displayName = "Toggle";
