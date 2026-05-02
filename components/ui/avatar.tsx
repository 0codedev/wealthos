import * as React from "react";
import { cn } from "@/lib/utils";

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: "sm" | "default" | "lg" | "xl";
  status?: "online" | "offline" | "busy" | "away";
}

const sizeClasses = {
  sm: "h-7 w-7 text-[10px]",
  default: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
  xl: "h-16 w-16 text-base",
};

const statusClasses = {
  online: "bg-emerald-500",
  offline: "bg-slate-500",
  busy: "bg-rose-500",
  away: "bg-amber-500",
};

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ src, alt, fallback, size = "default", status, className, ...props }, ref) => {
    const [hasError, setHasError] = React.useState(!src);

    return (
      <div
        ref={ref}
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center rounded-full bg-slate-800 font-semibold uppercase text-slate-200 border border-white/10 select-none overflow-hidden",
          sizeClasses[size],
          // Presets
          "",
          className
        )}
        {...props}
      >
        {src && !hasError ? (
          <img
            src={src}
            alt={alt || "Avatar"}
            onError={() => setHasError(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="font-mono">{fallback || (alt ? alt.substring(0, 2) : "U")}</span>
        )}

        {status && (
          <span
            className={cn(
              "absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full ring-2 ring-[#08090C]",
              statusClasses[status]
            )}
          />
        )}
      </div>
    );
  }
);
Avatar.displayName = "Avatar";
