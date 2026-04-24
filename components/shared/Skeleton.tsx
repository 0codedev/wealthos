import React from 'react';

interface SkeletonProps {
    className?: string;
    style?: React.CSSProperties;
}

/**
 * Base skeleton component with shimmer animation
 */
export const Skeleton: React.FC<SkeletonProps> & {
    Card: React.FC<{ className?: string }>;
    Text: React.FC<{ lines?: number; className?: string }>;
    Circle: React.FC<{ size?: number; className?: string }>;
    Chart: React.FC<{ className?: string }>;
} = ({ className = '', style }) => {
    return (
        <div
            className={`animate-pulse bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200 
            dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 
            bg-[length:200%_100%] animate-shimmer rounded ${className}`}
            style={{
                animation: 'shimmer 1.5s ease-in-out infinite',
                ...style,
            }}
        />
    );
};

/**
 * Card-shaped skeleton for loading dashboard cards
 */
Skeleton.Card = ({ className = '' }) => (
    <div className={`bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 ${className}`}>
        <div className="flex items-center justify-between mb-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-8 rounded-full" />
        </div>
        <Skeleton className="h-8 w-32 mb-2" />
        <Skeleton className="h-4 w-20" />
    </div>
);

/**
 * Multi-line text skeleton for loading paragraphs
 */
Skeleton.Text = ({ lines = 3, className = '' }) => (
    <div className={`space-y-2 ${className}`}>
        {Array.from({ length: lines }).map((_, i) => (
            <Skeleton
                key={i}
                className={`h-4 ${i === lines - 1 ? 'w-3/4' : 'w-full'}`}
            />
        ))}
    </div>
);

/**
 * Circular skeleton for avatars and icons
 */
Skeleton.Circle = ({ size = 40, className = '' }) => (
    <Skeleton
        className={`rounded-full ${className}`}
        style={{ width: size, height: size }}
    />
);

/**
 * Chart placeholder skeleton
 */
Skeleton.Chart = ({ className = '' }) => (
    <div className={`bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 ${className}`}>
        <div className="flex items-center gap-2 mb-6">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex items-end gap-2 h-48">
            {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton
                    key={i}
                    className="flex-1 rounded-t"
                    style={{ height: `${30 + ((i * 17) % 65)}%` }}
                />
            ))}
        </div>
    </div>
);

/**
 * Dashboard loading skeleton layout
 */
export const DashboardSkeleton: React.FC = () => (
    <div className="space-y-6 animate-in fade-in duration-500">
        {/* Hero Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton.Card className="md:col-span-2 h-40" />
            <Skeleton.Card className="h-40" />
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton.Card key={i} />
            ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Skeleton.Chart className="h-80" />
            <Skeleton.Chart className="h-80" />
        </div>
    </div>
);

/**
 * Portfolio holdings skeleton
 */
export const HoldingsSkeleton: React.FC = () => (
    <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex items-center gap-4">
                <Skeleton.Circle size={48} />
                <div className="flex-1">
                    <Skeleton className="h-4 w-32 mb-2" />
                    <Skeleton className="h-3 w-20" />
                </div>
                <div className="text-right">
                    <Skeleton className="h-5 w-24 mb-1" />
                    <Skeleton className="h-3 w-16" />
                </div>
            </div>
        ))}
    </div>
);

/**
 * AI Advisor loading skeleton
 */
export const AdvisorSkeleton: React.FC = () => (
    <div className="h-[calc(100vh-4rem)] flex flex-col relative bg-slate-50 dark:bg-slate-950 animate-pulse">
        {/* Fake Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-905 px-4 py-3">
            <Skeleton className="h-8 w-24 rounded-lg" />
            <div className="flex gap-2">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-8 w-28 rounded-lg" />
                <Skeleton className="h-8 w-32 rounded-lg" />
            </div>
        </div>
        {/* Fake Chat Area */}
        <div className="flex-1 flex p-4 gap-4">
            {/* Fake Chat Window */}
            <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 flex flex-col justify-between">
                <div className="space-y-4 flex-1">
                    <div className="flex gap-3">
                        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                        <div className="space-y-2 flex-1">
                            <Skeleton className="h-4 w-1/3 rounded" />
                            <Skeleton className="h-16 w-3/4 rounded-2xl" />
                        </div>
                    </div>
                    <div className="flex gap-3 justify-end">
                        <div className="space-y-2 flex-1 flex flex-col items-end">
                            <Skeleton className="h-4 w-1/4 rounded" />
                            <Skeleton className="h-12 w-2/3 rounded-2xl" />
                        </div>
                        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                    </div>
                </div>
                {/* Fake Input bar */}
                <div className="mt-4 flex gap-2">
                    <Skeleton className="h-12 flex-1 rounded-2xl" />
                    <Skeleton className="h-12 w-12 rounded-2xl" />
                </div>
            </div>
        </div>
    </div>
);

/**
 * Apex Backtester loading skeleton
 */
export const BacktesterSkeleton: React.FC = () => (
    <div className="p-6 space-y-6 animate-pulse bg-slate-950 min-h-screen">
        {/* Fake Header */}
        <div className="flex items-center justify-between bg-slate-900/40 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center gap-3">
                <Skeleton className="h-6 w-6 rounded-lg" />
                <Skeleton className="h-4 w-32 rounded" />
            </div>
            <div className="flex gap-2">
                <Skeleton className="h-8 w-20 rounded-lg" />
                <Skeleton className="h-8 w-20 rounded-lg" />
                <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
        </div>
        {/* Fake Content Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-8 space-y-6">
                <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 h-[400px] flex flex-col justify-between">
                    <div className="space-y-4">
                        <Skeleton className="h-6 w-1/4 rounded" />
                        <Skeleton className="h-4 w-3/4 rounded" />
                    </div>
                    <div className="space-y-3">
                        <Skeleton className="h-12 w-full rounded-xl" />
                        <Skeleton className="h-12 w-full rounded-xl" />
                    </div>
                </div>
            </div>
            <div className="lg:col-span-4">
                <div className="bg-slate-900/40 border border-slate-800 rounded-[2.5rem] p-8 h-[400px] flex flex-col justify-between">
                    <Skeleton className="h-6 w-1/3 rounded" />
                    <div className="space-y-4">
                        <Skeleton className="h-4 w-full rounded" />
                        <Skeleton className="h-4 w-5/6 rounded" />
                        <Skeleton className="h-4 w-2/3 rounded" />
                    </div>
                    <Skeleton className="h-10 w-full rounded-xl" />
                </div>
            </div>
        </div>
    </div>
);

/**
 * Stock Research loading skeleton
 */
export const StockResearchSkeleton: React.FC = () => (
    <div className="p-6 space-y-6 animate-pulse">
        {/* Fake Search bar */}
        <div className="flex gap-3 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
            <Skeleton className="h-10 flex-1 rounded-xl" />
            <Skeleton className="h-10 w-24 rounded-xl" />
        </div>
        {/* Fake Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 h-[300px] flex flex-col justify-between">
                <Skeleton className="h-6 w-1/3 rounded" />
                <Skeleton.Chart className="h-48 border-none p-0 bg-transparent" />
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 h-[300px] flex flex-col justify-between">
                <Skeleton className="h-6 w-1/2 rounded" />
                <div className="space-y-3">
                    <Skeleton className="h-4 w-full rounded" />
                    <Skeleton className="h-4 w-5/6 rounded" />
                    <Skeleton className="h-4 w-4/5 rounded" />
                </div>
            </div>
        </div>
    </div>
);

/**
 * IPO War Room loading skeleton
 */
export const IPOWarRoomSkeleton: React.FC = () => (
    <div className="p-6 space-y-6 animate-pulse">
        <div className="flex items-center justify-between">
            <div className="space-y-2">
                <Skeleton className="h-4 w-24 rounded" />
                <Skeleton className="h-6 w-48 rounded" />
            </div>
            <Skeleton className="h-10 w-32 rounded-xl" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton.Card key={i} className="h-44" />
            ))}
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 h-[350px] flex flex-col justify-between">
            <Skeleton className="h-6 w-1/4 rounded" />
            <div className="space-y-4">
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
            </div>
        </div>
    </div>
);

export default Skeleton;
