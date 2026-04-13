import React, { useMemo } from 'react';
import { Rocket, RefreshCw, Wallet, CheckCircle2, TrendingUp, ChevronDown, Award } from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';
import { IPOApplication } from '../../database';

interface ListingDayEventProps {
    availableForListing: string[];
    syncSuccess: boolean;
    selectedIPO: string;
    setSelectedIPO: (val: string) => void;
    listingMode: 'PERCENT' | 'PRICE';
    setListingMode: (val: 'PERCENT' | 'PRICE') => void;
    listingGainPct: string;
    setListingGainPct: (val: string) => void;
    listingPrice: string;
    setListingPrice: (val: string) => void;
    issuePrice: string;
    setIssuePrice: (val: string) => void;
    previewProfit: number;
    handleRealizeGains: () => void;
    isSyncing: boolean;
    applications?: IPOApplication[];
}

export const ListingDayEvent = React.memo(({
    availableForListing, syncSuccess, selectedIPO, setSelectedIPO,
    listingMode, setListingMode, listingGainPct, setListingGainPct,
    listingPrice, setListingPrice, issuePrice, setIssuePrice,
    previewProfit, handleRealizeGains, isSyncing, applications = []
}: ListingDayEventProps) => {
    if (availableForListing.length === 0) return null;

    // Calculate stats for the selected IPO
    const allottedAppsForSelected = useMemo(() => {
        if (!selectedIPO || !applications) return [];
        return applications.filter(app => app.ipoName === selectedIPO && app.status === 'ALLOTTED');
    }, [selectedIPO, applications]);

    const totalAllottedCapital = useMemo(() => {
        return allottedAppsForSelected.reduce((sum, app) => sum + (app.allottedAmount ?? app.amount), 0);
    }, [allottedAppsForSelected]);

    // Map each available IPO to its allotted application count and total capital
    const ipoDetailsMap = useMemo(() => {
        const map: Record<string, { count: number; capital: number }> = {};
        availableForListing.forEach(name => {
            const apps = applications.filter(a => a.ipoName === name && a.status === 'ALLOTTED');
            const cap = apps.reduce((sum, a) => sum + (a.allottedAmount ?? a.amount), 0);
            map[name] = { count: apps.length, capital: cap };
        });
        return map;
    }, [availableForListing, applications]);

    return (
        <div className="bg-gradient-to-r from-emerald-950 via-teal-950 to-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            {/* Background Icon Watermark */}
            <div className="absolute top-0 right-0 p-6 opacity-10 pointer-events-none">
                <Rocket size={120} className="text-emerald-400" />
            </div>

            <div className="relative z-10 space-y-4">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-emerald-500/20">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-xl shadow-lg shadow-emerald-500/30 animate-pulse">
                            <Rocket size={22} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-lg font-black text-white tracking-tight">Listing Day Event</h3>
                                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                    Realize Profits
                                </span>
                            </div>
                            <p className="text-xs text-emerald-300/80 font-medium">
                                Settle allotted shares, record net portfolio returns, and release capital back to syndicate vaults.
                            </p>
                        </div>
                    </div>

                    {selectedIPO && (
                        <div className="flex items-center gap-2 bg-emerald-900/40 border border-emerald-500/30 px-3 py-1.5 rounded-xl text-xs shrink-0">
                            <Award size={14} className="text-emerald-400" />
                            <span className="text-emerald-200 font-semibold">{allottedAppsForSelected.length} Allotted App(s)</span>
                            <span className="text-white font-mono font-bold">&bull; ₹{formatCurrency(totalAllottedCapital)}</span>
                        </div>
                    )}
                </div>

                {!syncSuccess ? (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
                        {/* Dropdown: Select IPO */}
                        <div className="lg:col-span-4 space-y-1.5">
                            <label className="block text-xs font-bold text-emerald-300 uppercase tracking-wider">
                                Select Allotted IPO
                            </label>
                            <div className="relative">
                                <select
                                    value={selectedIPO}
                                    onChange={(e) => setSelectedIPO(e.target.value)}
                                    className="w-full p-3 pr-10 rounded-xl bg-slate-950/80 border border-emerald-500/40 text-white font-semibold text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20 appearance-none transition-all cursor-pointer"
                                >
                                    <option value="" className="bg-slate-900 text-slate-400">-- Choose Allotted IPO --</option>
                                    {availableForListing.map(name => {
                                        const details = ipoDetailsMap[name];
                                        const labelText = details 
                                            ? `${name} (${details.count} Allotted • ₹${formatCurrency(details.capital)})`
                                            : name;
                                        return (
                                            <option key={name} value={name} className="bg-slate-900 text-white py-1">
                                                {labelText}
                                            </option>
                                        );
                                    })}
                                </select>
                                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400 pointer-events-none" />
                            </div>
                        </div>

                        {/* Performance Inputs */}
                        <div className="lg:col-span-5 space-y-1.5">
                            <div className="flex justify-between items-center">
                                <label className="block text-xs font-bold text-emerald-300 uppercase tracking-wider">
                                    Listing Performance
                                </label>
                                <div className="flex bg-slate-950/80 p-0.5 rounded-lg border border-emerald-500/30">
                                    <button
                                        type="button"
                                        onClick={() => setListingMode('PERCENT')}
                                        className={`px-2.5 py-1 text-[10px] uppercase font-black rounded-md transition-all ${
                                            listingMode === 'PERCENT' ? 'bg-emerald-500 text-white shadow' : 'text-emerald-400 hover:text-white'
                                        }`}
                                    >
                                        % Gain
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setListingMode('PRICE')}
                                        className={`px-2.5 py-1 text-[10px] uppercase font-black rounded-md transition-all ${
                                            listingMode === 'PRICE' ? 'bg-emerald-500 text-white shadow' : 'text-emerald-400 hover:text-white'
                                        }`}
                                    >
                                        Exact Price
                                    </button>
                                </div>
                            </div>

                            {listingMode === 'PERCENT' ? (
                                <div className="relative flex items-center">
                                    <input
                                        type="number"
                                        value={listingGainPct}
                                        onChange={(e) => setListingGainPct(e.target.value)}
                                        placeholder="e.g. 25"
                                        className="w-full p-3 rounded-xl bg-slate-950/80 border border-emerald-500/40 text-white font-mono font-black text-xl outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20 transition-all placeholder:text-slate-600"
                                    />
                                    <span className="absolute right-4 font-black text-emerald-400 text-lg pointer-events-none">%</span>
                                </div>
                            ) : (
                                <div className="flex gap-2">
                                    <div className="w-1/2">
                                        <input
                                            type="number"
                                            value={issuePrice}
                                            onChange={(e) => setIssuePrice(e.target.value)}
                                            placeholder="Issue Px (₹)"
                                            className="w-full p-3 rounded-xl bg-slate-950/80 border border-emerald-500/40 text-white font-mono font-bold text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20 transition-all placeholder:text-slate-600"
                                        />
                                    </div>
                                    <div className="w-1/2">
                                        <input
                                            type="number"
                                            value={listingPrice}
                                            onChange={(e) => setListingPrice(e.target.value)}
                                            placeholder="List Px (₹)"
                                            className="w-full p-3 rounded-xl bg-slate-950/80 border border-emerald-500/40 text-white font-mono font-bold text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20 transition-all placeholder:text-slate-600"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Realized Profit Preview & Action */}
                        <div className="lg:col-span-3 space-y-2">
                            <div className="p-3 bg-slate-950/90 rounded-xl border border-emerald-500/40 flex items-center justify-between">
                                <div>
                                    <span className="text-[9px] uppercase font-bold text-emerald-400/80 block">Net Profit</span>
                                    <span className="text-xs text-slate-400">Capital: ₹{formatCurrency(totalAllottedCapital)}</span>
                                </div>
                                <span className={`font-mono font-black text-lg ${previewProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {previewProfit >= 0 ? '+' : ''}₹{formatCurrency(previewProfit)}
                                </span>
                            </div>

                            <button
                                type="button"
                                onClick={handleRealizeGains}
                                disabled={!selectedIPO || isSyncing || (listingMode === 'PERCENT' && !listingGainPct) || (listingMode === 'PRICE' && (!listingPrice || !issuePrice))}
                                className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 active:scale-[0.98] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-emerald-500/30 flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                            >
                                {isSyncing ? (
                                    <RefreshCw className="animate-spin" size={16} />
                                ) : (
                                    <>
                                        <Wallet size={16} />
                                        <span>Realize & Transfer</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-6 text-center animate-in zoom-in duration-300">
                        <CheckCircle2 size={48} className="text-emerald-400 mx-auto mb-2 animate-bounce" />
                        <h3 className="text-xl font-black text-white">Gains Successfully Realized!</h3>
                        <p className="text-xs text-emerald-200 mt-1">
                            Net profits added to your main portfolio. Capital returned to syndicate member vaults.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
});
