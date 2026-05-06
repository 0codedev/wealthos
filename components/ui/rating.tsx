import * as React from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RatingProps {
  value: number; // 0 to max
  max?: number;
  onChange?: (val: number) => void;
  readonly?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const Rating: React.FC<RatingProps> = ({
  value,
  max = 5,
  onChange,
  readonly = false,
  size = "md",
  className,
}) => {
  const [hoverValue, setHoverValue] = React.useState<number | null>(null);

  const sizeClasses = {
    sm: "h-3.5 w-3.5",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      {Array.from({ length: max }).map((_, idx) => {
        const starNum = idx + 1;
        const isFilled = (hoverValue ?? value) >= starNum;

        return (
          <button
            key={idx}
            type="button"
            disabled={readonly}
            onClick={() => !readonly && onChange?.(starNum)}
            onMouseEnter={() => !readonly && setHoverValue(starNum)}
            onMouseLeave={() => !readonly && setHoverValue(null)}
            className={cn(
              "transition-transform",
              !readonly && "hover:scale-110 cursor-pointer",
              readonly && "cursor-default"
            )}
            aria-label={`Rate ${starNum} out of ${max}`}
          >
            <Star
              className={cn(
                sizeClasses[size],
                "transition-colors",
                isFilled
                  ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.3)]"
                  : "text-slate-600 hover:text-slate-400"
              )}
            />
          </button>
        );
      })}
    </div>
  );
};
Rating.displayName = "Rating";
