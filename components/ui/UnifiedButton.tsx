import * as React from "react";
import { useSettingsStore } from "../../store/settingsStore";
import { Button as ReuiButton } from "./reui/button";
import { AstryxButton } from "./astryx/button";
import { cn } from "../../lib/utils";

export interface UnifiedButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "destructive" | "ghost" | "outline";
  size?: "default" | "sm" | "lg" | "xs";
}

export const UnifiedButton = React.forwardRef<HTMLButtonElement, UnifiedButtonProps>(
  ({ className, variant = "primary", size = "default", ...props }, ref) => {
    const designPreset = useSettingsStore((s) => s.designPreset) || "wealthos-classic";

    // 1. Astryx Vertical
    if (designPreset === "astryx") {
      const astryxVariant =
        variant === "primary" ? "primary" : variant === "destructive" ? "danger" : variant === "ghost" ? "ghost" : "secondary";
      const astryxSize = size === "sm" || size === "xs" ? "sm" : size === "lg" ? "lg" : "default";

      return (
        <AstryxButton
          ref={ref}
          variant={astryxVariant}
          size={astryxSize}
          className={className}
          {...props}
        />
      );
    }

    // 2. Pure ReUI / Shadcn Vertical
    if (designPreset === "reui-nova" || designPreset === "shadcn") {
      const reuiVariant =
        variant === "primary"
          ? "default"
          : variant === "destructive"
          ? "destructive"
          : variant === "ghost"
          ? "ghost"
          : variant === "outline"
          ? "outline"
          : "secondary";
      const reuiSize = size === "xs" ? "xs" : size === "sm" ? "sm" : size === "lg" ? "lg" : "default";

      return (
        <ReuiButton
          ref={ref}
          variant={reuiVariant}
          size={reuiSize}
          className={className}
          {...props}
        />
      );
    }

    // 3. WealthOS Classic Baseline (Default)
    const classicVariants: Record<string, string> = {
      primary: "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 font-bold",
      secondary: "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold",
      destructive: "bg-rose-600 hover:bg-rose-500 text-white font-bold",
      ghost: "bg-transparent hover:bg-slate-800/60 text-slate-300 font-medium",
      outline: "border border-slate-700 hover:border-slate-600 text-slate-200 font-medium",
    };

    const classicSizes: Record<string, string> = {
      default: "h-9 px-4 text-xs rounded-xl",
      sm: "h-7 px-3 text-[11px] rounded-lg",
      xs: "h-6 px-2 text-[10px] rounded-md",
      lg: "h-11 px-6 text-sm rounded-2xl",
    };

    return (
      <button
        ref={ref}
        type={props.type || "button"}
        className={cn(
          "inline-flex items-center justify-center transition-all duration-200 disabled:opacity-50 active:scale-95",
          classicVariants[variant] || classicVariants.primary,
          classicSizes[size] || classicSizes.default,
          className
        )}
        {...props}
      />
    );
  }
);
UnifiedButton.displayName = "UnifiedButton";
