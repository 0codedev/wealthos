import React from 'react';
import { LucideIcon } from 'lucide-react';

interface TabHeroProps {
    eyebrow: string;
    title: string;
    description: string;
    icon: LucideIcon;
    iconTone?: string;
    gradientClassName?: string;
    actions?: React.ReactNode;
    chips?: string[];
    children?: React.ReactNode;
}

export const TabHero: React.FC<TabHeroProps> = ({
    eyebrow,
    title,
    description,
    icon: Icon,
    iconTone = 'text-indigo-500',
    gradientClassName = 'from-indigo-50 via-white to-sky-50 dark:from-indigo-950/20 dark:via-slate-950 dark:to-sky-950/20',
    actions,
    chips = [],
    children,
}) => {
    return (
        <div className={`overflow-visible rounded-2xl border border-slate-200/80 dark:border-white/[0.08] bg-white/80 dark:bg-slate-900/50 backdrop-blur-xl px-3 sm:px-4 py-2.5 sm:py-3 shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:shadow-none`}>
            <div className="grid items-center gap-2.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-4">
                <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                    <div className={`flex h-8 w-8 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-white/[0.06] ring-1 ring-slate-200/80 dark:ring-white/[0.08] ${iconTone}`}>
                        <Icon size={16} className="sm:w-[18px] sm:h-[18px]" />
                    </div>
                    <div className="min-w-0 space-y-0.5 sm:space-y-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="hidden sm:block shrink-0 text-[10px] leading-none font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{eyebrow}</p>
                            <h2 className="min-w-0 text-[14px] sm:text-[15px] leading-none font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                                {title}
                                {description && (
                                    <span 
                                        className="inline-flex sm:hidden items-center justify-center w-4 h-4 rounded-full bg-slate-100 dark:bg-white/[0.06] text-slate-400 text-[9px] font-bold cursor-help"
                                        title={description}
                                        aria-label="More information"
                                    >
                                        ⓘ
                                    </span>
                                )}
                            </h2>
                        </div>
                        <p className="hidden md:block max-w-3xl text-[11px] leading-[1.35] text-slate-600 dark:text-slate-300 line-clamp-1" title={description}>{description}</p>
                    </div>
                </div>

                {(actions || children) && (
                    <div className="flex flex-col justify-center gap-2 lg:row-span-2 lg:min-w-max">
                        {actions && <div className="flex items-center justify-start overflow-visible lg:justify-end">{actions}</div>}
                        {children && <div className="flex items-center justify-start overflow-visible lg:justify-end">{children}</div>}
                    </div>
                )}

                {chips.length > 0 && (
                    <div className="hidden sm:flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        {chips.map((chip) => (
                            <span
                                key={chip}
                                className="inline-flex min-h-[26px] items-center rounded-full bg-slate-100/80 dark:bg-white/[0.05] px-2.5 py-1 text-[9px] leading-none font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 ring-1 ring-slate-200/80 dark:ring-white/[0.08]"
                            >
                                {chip}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TabHero;
