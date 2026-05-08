import * as React from "react";
import { useSettingsStore } from "../../store/settingsStore";
import { Card as ReuiCard } from "./reui/card";
import { AstryxCard } from "./astryx/card";
import { cn } from "../../lib/utils";

export interface UnifiedCardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
}

export const UnifiedCard = React.forwardRef<HTMLDivElement, UnifiedCardProps>(
  ({ className, elevated = false, ...props }, ref) => {
    const designPreset = useSettingsStore((s) => s.designPreset) || "wealthos-classic";

    // 1. Astryx Vertical
    if (designPreset === "astryx") {
      return <AstryxCard ref={ref} className={className} {...props} />;
    }

    // 2. Pure ReUI / Shadcn Vertical
    if (designPreset === "reui-nova" || designPreset === "shadcn") {
      return <ReuiCard ref={ref} className={className} {...props} />;
    }

    // 3. WealthOS Classic Baseline (Default)
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 shadow-xl backdrop-blur-xl transition-all duration-300",
          elevated && "bg-slate-900/90 shadow-2xl border-slate-700/80",
          className
        )}
        {...props}
      />
    );
  }
);
UnifiedCard.displayName = "UnifiedCard";
