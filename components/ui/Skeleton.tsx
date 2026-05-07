
import React from 'react';

/**
 * Premium Loading Skeleton System (Agent X / CC1 / CC7)
 *
 * - CC1 introduced the `.animate-shimmer-premium` sweep.
 * - CC4 renamed it to `.animate-shimmer-cc4`.
 * - CC7 adds a *triple-layer* shimmer via the new `.cc7-shimmer` class:
 *     1. base solid neutral (visible before sweep starts)
 *     2. white/slate highlight band (the "wave")
 *     3. low-alpha indigo/violet echo band offset by 0.5s
 *   All three animate `background-position` only → GPU-friendly, no layout.
 *
 * The original `skeleton-shimmer` and `animate-shimmer-cc4` classes are kept
 * as fallbacks (the brief says "do not delete, rename, or move any file").
 * The `premium` flag (default true) selects the new triple-layer look.
 */

const fallbackShimmerStyle = `
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton-shimmer {
  background: linear-gradient(
    90deg,
    rgba(226, 232, 240, 0.5) 25%,
    rgba(241, 245, 249, 0.8) 50%,
    rgba(226, 232, 240, 0.5) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
.dark .skeleton-shimmer {
  background: linear-gradient(90deg, rgba(30,41,59,0.8) 25%, rgba(51,65,85,0.9) 50%, rgba(30,41,59,0.8) 75%);
}
`;

/**
 * Triple-layer shimmer container (CC7). Renders a base tone with two
 * overlapping gradient sweeps animating on top. GPU-accelerated.
 */
const ShimmerSweep: React.FC<{ className?: string; style?: React.CSSProperties; children?: React.ReactNode }> = ({
    className = '',
    style,
    children
}) => (
    <div
        className={`cc7-shimmer ${className}`}
        style={style}
    >
        {children}
    </div>
);

export const SkeletonLine: React.FC<{ width?: string; height?: number; rounded?: boolean, className?: string, style?: React.CSSProperties; premium?: boolean }> = ({
    width = '100%',
    height = 16,
    rounded = false,
    className = "",
    style = {},
    premium = true,
}) => {
    if (premium) {
        return (
            <ShimmerSweep
                className={className}
                style={{ width, height: `${height}px`, borderRadius: rounded ? '9999px' : '0.5rem', ...style }}
            />
        );
    }
    return (
        <>
            <style>{fallbackShimmerStyle}</style>
            <div
                className={`skeleton-shimmer ${className}`}
                style={{
                    width,
                    height: `${height}px`,
                    borderRadius: rounded ? '9999px' : '0.5rem',
                    ...style
                }}
            />
        </>
    );
};

export const SkeletonBox: React.FC<{ width?: string; height?: string; rounded?: string, className?: string; style?: React.CSSProperties; premium?: boolean }> = ({
    width = '100%',
    height = '100px',
    rounded = '1rem',
    className = "",
    style = {},
    premium = true
}) => {
    if (premium) {
        return (
            <ShimmerSweep
                className={className}
                style={{ width, height, borderRadius: rounded, ...style }}
            />
        );
    }
    return (
        <div
            className={`skeleton-shimmer ${className}`}
            style={{ width, height, borderRadius: rounded, ...style }}
        />
    );
};

export const SkeletonText: React.FC<{ lines?: number; spacing?: number }> = ({
    lines = 3,
    spacing = 8
}) => {
    const widths = ['100%', '85%', '92%', '78%', '95%'];
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: `${spacing}px` }}>
            {Array.from({ length: lines }).map((_, i) => (
                <SkeletonLine key={i} width={widths[i % widths.length]} />
            ))}
        </div>
    );
};

export const SkeletonCard: React.FC<{ padding?: string }> = ({ padding = '1.5rem' }) => (
    <div className="bg-white/60 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm" style={{ padding }}>
        <SkeletonLine width="40%" height={20} rounded style={{ marginBottom: '1.5rem' }} />
        <SkeletonBox height="150px" style={{ marginBottom: '1.5rem' }} />
        <SkeletonText lines={2} />
    </div>
);

export const SkeletonTable: React.FC<{ rows?: number; cols?: number }> = ({ rows = 5, cols = 4 }) => (
    <div className="w-full space-y-4">
        {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="flex gap-4">
                {Array.from({ length: cols }).map((_, c) => (
                    <div key={c} className="flex-1">
                        <SkeletonLine height={20} />
                    </div>
                ))}
            </div>
        ))}
    </div>
);

export const SkeletonNumber: React.FC<{ size?: 'sm' | 'md' | 'lg' | 'xl' }> = ({ size = 'md' }) => {
    const heights = { sm: 16, md: 24, lg: 32, xl: 48 };
    const widths = { sm: '60px', md: '100px', lg: '140px', xl: '200px' };
    return (
        <ShimmerSweep
            style={{
                width: widths[size],
                height: `${heights[size]}px`,
                borderRadius: '0.75rem',
            }}
        />
    );
};

/**
 * Per-widget skeleton that mirrors a typical dashboard widget layout
 * (title row, KPI number, two body lines). Use as a drop-in for the
 * "Loading..." string inside any widget that has those three regions.
 */
export const SkeletonWidget: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div
        className={`bg-white/60 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 md:p-6 shadow-sm ${className}`}
        role="status"
        aria-label="Loading widget"
    >
        <div className="flex items-center justify-between mb-4">
            <SkeletonLine width="40%" height={14} />
            <SkeletonLine width="14%" height={14} rounded />
        </div>
        <div className="mb-3">
            <SkeletonNumber size="lg" />
        </div>
        <div className="space-y-2">
            <SkeletonLine width="100%" height={10} />
            <SkeletonLine width="80%" height={10} />
        </div>
    </div>
);

export default {
    Line: SkeletonLine,
    Box: SkeletonBox,
    Text: SkeletonText,
    Card: SkeletonCard,
    Table: SkeletonTable,
    Number: SkeletonNumber,
    Widget: SkeletonWidget,
};

// CC97: Real-shape loading skeletons that mirror the layout of common
// dashboard surfaces. Most widgets are KPI-tile-shaped (title + number +
// 2-3 body lines), so SkeletonWidget covers the dominant case. The new
// exports below add table-shaped, list-shaped, chart-shaped, and
// stat-grid-shaped skeletons so loading state matches the surface that
// is about to render — no more "Loading..." text jumping to a 12-row
// table when data arrives.

/**
 * Table-shaped skeleton — header row + N body rows × M cols. Use as a
 * drop-in for any data table during fetch.
 */
export const SkeletonDataTable: React.FC<{ rows?: number; cols?: number; className?: string }> = ({
    rows = 6,
    cols = 5,
    className = '',
}) => (
    <div
        className={`bg-white/60 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-sm ${className}`}
        role="status"
        aria-label="Loading table"
    >
        <div className="flex gap-4 pb-3 mb-3 border-b border-slate-200 dark:border-slate-800">
            {Array.from({ length: cols }).map((_, c) => (
                <div key={c} className="flex-1">
                    <SkeletonLine width="70%" height={10} rounded />
                </div>
            ))}
        </div>
        <div className="space-y-3">
            {Array.from({ length: rows }).map((_, r) => (
                <div key={r} className="flex gap-4">
                    {Array.from({ length: cols }).map((_, c) => (
                        <div key={c} className="flex-1">
                            <SkeletonLine width={c === 0 ? '85%' : '60%'} height={12} />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    </div>
);

/**
 * List-shaped skeleton — icon + N lines of varying widths. Use for any
 * list/feed-style surface (transactions, alerts, news, etc.).
 */
export const SkeletonList: React.FC<{ items?: number; className?: string }> = ({
    items = 5,
    className = '',
}) => (
    <div
        className={`bg-white/60 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-sm space-y-4 ${className}`}
        role="status"
        aria-label="Loading list"
    >
        {Array.from({ length: items }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
                <SkeletonBox width="40px" height="40px" rounded="9999px" />
                <div className="flex-1 space-y-2">
                    <SkeletonLine width={`${50 + (i * 7) % 30}%`} height={12} />
                    <SkeletonLine width={`${30 + (i * 11) % 40}%`} height={10} />
                </div>
            </div>
        ))}
    </div>
);

/**
 * Chart-shaped skeleton — a 200px-tall block with a faint horizontal
 * axis line. Use for any line/bar/area chart during fetch.
 */
export const SkeletonChart: React.FC<{ height?: string; className?: string }> = ({
    height = '240px',
    className = '',
}) => (
    <div
        className={`bg-white/60 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-sm ${className}`}
        role="status"
        aria-label="Loading chart"
    >
        <div className="flex items-center justify-between mb-4">
            <SkeletonLine width="30%" height={14} />
            <SkeletonLine width="14%" height={14} rounded />
        </div>
        <div className="relative" style={{ height }}>
            <SkeletonBox width="100%" height="100%" rounded="0.75rem" />
            <div className="absolute bottom-0 left-0 right-0 h-px bg-slate-200 dark:bg-slate-800" />
        </div>
    </div>
);

/**
 * Stat-grid skeleton — 2-4 KPI tiles in a responsive grid. Use for
 * hero summaries, dashboard overviews, or any "stats row" surface.
 */
export const SkeletonStatGrid: React.FC<{ count?: number; className?: string }> = ({
    count = 4,
    className = '',
}) => (
    <div
        className={`grid grid-cols-2 lg:grid-cols-${Math.min(count, 4)} gap-3 sm:gap-4 ${className}`}
        role="status"
        aria-label="Loading statistics"
    >
        {Array.from({ length: count }).map((_, i) => (
            <div
                key={i}
                className="bg-white/60 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2"
            >
                <SkeletonLine width="55%" height={10} rounded />
                <SkeletonNumber size={i === 0 ? 'lg' : 'md'} />
                <SkeletonLine width="40%" height={8} />
            </div>
        ))}
    </div>
);
