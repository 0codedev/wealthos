import * as React from "react";
import { cn } from "@/lib/utils";

export interface SliderProps {
  min?: number;
  max?: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  label?: string;
  className?: string;
}

export const Slider: React.FC<SliderProps> = ({
  min = 0,
  max = 100,
  step = 1,
  value,
  onChange,
  formatValue,
  label,
  className,
}) => {
  const [isHovered, setIsHovered] = React.useState(false);
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className={cn("relative w-full space-y-1.5", className)}>
      {label && (
        <div className="flex justify-between items-center text-[11px] text-slate-400">
          <span>{label}</span>
          <span className="font-mono text-indigo-300 font-bold">
            {formatValue ? formatValue(value) : value}
          </span>
        </div>
      )}
      <div
        className="relative py-2"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Floating Bubble Tooltip (c-slider-4) */}
        {isHovered && (
          <div
            className="absolute -top-6 -translate-x-1/2 px-2 py-0.5 rounded bg-[#1A1C2C] border border-indigo-500/30 text-[10px] font-mono font-bold text-indigo-300 shadow-md pointer-events-none transition-all"
            style={{ left: `${percentage}%` }}
          >
            {formatValue ? formatValue(value) : value}
          </div>
        )}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-1.5 rounded-lg bg-slate-800 appearance-none cursor-pointer accent-indigo-500 transition-all focus:outline-none"
        />
      </div>
    </div>
  );
};
