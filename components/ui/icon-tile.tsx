import * as React from "react";
import { cn } from "@/lib/utils";

export interface IconTileProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string;
  description?: string;
  badge?: string;
  variant?: "default" | "active" | "ghost";
}

export const IconTile = React.forwardRef<HTMLButtonElement, IconTileProps>(
  ({ className, icon, label, description, badge, variant = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "relative flex flex-col items-center justify-center p-3 rounded-2xl border text-center transition-all group",
          variant === "default" && "border-white/10 bg-[#0E101A] hover:border-indigo-500/40 hover:bg-white/[0.04]",
          variant === "active" && "border-indigo-500 bg-indigo-500/10 text-indigo-300",
          variant === "ghost" && "border-transparent bg-transparent hover:bg-white/5",
          // Presets
          "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
          "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08] [data-design-preset=reui-nova]_&:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
          "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-lg",
          "",
          className
        )}
        {...props}
      >
        {badge && (
          <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-indigo-600 text-white text-[9px] font-mono font-bold">
            {badge}
          </span>
        )}
        <div className="p-2.5 rounded-xl bg-white/5 text-indigo-400 group-hover:scale-110 transition-transform mb-1.5">
          {icon}
        </div>
        <span className="text-xs font-bold text-slate-200">{label}</span>
        {description && (
          <span className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">
            {description}
          </span>
        )}
      </button>
    );
  }
);
IconTile.displayName = "IconTile";
