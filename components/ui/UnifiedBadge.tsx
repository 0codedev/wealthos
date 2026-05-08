import * as React from "react";
import { useSettingsStore } from "../../store/settingsStore";
import { Badge as ReuiBadge } from "./reui/badge";
import { AstryxBadge } from "./astryx/badge";
import { cn } from "../../lib/utils";

export interface UnifiedBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info";
}

export const UnifiedBadge: React.FC<UnifiedBadgeProps> = ({
  className,
  variant = "default",
  children,
  ...props
}) => {
  const designPreset = useSettingsStore((s) => s.designPreset) || "wealthos-classic";

  // 1. Astryx Vertical
  if (designPreset === "astryx") {
    const astryxVariant =
      variant === "success"
        ? "success"
        : variant === "warning"
        ? "warning"
        : variant === "destructive"
        ? "error"
        : variant === "info"
        ? "cyan"
        : "neutral";

    return (
      <AstryxBadge variant={astryxVariant} className={className} {...props}>
        {children}
      </AstryxBadge>
    );
  }

  // 2. Pure ReUI / Shadcn Vertical
  if (designPreset === "reui-nova" || designPreset === "shadcn") {
    return (
      <ReuiBadge variant={variant as any} className={className} {...props}>
        {children}
      </ReuiBadge>
    );
  }

  // 3. WealthOS Classic Baseline (Default)
  const classicBadgeVariants: Record<string, string> = {
    default: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
    secondary: "bg-slate-800 text-slate-300 border-slate-700",
    destructive: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    outline: "border-slate-700 text-slate-300",
    success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    warning: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    info: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide backdrop-blur-sm",
        classicBadgeVariants[variant] || classicBadgeVariants.default,
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};
