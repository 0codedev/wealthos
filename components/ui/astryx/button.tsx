import * as React from "react";
import { cn } from "../../../lib/utils";

export interface AstryxButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "default" | "sm" | "lg";
}

export const AstryxButton = React.forwardRef<HTMLButtonElement, AstryxButtonProps>(
  ({ className, variant = "secondary", size = "default", ...props }, ref) => {
    const baseStyle =
      "inline-flex items-center justify-center font-medium rounded-[10px] transition-colors focus:outline-none disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]";
    
    let variantStyle = "bg-[#262626] border border-[#525252] text-white hover:bg-[#333333]";
    if (variant === "primary") {
      variantStyle = "bg-white text-[#111111] hover:bg-[#eaeaea] font-semibold";
    } else if (variant === "danger") {
      variantStyle = "bg-[#ff705d] text-[#111111] hover:bg-[#e05e4d] font-semibold";
    } else if (variant === "ghost") {
      variantStyle = "bg-transparent text-white hover:bg-[#262626]";
    }

    let sizeStyle = "h-9 px-4 text-xs";
    if (size === "sm") sizeStyle = "h-7 px-2.5 text-[11px] rounded-[6px]";
    if (size === "lg") sizeStyle = "h-11 px-6 text-sm rounded-[12px]";

    return (
      <button
        ref={ref}
        type={props.type || "button"}
        className={cn(baseStyle, variantStyle, sizeStyle, className)}
        style={{
          fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
        {...props}
      />
    );
  }
);
AstryxButton.displayName = "AstryxButton";
