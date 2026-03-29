import React, { useCallback } from 'react';
import { FileText, AlertTriangle, CheckCircle2, Clock, Download } from 'lucide-react';
import { useVirtualScroll } from '../hooks/useVirtualScroll';

interface AuditEvent {
    id: number;
    type: 'TAX_HARVEST' | 'WASH_SALE' | 'LTCG_ALERT' | 'SYSTEM';
    message: string;
    timestamp: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

const MOCK_AUDIT_LOG: AuditEvent[] = [
    { id: 1, type: 'SYSTEM', message: 'Compliance Engine Initialized v2.4', timestamp: '2024-10-24 09:00', severity: 'LOW' },
    { id: 2, type: 'LTCG_ALERT', message: 'Realized LTCG crossed ₹1L threshold', timestamp: '2024-11-02 14:30', severity: 'MEDIUM' },
    { id: 3, type: 'WASH_SALE', message: 'Potential Wash Sale detected on ADANIENT', timestamp: '2024-11-15 11:15', severity: 'HIGH' },
    { id: 4, type: 'TAX_HARVEST', message: 'Harvested ₹12,000 loss in TATAMOTORS', timestamp: '2024-12-01 10:00', severity: 'LOW' },
];

const AuditLog: React.FC = () => {
    const { containerRef, onScroll, visibleItems, totalHeight, offsetY } = useVirtualScroll({
        itemHeight: 90, // Card height + gap
        itemsCount: MOCK_AUDIT_LOG.length,
        containerHeight: 400 // Approximation
    });

    // Export handlers
    const exportToCSV = useCallback(() => {
        const headers = ['ID', 'Type', 'Message', 'Timestamp', 'Severity'];
        const rows = MOCK_AUDIT_LOG.map(e =>
            [e.id, e.type, `"${e.message}"`, e.timestamp, e.severity].join(',')
        );
        const csv = [headers.join(','), ...rows].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit_log_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, []);

    const exportToJSON = useCallback(() => {
        const json = JSON.stringify(MOCK_AUDIT_LOG, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit_log_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, []);

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm h-full flex flex-col">
            <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                    <FileText size={20} className="text-indigo-500" /> Compliance Audit Log
                </h3>
                <div className="flex items-center gap-2">
                    <button
                        onClick={exportToCSV}
                        className="flex items-center gap-1 text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-400 transition-colors"
                        title="Export as CSV"
                    >
                        <Download size={12} /> CSV
                    </button>
                    <button
                        onClick={exportToJSON}
                        className="flex items-center gap-1 text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-400 transition-colors"
                        title="Export as JSON"
                    >
                        <Download size={12} /> JSON
                    </button>
                    <span className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-500 font-mono">
                        FY 2024-25
                    </span>
                </div>
            </div>

            <div
                ref={containerRef}
                onScroll={onScroll}
                className="flex-1 overflow-y-auto pr-2 relative"
            >
                <div style={{ height: totalHeight, position: 'relative' }}>
                    <div style={{ transform: `translateY(${offsetY}px)` }} className="space-y-4">
                        {visibleItems.map((index) => {
                            const event = MOCK_AUDIT_LOG[index];
                            return (
                                <div key={event.id} className="flex gap-4 relative">
                                    {/* Timeline Line */}
                                    <div className="absolute left-[19px] top-8 bottom-[-16px] w-0.5 bg-slate-100 dark:bg-slate-800 last:hidden"></div>

                                    <div className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center border-4 border-white dark:border-slate-900 z-10 
                                    ${event.severity === 'HIGH' ? 'bg-rose-100 text-rose-500' :
                                            event.severity === 'MEDIUM' ? 'bg-amber-100 text-amber-500' :
                                                'bg-slate-100 text-slate-500'}`}>
                                        {event.severity === 'HIGH' ? <AlertTriangle size={18} /> :
                                            event.severity === 'MEDIUM' ? <Clock size={18} /> :
                                                <CheckCircle2 size={18} />}
                                    </div>

                                    <div className="flex-1 pb-4">
                                        <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                                            <div className="flex justify-between items-start mb-1">
                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider 
                                                ${event.type === 'WASH_SALE' ? 'bg-rose-100 text-rose-600' :
                                                        event.type === 'LTCG_ALERT' ? 'bg-amber-100 text-amber-600' :
                                                            'bg-slate-200 text-slate-600'}`}>
                                                    {event.type.replace('_', ' ')}
                                                </span>
                                                <span className="text-[10px] text-slate-400 font-mono">{event.timestamp}</span>
                                            </div>
                                            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                                {event.message}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AuditLog;
