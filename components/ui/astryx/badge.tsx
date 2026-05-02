import * as React from "react";
import { cn } from "../../../lib/utils";

export type AstryxBadgeVariant =
  | "neutral"
  | "success"
  | "warning"
  | "error"
  | "blue"
  | "cyan"
  | "green"
  | "orange"
  | "purple"
  | "teal";

export interface AstryxBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: AstryxBadgeVariant;
}

const badgeColorMap: Record<AstryxBadgeVariant, { bg: string; text: string }> = {
  neutral: { bg: "rgba(255, 255, 255, 0.10)", text: "#ffffff" },
  success: { bg: "#64af4c", text: "#111111" },
  warning: { bg: "#ffce2f", text: "#111111" },
  error: { bg: "#ff705d", text: "#111111" },
  blue: { bg: "rgba(136, 188, 255, 0.18)", text: "#a1caff" },
  cyan: { bg: "rgba(113, 199, 221, 0.18)", text: "#85d5e9" },
  green: { bg: "rgba(144, 202, 144, 0.18)", text: "#90ca90" },
  orange: { bg: "rgba(255, 158, 85, 0.18)", text: "#ffb37e" },
  purple: { bg: "rgba(228, 150, 246, 0.18)", text: "#eaacf8" },
  teal: { bg: "rgba(129, 201, 187, 0.18)", text: "#90d7c8" },
};

export const AstryxBadge: React.FC<AstryxBadgeProps> = ({
  className,
  variant = "neutral",
  children,
  ...props
}) => {
  const colors = badgeColorMap[variant] || badgeColorMap.neutral;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide",
        className
      )}
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
        fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
      {...props}
    >
      {children}
    </span>
  );
};
