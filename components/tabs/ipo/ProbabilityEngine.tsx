import React, { useState, useEffect, useMemo } from 'react';
import {
    Calculator, Clover, Users, Wallet, AlertTriangle,
    Calendar, Info, Check, CheckCircle2, Scale,
    Sparkles, Zap
} from 'lucide-react';
import { Friend, IPOApplication } from '../../../database';
import { IPOListing } from '../../../services/IPOCalendarService';
import { formatCurrency } from '../../../utils/helpers';
import AllotmentDistributionChart, { DistPoint } from './AllotmentDistributionChart';

const isNameMatch = (nameA: string, nameB: string) => {
    const cleanA = nameA.trim().toLowerCase();
    const cleanB = nameB.trim().toLowerCase();
    if (cleanA === cleanB) return true;
    if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;

    const stopWords = ['ipo', 'limited', 'ltd', 'co', 'corp', 'corporation', 'fund', 'funds', 'management', 'mutual'];
    const wordsA = cleanA.split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w));
    const wordsB = cleanB.split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w));
    return wordsA.some(w => wordsB.includes(w));
};

interface ProbabilityEngineProps {
    subscriptionX: number | '';
    setSubscriptionX: (val: number | '') => void;
    hniSubscriptionX?: number | '';
    setHniSubscriptionX?: (val: number | '') => void;
    luckStats: {
        total: number;
        wins: number;
        ratio: number;
    };
    friends: Friend[];
    selectedIpo: IPOListing | null;
    applications?: IPOApplication[];
    currentGmp?: number;
}

const ProbabilityEngine: React.FC<ProbabilityEngineProps> = ({
    subscriptionX,
    setSubscriptionX,
    hniSubscriptionX = '',
    setHniSubscriptionX,
    luckStats,
    friends = [],
    selectedIpo,
    applications = [],
    currentGmp = 0
}) => {
    // Local state for number of applications (used in standard manual mode)
    const [numApplications, setNumApplications] = useState<number>(1);

    // Checklist state for syndicate members when selectedIpo is active (keyed by name)
    const [selectedFriends, setSelectedFriends] = useState<Record<string, boolean>>({});

    const lotSize = selectedIpo?.lotSize || 0;
    const maxPrice = selectedIpo?.priceRange?.max || 0;
    const lotValue = lotSize * maxPrice;

    // Pull accounts exclusively from the active/applied IPO applications list for the selected IPO using fuzzy matching
    const plannerItems = useMemo(() => {
        if (!selectedIpo) return [];

        const ipoApps = applications.filter(
            a => isNameMatch(a.ipoName, selectedIpo.name) &&
            (a.status === 'BLOCKED' || a.status === 'ALLOTTED')
        );

        return ipoApps.map((app, idx) => {
            const appId = app.id !== undefined ? String(app.id) : `app-${idx}`;
            return {
                id: appId,
                name: app.applicantName,
                balance: app.amount, // Display blocked amount
                applied: true,
                appliedAmount: app.amount,
                quota: app.quota || 'RETAIL',
                isFriend: friends.some(f => f.name.trim().toLowerCase() === app.applicantName.trim().toLowerCase())
            };
        });
    }, [friends, applications, selectedIpo]);

    // Auto-check friends who have applied
    useEffect(() => {
        if (!selectedIpo) return;
        const initialSelected: Record<string, boolean> = {};
        plannerItems.forEach(item => {
            initialSelected[item.id] = true;
        });
        setSelectedFriends(initialSelected);
    }, [selectedIpo?.id, plannerItems]);

    // Timeline calculation helpers
    const openDate = selectedIpo?.timeline?.application_start_date || selectedIpo?.issueOpenDate;
    const closeDate = selectedIpo?.timeline?.application_end_date || selectedIpo?.issueCloseDate;
    const refundDate = selectedIpo?.timeline?.refund_initiation_date || selectedIpo?.refundDate;
    const listingDate = selectedIpo?.timeline?.listing_date || selectedIpo?.listingDate;

    const getDaysBetween = (start?: string, end?: string) => {
        if (!start || !end) return null;
        const s = new Date(start).getTime();
        const e = new Date(end).getTime();
        if (Number.isNaN(s) || Number.isNaN(e)) return null;
        const diff = e - s;
        return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    };

    const lockDays = getDaysBetween(openDate, refundDate);
    const isPastClose = closeDate ? new Date(closeDate).getTime() < new Date().getTime() : false;
    const isTimelineOverlapping = (closeDate && refundDate)
        ? new Date(refundDate).getTime() < new Date(closeDate).getTime()
        : false;

    // Toggle friend check state
    const toggleFriend = (id: string) => {
        setSelectedFriends(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    // Calculate Capital Summary
    const checkedItemsList = plannerItems.filter(item => selectedFriends[item.id]);
    const numChecked = checkedItemsList.length;

    // Quota classification helpers
    const isHniQuota = (quota?: string) => quota === 'SMALL_HNI' || quota === 'BIG_HNI';
    const isShareholderQuota = (quota?: string) => quota === 'SHAREHOLDER';

    const numRetail = checkedItemsList.filter(item => !isHniQuota(item.quota) && !isShareholderQuota(item.quota)).length;
    const numHni = checkedItemsList.filter(item => isHniQuota(item.quota)).length;
    const hasHniAccounts = numHni > 0;

    // Subscription values
    const S_retail = subscriptionX ? Number(subscriptionX) : 0;
    const S_hni = hniSubscriptionX ? Number(hniSubscriptionX) : 0;

    // Required capital and Available capital reflect the blocked funds of selected applications
    const totalRequiredCapital = checkedItemsList.reduce((sum, item) => sum + item.appliedAmount, 0);
    const totalAvailableCapital = checkedItemsList.reduce((sum, item) => sum + item.balance, 0);
    const hasOverallShortfall = totalAvailableCapital < totalRequiredCapital;

    // Individual account probability mapping
    const accountProbMap = useMemo(() => {
        const map: Record<string, { p: number; expectedLots: number; sUsed: number; quotaType: string }> = {};

        checkedItemsList.forEach(item => {
            const lotsApplied = Math.max(1, Math.floor(item.balance / Math.max(1, lotValue)));
            let p = 0;
            let expected = 0;
            let sUsed = 1;
            let qType = 'RETAIL';

            if (isHniQuota(item.quota)) {
                qType = 'HNI';
                sUsed = S_hni;
                if (S_hni > 0) {
                    p = S_hni > 1 ? Math.min(1.0, 1.0 / S_hni) : 1.0;
                    expected = S_hni > 1 ? (1.0 / S_hni) : 1.0;
                }
            } else if (isShareholderQuota(item.quota)) {
                qType = 'SHAREHOLDER';
                sUsed = S_retail;
                if (S_retail > 0) {
                    p = S_retail > 1 ? Math.min(1.0, lotsApplied / S_retail) : 1.0;
                    expected = S_retail > 1 ? (lotsApplied / S_retail) : lotsApplied;
                }
            } else {
                qType = 'RETAIL';
                sUsed = S_retail;
                if (S_retail > 0) {
                    p = S_retail > 1 ? Math.min(1.0, 1.0 / S_retail) : 1.0;
                    expected = S_retail > 1 ? (1.0 / S_retail) : 1.0;
                }
            }

            map[item.id] = { p, expectedLots: expected, sUsed, quotaType: qType };
        });

        return map;
    }, [checkedItemsList, S_retail, S_hni, lotValue]);

    // Exact Poisson-Binomial Distribution and Allotment Probabilities
    const {
        allotmentProb,
        blankRatePct,
        exactOnePct,
        multiOddsPct,
        expectedAllotments,
        totalExpectedProfit,
        distributionData,
        pList
    } = useMemo(() => {
        if (!selectedIpo) {
            // Mode A (Standard Calculator without IPO loaded)
            const N = numApplications;
            const S = S_retail;
            if (S > 0 && N > 0) {
                const p = S > 1 ? 1 / S : 1.0;
                let pmf = [1.0];
                for (let i = 0; i < N; i++) {
                    const nextPmf = new Array(pmf.length + 1).fill(0);
                    for (let k = 0; k < pmf.length; k++) {
                        nextPmf[k] += pmf[k] * (1 - p);
                        nextPmf[k + 1] += pmf[k] * p;
                    }
                    pmf = nextPmf;
                }
                const blank = pmf[0] * 100;
                const win = (1 - pmf[0]) * 100;
                const exact1 = (pmf[1] || 0) * 100;
                const multi = Math.max(0, win - exact1);
                const expAllot = N * p;
                const expProfit = expAllot * lotValue * (currentGmp / 100);

                const dist: DistPoint[] = pmf.map((probDecimal, k) => ({
                    k,
                    probPct: probDecimal * 100,
                    probDecimal,
                    cumProbPct: pmf.slice(k).reduce((sum, v) => sum + v, 0) * 100
                }));

                return {
                    allotmentProb: win,
                    blankRatePct: blank,
                    exactOnePct: exact1,
                    multiOddsPct: multi,
                    expectedAllotments: expAllot,
                    totalExpectedProfit: expProfit,
                    distributionData: dist,
                    pList: new Array(N).fill(p)
                };
            }
            return {
                allotmentProb: 0,
                blankRatePct: 100,
                exactOnePct: 0,
                multiOddsPct: 0,
                expectedAllotments: 0,
                totalExpectedProfit: 0,
                distributionData: [],
                pList: []
            };
        }

        // Mode B (IPO Selected)
        if (numChecked === 0) {
            return {
                allotmentProb: 0,
                blankRatePct: 100,
                exactOnePct: 0,
                multiOddsPct: 0,
                expectedAllotments: 0,
                totalExpectedProfit: 0,
                distributionData: [],
                pList: []
            };
        }

        const probs: number[] = [];
        let expTotal = 0;

        checkedItemsList.forEach(item => {
            const entry = accountProbMap[item.id];
            if (entry) {
                probs.push(entry.p);
                expTotal += entry.expectedLots;
            }
        });

        // Exact Poisson-Binomial DP
        let pmf = [1.0];
        for (const p of probs) {
            const nextPmf = new Array(pmf.length + 1).fill(0);
            for (let k = 0; k < pmf.length; k++) {
                nextPmf[k] += pmf[k] * (1 - p);
                nextPmf[k + 1] += pmf[k] * p;
            }
            pmf = nextPmf;
        }

        const blankPct = pmf[0] * 100;
        const winPct = (1 - pmf[0]) * 100;
        const exact1Pct = (pmf[1] || 0) * 100;
        const multiPct = Math.max(0, winPct - exact1Pct);
        const expProfit = expTotal * lotValue * (currentGmp / 100);

        const dist: DistPoint[] = pmf.map((probDecimal, k) => ({
            k,
            probPct: probDecimal * 100,
            probDecimal,
            cumProbPct: pmf.slice(k).reduce((sum, v) => sum + v, 0) * 100
        }));

        return {
            allotmentProb: winPct,
            blankRatePct: blankPct,
            exactOnePct: exact1Pct,
            multiOddsPct: multiPct,
            expectedAllotments: expTotal,
            totalExpectedProfit: expProfit,
            distributionData: dist,
            pList: probs
        };
    }, [selectedIpo, numApplications, S_retail, numChecked, checkedItemsList, accountProbMap, lotValue, currentGmp]);

    // Parity Index (Lambda = N / S)
    const lambdaRetail = S_retail > 0 ? (numRetail / S_retail) : 0;
    const lambdaHni = S_hni > 0 ? (numHni / S_hni) : 0;

    const getRegime = (lambda: number) => {
        if (lambda <= 0) return { label: 'NO DATA', color: 'text-slate-400 bg-slate-800/40 border-slate-700/40' };
        if (lambda < 0.5) return { label: 'SUB-PARITY', color: 'text-rose-400 bg-rose-500/10 border-rose-500/30' };
        if (lambda < 0.9) return { label: 'NEAR-PARITY', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
        if (lambda <= 1.1) return { label: 'AT-PARITY', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' };
        return { label: 'SUPER-PARITY', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30' };
    };

    // Z-Score vs Single Applicant Baseline
    const zScoreStr = useMemo(() => {
        if (numChecked <= 1 || S_retail <= 0 || pList.length === 0) return null;
        const pSingle = 1 / Math.max(1, S_retail);
        const syndicateWinOdds = allotmentProb / 100;
        const variance = pList.reduce((sum, p) => sum + p * (1 - p), 0);
        const sigma = Math.sqrt(variance);
        if (sigma > 0) {
            const z = (syndicateWinOdds - pSingle) / sigma;
            return `+${z.toFixed(1)} SD vs Single`;
        }
        return null;
    }, [numChecked, S_retail, pList, allotmentProb]);

    // Contextual Intelligence Warning Banner
    const regimeBanner = useMemo(() => {
        if (!selectedIpo || numChecked === 0) return null;

        if (hasHniAccounts && (!hniSubscriptionX || Number(hniSubscriptionX) <= 0)) {
            return {
                title: 'HNI Subscription Missing',
                message: 'You have sNII account(s) selected but no HNI subscription entered. Enter sNII subscription above for accurate lottery odds.',
                style: 'bg-rose-500/15 border-rose-500/30 text-rose-300',
                icon: <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
            };
        }

        if (S_retail > 50) {
            return {
                title: 'Extreme Oversubscription (S > 50x)',
                message: 'Exchange lottery is heavily crowded. Single-account odds are sub-2%. Syndicate joint capture strategy is mandatory.',
                style: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
                icon: <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
            };
        }

        if (S_retail > 0 && S_retail <= 15) {
            return {
                title: 'Golden Zone Issue (S <= 15x)',
                message: 'Favorable risk-reward window. Multi-account syndicate gives high capture rate.',
                style: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
                icon: <Sparkles size={16} className="text-emerald-400 shrink-0 mt-0.5" />
            };
        }

        if (lambdaRetail >= 1.0) {
            return {
                title: 'Super-Parity Achieved in Retail',
                message: 'Syndicate application count matches or exceeds the subscription multiple. Blank floor drops towards Euler limit.',
                style: 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300',
                icon: <Sparkles size={16} className="text-indigo-400 shrink-0 mt-0.5" />
            };
        }

        return null;
    }, [selectedIpo, numChecked, hasHniAccounts, hniSubscriptionX, S_retail, lambdaRetail]);

    return (
        <div className="lg:col-span-2 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-900/40 rounded-3xl p-6 shadow-xl relative overflow-hidden transition-all duration-300">
            {/* Background Accent Graphics */}
            <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none">
                <Calculator size={160} className="text-indigo-400" />
            </div>
            <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

            <div className="flex items-center justify-between border-b border-indigo-900/30 pb-4 mb-6">
                <div>
                    <h3 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
                        <Calculator className="text-indigo-400" size={20} />
                        {selectedIpo ? 'Syndicate Capital & Allotment Planner' : 'Allotment Probability Engine'}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                        {selectedIpo
                            ? `Plan capital allocation and calculate probability matrix for ${selectedIpo.name}.`
                            : 'Input subscription multiple to view theoretical odds across multiple accounts.'
                        }
                    </p>
                </div>
                {selectedIpo && (
                    <span className="px-3 py-1 bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-[10px] font-black tracking-wider uppercase rounded-full">
                        {selectedIpo.category} IPO
                    </span>
                )}
            </div>

            {selectedIpo ? (
                /* ================= MODE B: IPO SELECTED ================= */
                <div>
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10">

                        {/* Left Column: Syndicate Allocations & Capital Checks */}
                        <div className="lg:col-span-7 space-y-4">
                            {/* Lot Details Header */}
                            <div className="grid grid-cols-3 gap-3 bg-slate-950/40 border border-indigo-950/60 rounded-2xl p-3">
                                <div className="text-center">
                                    <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest">Lot Size</span>
                                    <span className="text-xs font-extrabold text-white">{lotSize} Shares</span>
                                </div>
                                <div className="text-center border-x border-indigo-900/20">
                                    <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest">Max Price</span>
                                    <span className="text-xs font-extrabold text-white">₹{maxPrice}</span>
                                </div>
                                <div className="text-center">
                                    <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest">Lot Value</span>
                                    <span className="text-xs font-black text-indigo-400">₹{formatCurrency(lotValue)}</span>
                                </div>
                            </div>

                            {/* Friends list with per-account probability badge */}
                            <div className="bg-slate-950/30 border border-indigo-950/40 rounded-2xl p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <Users size={14} className="text-indigo-400" />
                                        <span className="text-xs font-black text-slate-300 uppercase tracking-wider">Select Syndicate Accounts</span>
                                    </div>
                                    <span className="text-[10px] text-slate-400 font-bold">
                                        {numChecked} / {plannerItems.length} Selected
                                    </span>
                                </div>

                                {plannerItems.length === 0 ? (
                                    <p className="text-xs text-slate-500 text-center py-4">No accounts in Syndicate Vault. Add members in Syndicate Tracker tab.</p>
                                ) : (
                                    <div className="max-h-60 overflow-y-auto space-y-2 pr-2 scrollbar-thin">
                                        {plannerItems.map(item => {
                                            const isChecked = !!selectedFriends[item.id];
                                            const itemStats = accountProbMap[item.id];
                                            const pDisplay = itemStats && itemStats.p > 0 ? (itemStats.p * 100) : 0;

                                            return (
                                                <div
                                                    key={item.id}
                                                    onClick={() => toggleFriend(item.id)}
                                                    className={`flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer ${
                                                        isChecked
                                                            ? 'bg-indigo-950/20 border-indigo-500/30'
                                                            : 'bg-slate-950/10 border-slate-800/40 hover:border-slate-700/60'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-6 h-6 rounded-md flex items-center justify-center border transition-colors ${
                                                            isChecked
                                                                ? 'bg-indigo-600 border-indigo-500 text-white'
                                                                : 'border-slate-700 bg-transparent text-transparent'
                                                        }`}>
                                                            <Check size={12} strokeWidth={3} />
                                                        </div>
                                                        <div>
                                                            <span className="text-xs font-bold text-white block">
                                                                {item.name}
                                                                {item.quota && (
                                                                    <span className={`ml-1.5 px-1 py-0.5 text-[8px] font-black rounded uppercase tracking-wider ${
                                                                        item.quota === 'SHAREHOLDER'
                                                                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                                                            : item.quota === 'SMALL_HNI' || item.quota === 'BIG_HNI'
                                                                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                                                                : 'bg-slate-800/40 text-slate-300 border border-slate-700/40'
                                                                    }`}>
                                                                        {item.quota === 'SMALL_HNI' ? 'sHNI' : item.quota === 'BIG_HNI' ? 'bHNI' : item.quota.toLowerCase()}
                                                                    </span>
                                                                )}
                                                                {!item.isFriend && (
                                                                    <span className="ml-1.5 px-1 py-0.5 bg-blue-500/20 text-blue-300 text-[8px] font-bold rounded">
                                                                        Manual App
                                                                    </span>
                                                                )}
                                                            </span>
                                                            <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                                                                <Wallet size={10} /> Blocked: ₹{formatCurrency(item.balance)}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-2">
                                                        {isChecked && pDisplay > 0 && (
                                                            <span className="px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[9px] font-mono font-bold">
                                                                p = {pDisplay.toFixed(1)}%
                                                            </span>
                                                        )}
                                                        {isChecked && item.applied && (
                                                            <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[9px] font-bold flex items-center gap-1">
                                                                <CheckCircle2 size={10} className="text-emerald-400" /> Applied: ₹{formatCurrency(item.appliedAmount)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Capital summary metrics */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-slate-950/40 border border-indigo-950/60 rounded-xl p-3">
                                    <span className="block text-[9px] font-bold text-slate-500 uppercase">Required Capital</span>
                                    <span className="text-base font-black text-white">₹{formatCurrency(totalRequiredCapital)}</span>
                                </div>
                                <div className="bg-slate-950/40 border border-indigo-950/60 rounded-xl p-3">
                                    <span className="block text-[9px] font-bold text-slate-500 uppercase">Syndicate Balance</span>
                                    <span className={`text-base font-black ${hasOverallShortfall ? 'text-rose-400' : 'text-emerald-400'}`}>
                                        ₹{formatCurrency(totalAvailableCapital)}
                                    </span>
                                </div>
                            </div>

                            {/* Capital Efficiency / EV Row (Feature E) */}
                            <div className="bg-slate-950/40 border border-indigo-950/60 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-2">
                                    <Zap size={14} className="text-amber-400 shrink-0" />
                                    <span className="text-slate-400 font-bold uppercase text-[10px]">Capital Efficiency:</span>
                                    <span className="font-mono font-black text-emerald-400">
                                        {totalRequiredCapital > 0 && totalExpectedProfit > 0
                                            ? `₹${(totalExpectedProfit / totalRequiredCapital).toFixed(3)} EV / ₹1 Blocked`
                                            : '₹0.000 EV / ₹1 Blocked'}
                                    </span>
                                </div>
                                <div className="text-[10px] text-slate-400">
                                    Capital lock: <strong className="text-indigo-300 font-mono">~{lockDays !== null ? lockDays : 4} Days</strong>
                                </div>
                            </div>

                            {hasOverallShortfall && (
                                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-2 text-rose-300">
                                    <AlertTriangle size={14} className="shrink-0" />
                                    <span className="text-[10px] font-bold leading-tight">
                                        Syndicate capital gap of ₹{formatCurrency(totalRequiredCapital - totalAvailableCapital)}. Replenish Syndicate balances or deselect accounts.
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Right Column: Probability Matrix, Inputs, Parity & Timeline Locks */}
                        <div className="lg:col-span-5 space-y-4">

                            {/* Regime Context Intelligence Banner (Feature F) */}
                            {regimeBanner && (
                                <div className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${regimeBanner.style}`}>
                                    {regimeBanner.icon}
                                    <div className="leading-tight font-medium">
                                        <strong className="block font-bold">{regimeBanner.title}</strong>
                                        <span className="text-[11px] opacity-90">{regimeBanner.message}</span>
                                    </div>
                                </div>
                            )}

                            {/* Dual Subscription Inputs (Feature 3 Redesign) */}
                            <div className="space-y-3">
                                {/* Retail Subscription Input */}
                                <div className="bg-slate-950/30 border border-indigo-950/40 rounded-2xl p-3.5">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="text-xs font-black text-slate-300 uppercase tracking-wider">
                                            Retail Subscription
                                        </label>
                                        <span className="text-[10px] text-slate-500 font-mono font-bold">
                                            {numRetail} Retail Acc(s)
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="number"
                                            value={subscriptionX}
                                            onChange={(e) => setSubscriptionX(parseFloat(e.target.value) || '')}
                                            placeholder="e.g. 15.0"
                                            className="w-full bg-slate-950 border border-indigo-950/80 rounded-xl p-2.5 text-white text-lg font-mono font-bold outline-none focus:border-indigo-500 transition-colors"
                                        />
                                        <span className="text-slate-400 font-bold shrink-0 text-sm">X</span>
                                    </div>
                                </div>

                                {/* HNI / sNII Subscription Input (Shown only when sNII accounts exist) */}
                                {hasHniAccounts && (
                                    <div className={`bg-slate-950/30 border rounded-2xl p-3.5 transition-all ${
                                        (!hniSubscriptionX || Number(hniSubscriptionX) <= 0)
                                            ? 'border-rose-500/60 ring-1 ring-rose-500/30 bg-rose-950/10'
                                            : 'border-purple-950/60'
                                    }`}>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <div className="flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                                                <label className="text-xs font-black text-purple-300 uppercase tracking-wider">
                                                    HNI / sNII Subscription
                                                </label>
                                            </div>
                                            <span className="text-[10px] text-purple-400 font-mono font-bold">
                                                {numHni} sNII Acc(s)
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="number"
                                                value={hniSubscriptionX}
                                                onChange={(e) => setHniSubscriptionX && setHniSubscriptionX(parseFloat(e.target.value) || '')}
                                                placeholder="e.g. 25.0"
                                                className="w-full bg-slate-950 border border-purple-950/80 rounded-xl p-2.5 text-white text-lg font-mono font-bold outline-none focus:border-purple-500 transition-colors"
                                            />
                                            <span className="text-purple-400 font-bold shrink-0 text-sm">X</span>
                                        </div>
                                        {(!hniSubscriptionX || Number(hniSubscriptionX) <= 0) && (
                                            <p className="text-[10px] text-rose-400 font-medium mt-1.5">
                                                Required: sNII lottery uses a separate allocation pool
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Syndicate Parity Lambda Meter (Feature A) */}
                            <div className="bg-slate-950/40 border border-indigo-950/60 rounded-2xl p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-slate-300">
                                        <Scale size={14} className="text-indigo-400" />
                                        <span className="text-xs font-black uppercase tracking-wider">Parity Lambda Index</span>
                                    </div>
                                    <span className="text-[10px] text-slate-400 font-mono">N / S Ratio</span>
                                </div>

                                {/* Retail Parity Bar */}
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[10px] font-bold text-slate-300 uppercase">Retail Parity (&lambda;)</span>
                                            <span className={`px-1.5 py-0.5 text-[8px] font-black rounded border ${getRegime(lambdaRetail).color}`}>
                                                {getRegime(lambdaRetail).label}
                                            </span>
                                        </div>
                                        <span className="font-mono font-black text-white text-xs">
                                            {lambdaRetail.toFixed(2)}x <span className="text-[10px] text-slate-500 font-normal">({numRetail}/{S_retail || '-'})</span>
                                        </span>
                                    </div>
                                    <div className="relative w-full bg-slate-900 h-2.5 rounded-full overflow-hidden border border-indigo-950/80">
                                        <div className="absolute top-0 bottom-0 left-[66.6%] w-0.5 bg-white/40 z-10" title="Parity Mark (1.0x)" />
                                        <div
                                            className={`h-full transition-all duration-700 ${
                                                lambdaRetail >= 1.0 ? 'bg-gradient-to-r from-emerald-500 to-indigo-500' :
                                                lambdaRetail >= 0.5 ? 'bg-gradient-to-r from-amber-500 to-emerald-500' :
                                                'bg-gradient-to-r from-rose-600 to-rose-400'
                                            }`}
                                            style={{ width: `${Math.min(100, (lambdaRetail / 1.5) * 100)}%` }}
                                        />
                                    </div>
                                </div>

                                {/* HNI Parity Bar (if sNII accounts present) */}
                                {hasHniAccounts && (
                                    <div className="space-y-1.5 pt-2 border-t border-indigo-950/40">
                                        <div className="flex items-center justify-between text-xs">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[10px] font-bold text-purple-300 uppercase">sNII Parity (&lambda;)</span>
                                                <span className={`px-1.5 py-0.5 text-[8px] font-black rounded border ${getRegime(lambdaHni).color}`}>
                                                    {getRegime(lambdaHni).label}
                                                </span>
                                            </div>
                                            <span className="font-mono font-black text-purple-200 text-xs">
                                                {lambdaHni.toFixed(2)}x <span className="text-[10px] text-slate-500 font-normal">({numHni}/{S_hni || '-'})</span>
                                            </span>
                                        </div>
                                        <div className="relative w-full bg-slate-900 h-2.5 rounded-full overflow-hidden border border-purple-950/80">
                                            <div className="absolute top-0 bottom-0 left-[66.6%] w-0.5 bg-white/40 z-10" title="Parity Mark (1.0x)" />
                                            <div
                                                className={`h-full transition-all duration-700 ${
                                                    lambdaHni >= 1.0 ? 'bg-gradient-to-r from-purple-500 to-indigo-400' :
                                                    lambdaHni >= 0.5 ? 'bg-gradient-to-r from-amber-500 to-purple-500' :
                                                    'bg-gradient-to-r from-rose-600 to-rose-400'
                                                }`}
                                                style={{ width: `${Math.min(100, (lambdaHni / 1.5) * 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Joint Probability Breakdown Panel (Feature C & G) */}
                            <div className="bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-950 border border-indigo-500/30 rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden group shadow-lg">
                                <div className="absolute top-0 right-0 p-3 opacity-5">
                                    <Clover size={80} className="text-emerald-400" />
                                </div>

                                <div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] text-indigo-300 font-black uppercase tracking-widest flex items-center gap-1">
                                            Joint Allotment Probability <Clover size={10} className="text-emerald-400" />
                                        </span>
                                        {zScoreStr && (
                                            <span className="text-[9px] font-black font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                                                {zScoreStr}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-3xl font-black text-white mt-1 flex items-baseline gap-2">
                                        <span>{allotmentProb.toFixed(1)}%</span>
                                        <span className="text-xs font-normal text-slate-400">
                                            (P(K &ge; 1) capture)
                                        </span>
                                    </div>
                                </div>

                                {/* Progress Bar */}
                                <div className="w-full bg-slate-950 h-2.5 rounded-full mt-3 overflow-hidden border border-indigo-900/50">
                                    <div
                                        className="bg-gradient-to-r from-emerald-500 via-teal-400 to-indigo-400 h-full transition-all duration-1000"
                                        style={{ width: `${Math.min(100, allotmentProb)}%` }}
                                    />
                                </div>

                                {/* Breakdown Grid: P(K=0), P(K=1), P(K>=2) */}
                                <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-indigo-900/40 text-center">
                                    <div className="bg-slate-950/40 border border-rose-900/30 rounded-xl p-2">
                                        <span className="block text-[8px] font-black text-rose-400 uppercase tracking-wider">Blank Rate P(0)</span>
                                        <span className="text-xs font-black text-rose-400 font-mono mt-0.5 block">{blankRatePct.toFixed(1)}%</span>
                                    </div>
                                    <div className="bg-slate-950/40 border border-emerald-900/30 rounded-xl p-2">
                                        <span className="block text-[8px] font-black text-emerald-400 uppercase tracking-wider">Exact 1 Lot P(1)</span>
                                        <span className="text-xs font-black text-emerald-300 font-mono mt-0.5 block">{exactOnePct.toFixed(1)}%</span>
                                    </div>
                                    <div className="bg-slate-950/40 border border-indigo-900/30 rounded-xl p-2">
                                        <span className="block text-[8px] font-black text-indigo-300 uppercase tracking-wider">Multi Lot P(&ge;2)</span>
                                        <span className="text-xs font-black text-indigo-300 font-mono mt-0.5 block">{multiOddsPct.toFixed(1)}%</span>
                                    </div>
                                </div>

                                {/* Expected Allotments & Profit */}
                                <div className="mt-3 pt-2.5 border-t border-indigo-900/30 space-y-1.5">
                                    <div className="flex items-center justify-between text-[11px] text-indigo-200">
                                        <span>Expected Allotments E[K]:</span>
                                        <span className="font-bold text-white text-xs font-mono">{expectedAllotments.toFixed(2)} Lot(s)</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] text-indigo-200">
                                        <span>Expected Profit (Allotment-adjusted):</span>
                                        <span className="font-black text-emerald-400 text-xs font-mono">
                                            ₹{formatCurrency(totalExpectedProfit)}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Timeline Alert Lock Widget */}
                            <div className="bg-slate-950/40 border border-indigo-950/60 rounded-2xl p-4 space-y-3">
                                <div className="flex items-center gap-2 text-slate-300">
                                    <Calendar size={14} className="text-indigo-400" />
                                    <span className="text-xs font-black uppercase tracking-wider">Timeline Capital Locks</span>
                                </div>

                                {isTimelineOverlapping && (
                                    <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-center gap-2 text-rose-300">
                                        <AlertTriangle size={12} className="shrink-0" />
                                        <span className="text-[9px] font-bold">Timeline Anomaly: Refund date is before Bidding Close date. Check RHP.</span>
                                    </div>
                                )}

                                {isPastClose && (
                                    <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-2 text-amber-300">
                                        <AlertTriangle size={12} className="shrink-0" />
                                        <span className="text-[9px] font-bold">Bidding closed. Calculated probabilities represent retrospective outcomes.</span>
                                    </div>
                                )}

                                <div className="space-y-1.5 text-[10px] text-slate-400">
                                    <div className="flex justify-between">
                                        <span>Bidding Window:</span>
                                        <span className="font-semibold text-slate-200">
                                            {openDate && closeDate ? `${openDate} to ${closeDate}` : 'TBD'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Refund Initiation:</span>
                                        <span className="font-semibold text-slate-200">{refundDate || 'TBD'}</span>
                                    </div>
                                    <div className="flex justify-between border-t border-indigo-950/60 pt-1.5">
                                        <span>Locked Duration:</span>
                                        <span className="font-black text-indigo-400 font-mono">
                                            {lockDays !== null ? `~${lockDays} Days` : 'TBD'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Real luck score comparison */}
                            <div className="bg-slate-950/20 border border-slate-800/40 rounded-xl p-3 flex justify-between items-center">
                                <div>
                                    <span className="text-[9px] text-slate-400 font-bold uppercase block">Syndicate Historical Luck</span>
                                    <span className="text-xs text-slate-300 font-semibold">{luckStats.ratio.toFixed(0)}% Win Rate ({luckStats.wins} Allotted / {luckStats.total} Closed)</span>
                                </div>
                                <div className="w-10 h-10 rounded-full border border-emerald-500/30 flex items-center justify-center bg-emerald-500/10 text-emerald-400">
                                    <Clover size={16} />
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* Option A: Full-width Allotment Distribution Bell Curve Chart */}
                    {numChecked > 0 && distributionData.length > 0 && (
                        <div className="mt-6 pt-6 border-t border-indigo-900/30">
                            <AllotmentDistributionChart
                                distribution={distributionData}
                                expectedAllotments={expectedAllotments}
                                blankRatePct={blankRatePct}
                                captureOddsPct={allotmentProb}
                                multiOddsPct={multiOddsPct}
                                totalAccounts={numChecked}
                                lambdaRetail={lambdaRetail}
                                lambdaHni={lambdaHni}
                                hasHni={hasHniAccounts}
                                ipoName={selectedIpo?.name}
                                category={selectedIpo?.category}
                                lotSize={lotSize}
                                maxPrice={maxPrice}
                                lotValue={lotValue}
                                currentGmp={currentGmp}
                                totalBlockedCapital={totalRequiredCapital}
                                lockDays={lockDays ?? 4}
                                numRetail={numRetail}
                                numHni={numHni}
                                retailSub={S_retail}
                                hniSub={S_hni}
                                totalExpectedProfit={totalExpectedProfit}
                                zScoreStr={zScoreStr}
                            />
                        </div>
                    )}
                </div>
            ) : (
                /* ================= MODE A: STANDARD CALCULATOR ================= */
                <div className="flex flex-col md:flex-row gap-6 relative z-10">
                    <div className="flex-1">
                        <div className="flex gap-4">
                            <div className="bg-slate-950/40 p-4 rounded-2xl border border-indigo-950/60 flex-1">
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Retail Subscription</label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="number"
                                        value={subscriptionX}
                                        onChange={(e) => setSubscriptionX(parseFloat(e.target.value) || '')}
                                        placeholder="e.g. 50"
                                        className="w-full bg-slate-950 border border-indigo-950/80 rounded-xl p-3 text-white text-xl font-mono font-bold outline-none focus:border-indigo-500 transition-colors"
                                    />
                                    <span className="text-slate-500 font-bold shrink-0">X</span>
                                </div>
                            </div>

                            <div className="bg-slate-950/40 p-4 rounded-2xl border border-indigo-950/60 flex-1">
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Applications</label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="number"
                                        min="1"
                                        value={numApplications}
                                        onChange={(e) => setNumApplications(Math.max(1, parseInt(e.target.value) || 1))}
                                        className="w-full bg-slate-950 border border-indigo-950/80 rounded-xl p-3 text-white text-xl font-mono font-bold outline-none focus:border-indigo-500 transition-colors"
                                    />
                                    <span className="text-slate-500 font-bold shrink-0">Nos</span>
                                </div>
                            </div>
                        </div>

                        {/* Prompt to use active IPO for full planner features */}
                        <div className="mt-4 p-3 bg-indigo-500/5 border border-indigo-500/20 rounded-xl flex items-start gap-2.5">
                            <Info size={16} className="text-indigo-400 shrink-0 mt-0.5" />
                            <p className="text-[10px] text-slate-400 leading-normal">
                                <strong className="text-indigo-300">Pro-Tip:</strong> Select any active IPO from the <strong>Quick Load</strong> list above to automatically populate lot value, map Syndicate Vault members, and plan required capital.
                            </p>
                        </div>
                    </div>

                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Historical Luck widget */}
                        <div className="bg-gradient-to-br from-emerald-950/40 to-slate-950/40 p-4 rounded-xl border border-emerald-500/20 flex flex-col justify-between group hover:bg-emerald-950/30 transition-colors relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-2 opacity-10">
                                <Clover size={64} className="text-emerald-400" />
                            </div>
                            <p className="text-xs text-emerald-300 font-bold uppercase mb-1 flex items-center gap-1">
                                Real Luck Score <Clover size={10} />
                            </p>
                            <div className="flex items-baseline gap-2">
                                <div className="text-2xl font-black text-white">{luckStats.ratio.toFixed(0)}%</div>
                                <span className="text-xs text-slate-400 font-mono">({luckStats.wins}/{luckStats.total})</span>
                            </div>
                            <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
                                <div className="bg-emerald-500 h-full transition-all duration-1000" style={{ width: `${luckStats.ratio}%` }}></div>
                            </div>
                            <p className="text-[9px] text-slate-400 mt-2">Based on historical allotment data.</p>
                        </div>

                        {/* Theoretical probability widget */}
                        <div className="bg-slate-950/40 p-4 rounded-xl border border-indigo-950/60 flex flex-col justify-between group hover:bg-slate-900/60 transition-colors">
                            <p className="text-xs text-indigo-300 font-bold uppercase mb-1">Theoretical ({numApplications} Acc)</p>
                            <div className="text-2xl font-black text-white">
                                {allotmentProb.toFixed(1)}%
                            </div>
                            <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
                                <div className="bg-indigo-500 h-full" style={{ width: `${allotmentProb}%` }}></div>
                            </div>
                            <p className="text-[9px] text-slate-400 mt-2">Vs {subscriptionX || 0}x sub with {numApplications} apps.</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProbabilityEngine;
