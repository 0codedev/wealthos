import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepItem {
  id: string | number;
  label: string;
  description?: string;
}

export interface StepperProps extends React.HTMLAttributes<HTMLDivElement> {
  steps: StepItem[];
  activeStep: number; // 0-indexed
  onStepClick?: (stepIndex: number) => void;
}

export const Stepper: React.FC<StepperProps> = ({
  steps,
  activeStep,
  onStepClick,
  className,
  ...props
}) => {
  return (
    <div className={cn("w-full py-3", className)} {...props}>
      <div className="flex items-center justify-between relative">
        {/* Background connector line */}
        <div className="absolute top-4 left-4 right-4 h-0.5 bg-white/10 -z-0" />
        {/* Active connector line */}
        <div
          className="absolute top-4 left-4 h-0.5 bg-[#6366F1] transition-all duration-300 -z-0"
          style={{
            width: `${(activeStep / Math.max(1, steps.length - 1)) * 100}%`,
          }}
        />

        {steps.map((step, idx) => {
          const isCompleted = idx < activeStep;
          const isCurrent = idx === activeStep;

          return (
            <div
              key={step.id}
              onClick={() => onStepClick?.(idx)}
              className={cn(
                "flex flex-col items-center relative z-10 select-none",
                onStepClick && "cursor-pointer"
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold border transition-all",
                  isCompleted && "bg-[#6366F1] border-[#6366F1] text-white",
                  isCurrent && "bg-[#0D0E18] border-[#6366F1] text-[#6366F1] ring-4 ring-[#6366F1]/20",
                  !isCompleted && !isCurrent && "bg-slate-900 border-white/20 text-slate-500",
                  ""
                )}
              >
                {isCompleted ? <Check className="h-4 w-4 stroke-[3]" /> : idx + 1}
              </div>
              <span
                className={cn(
                  "mt-2 text-xs font-semibold tracking-tight",
                  isCurrent ? "text-white" : isCompleted ? "text-slate-300" : "text-slate-500"
                )}
              >
                {step.label}
              </span>
              {step.description && (
                <span className="text-[10px] text-slate-500 font-normal">
                  {step.description}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
