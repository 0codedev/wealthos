import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  prefixNode?: React.ReactNode;
  suffixNode?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, prefixNode, suffixNode, ...props }, ref) => {
    return (
      <div className="relative flex items-center w-full">
        {prefixNode && (
          <div className="absolute left-3 flex items-center pointer-events-none text-slate-500 text-xs">
            {prefixNode}
          </div>
        )}
        <input
          type={type}
          className={cn(
            "flex h-10 w-full rounded-[8px] border border-white/10 bg-[#090A12] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 transition-all",
            prefixNode && "pl-9",
            suffixNode && "pr-9",
            // Presets
            "[data-design-preset=wealthos-classic]_&:bg-[#0D0F1B] [data-design-preset=wealthos-classic]_&:border-white/10",
            "[data-design-preset=reui-nova]_&:bg-[#090A10] [data-design-preset=reui-nova]_&:border-white/[0.08]",
            "[data-design-preset=shadcn]_&:bg-[#0F1117] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
            "",
            className
          )}
          ref={ref}
          {...props}
        />
        {suffixNode && (
          <div className="absolute right-3 flex items-center pointer-events-none text-slate-500 text-xs font-mono">
            {suffixNode}
          </div>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
