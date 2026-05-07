import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SheetContextType {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const SheetContext = React.createContext<SheetContextType | null>(null);

export interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function Sheet({ open: controlledOpen, onOpenChange, children }: SheetProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = React.useCallback(
    (value: React.SetStateAction<boolean>) => {
      const next = typeof value === "function" ? value(open) : value;
      if (!isControlled) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [isControlled, open, onOpenChange]
  );

  return (
    <SheetContext.Provider value={{ open, setOpen }}>
      {children}
    </SheetContext.Provider>
  );
}

export function SheetTrigger({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = React.useContext(SheetContext);
  if (!context) throw new Error("SheetTrigger must be used within Sheet");

  return (
    <button
      type="button"
      onClick={() => context.setOpen(true)}
      {...props}
    >
      {children}
    </button>
  );
}

export interface SheetContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: "top" | "bottom" | "left" | "right";
}

export function SheetContent({
  side = "right",
  className,
  children,
  ...props
}: SheetContentProps) {
  const context = React.useContext(SheetContext);
  if (!context) throw new Error("SheetContent must be used within Sheet");

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") context.setOpen(false);
    };
    if (context.open) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [context.open, context]);

  if (!context.open) return null;

  const sideClasses = {
    top: "inset-x-0 top-0 border-b border-white/10 animate-in slide-in-from-top",
    bottom: "inset-x-0 bottom-0 border-t border-white/10 animate-in slide-in-from-bottom",
    left: "inset-y-0 left-0 h-full w-3/4 max-w-sm border-r border-white/10 animate-in slide-in-from-left",
    right: "inset-y-0 right-0 h-full w-full sm:w-96 border-l border-white/10 animate-in slide-in-from-right",
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={() => context.setOpen(false)}
      />
      {/* Drawer */}
      <div
        className={cn(
          "fixed z-50 bg-[#0E101A] p-6 text-slate-100 shadow-2xl transition-all duration-300 flex flex-col justify-between",
          sideClasses[side],
          // Presets
          "[data-design-preset=wealthos-classic]_&:bg-[#111322] [data-design-preset=wealthos-classic]_&:border-white/15",
          "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.12]",
          "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38]",
          "",
          className
        )}
        {...props}
      >
        <button
          onClick={() => context.setOpen(false)}
          className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 text-slate-400 hover:text-white"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </button>
        {children}
      </div>
    </div>
  );
}

export function SheetHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col space-y-1.5 text-left pb-4 border-b border-white/[0.08]", className)}
      {...props}
    />
  );
}

export function SheetTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("text-base font-bold text-white tracking-tight", className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-xs text-slate-400 leading-relaxed font-normal", className)}
      {...props}
    />
  );
}

export function SheetFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 pt-4 border-t border-white/[0.08] mt-auto",
        className
      )}
      {...props}
    />
  );
}
