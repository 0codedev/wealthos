import React from "react";
import { cn } from "@/lib/utils";

export interface TabHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  hideTitleOnMobile?: boolean;
  children?: React.ReactNode;
}

export const TabHeader: React.FC<TabHeaderProps> = ({
  title,
  subtitle,
  badge,
  actions,
  className,
  hideTitleOnMobile,
  children,
}) => {
  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4 pb-2.5 sm:pb-4 mb-3 sm:mb-6 border-b border-white/[0.06] transition-colors",
        className
      )}
    >
      <div className={cn(
        "flex flex-col gap-1 min-w-0",
        hideTitleOnMobile && "hidden sm:flex"
      )}>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="wa-tab-title text-slate-100 tracking-tight select-none">
            {title}
          </h1>
          {badge && <div className="shrink-0">{badge}</div>}
        </div>
        {subtitle && (
          <p className="wa-tab-subtitle text-slate-400 select-none hidden sm:block line-clamp-1 max-w-2xl" title={typeof subtitle === 'string' ? subtitle : undefined}>
            {subtitle}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          {actions}
        </div>
      )}

      {children}
    </div>
  );
};

export default TabHeader;
