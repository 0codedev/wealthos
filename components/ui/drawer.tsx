import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const Drawer: React.FC<DrawerProps> = ({
  open,
  onClose,
  title,
  description,
  children,
  className,
}) => {
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70 backdrop-blur-sm transition-opacity">
      <div className="fixed inset-0" onClick={onClose} />
      <div
        className={cn(
          "relative z-10 w-full max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-white/15 bg-[#0E101A] p-6 shadow-2xl transition-transform animate-in slide-in-from-bottom duration-300",
          // Presets
          "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
          "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08] [data-design-preset=reui-nova]_&:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
          "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-t-xl",
          "",
          className
        )}
      >
        {/* Grab Handle */}
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/20" />

        <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
          <div>
            {title && (
              <h3 className="text-base font-bold text-slate-100">{title}</h3>
            )}
            {description && (
              <p className="text-xs text-slate-400 mt-0.5">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="py-2">{children}</div>
      </div>
    </div>
  );
};
Drawer.displayName = "Drawer";
