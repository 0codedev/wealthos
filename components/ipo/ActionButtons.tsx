import React from 'react';
import { RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { IPOApplication } from '../../database'; // Adjust import path as needed

interface ActionButtonsProps {
    app: IPOApplication;
    updateStatus: (id: number, status: IPOApplication['status']) => void;
    deleteApp: (id: number) => void;
}

export const ActionButtons = React.memo(({ app, updateStatus, deleteApp }: ActionButtonsProps) => (
    <>
        {app.status === 'BLOCKED' && (
            <>
                <button
                    onClick={() => updateStatus(app.id!, 'REFUNDED')}
                    className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors"
                    title="Mark Refunded"
                >
                    <RefreshCw size={14} />
                </button>
                <button
                    onClick={() => updateStatus(app.id!, 'ALLOTTED')}
                    className="p-1.5 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="Mark Allotted"
                >
                    <ShieldCheck size={14} />
                </button>
            </>
        )}
        <button onClick={() => deleteApp(app.id!)} className="p-1.5 text-slate-300 hover:text-rose-500 transition-colors">
            <Trash2 size={14} />
        </button>
    </>
));
