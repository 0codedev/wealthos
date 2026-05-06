import * as React from "react";
import { cn } from "@/lib/utils";

export interface ScrollspySection {
  id: string;
  label: string;
}

export interface ScrollspyProps {
  sections: ScrollspySection[];
  className?: string;
  onSectionChange?: (activeId: string) => void;
}

export const Scrollspy: React.FC<ScrollspyProps> = ({
  sections,
  className,
  onSectionChange,
}) => {
  const [activeId, setActiveId] = React.useState<string>(sections[0]?.id || "");

  React.useEffect(() => {
    const handleScroll = () => {
      const scrollPos = window.scrollY + 100;

      for (let i = sections.length - 1; i >= 0; i--) {
        const el = document.getElementById(sections[i].id);
        if (el && el.offsetTop <= scrollPos) {
          setActiveId(sections[i].id);
          onSectionChange?.(sections[i].id);
          break;
        }
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [sections, onSectionChange]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <nav className={cn("space-y-1 select-none", className)}>
      {sections.map((sec) => {
        const isActive = activeId === sec.id;
        return (
          <button
            key={sec.id}
            type="button"
            onClick={() => scrollTo(sec.id)}
            className={cn(
              "flex items-center gap-2 w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              isActive
                ? "bg-indigo-600/20 text-indigo-300 font-bold border-l-2 border-indigo-500"
                : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
            )}
          >
            <span>{sec.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
Scrollspy.displayName = "Scrollspy";
