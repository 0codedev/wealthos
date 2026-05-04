import * as React from "react";
import { cn } from "@/lib/utils";

export interface FrameProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  showDots?: boolean;
  actions?: React.ReactNode;
}

export const Frame = React.forwardRef<HTMLDivElement, FrameProps>(
  ({ className, title, showDots = true, actions, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-2xl border border-white/10 bg-[#0E101A] overflow-hidden shadow-2xl transition-all",
          // Presets
          "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
          "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08] [data-design-preset=reui-nova]_&:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
          "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-lg",
          "",
          className
        )}
        {...props}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            {showDots && (
              <div className="flex items-center gap-1.5 mr-2">
                <div className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
                <div className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
              </div>
            )}
            {title && (
              <span className="text-xs font-bold text-slate-300 font-mono">
                {title}
              </span>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
        <div className="p-4">{children}</div>
      </div>
    );
  }
);
Frame.displayName = "Frame";
