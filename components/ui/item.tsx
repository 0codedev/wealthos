import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  showChevron?: boolean;
}

export const Item = React.forwardRef<HTMLDivElement, ItemProps>(
  (
    {
      className,
      leading,
      title,
      subtitle,
      trailing,
      onClick,
      showChevron = false,
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        onClick={onClick}
        className={cn(
          "flex items-center justify-between p-3 rounded-xl border border-white/5 bg-white/[0.02] text-slate-100 transition-all",
          onClick && "cursor-pointer hover:bg-white/[0.05] hover:border-white/10",
          // Presets
          "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/5",
          "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.06]",
          "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
          "",
          className
        )}
        {...props}
      >
        <div className="flex items-center gap-3 min-w-0">
          {leading && <div className="shrink-0">{leading}</div>}
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-100 truncate">
              {title}
            </div>
            {subtitle && (
              <div className="text-[11px] text-slate-500 truncate mt-0.5">
                {subtitle}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-3">
          {trailing}
          {showChevron && (
            <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" />
          )}
        </div>
      </div>
    );
  }
);
Item.displayName = "Item";
