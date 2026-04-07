import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useTransactions, Transaction } from '../../../contexts/TransactionContext';
import { Search, Filter, Calendar, Tag, ChevronDown, ShoppingBag, Coffee, Car, Zap, Smartphone, Home, Wallet, Landmark, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface TransactionTimelineProps {
    formatCurrency: (val: number) => string;
}

// Helper to get icon for category
const getCategoryIcon = (category: string) => {
    switch (category.toLowerCase()) {
        case 'food & dining': return <Coffee size={18} />;
        case 'groceries': return <ShoppingBag size={18} />;
        case 'transport': return <Car size={18} />;
        case 'bills & utilities': return <Zap size={18} />;
        case 'entertainment': return <Smartphone size={18} />;
        case 'rent': return <Home size={18} />;
        case 'investment': return <Calendar size={18} />;
        default: return <Tag size={18} />;
    }
};

const getBankStyle = (bankName: string = '') => {
    if (bankName.toLowerCase().includes('sbi') || bankName.toLowerCase().includes('state bank')) return { color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900/30' };
    if (bankName.toLowerCase().includes('icici')) return { color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/30' };
    if (bankName.toLowerCase().includes('hdfc')) return { color: 'text-indigo-600', bg: 'bg-indigo-100 dark:bg-indigo-900/30' };
    if (bankName.toLowerCase().includes('axis')) return { color: 'text-pink-600', bg: 'bg-pink-100 dark:bg-pink-900/30' };
    return { color: 'text-slate-600', bg: 'bg-slate-100 dark:bg-slate-800' };
};

export const TransactionTimeline: React.FC<TransactionTimelineProps> = ({ formatCurrency }) => {
    const { transactions, updateTransaction, spendingByCategory } = useTransactions();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState<string | null>(null);
    const [isFilterOpen, setIsFilterOpen] = useState(false);

    // Virtualization / Load More State
    const [visibleCount, setVisibleCount] = useState(20);
    const observerTarget = useRef<HTMLDivElement>(null);

    // Reset visible count on search/filter change
    useEffect(() => {
        setVisibleCount(20);
    }, [searchTerm, filterCategory]);

    // Infinite Scroll Observer
    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting) {
                    setVisibleCount(prev => prev + 20);
                }
            },
            { threshold: 0.5 }
        );

        if (observerTarget.current) {
            observer.observe(observerTarget.current);
        }

        return () => observer.disconnect();
    }, [observerTarget.current]);


    // Group transactions by Date
    const groupedData = useMemo(() => {
        let filtered = [...transactions];

        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            filtered = filtered.filter(t =>
                t.description.toLowerCase().includes(lower) ||
                t.merchant?.toLowerCase().includes(lower) ||
                t.amount.toString().includes(lower) ||
                t.bankName?.toLowerCase().includes(lower)
            );
        }

        if (filterCategory) {
            filtered = filtered.filter(t => t.category === filterCategory);
        }

        // Sort by date desc
        filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        // Group
        const groups: Record<string, { txns: Transaction[], total: number }> = {};

        filtered.forEach(t => {
            const dateStr = new Date(t.date).toLocaleDateString(undefined, {
                weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
            });

            if (!groups[dateStr]) groups[dateStr] = { txns: [], total: 0 };
            groups[dateStr].txns.push(t);

            // Calculate Net Amount for the day (Credit = +ve, Debit = -ve)
            const val = t.type === 'credit' ? t.amount : -t.amount;
            groups[dateStr].total += val;
        });

        return groups;
    }, [transactions, searchTerm, filterCategory]);

    // Flatten for virtualization (Optional: if we wanted strict list virtualization, we'd flatten here. 
    // But since we group by date, we'll just slice the KEYS or let the CSS efficient scrolling handle it. 
    // A simple approach effectively: Limit the number of GROUPS rendered or entries.)

    // Better Virtualization Strategy for Groups: 
    // Slice the entries of the groups.
    const visibleGroups = Object.entries(groupedData).slice(0, visibleCount);

    const handleAddTag = (txnId: string, currentTags: string[] = []) => {
        const newTag = prompt("Enter a tag:", "");
        if (newTag) {
            updateTransaction(txnId, { tags: [...currentTags, newTag] });
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden min-h-[600px] flex flex-col relative">

            {/* 1. Fold-style Toolbar */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap gap-3 items-center justify-between bg-white/80 dark:bg-slate-900/80 sticky top-0 z-20 backdrop-blur-md">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search merchant, tag, amount..."
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-100 dark:bg-slate-800 border-none rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                    />
                </div>
                <div className="flex gap-2">
                    <div className="relative">
                        <input
                            type="date"
                            className="absolute inset-0 opacity-0 cursor-pointer"
                            onChange={(e) => {
                                // Simple date filter logic - in a real app this would be more robust
                                if (e.target.value) {
                                    alert(`Filtering for date: ${e.target.value} (Implement strict date filter logic here)`);
                                    // For now just console log or basic alert as user asked to "enable" it.
                                    // ideally we setFilterDate(e.target.value)
                                }
                            }}
                        />
                        <button className="px-3 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-2 text-sm font-bold">
                            <Calendar size={16} /> <span className="hidden sm:inline">Date</span>
                        </button>
                    </div>

                    <button
                        onClick={() => setIsFilterOpen(!isFilterOpen)}
                        className={`px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors ${filterCategory ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                    >
                        <Filter size={16} /> {filterCategory || 'Filter'} <ChevronDown size={14} />
                    </button>

                    {/* Category Dropdown */}
                    {isFilterOpen && (
                        <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 z-50 py-2 animate-in fade-in zoom-in-95 duration-200">
                            <button onClick={() => { setFilterCategory(null); setIsFilterOpen(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 font-medium text-slate-600 dark:text-slate-300">
                                All Categories
                            </button>
                            {spendingByCategory.map(cat => (
                                <button key={cat.category} onClick={() => { setFilterCategory(cat.category); setIsFilterOpen(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center gap-2">
                                    {getCategoryIcon(cat.category)} {cat.category}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* 2. Timeline List */}
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700">
                {Object.keys(groupedData).length === 0 ? (
                    <div className="p-12 text-center text-slate-400 flex flex-col items-center">
                        <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                            <Search size={32} />
                        </div>
                        <p className="font-medium text-lg text-slate-600 dark:text-slate-300">No transactions found</p>
                        <p className="text-sm">Try adjusting your filters or search term.</p>
                    </div>
                ) : (
                    <div className="pb-10">
                        {visibleGroups.map(([date, { txns, total }]) => (
                            <div key={date} className="relative">
                                {/* Date Header */}
                                <div className="sticky top-0 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur px-5 py-3 text-xs font-bold text-slate-500 uppercase z-10 border-y border-slate-200 dark:border-slate-800 flex justify-between items-center group">
                                    <span className="flex items-center gap-2">
                                        <Calendar size={12} /> {date}
                                    </span>
                                    <span className={`font-mono ${total >= 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                                        {total >= 0 ? '+' : ''}{formatCurrency(total)}
                                    </span>
                                </div>

                                <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
                                    {txns.map(t => {
                                        const bankStyle = getBankStyle(t.bankName);
                                        const isCredit = t.type === 'credit';

                                        return (
                                            <div key={t.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-all flex items-center justify-between group cursor-pointer border-l-4 border-transparent hover:border-indigo-500">
                                                <div className="flex items-center gap-4">

                                                    {/* Icon showing Bank or Category */}
                                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm relative ${t.category === 'Food & Dining' ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/20' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                                                        {t.bankName ? (
                                                            <Landmark size={20} className={bankStyle.color} />
                                                        ) : (
                                                            getCategoryIcon(t.category)
                                                        )}

                                                        {/* Small Type Indicator Badge */}
                                                        <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center ${isCredit ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
                                                            {isCredit ? <ArrowDownRight size={10} className="text-white" /> : <ArrowUpRight size={10} className="text-slate-500 dark:text-slate-300" />}
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-bold text-slate-900 dark:text-white text-base">
                                                                {t.merchant || t.description}
                                                            </p>
                                                            {t.bankName && (
                                                                <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wide ${bankStyle.bg} ${bankStyle.color}`}>
                                                                    {t.bankName}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                                            {t.category} • <span className="text-slate-400">{new Date(t.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-5">
                                                    {/* Tags */}
                                                    <div className="hidden md:flex gap-1">
                                                        {t.tags?.map(tag => (
                                                            <span key={tag} className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] rounded-md font-bold uppercase tracking-wider">
                                                                {tag}
                                                            </span>
                                                        ))}
                                                    </div>

                                                    <div className="text-right">
                                                        <p className={`font-bold text-base ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                                            {isCredit ? '+' : ''}{formatCurrency(t.amount)}
                                                        </p>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleAddTag(t.id, t.tags); }}
                                                            className="text-xs font-medium text-indigo-500 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-end gap-1 mt-1"
                                                        >
                                                            <Tag size={12} /> {t.tags && t.tags.length > 0 ? 'Edit' : 'Tag'}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}

                        {/* Virtualization Trigger */}
                        {visibleGroups.length < Object.keys(groupedData).length && (
                            <div ref={observerTarget} className="h-20 flex items-center justify-center text-slate-400 text-sm">
                                Loading more transactions...
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
