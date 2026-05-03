import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItemProps {
  label: string;
  href?: string;
  isCurrent?: boolean;
  onClick?: () => void;
}

export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
  items: BreadcrumbItemProps[];
  separator?: React.ReactNode;
}

export const Breadcrumb = React.forwardRef<HTMLElement, BreadcrumbProps>(
  ({ items, separator, className, ...props }, ref) => {
    return (
      <nav
        ref={ref}
        aria-label="Breadcrumb"
        className={cn("flex items-center text-xs text-slate-400 font-medium", className)}
        {...props}
      >
        <ol className="flex items-center space-x-1.5">
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            return (
              <li key={item.label + index} className="flex items-center">
                {index > 0 && (
                  <span className="mx-1 text-slate-600">
                    {separator || <ChevronRight className="h-3.5 w-3.5" />}
                  </span>
                )}
                {item.isCurrent || isLast ? (
                  <span
                    aria-current="page"
                    className="text-white font-semibold tracking-tight"
                  >
                    {item.label}
                  </span>
                ) : item.href ? (
                  <a
                    href={item.href}
                    onClick={(e) => {
                      if (item.onClick) {
                        e.preventDefault();
                        item.onClick();
                      }
                    }}
                    className="hover:text-slate-200 transition-colors"
                  >
                    {item.label}
                  </a>
                ) : (
                  <span
                    onClick={item.onClick}
                    className="cursor-pointer hover:text-slate-200 transition-colors"
                  >
                    {item.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    );
  }
);
Breadcrumb.displayName = "Breadcrumb";
