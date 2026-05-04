import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const headingVariants = cva("tracking-tight select-none", {
  variants: {
    variant: {
      tab: "wa-tab-title text-slate-100 text-2xl font-[var(--weight-tab-title,700)]",
      card: "wa-card-title text-slate-100 text-lg font-[var(--weight-card-title,600)]",
      section: "text-slate-200 text-base font-semibold",
      eyebrow: "text-xs uppercase tracking-widest font-semibold text-slate-400 font-mono",
    },
    weight: {
      bold: "font-bold",
      semibold: "font-semibold",
      medium: "font-medium",
      normal: "font-normal",
    },
  },
  defaultVariants: {
    variant: "card",
  },
});

export interface HeadingProps
  extends React.HTMLAttributes<HTMLHeadingElement>,
    VariantProps<typeof headingVariants> {
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  as?: React.ElementType;
}

export const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ className, variant, weight, level = 2, as, children, ...props }, ref) => {
    const Component = as || (`h${level}` as React.ElementType);

    return (
      <Component
        ref={ref}
        className={cn(headingVariants({ variant, weight, className }))}
        {...props}
      >
        {children}
      </Component>
    );
  }
);

Heading.displayName = "Heading";
export default Heading;
