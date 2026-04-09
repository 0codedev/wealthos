import React, { useState } from 'react';
import { Milestone, Trash2, Signpost, Plus } from 'lucide-react';
import { LifeEvent } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import { EmptyState } from '../../shared/EmptyState';
import { useToast } from '../../shared/ToastProvider';
import { pushUndo, consumeUndo, dropUndo } from '../../../lib/undoStack';
import { ValueFlash } from '../../shared/ValueFlash';

interface MilestoneTimelineWidgetProps {
    lifeEvents: LifeEvent[];
    addLifeEvent: (event: Omit<LifeEvent, 'id'>) => Promise<void>;
    deleteLifeEvent: (id: number) => Promise<void>;
}

const MilestoneTimelineWidget: React.FC<MilestoneTimelineWidgetProps> = ({
    lifeEvents, addLifeEvent, deleteLifeEvent
}) => {
    const { toast } = useToast();
    const [newEventName, setNewEventName] = useState('');
    const [newEventAmount, setNewEventAmount] = useState('');
    const [newEventDate, setNewEventDate] = useState('');

    const handleAddEvent = () => {
        if (!newEventName || !newEventAmount || !newEventDate) return;
        addLifeEvent({
            name: newEventName,
            amount: parseFloat(newEventAmount),
            date: newEventDate,
            type: 'EXPENSE'
        });
        setNewEventName('');
        setNewEventAmount('');
        setNewEventDate('');
    };

    return (
        <div className="bg-white/60 dark:bg-slate-950/50 backdrop-blur-xl border border-slate-200 dark:border-slate-800 rounded-3xl p-6 relative overflow-hidden h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-2 mb-6">
                <Signpost size={16} className="text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-bold text-slate-900 dark:text-white text-sm uppercase tracking-wider">Milestone Timeline</h3>
            </div>

            {/* List Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar mb-6 min-h-[150px]">
                {lifeEvents.length === 0 ? (
                    <EmptyState
                        variant="minimal"
                        icon={Signpost}
                        title="No future events logged"
                        description="Add weddings, vacations, or big purchases to see their impact on your runway."
                        actionLabel="Add Milestone"
                        onAction={handleAddEvent}
                    />
                ) : (
                    <div className="space-y-3">
                        {lifeEvents.map((evt) => (
                            <div key={evt.id} className="flex justify-between items-center bg-white/60 dark:bg-slate-900/50 backdrop-blur-sm p-3 rounded-xl border border-slate-200 dark:border-slate-800 group hover:border-indigo-500/30 transition-all">
                                <div>
                                    <p className="text-sm font-bold text-slate-900 dark:text-white">{evt.name}</p>
                                    <p className="text-xs text-slate-500">{new Date(evt.date).toLocaleDateString()}</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <ValueFlash value={evt.amount} className="inline-block" epsilon={1}>
                                        <span className="text-sm font-mono font-bold text-rose-600 dark:text-rose-400">-{formatCurrency(evt.amount)}</span>
                                    </ValueFlash>
                                    <button
                                        onClick={() => {
                                            if (!evt.id) return;
                                            const snapshot = { ...evt };
                                            const entry = pushUndo({
                                                kind: 'lifeEvent',
                                                label: evt.name,
                                                message: `Life event deleted: ${evt.name}`,
                                                undo: async () => {
                                                    const { id, ...rest } = snapshot;
                                                    await addLifeEvent(rest as Omit<LifeEvent, 'id'>);
                                                },
                                            });
                                            toast.success(`Deleted "${evt.name}"`, {
                                                duration: 5000,
                                                action: {
                                                    label: 'Undo',
                                                    onClick: async () => {
                                                        consumeUndo(entry.id);
                                                        const { id, ...rest } = snapshot;
                                                        await addLifeEvent(rest as Omit<LifeEvent, 'id'>);
                                                    }
                                                }
                                            });
                                            window.setTimeout(() => {
                                                dropUndo(entry.id);
                                                if (evt.id !== undefined) deleteLifeEvent(evt.id);
                                            }, 5000);
                                        }}
                                        className="text-slate-650 hover:text-rose-500 transition-colors"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Add Event Form */}
            <div className="bg-white/60 dark:bg-slate-900/50 backdrop-blur-sm p-4 rounded-xl border border-slate-200 dark:border-slate-800/50">
                <p className="text-[10px] font-bold text-slate-550 uppercase mb-3">Add Life Event</p>
                <div className="space-y-3">
                    <input
                        value={newEventName}
                        onChange={e => setNewEventName(e.target.value)}
                        placeholder="e.g. Wedding, Vacation, Car"
                        className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-indigo-500 outline-none"
                    />
                    <div className="flex gap-3">
                        <input
                            type="number"
                            value={newEventAmount}
                            onChange={e => setNewEventAmount(e.target.value)}
                            placeholder="₹ Amount"
                            className="flex-1 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-indigo-500 outline-none"
                        />
                        <input
                            type="date"
                            value={newEventDate}
                            onChange={e => setNewEventDate(e.target.value)}
                            className="w-32 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-indigo-500 outline-none"
                        />
                    </div>
                    <button
                        onClick={handleAddEvent}
                        disabled={!newEventName || !newEventAmount || !newEventDate}
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        Add Milestone
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MilestoneTimelineWidget;
