import * as React from "react";
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DateRange {
  from?: Date;
  to?: Date;
}

export interface DateSelectorProps {
  value?: string;
  onChange: (rangeKey: string, customRange?: DateRange) => void;
  className?: string;
}

const PRESET_RANGES = [
  { key: "1D", label: "1D" },
  { key: "1W", label: "1W" },
  { key: "1M", label: "1M" },
  { key: "3M", label: "3M" },
  { key: "1Y", label: "1Y" },
  { key: "YTD", label: "YTD" },
  { key: "ALL", label: "ALL" },
];

export const DateSelector: React.FC<DateSelectorProps> = ({
  value = "1M",
  onChange,
  className,
}) => {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-xl p-1 bg-[#0E101A] border border-white/10 text-xs shadow-sm",
        // Presets
        "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
        "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08]",
        "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
        "",
        className
      )}
    >
      <div className="flex items-center gap-0.5">
        {PRESET_RANGES.map((range) => {
          const isActive = value === range.key;
          return (
            <button
              key={range.key}
              type="button"
              onClick={() => onChange(range.key)}
              className={cn(
                "px-2.5 py-1 rounded-lg font-mono text-[11px] font-bold transition-all",
                isActive
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
              )}
            >
              {range.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
DateSelector.displayName = "DateSelector";
