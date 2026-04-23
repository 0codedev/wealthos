
import React from 'react';

export const CardSkeleton = () => (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm animate-pulse">
        <div className="h-6 w-1/3 bg-slate-200 dark:bg-slate-800 rounded mb-4"></div>
        <div className="space-y-3">
            <div className="h-4 w-full bg-slate-100 dark:bg-slate-800 rounded"></div>
            <div className="h-4 w-5/6 bg-slate-100 dark:bg-slate-800 rounded"></div>
            <div className="h-4 w-4/6 bg-slate-100 dark:bg-slate-800 rounded"></div>
        </div>
    </div>
);

export const BubbleSkeleton = ({ align = 'left' }: { align?: 'left' | 'right' }) => (
    <div className={`flex w-full mb-6 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
        <div className={`flex max-w-[80%] gap-4 items-start ${align === 'right' ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 shrink-0 animate-pulse"></div>
            <div className={`p-5 rounded-2xl border border-slate-200 dark:border-slate-800 w-64 ${align === 'right' ? 'bg-indigo-50 border-indigo-100' : 'bg-white dark:bg-slate-900'}`}>
                <div className="space-y-2 animate-pulse">
                    <div className="h-3 w-3/4 bg-slate-200 dark:bg-slate-800 rounded"></div>
                    <div className="h-3 w-1/2 bg-slate-200 dark:bg-slate-800 rounded"></div>
                </div>
            </div>
        </div>
    </div>
);

export const TextSkeleton = ({ lines = 3 }: { lines?: number }) => (
    <div className="space-y-2 animate-pulse w-full">
        {Array.from({ length: lines }).map((_, i) => (
            <div key={i} className="h-4 bg-slate-200 dark:bg-slate-800 rounded" style={{ width: `${Math.random() * 40 + 60}%` }}></div>
        ))}
    </div>
);
