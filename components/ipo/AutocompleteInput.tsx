import React, { useState } from 'react';

interface AutocompleteInputProps {
    value: string;
    onChange: (val: string) => void;
    onSelect?: (val: string) => void;
    placeholder: string;
    options: string[];
    appliedOptions?: Set<string> | string[];
    subtitleMap?: Record<string, string>;
    className?: string;
}

export const AutocompleteInput = React.forwardRef<HTMLInputElement, AutocompleteInputProps>(({
    value, onChange, onSelect, placeholder, options, appliedOptions, subtitleMap, className
}, ref) => {
    const [show, setShow] = useState(false);

    // Normalized set of applied items
    const appliedSet = React.useMemo(() => {
        if (!appliedOptions) return new Set<string>();
        if (appliedOptions instanceof Set) return appliedOptions;
        return new Set(appliedOptions.map(o => o.trim().toLowerCase()));
    }, [appliedOptions]);

    // Filter options based on input & sort unapplied to top
    const filtered = React.useMemo(() => {
        const query = (value || '').trim().toLowerCase();
        const matches = options.filter(opt => {
            if (!query) return true;
            return opt.toLowerCase().includes(query);
        });

        // Sort unapplied to top, applied to bottom
        return [...matches].sort((a, b) => {
            const isAppliedA = appliedSet.has(a.trim().toLowerCase());
            const isAppliedB = appliedSet.has(b.trim().toLowerCase());
            if (isAppliedA === isAppliedB) return 0;
            return isAppliedA ? 1 : -1;
        });
    }, [options, value, appliedSet]);

    return (
        <div className="relative">
            <input
                ref={ref}
                type="text"
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
                    setShow(true);
                }}
                onFocus={() => setShow(true)}
                // Delay blur to allow clicking the item
                onBlur={() => setTimeout(() => setShow(false), 200)}
                placeholder={placeholder}
                className={className}
                autoComplete="off"
            />
            {show && filtered.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl max-h-48 overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
                    {filtered.map(opt => {
                        const isApplied = appliedSet.has(opt.trim().toLowerCase());
                        const subtitle = subtitleMap ? subtitleMap[opt.trim().toLowerCase()] : null;

                        return (
                            <div
                                key={opt}
                                className={`px-3 py-2 text-xs flex items-center justify-between cursor-pointer font-medium border-b last:border-0 border-slate-100 dark:border-slate-800/50 transition-colors ${
                                    isApplied
                                        ? 'text-slate-400 dark:text-slate-500 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 bg-slate-50/40 dark:bg-slate-950/20'
                                        : 'text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-600 dark:hover:text-indigo-300'
                                }`}
                                onMouseDown={(e) => {
                                    // Use onMouseDown so it fires before onBlur
                                    e.preventDefault();
                                    onChange(opt);
                                    if (onSelect) onSelect(opt);
                                    setShow(false);
                                }}
                            >
                                <div className="flex flex-col min-w-0 pr-2">
                                    <span className={isApplied ? 'line-through opacity-75' : ''}>
                                        {opt}
                                    </span>
                                    {subtitle && (
                                        <span className="text-[10px] text-slate-400 font-mono truncate font-normal">
                                            {subtitle}
                                        </span>
                                    )}
                                </div>
                                {isApplied && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-500 dark:text-slate-400 shrink-0 ml-1">
                                        Applied
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
});

AutocompleteInput.displayName = 'AutocompleteInput';
