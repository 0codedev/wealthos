import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const textVariants = cva("leading-relaxed", {
  variants: {
    variant: {
      body: "text-slate-200 text-sm",
      subtle: "text-slate-400 text-sm",
      caption: "text-slate-400 text-xs",
      mono: "font-mono tabular-nums text-xs",
      metric: "font-mono tabular-nums text-2xl font-bold tracking-tight text-white",
    },
    weight: {
      bold: "font-bold",
      semibold: "font-semibold",
      medium: "font-medium",
      normal: "font-normal",
    },
  },
  defaultVariants: {
    variant: "body",
  },
});

export interface TextProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof textVariants> {
  as?: React.ElementType;
}

export const Text = React.forwardRef<HTMLElement, TextProps>(
  ({ className, variant, weight, as = "p", children, ...props }, ref) => {
    const Component = as;

    return (
      <Component
        ref={ref}
        className={cn(textVariants({ variant, weight, className }))}
        {...props}
      >
        {children}
      </Component>
    );
  }
);

Text.displayName = "Text";
export default Text;
