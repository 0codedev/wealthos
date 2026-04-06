import React, { useState } from 'react';
import { ArrowLeft, LayoutGrid, List, PieChart, Plus, Bot, Wallet, TrendingUp } from 'lucide-react';
import { useLocalShortcuts } from '../../../hooks/useLocalShortcuts';
import { SpendingOverview } from '../spending/SpendingOverview';
import { TransactionTimeline } from '../spending/TransactionTimeline';
import { JupiterAnalyticsWidget } from '../spending/JupiterAnalyticsWidget';
import { BankImportModal } from '../spending/BankImportModal';
import { MonthlySpendTrendWidget } from '../spending/MonthlySpendTrendWidget';
import { SpendingCalendarWidget } from '../spending/SpendingCalendarWidget';
import { CategoryDonutChart } from '../spending/CategoryDonutChart';
import { TopMerchantsBarChart } from '../spending/TopMerchantsBarChart';
import { NetWorthTrendWidget } from '../spending/NetWorthTrendWidget';
import AIFinancialAssistant from '../spending/AIFinancialAssistant';
import BudgetManager from '../spending/BudgetManager';

interface SpendingAnalyticsHubProps {
    onBack?: () => void;
    formatCurrency: (val: number) => string;
}

type Tab = 'overview' | 'timeline' | 'analytics' | 'budget' | 'ai-chat';

export const SpendingAnalyticsHub: React.FC<SpendingAnalyticsHubProps> = ({ onBack, formatCurrency }) => {
    const [activeTab, setActiveTab] = useState<Tab>('overview');
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const topRef = React.useRef<HTMLDivElement>(null);

    const tabs = [
        { id: 'overview', label: 'Overview', icon: <LayoutGrid size={14} /> },
        { id: 'timeline', label: 'Timeline', icon: <List size={14} /> },
        { id: 'analytics', label: 'Analytics', icon: <PieChart size={14} /> },
        { id: 'budget', label: 'Budget', icon: <Wallet size={14} /> },
        { id: 'ai-chat', label: 'AI Chat', icon: <Bot size={14} /> },
    ] as const;

    useLocalShortcuts([
        {
            key: 'i',
            ctrlKey: true,
            description: 'Open Statement Import Modal',
            category: 'Spending Analytics',
            action: () => setIsImportModalOpen(true)
        },
        {
            key: 'a',
            ctrlKey: true,
            description: 'Add Manual Transaction',
            category: 'Spending Analytics',
            action: () => setIsImportModalOpen(true)
        },
        {
            key: 'ArrowRight',
            description: 'Next Tab',
            category: 'Spending Analytics',
            action: () => {
                const idx = tabs.findIndex(t => t.id === activeTab);
                const nextIdx = (idx + 1) % tabs.length;
                setActiveTab(tabs[nextIdx].id as Tab);
            }
        },
        {
            key: 'ArrowLeft',
            description: 'Previous Tab',
            category: 'Spending Analytics',
            action: () => {
                const idx = tabs.findIndex(t => t.id === activeTab);
                const prevIdx = idx <= 0 ? tabs.length - 1 : idx - 1;
                setActiveTab(tabs[prevIdx].id as Tab);
            }
        }
    ]);

    React.useEffect(() => {
        topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    return (
        <div ref={topRef} className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
            {/* Header / Navigation */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
                        >
                            <ArrowLeft size={20} />
                        </button>
                    )}
                    <div>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            Spending & Analytics
                            <span className="text-[10px] bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full font-bold">2.0</span>
                        </h2>
                        <p className="text-sm text-slate-500">Track, Analyze, Budget, and Get AI Insights</p>
                    </div>
                </div>

                {/* Tab Switcher */}
                <div className="flex items-center gap-3 self-start md:self-auto">
                    <button
                        onClick={() => setIsImportModalOpen(true)}
                        className="h-10 w-10 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/30 transition-all hover:scale-105"
                        title="Import Bank Statement"
                    >
                        <Plus size={20} />
                    </button>

                    <BankImportModal
                        isOpen={isImportModalOpen}
                        onClose={() => setIsImportModalOpen(false)}
                    />

                    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${activeTab === tab.id
                                        ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                    }`}
                            >
                                {tab.icon}
                                <span className="hidden sm:inline">{tab.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="min-h-[600px]">
                {activeTab === 'overview' && <SpendingOverview formatCurrency={formatCurrency} />}
                {activeTab === 'timeline' && <TransactionTimeline formatCurrency={formatCurrency} />}
                {activeTab === 'analytics' && (
                    <div className="space-y-6">
                        <JupiterAnalyticsWidget formatCurrency={formatCurrency} />
                        <NetWorthTrendWidget formatCurrency={formatCurrency} />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <CategoryDonutChart formatCurrency={formatCurrency} />
                            <TopMerchantsBarChart formatCurrency={formatCurrency} />
                            <MonthlySpendTrendWidget formatCurrency={formatCurrency} />
                            <SpendingCalendarWidget formatCurrency={formatCurrency} />
                        </div>
                    </div>
                )}
                {activeTab === 'budget' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <BudgetManager formatCurrency={formatCurrency} />
                        <div className="space-y-6">
                            <div className="bg-gradient-to-br from-slate-900 via-purple-950/20 to-slate-900 rounded-3xl border border-purple-500/20 p-6">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center">
                                        <TrendingUp size={20} className="text-white" />
                                    </div>
                                    <div>
                                        <h4 className="text-white font-bold">Spending Prediction</h4>
                                        <p className="text-xs text-purple-300/60">Based on your patterns</p>
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                                        <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Predicted End-of-Month Spend</p>
                                        <p className="text-2xl font-black text-white font-mono">₹78,500</p>
                                        <p className="text-xs text-amber-400 mt-1">↑ 12% vs last month</p>
                                    </div>
                                    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                                        <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Saving Potential</p>
                                        <p className="text-2xl font-black text-emerald-400 font-mono">₹15,000</p>
                                        <p className="text-xs text-slate-400 mt-1">With suggested optimizations</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                {activeTab === 'ai-chat' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <AIFinancialAssistant formatCurrency={formatCurrency} />
                        <div className="space-y-6">
                            <div className="bg-gradient-to-br from-slate-900 via-indigo-950/30 to-slate-900 rounded-3xl border border-indigo-500/20 p-6">
                                <h4 className="text-white font-bold mb-4 flex items-center gap-2">
                                    <Bot size={16} className="text-indigo-400" />
                                    AI Capabilities
                                </h4>
                                <div className="space-y-3 text-sm">
                                    {[
                                        { title: 'Budget Planning', desc: 'Create personalized monthly budgets' },
                                        { title: 'Spending Analysis', desc: 'Identify patterns and anomalies' },
                                        { title: 'Savings Coach', desc: 'Get actionable tips to save more' },
                                        { title: 'Investment Advice', desc: 'Smart suggestions for growing wealth' },
                                    ].map((item, i) => (
                                        <div key={i} className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                                            <p className="text-white font-semibold">{item.title}</p>
                                            <p className="text-xs text-slate-400">{item.desc}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

