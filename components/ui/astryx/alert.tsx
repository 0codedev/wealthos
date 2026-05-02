import * as React from "react";
import { cn } from "../../../lib/utils";

export interface AstryxAlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  variant?: "default" | "destructive" | "warning" | "success" | "info";
  title?: React.ReactNode;
  action?: React.ReactNode;
}

const statusColors: Record<string, { dot: string; border: string; text: string }> = {
  default: { dot: "#ffffff", border: "rgba(255, 255, 255, 0.12)", text: "#ffffff" },
  destructive: { dot: "#ff705d", border: "rgba(255, 112, 93, 0.4)", text: "#ff705d" },
  warning: { dot: "#ffce2f", border: "rgba(255, 206, 47, 0.4)", text: "#ffce2f" },
  success: { dot: "#64af4c", border: "rgba(100, 175, 76, 0.4)", text: "#64af4c" },
  info: { dot: "#85d5e9", border: "rgba(113, 199, 221, 0.4)", text: "#85d5e9" },
};

export const AstryxAlert: React.FC<AstryxAlertProps> = ({
  className,
  variant = "default",
  title,
  children,
  action,
  ...props
}) => {
  const current = statusColors[variant] || statusColors.default;

  return (
    <div
      role="alert"
      className={cn(
        "relative w-full rounded-[10px] border p-4 bg-[#262626] text-white transition-all",
        className
      )}
      style={{
        borderColor: current.border,
        fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span
            className="mt-1 size-2 shrink-0 rounded-full"
            style={{ backgroundColor: current.dot }}
          />
          <div>
            {title && (
              <h5
                className="text-sm font-semibold tracking-tight"
                style={{ color: current.text }}
              >
                {title}
              </h5>
            )}
            <div className="mt-1 text-xs text-[#9e9e9e] leading-relaxed">
              {children}
            </div>
          </div>
        </div>
        {action && <div className="shrink-0 pl-2">{action}</div>}
      </div>
    </div>
  );
};
