import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputOtpProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  autoFocus?: boolean;
}

export const InputOtp: React.FC<InputOtpProps> = ({
  length = 6,
  value,
  onChange,
  className,
  autoFocus = false,
}) => {
  const inputRefs = React.useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const val = e.target.value;
    if (!val) {
      const next = value.split("");
      next[index] = "";
      onChange(next.join(""));
      return;
    }

    const char = val.slice(-1);
    const next = value.padEnd(length, " ").split("");
    next[index] = char;
    const newOtp = next.join("").trimEnd();
    onChange(newOtp);

    if (char && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace" && !value[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text/plain").slice(0, length);
    onChange(pasted);
    const targetIdx = Math.min(pasted.length, length - 1);
    inputRefs.current[targetIdx]?.focus();
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            inputRefs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={value[i] || ""}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => handleChange(e, i)}
          onKeyDown={(e) => handleKeyDown(e, i)}
          onPaste={handlePaste}
          className={cn(
            "h-12 w-10 text-center font-mono text-lg font-bold rounded-xl border border-white/10 bg-[#0E101A] text-white transition-all outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500",
            // Presets
            "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
            "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08] [data-design-preset=reui-nova]_&:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
            "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
            ""
          )}
        />
      ))}
    </div>
  );
};
InputOtp.displayName = "InputOtp";
