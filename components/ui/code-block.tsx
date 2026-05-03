import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CodeBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
}

export const CodeBlock = React.forwardRef<HTMLPreElement, CodeBlockProps>(
  ({ code, language = "typescript", showLineNumbers = false, className, ...props }, ref) => {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = () => {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };

    const lines = code.trim().split("\n");

    return (
      <div className="relative rounded-[10px] border border-white/10 bg-[#07080D] overflow-hidden group">
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-black/40 text-[10px] font-mono text-slate-400">
          <span>{language.toUpperCase()}</span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 hover:text-white transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
        <pre
          ref={ref}
          className={cn(
            "p-4 overflow-x-auto text-xs font-mono text-slate-200 leading-relaxed",
            className
          )}
          {...props}
        >
          {showLineNumbers ? (
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx}>
                    <td className="pr-4 select-none text-slate-600 text-right w-8">
                      {idx + 1}
                    </td>
                    <td>{line}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <code>{code}</code>
          )}
        </pre>
      </div>
    );
  }
);
CodeBlock.displayName = "CodeBlock";
