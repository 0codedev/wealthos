import React from 'react';

export const StatusBadge = React.memo(({ status }: { status: string }) => (
    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${displayStatusColor(status)}`}>
        {status === 'LISTED' ? 'REALIZED' : status}
    </span>
));

const displayStatusColor = (status: string) => {
    switch (status) {
        case 'BLOCKED': return 'bg-amber-100 text-amber-600 border-amber-200';
        case 'ALLOTTED': return 'bg-emerald-100 text-emerald-600 border-emerald-200';
        case 'LISTED': return 'bg-emerald-100 text-emerald-600 border-emerald-200'; // Same as Allotted
        case 'REFUNDED': return 'bg-slate-100 text-slate-500 border-slate-200';
        default: return 'bg-slate-100 text-slate-500 border-slate-200';
    }
};
