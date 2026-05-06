import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  dotColor?: string;
}

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, value, onChange, label, ...props }, ref) => {
    return (
      <div className="relative inline-block w-full">
        {label && (
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            {label}
          </span>
        )}
        <div className="relative flex items-center">
          <select
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
              "h-9 w-full appearance-none rounded-[8px] border border-white/10 bg-[#0E101A] px-3 pr-8 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-all cursor-pointer",
              // Presets
              "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
              "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08]",
              "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
              "",
              className
            )}
            {...props}
          >
            {options.map((opt) => (
              <option
                key={opt.value}
                value={opt.value}
                className="bg-[#0D0E18] text-slate-200 py-1"
              >
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
        </div>
      </div>
    );
  }
);
Select.displayName = "Select";
