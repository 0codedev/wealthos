import * as React from "react";
import { Phone, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PhoneInputProps {
  value: string;
  countryCode?: string;
  onChange: (fullNumber: string, countryCode: string, localNumber: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const COUNTRY_CODES = [
  { code: "+91", country: "IN", flag: "🇮🇳" },
  { code: "+1", country: "US", flag: "🇺🇸" },
  { code: "+44", country: "UK", flag: "🇬🇧" },
  { code: "+971", country: "AE", flag: "🇦🇪" },
  { code: "+65", country: "SG", flag: "🇸🇬" },
];

export const PhoneInput: React.FC<PhoneInputProps> = ({
  value,
  countryCode = "+91",
  onChange,
  placeholder = "98765 43210",
  className,
  disabled = false,
}) => {
  const [currentCode, setCurrentCode] = React.useState(countryCode);
  const [localNumber, setLocalNumber] = React.useState(value.replace(currentCode, "").trim());

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    setLocalNumber(raw);
    onChange(`${currentCode} ${raw}`, currentCode, raw);
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const code = e.target.value;
    setCurrentCode(code);
    onChange(`${code} ${localNumber}`, code, localNumber);
  };

  return (
    <div
      className={cn(
        "flex items-center rounded-xl border border-white/10 bg-[#0E101A] overflow-hidden focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 transition-all",
        // Presets
        "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
        "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08]",
        "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
        "",
        className
      )}
    >
      <div className="relative flex items-center bg-white/[0.04] border-r border-white/10 px-2 py-1.5">
        <select
          value={currentCode}
          disabled={disabled}
          onChange={handleCodeChange}
          className="appearance-none bg-transparent pr-5 text-xs font-mono font-bold text-slate-200 outline-none cursor-pointer"
        >
          {COUNTRY_CODES.map((c) => (
            <option key={c.code} value={c.code} className="bg-[#0E101A] text-white">
              {c.flag} {c.code}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-1.5 h-3 w-3 text-slate-400 pointer-events-none" />
      </div>

      <input
        type="tel"
        value={localNumber}
        disabled={disabled}
        placeholder={placeholder}
        onChange={handleNumberChange}
        className="flex-1 bg-transparent px-3 py-2 text-xs font-mono text-slate-100 outline-none placeholder:text-slate-500"
      />
    </div>
  );
};
PhoneInput.displayName = "PhoneInput";
