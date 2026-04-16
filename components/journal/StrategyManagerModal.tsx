
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, CheckCircle2, Save, BookOpen, AlertCircle } from 'lucide-react';
import { db, Strategy } from '../../database';

interface StrategyManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const StrategyManagerModal: React.FC<StrategyManagerModalProps> = ({ isOpen, onClose }) => {
    const [strategies, setStrategies] = useState<Strategy[]>([]);
    const [editingId, setEditingId] = useState<number | null>(null);

    // Form State
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [rules, setRules] = useState<string[]>(['']);

    useEffect(() => {
        if (isOpen) loadStrategies();
    }, [isOpen]);

    const loadStrategies = async () => {
        const data = await db.strategies.toArray();
        setStrategies(data);
    };

    const handleEdit = (s: Strategy) => {
        setEditingId(s.id!);
        setName(s.name);
        setDescription(s.description || '');
        setRules(s.rules.length > 0 ? s.rules : ['']);
    };

    const handleNew = () => {
        setEditingId(-1); // -1 indicates new
        setName('');
        setDescription('');
        setRules(['']);
    };

    const handleSave = async () => {
        if (!name.trim()) return;
        const cleanRules = rules.filter(r => r.trim() !== '');

        if (editingId === -1) {
            await db.strategies.add({ name, description, rules: cleanRules });
        } else if (editingId) {
            await db.strategies.update(editingId, { name, description, rules: cleanRules });
        }

        setEditingId(null);
        loadStrategies();
    };

    const handleDelete = async (id: number) => {
        if (confirm('Delete this strategy?')) {
            await db.strategies.delete(id);
            loadStrategies();
            if (editingId === id) setEditingId(null);
        }
    };

    const handleRuleChange = (index: number, val: string) => {
        const newRules = [...rules];
        newRules[index] = val;
        setRules(newRules);
    };

    const addRule = () => setRules([...rules, '']);
    const removeRule = (index: number) => setRules(rules.filter((_, i) => i !== index));

    if (!isOpen) return null;
    if (typeof window === 'undefined') return null;

    return createPortal(
        <div role="dialog" aria-modal="true" aria-labelledby="strategy-manager-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl h-[80vh] overflow-hidden flex flex-col md:flex-row">

                {/* Sidebar List */}
                <div className="w-full md:w-1/3 bg-slate-50 dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 flex flex-col">
                    <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                        <h3 className="font-bold text-slate-700 dark:text-white flex items-center gap-2">
                            <BookOpen size={18} className="text-indigo-500" /> Strategies
                        </h3>
                        <button onClick={handleNew} className="p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors">
                            <Plus size={18} />
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {strategies.map(s => (
                            <div
                                key={s.id}
                                onClick={() => handleEdit(s)}
                                className={`p-3 rounded-xl cursor-pointer transition-all border ${editingId === s.id ? 'bg-white dark:bg-slate-800 border-indigo-500 shadow-md' : 'bg-transparent border-transparent hover:bg-slate-100 dark:hover:bg-slate-900'}`}
                            >
                                <div className="flex justify-between items-start">
                                    <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200">{s.name}</h4>
                                    {editingId === s.id && <div className="w-2 h-2 rounded-full bg-indigo-500 mt-1.5"></div>}
                                </div>
                                <p className="text-xs text-slate-500 truncate mt-1">{s.description || 'No description'}</p>
                                <div className="flex gap-1 mt-2">
                                    <span className="text-[10px] bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-500">{s.rules.length} Rules</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Edit Area */}
                <div className="flex-1 flex flex-col bg-white dark:bg-slate-900">
                    <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                        <h3 className="font-bold text-slate-500 uppercase text-xs tracking-wider">
                            {editingId === -1 ? 'Create New Strategy' : editingId ? 'Edit Strategy' : 'Select a Strategy'}
                        </h3>
                        <button onClick={onClose} aria-label="Close modal" className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                            <X size={20} />
                        </button>
                    </div>

                    {editingId ? (
                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Strategy Name</label>
                                <input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="e.g. Bull Flag Breakout"
                                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-lg font-bold outline-none focus:border-indigo-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description / Thesis</label>
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="What is the edge here?"
                                    rows={2}
                                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-sm outline-none focus:border-indigo-500 resize-none"
                                />
                            </div>

                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Pre-Trade Checklist (Rules)</label>
                                    <button onClick={addRule} className="text-xs font-bold text-indigo-500 hover:underline flex items-center gap-1">
                                        <Plus size={12} /> Add Rule
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    {rules.map((rule, idx) => (
                                        <div key={idx} className="flex gap-2 items-center">
                                            <span className="text-xs font-mono text-slate-400 w-4">{idx + 1}.</span>
                                            <input
                                                value={rule}
                                                onChange={(e) => handleRuleChange(idx, e.target.value)}
                                                placeholder={`Rule #${idx + 1}`}
                                                className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-sm outline-none focus:border-indigo-500"
                                            />
                                            <button onClick={() => removeRule(idx)} className="text-slate-400 hover:text-rose-500">
                                                <X size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-50">
                            <BookOpen size={64} className="mb-4 text-slate-300 dark:text-slate-700" />
                            <p>Select or create a strategy to manage your edge.</p>
                        </div>
                    )}

                    {editingId && (
                        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-between bg-slate-50 dark:bg-slate-950">
                            <button
                                onClick={() => handleDelete(editingId)}
                                disabled={editingId === -1}
                                className="px-4 py-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg font-bold text-sm transition-colors disabled:opacity-0"
                            >
                                Delete
                            </button>
                            <button
                                onClick={handleSave}
                                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-sm shadow-lg shadow-indigo-500/20 flex items-center gap-2"
                            >
                                <Save size={16} /> Save Strategy
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default StrategyManagerModal;
