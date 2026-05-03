import * as React from "react";
import { cn } from "@/lib/utils";

interface CollapsibleContextType {
  open: boolean;
  toggle: () => void;
}

const CollapsibleContext = React.createContext<CollapsibleContextType | null>(null);

export interface CollapsibleProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Collapsible({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
  ...props
}: CollapsibleProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const toggle = React.useCallback(() => {
    const next = !open;
    if (!isControlled) {
      setUncontrolledOpen(next);
    }
    onOpenChange?.(next);
  }, [isControlled, open, onOpenChange]);

  return (
    <CollapsibleContext.Provider value={{ open, toggle }}>
      <div className={cn("w-full", className)} {...props}>
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
}

export function CollapsibleTrigger({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = React.useContext(CollapsibleContext);
  if (!context) throw new Error("CollapsibleTrigger must be used within Collapsible");

  return (
    <button
      type="button"
      onClick={context.toggle}
      className={cn("cursor-pointer select-none", className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function CollapsibleContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const context = React.useContext(CollapsibleContext);
  if (!context) throw new Error("CollapsibleContent must be used within Collapsible");

  if (!context.open) return null;

  return (
    <div
      className={cn("overflow-hidden transition-all animate-in fade-in duration-150", className)}
      {...props}
    >
      {children}
    </div>
  );
}
