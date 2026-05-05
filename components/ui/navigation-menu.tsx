import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavItem {
  label: string;
  href?: string;
  description?: string;
  children?: NavItem[];
}

export interface NavigationMenuProps {
  items: NavItem[];
  activeHref?: string;
  onNavigate?: (href: string) => void;
  className?: string;
}

export const NavigationMenu: React.FC<NavigationMenuProps> = ({
  items,
  activeHref,
  onNavigate,
  className,
}) => {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenIndex(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn("flex items-center gap-1 relative", className)}
    >
      {items.map((item, idx) => {
        const hasChildren = item.children && item.children.length > 0;
        const isActive = item.href && activeHref === item.href;

        return (
          <div key={item.label} className="relative">
            <button
              type="button"
              onClick={() => {
                if (hasChildren) {
                  setOpenIndex(openIndex === idx ? null : idx);
                } else if (item.href) {
                  onNavigate?.(item.href);
                }
              }}
              className={cn(
                "flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                isActive
                  ? "bg-indigo-600/20 text-indigo-300 font-bold"
                  : "text-slate-300 hover:text-white hover:bg-white/5"
              )}
            >
              <span>{item.label}</span>
              {hasChildren && (
                <ChevronDown
                  className={cn(
                    "h-3 w-3 transition-transform text-slate-400",
                    openIndex === idx && "rotate-180"
                  )}
                />
              )}
            </button>

            {hasChildren && openIndex === idx && (
              <div className="absolute left-0 top-full mt-2 z-50 w-64 rounded-2xl border border-white/10 bg-[#0E101A] p-2 shadow-2xl backdrop-blur-xl text-xs space-y-1">
                {item.children!.map((child) => (
                  <div
                    key={child.label}
                    onClick={() => {
                      if (child.href) onNavigate?.(child.href);
                      setOpenIndex(null);
                    }}
                    className="p-2 rounded-xl cursor-pointer hover:bg-white/5 transition-colors"
                  >
                    <div className="font-semibold text-slate-100">
                      {child.label}
                    </div>
                    {child.description && (
                      <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">
                        {child.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
NavigationMenu.displayName = "NavigationMenu";
