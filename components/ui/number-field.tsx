import * as React from "react";
import { Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NumberFieldProps {
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  disabled?: boolean;
}

export const NumberField: React.FC<NumberFieldProps> = ({
  value,
  onChange,
  min = 0,
  max = Infinity,
  step = 1,
  prefix,
  suffix,
  className,
  disabled = false,
}) => {
  const increment = () => {
    if (value + step <= max) {
      onChange(Number((value + step).toFixed(4)));
    }
  };

  const decrement = () => {
    if (value - step >= min) {
      onChange(Number((value - step).toFixed(4)));
    }
  };

  return (
    <div
      className={cn(
        "flex items-center rounded-xl border border-white/10 bg-[#0E101A] overflow-hidden focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 transition-all",
        // Presets
        "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
        "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08]",
        "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
        "",
        className
      )}
    >
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={decrement}
        className="p-2.5 text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <Minus className="h-3 w-3" />
      </button>

      <div className="flex-1 flex items-center justify-center font-mono text-xs font-bold text-white px-2">
        {prefix && <span className="text-slate-500 mr-1">{prefix}</span>}
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full bg-transparent text-center outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        {suffix && <span className="text-slate-500 ml-1">{suffix}</span>}
      </div>

      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={increment}
        className="p-2.5 text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
};
NumberField.displayName = "NumberField";
