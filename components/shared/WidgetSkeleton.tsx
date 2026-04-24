import React from 'react';
import { Loader2 } from 'lucide-react';

interface WidgetSkeletonProps {
    title?: string;
    height?: string;
    className?: string;
}

const WidgetSkeleton: React.FC<WidgetSkeletonProps> = ({ title, height = "h-[300px]", className = "" }) => {
    return (
        <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm ${className}`}>
            <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse"></div>
                <div className="space-y-2">
                    <div className="h-4 w-32 bg-slate-200 dark:bg-slate-800 rounded animate-pulse"></div>
                    <div className="h-2 w-20 bg-slate-200 dark:bg-slate-800 rounded animate-pulse"></div>
                </div>
            </div>
            <div className={`${height} bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center`}>
                <Loader2 className="text-slate-300 dark:text-slate-700 animate-spin mb-2" size={32} />
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">{title ? `Loading ${title}...` : 'Loading Widget...'}</p>
            </div>
        </div>
    );
};

export default WidgetSkeleton;
