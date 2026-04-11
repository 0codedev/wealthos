import React, { useState } from 'react';
import { Scroll, Users, Phone, Map, ChevronRight, Lock } from 'lucide-react';
import { usePortfolio } from '../../hooks/usePortfolio';
import { formatCurrency } from '../../utils/helpers';

export const LegacyProtocol: React.FC = () => {
    const { stats, investments } = usePortfolio();
    const [activeTab, setActiveTab] = useState<'ASSETS' | 'CONTACTS' | 'LETTER'>('ASSETS');

    // Filter sensitive trading info, show high level
    const summary = [
        { label: 'Total Estate Value', value: formatCurrency(stats?.totalValue || 0) },
        { label: 'Liquid Cash (Bank/FD)', value: formatCurrency((investments || []).filter(i => i.type === 'Cash/Bank').reduce((a, b) => a + (b.currentValue || 0), 0)) },
        { label: 'Equity Portfolio', value: formatCurrency((investments || []).filter(i => i.type?.includes('Equity') || i.type?.includes('Fund')).reduce((a, b) => a + (b.currentValue || 0), 0)) },
    ];

    const contacts = [
        { role: 'Financial Advisor', name: 'Rajiv Malhotra', phone: '+91 98765 43210', email: 'rajiv@wealthpartners.com' },
        { role: 'Charted Accountant', name: 'Sneha Gupta', phone: '+91 99887 76655', email: 'sneha@guptaca.com' },
        { role: 'Family Lawyer', name: 'Amit Desai', phone: '+91 91234 56789', email: 'amit@legal.com' },
    ];

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm h-full flex flex-col">

            <div className="flex items-center gap-3 mb-6 p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="p-3 bg-indigo-600 text-white rounded-lg shadow-lg shadow-indigo-500/30">
                    <Scroll size={24} />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">The Legacy Protocol</h2>
                    <p className="text-sm text-slate-500">Beneficiary Access Dashboard</p>
                </div>
                <div className="ml-auto flex items-center gap-2 text-xs font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-1.5 rounded-lg border border-indigo-100 dark:border-indigo-900/30">
                    <Lock size={12} />
                    SECURE VIEW
                </div>
            </div>

            {/* Navigation */}
            <div className="flex gap-2 mb-6">
                {[
                    { id: 'ASSETS', label: 'Estate Summary', icon: Map },
                    { id: 'CONTACTS', label: 'Key Contacts', icon: Users },
                    { id: 'LETTER', label: 'Personal Letter', icon: Scroll },
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${activeTab === tab.id
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-500 hover:text-indigo-600'
                            }`}
                    >
                        <tab.icon size={16} />
                        <span className="hidden md:inline">{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto">
                {activeTab === 'ASSETS' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {summary.map((item, idx) => (
                                <div key={idx} className="bg-slate-50 dark:bg-slate-950 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 text-center">
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{item.label}</p>
                                    <p className="text-2xl font-black text-slate-800 dark:text-white">{item.value}</p>
                                </div>
                            ))}
                        </div>
                        <div className="bg-amber-50 dark:bg-amber-900/10 p-6 rounded-2xl border border-amber-100 dark:border-amber-900/30">
                            <h3 className="font-bold text-amber-800 dark:text-amber-400 mb-2">Location of Physical Assets</h3>
                            <ul className="list-disc pl-5 space-y-2 text-sm text-slate-700 dark:text-slate-300">
                                <li><strong>Property Documents:</strong> Bank Locker #402, HDFC Bank, Indiranagar Branch.</li>
                                <li><strong>Gold Jewelry:</strong> Home Safe (Code is in the Vault).</li>
                                <li><strong>Vehicle Keys:</strong> Study Room - Top Drawer.</li>
                            </ul>
                        </div>
                    </div>
                )}

                {activeTab === 'CONTACTS' && (
                    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4">
                        {contacts.map((c, idx) => (
                            <div key={idx} className="flex items-center justify-between p-4 bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/30 rounded-full flex items-center justify-center text-indigo-600 font-bold">
                                        {c.name[0]}
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-800 dark:text-white">{c.name}</h4>
                                        <p className="text-xs text-slate-500">{c.role}</p>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg">
                                        <Phone size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'LETTER' && (
                    <div className="prose dark:prose-invert max-w-none p-6 bg-yellow-50 dark:bg-yellow-900/10 rounded-2xl border border-yellow-100 dark:border-yellow-900/20 animate-in fade-in slide-in-from-bottom-4">
                        <p className="font-serif text-lg leading-relaxed italic text-slate-700 dark:text-slate-300">
                            "To my family,
                            <br /><br />
                            If you are reading this, I am no longer with you to guide you. I built this portfolio not just for numbers, but to give you freedom.
                            <br /><br />
                            Do not panic sell. Trust the process we built. Call Rajiv (Advisor) before making any major decisions.
                            <br /><br />
                            I love you all."
                        </p>
                        <p className="text-right mt-8 font-bold text-slate-800 dark:text-white">- Dad/Mom</p>
                    </div>
                )}
            </div>
        </div>
    );
};
