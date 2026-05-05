import * as React from "react";
import { cn } from "@/lib/utils";

export interface MenubarItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick?: () => void;
  separator?: boolean;
}

export interface MenubarMenu {
  title: string;
  items: MenubarItem[];
}

export interface MenubarProps {
  menus: MenubarMenu[];
  className?: string;
}

export const Menubar: React.FC<MenubarProps> = ({ menus, className }) => {
  const [activeMenu, setActiveMenu] = React.useState<number | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex items-center gap-1 rounded-xl border border-white/10 bg-[#0E101A] px-2 py-1 text-xs",
        // Presets
        "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
        "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08]",
        "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
        "",
        className
      )}
    >
      {menus.map((menu, idx) => (
        <div key={menu.title} className="relative">
          <button
            type="button"
            onClick={() => setActiveMenu(activeMenu === idx ? null : idx)}
            className={cn(
              "px-2.5 py-1 rounded-lg font-medium transition-colors",
              activeMenu === idx
                ? "bg-white/10 text-white"
                : "text-slate-300 hover:text-white hover:bg-white/5"
            )}
          >
            {menu.title}
          </button>

          {activeMenu === idx && (
            <div className="absolute left-0 top-full mt-1.5 z-50 min-w-[180px] rounded-xl border border-white/10 bg-[#0E101A] p-1 shadow-2xl backdrop-blur-xl text-xs space-y-0.5">
              {menu.items.map((item, itemIdx) => {
                if (item.separator) {
                  return (
                    <div
                      key={`sep-${itemIdx}`}
                      className="my-1 border-t border-white/10"
                    />
                  );
                }
                return (
                  <div
                    key={item.label}
                    onClick={() => {
                      if (item.disabled) return;
                      item.onClick?.();
                      setActiveMenu(null);
                    }}
                    className={cn(
                      "flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors",
                      item.disabled
                        ? "opacity-40 cursor-not-allowed"
                        : "text-slate-300 hover:bg-indigo-600/20 hover:text-white"
                    )}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && (
                      <span className="font-mono text-[10px] text-slate-500">
                        {item.shortcut}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
Menubar.displayName = "Menubar";
