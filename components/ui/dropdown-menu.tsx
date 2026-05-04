import * as React from "react";
import { cn } from "@/lib/utils";

interface DropdownContextType {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const DropdownContext = React.createContext<DropdownContextType | null>(null);

export interface DropdownMenuProps {
  children: React.ReactNode;
}

export function DropdownMenu({ children }: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  return (
    <DropdownContext.Provider value={{ open, setOpen }}>
      <div ref={containerRef} className="relative inline-block text-left">
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

export function DropdownMenuTrigger({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = React.useContext(DropdownContext);
  if (!context) throw new Error("DropdownMenuTrigger must be used within DropdownMenu");

  return (
    <button
      type="button"
      onClick={() => context.setOpen(!context.open)}
      {...props}
    >
      {children}
    </button>
  );
}

export interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "left" | "right";
}

export function DropdownMenuContent({
  align = "right",
  className,
  children,
  ...props
}: DropdownMenuContentProps) {
  const context = React.useContext(DropdownContext);
  if (!context) throw new Error("DropdownMenuContent must be used within DropdownMenu");

  if (!context.open) return null;

  return (
    <div
      className={cn(
        "absolute z-50 mt-1.5 w-48 rounded-[10px] border border-white/10 bg-[#0E101A] p-1 text-xs text-slate-200 shadow-2xl animate-in fade-in zoom-in-95 select-none",
        align === "right" ? "right-0" : "left-0",
        // Presets
        "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/15",
        "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.12] [data-design-preset=reui-nova]_&:shadow-[0_16px_36px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.1)]",
        "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
        "",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function DropdownMenuItem({
  className,
  children,
  onClick,
  destructive = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { destructive?: boolean }) {
  const context = React.useContext(DropdownContext);

  return (
    <div
      onClick={(e) => {
        onClick?.(e);
        context?.setOpen(false);
      }}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-xs transition-colors hover:bg-white/5 hover:text-white",
        destructive && "text-rose-400 hover:bg-rose-500/10 hover:text-rose-300",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("-mx-1 my-1 h-[1px] bg-white/[0.08]", className)}
      {...props}
    />
  );
}
