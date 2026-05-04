import * as React from "react";
import { cn } from "@/lib/utils";

export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
}

export const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  ({ className, label, description, error, required, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("space-y-1.5 w-full", className)} {...props}>
        {label && (
          <label className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-300">
            {label}
            {required && <span className="text-rose-500 font-black">*</span>}
          </label>
        )}
        {children}
        {description && !error && (
          <p className="text-[11px] text-slate-500 leading-normal">{description}</p>
        )}
        {error && (
          <p className="text-[11px] font-medium text-rose-400 flex items-center gap-1 leading-normal">
            {error}
          </p>
        )}
      </div>
    );
  }
);
Field.displayName = "Field";
