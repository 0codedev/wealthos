import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  onRemove?: () => void;
  icon?: React.ReactNode;
}

export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, active = false, onRemove, icon, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all select-none border whitespace-nowrap",
          active
            ? "bg-[#6366F1] text-white border-[#6366F1] shadow-sm shadow-indigo-500/25"
            : "bg-[#131620] text-slate-300 border-white/10 hover:border-white/20 hover:text-white",
          className
        )}
        {...props}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{children}</span>
        {onRemove && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onRemove();
              }
            }}
            className="hover:bg-black/20 rounded-full p-0.5 ml-0.5 inline-flex items-center justify-center cursor-pointer"
            aria-label="Remove filter"
          >
            <X className="w-3 h-3" />
          </span>
        )}
      </button>
    );
  }
);
Chip.displayName = "Chip";
