import * as React from "react";
import { cn } from "@/lib/utils";

export interface IconStackProps {
  items: {
    id: string;
    icon?: React.ReactNode;
    image?: string;
    label: string;
  }[];
  max?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const IconStack: React.FC<IconStackProps> = ({
  items,
  max = 4,
  size = "md",
  className,
}) => {
  const visible = items.slice(0, max);
  const remaining = items.length - max;

  const sizeClasses = {
    sm: "h-6 w-6 text-[10px]",
    md: "h-8 w-8 text-xs",
    lg: "h-10 w-10 text-sm",
  };

  return (
    <div className={cn("flex items-center -space-x-2 overflow-hidden", className)}>
      {visible.map((item) => (
        <div
          key={item.id}
          title={item.label}
          className={cn(
            "relative inline-flex items-center justify-center rounded-full border-2 border-[#0E101A] bg-slate-800 text-white font-bold transition-transform hover:z-10 hover:scale-110",
            sizeClasses[size]
          )}
        >
          {item.image ? (
            <img
              src={item.image}
              alt={item.label}
              className="h-full w-full rounded-full object-cover"
            />
          ) : item.icon ? (
            item.icon
          ) : (
            item.label.charAt(0)
          )}
        </div>
      ))}

      {remaining > 0 && (
        <div
          className={cn(
            "relative inline-flex items-center justify-center rounded-full border-2 border-[#0E101A] bg-indigo-900 text-indigo-200 font-mono font-bold",
            sizeClasses[size]
          )}
        >
          +{remaining}
        </div>
      )}
    </div>
  );
};
IconStack.displayName = "IconStack";
