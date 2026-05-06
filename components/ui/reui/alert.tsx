import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../../lib/utils";

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>[data-slot=action]]:grid-cols-[calc(var(--spacing)*4)_1fr_auto] items-start gap-y-0.5 gap-x-3 transition-colors duration-200 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground border-border",
        destructive:
          "border-rose-500/40 text-rose-400 bg-rose-950/10 dark:border-rose-500/30 dark:bg-rose-950/15 [&>svg]:text-rose-400",
        success:
          "border-emerald-500/40 text-emerald-400 bg-emerald-950/10 dark:border-emerald-500/30 dark:bg-emerald-950/15 [&>svg]:text-emerald-400",
        warning:
          "border-amber-500/40 text-amber-400 bg-amber-950/10 dark:border-amber-500/30 dark:bg-amber-950/15 [&>svg]:text-amber-400",
        info:
          "border-blue-500/40 text-blue-400 bg-blue-950/10 dark:border-blue-500/30 dark:bg-blue-950/15 [&>svg]:text-blue-400",
        invert:
          "bg-foreground text-background border-transparent [&>svg]:text-background",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("col-start-2 line-clamp-1 min-h-4 font-semibold tracking-tight leading-normal", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("col-start-2 text-xs text-muted-foreground [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

const AlertAction = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="action"
    className={cn("col-start-3 row-span-2 flex items-center gap-2 self-center pl-2", className)}
    {...props}
  />
));
AlertAction.displayName = "AlertAction";

export { Alert, AlertTitle, AlertDescription, AlertAction, alertVariants };
