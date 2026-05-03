import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-[var(--badge-radius,9999px)] font-semibold transition-colors select-none",
  {
    variants: {
      variant: {
        default:
          "bg-[#6366F1]/15 text-indigo-300 border border-[#6366F1]/30",
        secondary:
          "bg-[#131620] text-slate-300 border border-white/10",
        gain:
          "bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30 font-mono",
        loss:
          "bg-[#F43F5E]/15 text-[#F43F5E] border border-[#F43F5E]/30 font-mono",
        warn:
          "bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/30",
        info:
          "bg-[#38BDF8]/15 text-[#38BDF8] border border-[#38BDF8]/30",
        outline:
          "border border-white/20 text-slate-300 bg-transparent",
        live:
          "bg-[#10B981] text-black font-bold uppercase tracking-wider text-[10px] px-2 py-0.5",
      },
      size: {
        default: "px-2.5 py-0.5 text-xs",
        sm: "px-2 py-0.5 text-[10px]",
        lg: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
