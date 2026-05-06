import * as React from "react";
import { Circle } from "lucide-react";
import { cn } from "@/lib/utils";

interface RadioGroupContextType {
  value: string;
  onChange: (value: string) => void;
  name?: string;
}

const RadioGroupContext = React.createContext<RadioGroupContextType | null>(null);

export interface RadioGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  onValueChange: (value: string) => void;
  name?: string;
}

export const RadioGroup = React.forwardRef<HTMLDivElement, RadioGroupProps>(
  ({ className, value, onValueChange, name, children, ...props }, ref) => {
    return (
      <RadioGroupContext.Provider value={{ value, onChange: onValueChange, name }}>
        <div ref={ref} role="radiogroup" className={cn("space-y-2", className)} {...props}>
          {children}
        </div>
      </RadioGroupContext.Provider>
    );
  }
);
RadioGroup.displayName = "RadioGroup";

export interface RadioGroupItemProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  value: string;
  label?: React.ReactNode;
  description?: React.ReactNode;
}

export const RadioGroupItem = React.forwardRef<HTMLButtonElement, RadioGroupItemProps>(
  ({ className, value, label, description, ...props }, ref) => {
    const ctx = React.useContext(RadioGroupContext);
    if (!ctx) throw new Error("RadioGroupItem must be inside RadioGroup");

    const checked = ctx.value === value;

    return (
      <label className="flex items-start gap-3 cursor-pointer group select-none">
        <button
          ref={ref}
          type="button"
          role="radio"
          aria-checked={checked}
          onClick={() => ctx.onChange(value)}
          className={cn(
            "h-4 w-4 rounded-full border border-white/20 bg-[#0E101A] flex items-center justify-center transition-all mt-0.5",
            checked && "border-indigo-500 bg-indigo-600/20",
            // Presets
            "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/20",
            "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.12]",
            "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38]",
            "",
            className
          )}
          {...props}
        >
          {checked && <Circle className="h-2 w-2 fill-indigo-400 text-indigo-400" />}
        </button>

        {(label || description) && (
          <div className="flex flex-col">
            {label && (
              <span className="text-xs font-semibold text-slate-200 group-hover:text-white transition-colors">
                {label}
              </span>
            )}
            {description && (
              <span className="text-[11px] text-slate-500 leading-tight mt-0.5">
                {description}
              </span>
            )}
          </div>
        )}
      </label>
    );
  }
);
RadioGroupItem.displayName = "RadioGroupItem";
