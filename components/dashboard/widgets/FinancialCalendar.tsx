import React, { useMemo, useState } from 'react';
import { Calendar, RefreshCw, Zap, TrendingUp, Building2, Ticket, Landmark, X } from 'lucide-react';
import { Investment, RecurringFrequency } from '../../../types';
import { formatCurrency } from '../../../utils/helpers';
import { EmptyState } from '../../shared/EmptyState';

interface FinancialCalendarProps {
    investments: Investment[];
}

type TabType = 'ALL' | 'IPO' | 'DIVIDENDS' | 'BONDS';
type IpoType = 'MAINBOARD' | 'SME';

const FinancialCalendar: React.FC<FinancialCalendarProps> = ({ investments }) => {
    const [activeTab, setActiveTab] = useState<TabType>('ALL');
    const [ipoTypes, setIpoTypes] = useState<IpoType[]>(['MAINBOARD']); // Multi-select support
    const [dateRange, setDateRange] = useState<{ from: string, to: string }>({ from: '', to: '' });
    const [showDatePicker, setShowDatePicker] = useState(false);

    const toggleIpoType = (type: IpoType) => {
        if (ipoTypes.includes(type)) {
            if (ipoTypes.length > 1) setIpoTypes(ipoTypes.filter(t => t !== type)); // Prevent empty selection
        } else {
            setIpoTypes([...ipoTypes, type]);
        }
    };

    const events = useMemo(() => {
        const today = new Date();
        const list: { date: Date, type: string, name: string, amount: number | string, icon: any, color: string, subType?: string }[] = [];

        // 1. Recurring Investments (SIPs)
        investments.forEach(inv => {
            if (inv.recurring?.isEnabled) {
                const nextDate = new Date();
                nextDate.setHours(0, 0, 0, 0);

                if (inv.recurring.frequency === RecurringFrequency.DAILY) {
                    nextDate.setDate(today.getDate() + 1);
                    list.push({ date: nextDate, type: 'SIP', name: inv.name, amount: inv.recurring.amount, icon: RefreshCw, color: 'text-indigo-500', subType: 'SIP' });
                }
            }
        });

        // 2. Dividends (Real Data Dec 2024/Jan 2025)
        list.push({ date: new Date('2024-12-03'), type: 'DIVIDEND', name: 'Indo US Bio-Tech', amount: '₹0.25', icon: TrendingUp, color: 'text-emerald-500', subType: 'DIVIDEND' });
        list.push({ date: new Date('2024-12-04'), type: 'DIVIDEND', name: 'Can Fin Homes', amount: '₹6.00', icon: TrendingUp, color: 'text-emerald-500', subType: 'DIVIDEND' });
        list.push({ date: new Date('2024-12-06'), type: 'DIVIDEND', name: 'Phoenix Township', amount: '₹0.10', icon: TrendingUp, color: 'text-emerald-500', subType: 'DIVIDEND' });
        list.push({ date: new Date('2025-01-03'), type: 'DIVIDEND', name: 'Red Tape', amount: '₹2.00', icon: TrendingUp, color: 'text-emerald-500', subType: 'DIVIDEND' });
        list.push({ date: new Date('2025-01-17'), type: 'DIVIDEND', name: 'TCS', amount: '₹10.00', icon: TrendingUp, color: 'text-emerald-500', subType: 'DIVIDEND' });
        list.push({ date: new Date('2025-01-21'), type: 'DIVIDEND', name: 'Angel One', amount: 'TBD', icon: TrendingUp, color: 'text-emerald-500', subType: 'DIVIDEND' });
        list.push({ date: new Date('2025-01-22'), type: 'DIVIDEND', name: 'Havells India', amount: 'TBD', icon: TrendingUp, color: 'text-emerald-500', subType: 'DIVIDEND' });

        // 3. Corporate Bonds (NCDs) (Real Data Dec 2024/Jan 2025)
        list.push({ date: new Date('2024-12-06'), type: 'BOND', name: 'IIFL Home Finance', amount: '₹500 Cr', icon: Ticket, color: 'text-blue-500', subType: 'BOND' });
        list.push({ date: new Date('2024-12-23'), type: 'BOND', name: 'Muthoot Fincorp', amount: '₹300 Cr', icon: Ticket, color: 'text-blue-500', subType: 'BOND' });
        list.push({ date: new Date('2025-01-01'), type: 'BOND', name: 'Kosamattam Fin', amount: '₹100 Cr', icon: Ticket, color: 'text-blue-500', subType: 'BOND' });
        list.push({ date: new Date('2025-01-08'), type: 'BOND', name: 'Muthoot Finance', amount: '₹100 Cr', icon: Ticket, color: 'text-blue-500', subType: 'BOND' });
        list.push({ date: new Date('2025-01-09'), type: 'BOND', name: 'Edelweiss Fin', amount: '₹125 Cr', icon: Ticket, color: 'text-blue-500', subType: 'BOND' });
        list.push({ date: new Date('2025-01-11'), type: 'BOND', name: '360 ONE Prime', amount: '₹1000 Cr', icon: Landmark, color: 'text-blue-600', subType: 'BOND' });

        // 4. IPOs (Real Data Updates from Research)
        // Mainboard
        list.push({ date: new Date('2024-12-13'), type: 'IPO', name: 'IGI (Gems)', amount: '₹4,225 Cr', icon: Zap, color: 'text-amber-500', subType: 'MAINBOARD' });
        list.push({ date: new Date('2024-12-11'), type: 'IPO', name: 'Sai Life Sciences', amount: '₹3,042 Cr', icon: Zap, color: 'text-amber-500', subType: 'MAINBOARD' });
        list.push({ date: new Date('2024-12-20'), type: 'IPO', name: 'Ventive Hospitality', amount: '₹1,600 Cr', icon: Zap, color: 'text-amber-500', subType: 'MAINBOARD' });
        list.push({ date: new Date('2024-12-20'), type: 'IPO', name: 'Carraro India', amount: '₹1,250 Cr', icon: Zap, color: 'text-amber-500', subType: 'MAINBOARD' });
        list.push({ date: new Date('2024-12-23'), type: 'IPO', name: 'Unimech Aerospace', amount: '₹500 Cr', icon: Zap, color: 'text-amber-500', subType: 'MAINBOARD' });
        list.push({ date: new Date('2025-01-06'), type: 'IPO', name: 'Standard Glass', amount: '₹410 Cr', icon: Zap, color: 'text-amber-500', subType: 'MAINBOARD' });
        // TBD Dates for Jan
        list.push({ date: new Date('2025-01-07'), type: 'IPO', name: 'Quadrant Future', amount: '₹TBD', icon: Zap, color: 'text-amber-500', subType: 'MAINBOARD' });
        list.push({ date: new Date('2025-01-13'), type: 'IPO', name: 'Laxmi Dental', amount: '₹TBD', icon: Zap, color: 'text-amber-500', subType: 'MAINBOARD' });


        // SME
        list.push({ date: new Date('2024-12-15'), type: 'IPO', name: 'Neptune Logitek', amount: '₹46 Cr', icon: Building2, color: 'text-purple-500', subType: 'SME' });
        list.push({ date: new Date('2024-12-24'), type: 'IPO', name: 'Solar91 Cleantech', amount: '₹106 Cr', icon: Building2, color: 'text-purple-500', subType: 'SME' });
        list.push({ date: new Date('2024-12-26'), type: 'IPO', name: 'Anya Polytech', amount: '₹45 Cr', icon: Building2, color: 'text-purple-500', subType: 'SME' });
        list.push({ date: new Date('2024-12-23'), type: 'IPO', name: 'Newmalayalam Steel', amount: '₹42 Cr', icon: Building2, color: 'text-purple-500', subType: 'SME' });

        return list.sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [investments]);

    // Filtering Logic
    const filteredEvents = useMemo(() => {
        return events.filter(evt => {
            // Date Filter
            if (dateRange.from) {
                const from = new Date(dateRange.from);
                from.setHours(0, 0, 0, 0);
                if (evt.date < from) return false;
            }
            if (dateRange.to) {
                const to = new Date(dateRange.to);
                to.setHours(23, 59, 59, 999);
                if (evt.date > to) return false;
            }

            // Tab Filter
            if (activeTab === 'ALL') return true;
            if (activeTab === 'DIVIDENDS') return evt.type === 'DIVIDEND' || evt.type === 'SIP';
            if (activeTab === 'BONDS') return evt.type === 'BOND';
            if (activeTab === 'IPO') {
                if (evt.type !== 'IPO') return false;
                // Multi-select Logic
                if (!ipoTypes.includes(evt.subType as IpoType)) return false;
                return true;
            }
            return true;
        });
    }, [events, activeTab, ipoTypes, dateRange]);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 md:p-6 shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col h-full ring-1 ring-slate-100 dark:ring-slate-800">
            <div className="flex flex-col gap-4 mb-4">
                <div className="flex justify-between items-center">
                    <h3 className="text-base font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Calendar size={18} className="text-indigo-500" />
                        Financial Calendar
                    </h3>
                    <button
                        onClick={() => setShowDatePicker(!showDatePicker)}
                        aria-expanded={showDatePicker}
                        aria-label="Toggle date range picker"
                        className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border transition-all flex items-center gap-2 ${showDatePicker || dateRange.from
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/20 dark:border-indigo-800 dark:text-indigo-300'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-indigo-300'}`}
                    >
                        <Calendar size={12} />
                        {dateRange.from ? `${dateRange.from} → ${dateRange.to || 'All'}` : 'Select Dates'}
                    </button>
                </div>

                {/* Date Range Picker Panel */}
                {showDatePicker && (
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-700 animate-in slide-in-from-top-2 mb-2">
                        <div className="flex gap-4 items-end">
                            <div className="flex flex-col gap-1.5 flex-1">
                                <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">From Date</label>
                                <input
                                    type="date"
                                    value={dateRange.from}
                                    onChange={e => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                                    className="w-full text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                />
                            </div>
                            <div className="flex flex-col gap-1.5 flex-1">
                                <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">To Date</label>
                                <input
                                    type="date"
                                    value={dateRange.to}
                                    onChange={e => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                                    className="w-full text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                />
                            </div>
                            <button
                                onClick={() => { setDateRange({ from: '', to: '' }); setShowDatePicker(false); }}
                                className="p-2 bg-rose-50 text-rose-500 hover:bg-rose-100 dark:bg-rose-900/20 dark:hover:bg-rose-900/40 rounded-lg transition-colors"
                                title="Clear & Close"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                )}

                <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                    {/* Tabs */}
                    <div className="flex items-center gap-1">
                        {(['ALL', 'IPO', 'DIVIDENDS', 'BONDS'] as TabType[]).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all whitespace-nowrap ${activeTab === tab
                                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                    : 'text-slate-500 hover:text-indigo-500'
                                    }`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>

                    {/* IPO Sub-Filters (Inline Right) */}
                    {activeTab === 'IPO' && (
                        <div className="flex items-center gap-1 pl-2 border-l border-slate-200 dark:border-slate-700 animate-in fade-in duration-300">
                            <button
                                onClick={() => toggleIpoType('MAINBOARD')}
                                className={`px-2 py-1 rounded text-[10px] font-bold border transition-colors ${ipoTypes.includes('MAINBOARD')
                                    ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400'
                                    : 'bg-transparent border-slate-200 dark:border-slate-700 text-slate-400 opacity-60'
                                    }`}
                            >
                                Main
                            </button>
                            <button
                                onClick={() => toggleIpoType('SME')}
                                className={`px-2 py-1 rounded text-[10px] font-bold border transition-colors ${ipoTypes.includes('SME')
                                    ? 'bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-900/20 dark:border-purple-800 dark:text-purple-400'
                                    : 'bg-transparent border-slate-200 dark:border-slate-700 text-slate-400 opacity-60'
                                    }`}
                            >
                                SME
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="space-y-3 flex-1 overflow-y-auto pr-1 custom-scrollbar max-h-[300px]">
                {filteredEvents.map((evt, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-white dark:bg-slate-700 shadow-sm ${evt.color} group-hover:scale-110 transition-transform`}>
                            <evt.icon size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start">
                                <p className="text-sm font-bold text-slate-900 dark:text-white truncate pr-2">{evt.name}</p>
                                <span className={`text-[10px] font-mono shrink-0 px-1.5 py-0.5 rounded ${(dateRange.from && new Date(evt.date) >= new Date(dateRange.from) && (!dateRange.to || new Date(evt.date) <= new Date(dateRange.to)))
                                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300 font-bold'
                                    : 'text-slate-400 bg-slate-200 dark:bg-slate-700'
                                    }`}>
                                    {evt.date.getDate()} {evt.date.toLocaleString('default', { month: 'short' }).toUpperCase()}
                                </span>
                            </div>
                            <div className="flex justify-between items-center mt-1">
                                <p className="text-xs text-slate-500 flex items-center gap-1">
                                    {evt.type} {evt.subType && evt.type === 'IPO' ? `• ${evt.subType}` : ''}
                                </p>
                                <p className="text-xs font-bold font-mono text-slate-700 dark:text-slate-300">
                                    {typeof evt.amount === 'number' ? formatCurrency(evt.amount) : evt.amount}
                                </p>
                            </div>
                        </div>
                    </div>
                ))}

                {filteredEvents.length === 0 && (
                    <EmptyState
                        variant="minimal"
                        type="no-data"
                        message="No upcoming events found."
                        icon={Calendar}
                    />
                )}
            </div>
        </div>
    );
};

export default FinancialCalendar;
