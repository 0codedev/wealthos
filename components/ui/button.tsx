import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-[8px] text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090C] disabled:pointer-events-none disabled:opacity-50 select-none gap-2",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--btn-primary-bg,#6366F1)] text-[var(--btn-primary-text,#FFFFFF)] rounded-[var(--btn-radius,8px)] hover:opacity-90 active:scale-[0.98] shadow-[var(--btn-primary-shadow,none)] font-semibold transition-all",
        secondary:
          "bg-[var(--btn-sec-bg,#181D33)] text-[var(--btn-sec-text,#E2E8F0)] border border-[var(--btn-sec-border,rgba(255,255,255,0.12))] rounded-[var(--btn-radius,8px)] hover:bg-[var(--btn-sec-hover,#222946)] active:scale-[0.98] transition-all",
        outline:
          "border border-white/15 bg-transparent text-slate-300 hover:bg-white/5 hover:text-white rounded-[var(--btn-radius,8px)] active:scale-[0.98]",
        ghost:
          "text-slate-400 hover:text-white hover:bg-white/5 rounded-[var(--btn-radius,8px)] active:scale-[0.98]",
        destructive:
          "bg-[#F43F5E] text-white hover:bg-[#E11D48] rounded-[var(--btn-radius,8px)] active:scale-[0.98] shadow-sm shadow-rose-500/20",
        success:
          "bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-600 hover:text-white rounded-[var(--btn-radius,8px)] active:scale-[0.98]",
        link:
          "text-[#6366F1] underline-offset-4 hover:underline p-0 h-auto font-normal",
        terminal:
          "bg-black border border-emerald-500/40 text-emerald-400 font-mono hover:bg-emerald-950/30 rounded-[var(--btn-radius,8px)] active:scale-[0.98]",
      },
      size: {
        default: "h-10 px-4 py-2 text-sm",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6 text-base",
        icon: "h-10 w-10 p-0",
        "icon-sm": "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
