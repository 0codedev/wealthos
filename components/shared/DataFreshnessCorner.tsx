import React from 'react';
import { useDataFreshness, type FreshnessStatus } from './DataFreshnessProvider';

/**
 * DataFreshnessCorner — a small corner dot that signals how recent the
 * surrounding data is. Auto-derives its color and pulse from the
 * DataFreshnessProvider context. Pure presentation; no logic.
 */

const STATUS_COLOR: Record<FreshnessStatus, string> = {
    live: 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.65)]',
    cached: 'bg-indigo-500',
    stale: 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]',
    degraded: 'bg-rose-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]',
    unknown: 'bg-slate-400',
};

const STATUS_LABEL: Record<FreshnessStatus, string> = {
    live: 'Live',
    cached: 'Cached',
    stale: 'Stale',
    degraded: 'Degraded',
    unknown: 'Unknown',
};

export interface DataFreshnessCornerProps {
    /** Optional override. If omitted, the dot uses the provider context. */
    status?: FreshnessStatus;
    /** Optional override of the timestamp. */
    fetchedAt?: number | null;
    className?: string;
}

export const DataFreshnessCorner: React.FC<DataFreshnessCornerProps> = ({
    status: statusOverride,
    fetchedAt: tsOverride,
    className = '',
}) => {
    const ctx = useDataFreshness();
    const status = statusOverride ?? ctx.status;
    const fetchedAt = tsOverride ?? ctx.lastFetchedAt;

    const ariaLabel = fetchedAt
        ? `${STATUS_LABEL[status]} data, updated ${new Date(fetchedAt).toLocaleTimeString()}`
        : `${STATUS_LABEL[status]} data`;

    return (
        <span
            aria-label={ariaLabel}
            title={ariaLabel}
            role="status"
            className={`inline-block h-2 w-2 rounded-full ${STATUS_COLOR[status]} ${status === 'live' ? 'animate-pulse' : ''} ${className}`}
        />
    );
};

export default DataFreshnessCorner;
