import * as React from "react";
import { cn } from "@/lib/utils";

export interface AspectRatioProps extends React.HTMLAttributes<HTMLDivElement> {
  ratio?: number; // width / height, e.g. 16/9, 4/3, 1
}

export const AspectRatio = React.forwardRef<HTMLDivElement, AspectRatioProps>(
  ({ ratio = 16 / 9, className, style, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        style={{ position: "relative", width: "100%", paddingBottom: `${(1 / ratio) * 100}%`, ...style }}
        className={cn("overflow-hidden", className)}
        {...props}
      >
        <div className="absolute inset-0 w-full h-full">
          {children}
        </div>
      </div>
    );
  }
);
AspectRatio.displayName = "AspectRatio";
