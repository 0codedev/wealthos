import React, { useState, useEffect } from 'react';
import {
    Calendar, TrendingUp, TrendingDown, Clock, Zap, AlertCircle,
    ChevronRight, ExternalLink, RefreshCw, Loader2, Target, Building2
} from 'lucide-react';
import { ipoCalendarService, IPOListing } from '../../services/IPOCalendarService';
import { formatCurrency } from '../../utils/helpers';

interface IPOCalendarWidgetProps {
    onSelectIpo?: (ipo: IPOListing) => void;
}

export const IPOCalendarWidget: React.FC<IPOCalendarWidgetProps> = ({ onSelectIpo }) => {
    const [ipos, setIPOs] = useState<IPOListing[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'ALL' | 'UPCOMING' | 'OPEN' | 'CLOSED'>('OPEN');
    const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'MAINBOARD' | 'SME'>('MAINBOARD');

    const loadIPOs = async (force: boolean = false) => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await ipoCalendarService.getAllIPOs(force);
            setIPOs(data);
        } catch (err) {
            console.error('Failed to load IPOs', err);
            setError('Could not load IPO calendar. Tap refresh to retry.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadIPOs(false);
    }, []);

    // Filter by category first to adjust status counts dynamically
    const filteredByCategory = categoryFilter === 'ALL'
        ? ipos
        : ipos.filter(ipo => ipo.category === categoryFilter);

    // Status counts adjusted for active category filter
    const openCount = filteredByCategory.filter(i => i.status === 'OPEN').length;
    const upcomingCount = filteredByCategory.filter(i => i.status === 'UPCOMING').length;

    // Filter by both category and status for listing
    const filteredIPOs = filteredByCategory.filter(ipo => {
        return filter === 'ALL' || ipo.status === filter;
    });

    // Category counts adjusted for active status filter
    const filteredByStatus = filter === 'ALL'
        ? ipos
        : ipos.filter(ipo => ipo.status === filter);

    const mainboardCount = filteredByStatus.filter(i => i.category === 'MAINBOARD').length;
    const smeCount = filteredByStatus.filter(i => i.category === 'SME').length;

    const getStatusStyle = (status: IPOListing['status']) => {
        switch (status) {
            case 'UPCOMING': return 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400';
            case 'OPEN': return 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400';
            case 'CLOSED': return 'bg-amber-500/20 text-amber-600 dark:text-amber-400';
            case 'LISTED': return 'bg-slate-500/20 text-slate-600 dark:text-slate-400';
            default: return 'bg-slate-500/20 text-slate-500';
        }
    };

    const getRatingStyle = (rating?: IPOListing['rating']) => {
        switch (rating) {
            case 'SUBSCRIBE': return 'bg-emerald-500 text-white';
            case 'AVOID': return 'bg-rose-500 text-white';
            case 'NEUTRAL': return 'bg-amber-500 text-white';
            default: return 'bg-slate-400 text-white';
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-indigo-500/20 rounded-xl">
                            <Calendar className="text-indigo-600 dark:text-indigo-400" size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800 dark:text-white leading-tight text-sm">IPO Calendar</h3>
                            <p className="text-[9px] text-slate-500">Track upcoming listings</p>
                        </div>
                    </div>

                    {/* Category Selector Pills */}
                    <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200/50 dark:border-slate-700/50">
                        {(['ALL', 'MAINBOARD', 'SME'] as const).map(cat => {
                            const count = cat === 'ALL'
                                ? filteredByStatus.length
                                : cat === 'MAINBOARD' ? mainboardCount : smeCount;
                            return (
                                <button
                                    type="button"
                                    key={cat}
                                    aria-label={`Filter by ${cat === 'MAINBOARD' ? 'Mainboard' : cat === 'SME' ? 'SME' : 'All categories'}`}
                                    aria-pressed={categoryFilter === cat}
                                    onClick={() => setCategoryFilter(cat)}
                                    className={`px-2 py-0.5 text-[9px] font-extrabold rounded-md transition-all flex items-center gap-1 ${categoryFilter === cat
                                            ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm border border-slate-200/20 dark:border-slate-650'
                                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                        }`}
                                >
                                    <span>{cat === 'MAINBOARD' ? 'Main' : cat === 'SME' ? 'SME' : 'All'}</span>
                                    <span className={`text-[8px] px-1 rounded-full ${categoryFilter === cat ? 'bg-indigo-500 text-white' : 'bg-slate-200 dark:bg-slate-700/80 text-slate-500 dark:text-slate-450'}`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {openCount > 0 && (
                        <span className="px-2 py-1 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold rounded-full animate-pulse">
                            {openCount} OPEN
                        </span>
                    )}
                    <button
                        type="button"
                        aria-label="Refresh IPO calendar"
                        title="Refresh IPO calendar"
                        onClick={() => loadIPOs(true)}
                        disabled={isLoading}
                        className="p-1.5 text-slate-400 hover:text-indigo-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    >
                        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl mb-4">
                {(['ALL', 'OPEN', 'UPCOMING', 'CLOSED'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setFilter(tab)}
                        className={`flex-1 px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all ${filter === tab
                                ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                            }`}
                    >
                        {tab}
                        {tab === 'OPEN' && openCount > 0 && (
                            <span className="ml-1 px-1.5 bg-emerald-500 text-white rounded-full text-[9px]">{openCount}</span>
                        )}
                        {tab === 'UPCOMING' && upcomingCount > 0 && (
                            <span className="ml-1 px-1.5 bg-indigo-500 text-white rounded-full text-[9px]">{upcomingCount}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* IPO List */}
            {isLoading ? (
                <div className="flex-1 flex items-center justify-center py-8">
                    <Loader2 className="animate-spin text-indigo-500" size={24} />
                </div>
            ) : filteredIPOs.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-8">
                    <Calendar className="mx-auto text-slate-300 dark:text-slate-700 mb-2" size={32} />
                    <p className="text-sm text-slate-500">No IPOs in this category</p>
                </div>
            ) : (
                <div className="space-y-3 flex-1 overflow-y-auto pr-1 scrollbar-thin">
                    {filteredIPOs.map(ipo => {
                        const lotValue = ipoCalendarService.calculateLotValue(ipo);
                        const gain = ipoCalendarService.calculateExpectedGain(ipo);
                        const daysUntil = ipoCalendarService.getDaysUntil(ipo.issueOpenDate);

                        return (
                            <div
                                key={ipo.id}
                                onClick={() => onSelectIpo?.(ipo)}
                                className={`p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 transition-all ${
                                    onSelectIpo 
                                        ? 'cursor-pointer hover:border-indigo-500 hover:ring-2 hover:ring-indigo-500/20 active:scale-[0.98]' 
                                        : 'hover:border-indigo-300 dark:hover:border-indigo-700'
                                }`}
                            >
                                {/* Top Row */}
                                <div className="flex items-start justify-between mb-2">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h4 className="font-bold text-slate-800 dark:text-white text-sm">
                                                {ipo.name}
                                            </h4>
                                            <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${getStatusStyle(ipo.status)}`}>
                                                {ipo.status}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className="text-[10px] text-slate-500">
                                                {ipo.symbol && <span className="font-mono">{ipo.symbol}</span>}
                                            </span>
                                            <span className="text-[10px] text-slate-400">•</span>
                                            <span className="text-[10px] text-slate-500">{ipo.sector}</span>
                                            <span className={`px-1 py-0.5 text-[8px] font-bold rounded ${ipo.category === 'SME' ? 'bg-purple-500/20 text-purple-600' : 'bg-blue-500/20 text-blue-600'
                                                }`}>
                                                {ipo.category}
                                            </span>
                                        </div>
                                    </div>
                                    {ipo.rating && (
                                        <span className={`px-2 py-1 text-[10px] font-bold rounded-lg ${getRatingStyle(ipo.rating)}`}>
                                            {ipo.rating}
                                        </span>
                                    )}
                                </div>

                                {/* Stats Grid */}
                                <div className="grid grid-cols-4 gap-2 text-[10px] mb-2">
                                    <div>
                                        <p className="text-slate-400 mb-0.5">Price Range</p>
                                        <p className="font-bold text-slate-700 dark:text-white">
                                            {ipo.priceRange ? `₹${ipo.priceRange.min}-${ipo.priceRange.max}` : '-'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-slate-400 mb-0.5">Lot Value</p>
                                        <p className="font-bold text-slate-700 dark:text-white">
                                            {formatCurrency(lotValue)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-slate-400 mb-0.5">Issue Size</p>
                                        <p className="font-bold text-slate-700 dark:text-white">
                                            {ipo.issueSize ? `₹${ipo.issueSize} Cr` : '-'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-slate-400 mb-0.5">GMP</p>
                                        <p className={`font-bold ${ipo.gmp && ipo.gmp > 0 ? 'text-emerald-600' : ipo.gmp && ipo.gmp < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                                            {ipo.gmp !== undefined ? (
                                                <>
                                                    {ipo.gmp > 0 ? '+' : ''}₹{ipo.gmp}
                                                    <span className="text-[8px] ml-0.5">
                                                        ({(gain?.percentage ?? 0).toFixed(1)}%)
                                                    </span>
                                                </>
                                            ) : '-'}
                                        </p>
                                    </div>
                                </div>

                                {/* Subscription Data (if closed) */}
                                {ipo.subscriptionData && (
                                    <div className="grid grid-cols-4 gap-2 text-[10px] p-2 bg-slate-100 dark:bg-slate-800 rounded-lg mb-2">
                                        <div>
                                            <p className="text-slate-400">QIB</p>
                                            <p className="font-bold text-indigo-600">{ipo.subscriptionData.qib}x</p>
                                        </div>
                                        <div>
                                            <p className="text-slate-400">NII</p>
                                            <p className="font-bold text-purple-600">{ipo.subscriptionData.nii}x</p>
                                        </div>
                                        <div>
                                            <p className="text-slate-400">Retail</p>
                                            <p className="font-bold text-cyan-600">{ipo.subscriptionData.retail}x</p>
                                        </div>
                                        <div>
                                            <p className="text-slate-400">Total</p>
                                            <p className={`font-bold ${ipo.subscriptionData.total > 10 ? 'text-emerald-600' : 'text-slate-600'}`}>
                                                {ipo.subscriptionData.total}x
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* Dates */}
                                <div className="flex items-center justify-between text-[10px] text-slate-500">
                                    <span className="flex items-center gap-1">
                                        <Clock size={10} />
                                        {ipo.issueOpenDate} - {ipo.issueCloseDate}
                                    </span>
                                    {ipo.status === 'UPCOMING' && daysUntil > 0 && (
                                        <span className="flex items-center gap-1 text-indigo-500 font-bold">
                                            <Zap size={10} />
                                            Opens in {daysUntil}d
                                        </span>
                                    )}
                                    {ipo.listingDate && (
                                        <span className="flex items-center gap-1">
                                            <Target size={10} />
                                            Lists: {ipo.listingDate}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Footer */}
            <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <p className="text-[10px] text-slate-400">
                    Refreshed from Live Mirror • Institutional Feed
                </p>
                <button className="flex items-center gap-1 text-[10px] text-indigo-500 hover:text-indigo-600 font-bold">
                    View All <ChevronRight size={12} />
                </button>
            </div>
        </div>
    );
};

export default IPOCalendarWidget;
