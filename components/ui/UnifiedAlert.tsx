import * as React from "react";
import { useSettingsStore } from "../../store/settingsStore";
import { Alert, AlertTitle, AlertDescription, AlertAction } from "./reui/alert";
import { AstryxAlert } from "./astryx/alert";
import { cn } from "../../lib/utils";

export interface UnifiedAlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  variant?: "default" | "destructive" | "warning" | "success" | "info";
  title?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export const UnifiedAlert: React.FC<UnifiedAlertProps> = ({
  className,
  variant = "default",
  title,
  icon,
  action,
  children,
  ...props
}) => {
  const designPreset = useSettingsStore((s) => s.designPreset) || "wealthos-classic";

  // 1. Astryx Vertical
  if (designPreset === "astryx") {
    return (
      <AstryxAlert
        variant={variant}
        title={title}
        action={action}
        className={className}
        {...props}
      >
        {children}
      </AstryxAlert>
    );
  }

  // 2. Pure ReUI / Shadcn Vertical (Canonical, zero hardcoding)
  if (designPreset === "reui-nova" || designPreset === "shadcn") {
    return (
      <Alert variant={variant} className={className} {...props}>
        {icon}
        {title && <AlertTitle>{title}</AlertTitle>}
        {children && <AlertDescription>{children}</AlertDescription>}
        {action && <AlertAction>{action}</AlertAction>}
      </Alert>
    );
  }

  // 3. WealthOS Classic Baseline (Default)
  const classicVariantStyles: Record<string, string> = {
    default: "bg-slate-900/80 border-slate-800 text-slate-200",
    destructive: "bg-rose-500/10 border-rose-500/30 text-rose-300",
    warning: "bg-amber-500/10 border-amber-500/30 text-amber-300",
    success: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
    info: "bg-indigo-500/10 border-indigo-500/30 text-indigo-300",
  };

  return (
    <div
      role="alert"
      className={cn(
        "rounded-2xl border p-4 shadow-sm backdrop-blur-md transition-all",
        classicVariantStyles[variant] || classicVariantStyles.default,
        className
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
          <div>
            {title && <h5 className="text-sm font-bold tracking-tight text-white mb-1">{title}</h5>}
            <div className="text-xs text-slate-400 leading-relaxed">{children}</div>
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
};
