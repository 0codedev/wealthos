import React, { useState } from 'react';
import { Users, Plus, AlertTriangle, Trash2, Heart } from 'lucide-react';
import { LegacyBeneficiary } from './types';

// ===================== LEGACY PLANNING =====================
export const LegacyPlanning: React.FC = React.memo(() => {
    const [beneficiaries, setBeneficiaries] = useState<LegacyBeneficiary[]>([
        { id: '1', name: 'Spouse', email: 'spouse@email.com', relationship: 'Spouse', share: 50 },
        { id: '2', name: 'Child 1', email: 'child1@email.com', relationship: 'Child', share: 25 },
        { id: '3', name: 'Child 2', email: 'child2@email.com', relationship: 'Child', share: 25 },
    ]);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newBeneficiary, setNewBeneficiary] = useState({ name: '', email: '', relationship: '', share: 0 });

    const totalShare = beneficiaries.reduce((sum, b) => sum + b.share, 0);

    const handleAdd = () => {
        if (!newBeneficiary.name || !newBeneficiary.email) return;
        setBeneficiaries([...beneficiaries, {
            id: Date.now().toString(),
            ...newBeneficiary,
            share: newBeneficiary.share || 0
        }]);
        setNewBeneficiary({ name: '', email: '', relationship: '', share: 0 });
        setShowAddForm(false);
    };

    const handleDelete = (id: string) => {
        setBeneficiaries(beneficiaries.filter(b => b.id !== id));
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-amber-300 uppercase flex items-center gap-2">
                    <Users size={14} /> Beneficiaries
                </h4>
                <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="text-[10px] bg-amber-500/10 text-amber-400 px-2 py-1 rounded-full hover:bg-amber-500/20 border border-amber-500/20"
                >
                    <Plus size={10} className="inline mr-1" /> Add
                </button>
            </div>

            {totalShare !== 100 && (
                <div className="bg-rose-950/20 border border-rose-500/30 rounded-lg p-2 text-[10px] text-rose-400 flex items-center gap-2">
                    <AlertTriangle size={12} />
                    Total share is {totalShare}% (should be 100%)
                </div>
            )}

            {showAddForm && (
                <div className="bg-slate-950 p-3 rounded-xl border border-amber-500/30 space-y-2 animate-in fade-in">
                    <input
                        type="text"
                        placeholder="Name"
                        value={newBeneficiary.name}
                        onChange={e => setNewBeneficiary({ ...newBeneficiary, name: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                    />
                    <input
                        type="email"
                        placeholder="Email"
                        value={newBeneficiary.email}
                        onChange={e => setNewBeneficiary({ ...newBeneficiary, email: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                    />
                    <div className="flex gap-2">
                        <select
                            value={newBeneficiary.relationship}
                            onChange={e => setNewBeneficiary({ ...newBeneficiary, relationship: e.target.value })}
                            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                        >
                            <option value="">Relationship</option>
                            <option value="Spouse">Spouse</option>
                            <option value="Child">Child</option>
                            <option value="Parent">Parent</option>
                            <option value="Sibling">Sibling</option>
                            <option value="Other">Other</option>
                        </select>
                        <input
                            type="number"
                            placeholder="%"
                            value={newBeneficiary.share || ''}
                            onChange={e => setNewBeneficiary({ ...newBeneficiary, share: parseInt(e.target.value) || 0 })}
                            className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white text-center"
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setShowAddForm(false)} className="text-[10px] text-slate-400">Cancel</button>
                        <button onClick={handleAdd} className="text-[10px] bg-amber-600 text-white px-3 py-1 rounded">Add</button>
                    </div>
                </div>
            )}

            <div className="space-y-2">
                {beneficiaries.map(b => (
                    <div key={b.id} className="flex items-center justify-between p-3 bg-slate-900/50 rounded-xl border border-slate-800 group hover:border-amber-500/30">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 text-xs font-bold">
                                {b.name.charAt(0)}
                            </div>
                            <div>
                                <p className="text-xs font-bold text-slate-200">{b.name}</p>
                                <p className="text-[9px] text-slate-500">{b.relationship} • {b.email}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-mono font-bold text-amber-400">{b.share}%</span>
                            <button
                                onClick={() => handleDelete(b.id)}
                                className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-500 transition-all"
                            >
                                <Trash2 size={12} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-3">
                <p className="text-[10px] text-amber-300 leading-relaxed">
                    <Heart size={10} className="inline mr-1" />
                    Upon activation of Dead Man's Switch, your encrypted vault access will be securely shared with verified beneficiaries.
                </p>
            </div>
        </div>
    );
});

LegacyPlanning.displayName = 'LegacyPlanning';
