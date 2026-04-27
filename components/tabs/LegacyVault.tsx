import React, { useState, useEffect } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import {
    Shield, Users, FileText, Lock, Plus, Trash2,
    Printer, Heart, AlertTriangle, CheckCircle, Loader2
} from 'lucide-react';
import {
    PieChart, Pie, Cell, Tooltip, Legend
} from 'recharts';
import { Investment } from '../../types';
import { db, Beneficiary } from '../../database';
import { liveQuery } from 'dexie';
import { useToast } from '../shared/ToastProvider';
import TabHero from '../shared/TabHero';
import { SectionHeader, StateSurface } from '../shared/SurfacePrimitives';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useShallow } from 'zustand/react/shallow';
import { formatCurrency } from '../../utils/helpers';

const COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6'];

const LegacyVault: React.FC = () => {
    const { toast } = useToast();
    const [newBeneficiaryName, setNewBeneficiaryName] = useState('');
    const [isICEView, setIsICEView] = useState(false);
    const [isInitializing, setIsInitializing] = useState(true);

    const investments = usePortfolioStore(useShallow(s => s.investments));
    const stats = usePortfolioStore(useShallow(s => s.stats));
    const totalNetWorth = formatCurrency(stats?.totalCurrent || 0);

    // --- Persistent State via IndexedDB ---
    const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);

    useEffect(() => {
        const subscription = liveQuery(() => db.beneficiaries.toArray()).subscribe(setBeneficiaries);
        return () => subscription.unsubscribe();
    }, []);

    // Initialize with default beneficiaries if table is empty
    useEffect(() => {
        const initBeneficiaries = async () => {
            try {
                const count = await db.beneficiaries.count();
                if (count === 0) {
                    await db.beneficiaries.bulkAdd([
                        { name: 'Spouse', relation: 'Spouse', allocation: 50, color: COLORS[0] },
                        { name: 'Children', relation: 'Child', allocation: 50, color: COLORS[1] }
                    ]);
                }
            } catch (err) {
                console.error('[LegacyVault] Failed to initialize beneficiaries:', err);
            } finally {
                setIsInitializing(false);
            }
        };
        initBeneficiaries();
    }, []);

    // --- Derived ---
    const totalAllocation = Array.isArray(beneficiaries)
        ? beneficiaries.reduce((sum, b) => sum + (b.allocation || 0), 0)
        : 0;
    const isAllocationValid = totalAllocation === 100;

    // --- Handlers ---
    const addBeneficiary = async () => {
        if (!newBeneficiaryName) return;
        try {
            const color = COLORS[(beneficiaries?.length || 0) % COLORS.length];
            await db.beneficiaries.add({
                name: newBeneficiaryName,
                relation: 'Other',
                allocation: 0,
                color
            });
            setNewBeneficiaryName('');
            toast.success(`Added ${newBeneficiaryName} as beneficiary`);
        } catch (err) {
            console.error('[LegacyVault] Failed to add beneficiary:', err);
        }
    };

    const updateAllocation = async (id: number, val: number) => {
        try {
            await db.beneficiaries.update(id, { allocation: val });
        } catch (err) {
            console.error('[LegacyVault] Failed to update allocation:', err);
        }
    };

    const deleteBeneficiary = async (id: number) => {
        try {
            await db.beneficiaries.delete(id);
            toast.info('Beneficiary removed');
        } catch (err) {
            console.error('[LegacyVault] Failed to delete beneficiary:', err);
        }
    };

    const handlePrintICE = () => {
        window.print();
    };

    // --- Loading State ---
    if (isInitializing) {
        return (
            <div className="flex items-center justify-center h-96">
                <Loader2 className="animate-spin text-indigo-500" size={48} />
            </div>
        );
    }

    // --- ICE Render ---
    if (isICEView) {
        return (
            <div className="fixed inset-0 z-50 bg-white text-slate-900 p-8 overflow-auto animate-in fade-in duration-300">
                <div className="max-w-3xl mx-auto border border-slate-300 p-8 shadow-2xl print:shadow-none print:border-none">
                    <div className="flex justify-between items-start mb-8 border-b border-slate-900 pb-4">
                        <div>
                            <h1 className="text-3xl font-black uppercase tracking-widest text-slate-900">ICES Report</h1>
                            <p className="text-sm font-bold text-slate-500">In Case of Emergency Sheet • Confidential</p>
                        </div>
                        <div className="text-right print:hidden">
                            <button onClick={() => window.print()} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-bold mr-2">Print / Save PDF</button>
                            <button onClick={() => setIsICEView(false)} className="bg-slate-200 text-slate-900 px-4 py-2 rounded-lg text-sm font-bold">Close</button>
                        </div>
                    </div>

                    <div className="bg-rose-50 border border-rose-200 p-4 rounded-lg mb-8 text-sm text-rose-800 font-medium">
                        <AlertTriangle className="inline-block mr-2 mb-1" size={16} />
                        To the Reader: This document contains sensitive financial information intended solely for the beneficiaries listed below.
                    </div>

                    <div className="grid grid-cols-2 gap-8 mb-8">
                        <div>
                            <h3 className="text-xs font-black uppercase text-slate-400 mb-2">Total Asset Value</h3>
                            <p className="text-2xl font-mono font-bold">{totalNetWorth}</p>
                        </div>
                        <div>
                            <h3 className="text-xs font-black uppercase text-slate-400 mb-2">Asset Count</h3>
                            <p className="text-2xl font-mono font-bold">{investments.length} Holdings</p>
                        </div>
                    </div>

                    <h3 className="text-lg font-bold border-b border-slate-200 pb-2 mb-4">1. Key Beneficiaries</h3>
                    <ul className="mb-8 space-y-2">
                        {beneficiaries.map(b => (
                            <li key={b.id} className="flex justify-between font-mono text-sm border-b border-dotted border-slate-300 pb-1">
                                <span>{b.name} ({b.relation})</span>
                                <span className="font-bold">{b.allocation}% Allocation</span>
                            </li>
                        ))}
                    </ul>

                    <h3 className="text-lg font-bold border-b border-slate-200 pb-2 mb-4">2. Asset Ledger</h3>
                    <table className="w-full text-left text-sm mb-8">
                        <thead>
                            <tr className="bg-slate-100 uppercase text-xs">
                                <th className="p-2">Asset Name</th>
                                <th className="p-2">Type</th>
                                <th className="p-2">Platform / Location</th>
                            </tr>
                        </thead>
                        <tbody>
                            {investments.map(inv => (
                                <tr key={inv.id} className="border-b border-slate-100">
                                    <td className="p-2 font-bold">{inv.name}</td>
                                    <td className="p-2 text-slate-500">{inv.type}</td>
                                    <td className="p-2 text-slate-500">{inv.platform}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <div className="mt-12 pt-8 border-t border-slate-900 text-center text-xs text-slate-400">
                        Generated by WealthAggregator • Local Secure Vault
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-5 pb-20 animate-in fade-in duration-500">
            <TabHero
                eyebrow="Succession Ops"
                title="Legacy Vault"
                description="Beneficiary planning, emergency access structure, and printable inheritance records in one secure strip."
                icon={Lock}
                iconTone="text-rose-500"
                gradientClassName="from-rose-50 via-white to-amber-50 dark:from-rose-950/20 dark:via-slate-950 dark:to-amber-950/20"
                chips={[`${beneficiaries.length} beneficiaries`, isAllocationValid ? 'Allocation aligned' : 'Allocation pending', 'Local secure vault']}
                actions={
                    <button
                        onClick={() => setIsICEView(true)}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white transition-transform hover:scale-105 dark:bg-white dark:text-slate-900"
                    >
                        <Printer size={12} /> I.C.E. Report
                    </button>
                }
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                {/* 1. BENEFICIARY MAPPER */}
                <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
                    <SectionHeader
                        eyebrow="Allocation Desk"
                        title="Beneficiary Mapper"
                        description="Define inheritor split and keep total allocation validated."
                        icon={Users}
                        tone="info"
                        badge={`${totalAllocation}% assigned`}
                        className="mb-4"
                    />

                    <div className="mb-4 flex gap-2">
                        <input
                            type="text"
                            placeholder="New Beneficiary Name..."
                            value={newBeneficiaryName}
                            onChange={e => setNewBeneficiaryName(e.target.value)}
                            className="h-10 flex-1 rounded-full border border-slate-200 bg-slate-100 px-4 text-sm font-medium text-slate-800 outline-none transition-colors focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                        <button
                            onClick={addBeneficiary}
                            className="inline-flex h-10 items-center gap-1 rounded-full bg-indigo-500 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white transition-colors hover:bg-indigo-600"
                        >
                            <Plus size={14} /> Add
                        </button>
                    </div>

                    {beneficiaries.length === 0 ? (
                        <StateSurface
                            title="No Beneficiaries Added"
                            description="Add at least one beneficiary to begin inheritance planning."
                            icon={Users}
                            tone="neutral"
                            badge="empty"
                            compact
                        />
                    ) : (
                        <div className="space-y-2.5">
                            {beneficiaries.map(b => (
                                <div key={b.id} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                                    <div className="w-1.5 h-8 rounded-full" style={{ backgroundColor: b.color }}></div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{b.name}</p>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400">{b.relation}</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex flex-col items-end w-28">
                                            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.14em]">Allocation</span>
                                            <div className="flex items-center gap-2 w-full">
                                                <input
                                                    type="range" min="0" max="100"
                                                    value={b.allocation}
                                                    onChange={e => b.id !== undefined && updateAllocation(b.id, Number(e.target.value))}
                                                    className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                                />
                                                <span className="font-mono text-xs font-bold w-9 text-right">{b.allocation}%</span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => b.id !== undefined && deleteBeneficiary(b.id)}
                                            className="rounded-full p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-colors"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {!isAllocationValid && (
                        <div className="mt-4 flex items-center gap-2 text-rose-500 font-bold bg-rose-50 dark:bg-rose-900/20 p-2.5 rounded-xl text-xs">
                            <AlertTriangle size={14} />
                            <span>Total allocation must equal 100% (Current: {totalAllocation}%)</span>
                        </div>
                    )}
                </div>

                {/* 2. VISUAL DISTRIBUTION */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
                    <SectionHeader
                        eyebrow="Visual Split"
                        title="Distribution"
                        description="Snapshot of current inheritance allocation by beneficiary."
                        icon={Heart}
                        tone="neutral"
                        badge="chart"
                        className="mb-4"
                    />

                    <div className="h-[220px]">
                        <SafeChartContainer>
                            <PieChart>
                                <Pie
                                    data={beneficiaries.map(b => ({ name: b.name, allocation: b.allocation, color: b.color }))}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="allocation"
                                >
                                    {beneficiaries.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Legend verticalAlign="bottom" height={36} iconType="circle" />
                            </PieChart>
                        </SafeChartContainer>
                    </div>

                    <div className="mt-5 pt-5 border-t border-slate-100 dark:border-slate-800">
                        <div className="flex items-start gap-3">
                            <Shield className="text-emerald-500 shrink-0" size={16} />
                            <div>
                                <h4 className="font-bold text-sm text-slate-800 dark:text-white">Secure Vault</h4>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                    All beneficiary data is stored locally. The ICE Report is generated purely in your browser memory for printing.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default LegacyVault;
