import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: React.ReactNode;
}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, checked = false, onCheckedChange, label, disabled, ...props }, ref) => {
    return (
      <label
        className={cn(
          "inline-flex items-center gap-2 cursor-pointer select-none text-xs text-slate-300",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <div className="relative inline-flex items-center">
          <input
            type="checkbox"
            ref={ref}
            checked={checked}
            disabled={disabled}
            onChange={(e) => onCheckedChange?.(e.target.checked)}
            className="sr-only"
            {...props}
          />
          <div
            className={cn(
              "h-5 w-9 rounded-full bg-slate-800 transition-colors p-0.5",
              checked && "bg-[#6366F1]",
              "",
              className
            )}
          >
            <div
              className={cn(
                "h-4 w-4 rounded-full bg-white transition-transform transform shadow-sm",
                checked ? "translate-x-4" : "translate-x-0",
                ""
              )}
            />
          </div>
        </div>
        {label && <span>{label}</span>}
      </label>
    );
  }
);
Switch.displayName = "Switch";
