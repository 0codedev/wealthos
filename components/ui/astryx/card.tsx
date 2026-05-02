import * as React from "react";
import { cn } from "../../../lib/utils";

export const AstryxCard = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-[12px] border border-[rgba(255,255,255,0.102)] bg-[#262626] text-white p-5 transition-all",
      className
    )}
    style={{
      fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}
    {...props}
  />
));
AstryxCard.displayName = "AstryxCard";
