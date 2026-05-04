import * as React from "react";
import { cn } from "@/lib/utils";

export interface HoverCardProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  openDelay?: number;
  closeDelay?: number;
  className?: string;
}

export const HoverCard: React.FC<HoverCardProps> = ({
  trigger,
  children,
  openDelay = 200,
  closeDelay = 150,
  className,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const openTimeout = React.useRef<NodeJS.Timeout | null>(null);
  const closeTimeout = React.useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (closeTimeout.current) clearTimeout(closeTimeout.current);
    openTimeout.current = setTimeout(() => setIsOpen(true), openDelay);
  };

  const handleMouseLeave = () => {
    if (openTimeout.current) clearTimeout(openTimeout.current);
    closeTimeout.current = setTimeout(() => setIsOpen(false), closeDelay);
  };

  React.useEffect(() => {
    return () => {
      if (openTimeout.current) clearTimeout(openTimeout.current);
      if (closeTimeout.current) clearTimeout(closeTimeout.current);
    };
  }, []);

  return (
    <div
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="cursor-pointer">{trigger}</div>
      {isOpen && (
        <div
          className={cn(
            "absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 rounded-2xl border border-white/10 bg-[#0E101A] p-4 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 text-slate-100",
            // Presets
            "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
            "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08] [data-design-preset=reui-nova]_&:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
            "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-lg",
            "",
            className
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
};
HoverCard.displayName = "HoverCard";
