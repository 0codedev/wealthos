import * as React from "react";
import { ChevronDown, Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface AccordionContextType {
  openItems: string[];
  toggleItem: (id: string) => void;
  indicator: "chevron" | "plus-minus";
}

const AccordionContext = React.createContext<AccordionContextType | null>(null);

export interface AccordionProps extends React.HTMLAttributes<HTMLDivElement> {
  type?: "single" | "multiple";
  defaultValue?: string | string[];
  indicator?: "chevron" | "plus-minus";
  children: React.ReactNode;
}

export function Accordion({
  type = "single",
  defaultValue,
  indicator = "chevron",
  className,
  children,
  ...props
}: AccordionProps) {
  const [openItems, setOpenItems] = React.useState<string[]>(() => {
    if (!defaultValue) return [];
    return Array.isArray(defaultValue) ? defaultValue : [defaultValue];
  });

  const toggleItem = React.useCallback(
    (id: string) => {
      setOpenItems((prev) => {
        const isOpen = prev.includes(id);
        if (type === "single") {
          return isOpen ? [] : [id];
        }
        return isOpen ? prev.filter((item) => item !== id) : [...prev, id];
      });
    },
    [type]
  );

  return (
    <AccordionContext.Provider value={{ openItems, toggleItem, indicator }}>
      <div
        className={cn(
          "w-full divide-y divide-white/[0.06] rounded-[10px] border border-white/[0.08] bg-[#0D0E18]",
          // Presets
          "[data-design-preset=wealthos-classic]_&:bg-[#10121E] [data-design-preset=wealthos-classic]_&:border-white/10",
          "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08] [data-design-preset=reui-nova]_&:shadow-[0_8px_24px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.08)]",
          "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
          "",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

const AccordionItemContext = React.createContext<{ id: string; isOpen: boolean } | null>(null);

export interface AccordionItemProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function AccordionItem({ value, className, children, ...props }: AccordionItemProps) {
  const context = React.useContext(AccordionContext);
  if (!context) throw new Error("AccordionItem must be used within Accordion");

  const isOpen = context.openItems.includes(value);

  return (
    <AccordionItemContext.Provider value={{ id: value, isOpen }}>
      <div
        className={cn("overflow-hidden transition-all first:rounded-t-[inherit] last:rounded-b-[inherit]", className)}
        {...props}
      >
        {children}
      </div>
    </AccordionItemContext.Provider>
  );
}

export function AccordionTrigger({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const accContext = React.useContext(AccordionContext);
  const itemContext = React.useContext(AccordionItemContext);
  if (!accContext || !itemContext) throw new Error("AccordionTrigger must be used within AccordionItem");

  const { isOpen, id } = itemContext;
  const { indicator, toggleItem } = accContext;

  return (
    <button
      type="button"
      onClick={() => toggleItem(id)}
      className={cn(
        "flex w-full items-center justify-between py-4 px-5 text-left text-xs font-semibold text-slate-200 transition-all hover:text-white select-none",
        isOpen && "text-white",
        className
      )}
      {...props}
    >
      <span>{children}</span>
      {indicator === "chevron" ? (
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200",
            isOpen && "rotate-180 text-indigo-400"
          )}
        />
      ) : isOpen ? (
        <Minus className="h-4 w-4 shrink-0 text-indigo-400" />
      ) : (
        <Plus className="h-4 w-4 shrink-0 text-slate-400" />
      )}
    </button>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const itemContext = React.useContext(AccordionItemContext);
  if (!itemContext) throw new Error("AccordionContent must be used within AccordionItem");

  if (!itemContext.isOpen) return null;

  return (
    <div
      className={cn(
        "px-5 pb-4 text-xs text-slate-400 leading-relaxed animate-in fade-in duration-200",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
