// IPO War Room - HMR Trigger Cache Invalidation 2026-07-21
import React, { useState, useMemo, useEffect } from 'react';
import { liveQuery } from 'dexie';
import {
    AlertTriangle, CheckCircle2, XCircle,
    Search, Banknote, Users, AlertOctagon,
    ThumbsDown, ThumbsUp, Calendar, Zap, Calculator,
    BarChart3, ArrowRight, MousePointerClick,
    Activity, TrendingUp, LayoutGrid, List,
    Briefcase, CandlestickChart, Scale, Wallet
} from 'lucide-react';
import { Investment, InvestmentType } from '../../types';
import { db, IPOApplication, Friend } from '../../database';
import SyndicateTracker from '../SyndicateTracker';
import { useSettingsStore } from '../../store/settingsStore';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useShallow } from 'zustand/react/shallow';
import { formatCurrency } from '../../utils/helpers';
import PasteParserModal from '../PasteParserModal';
import DemandHeatmap from './ipo/DemandHeatmap';
import ProbabilityEngine from './ipo/ProbabilityEngine';
import FlippersMatrix from './ipo/FlippersMatrix';
import { ipoCalendarService, IPOListing } from '../../services/IPOCalendarService';
import { buildIPOTimeline, summarizeIPOApplications } from '../../services/IPOWarRoomService';
import TabHero from '../shared/TabHero';
import { MetricTile, SectionHeader, StateSurface } from '../shared/SurfacePrimitives';

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

export interface IPOWarRoomProps {
    onRefresh?: () => void;
}

// Fallback presets for offline quick fill
const IPO_PRESETS = [
    { name: 'NTPC Green', fresh: 100, promoter: 85, litigation: 2, pe: 45, gmp: 8, sub: 2.5, qib: 3.2, nii: 4.5, retail: 1.8 },
    { name: 'Swiggy', fresh: 45, promoter: 0, litigation: 12, pe: -1, gmp: 2, sub: 1.1, qib: 1.5, nii: 0.8, retail: 0.9 },
    { name: 'Hyundai India', fresh: 0, promoter: 100, litigation: 5, pe: 26, gmp: 5, sub: 2.3, qib: 6.9, nii: 0.6, retail: 0.5 },
    { name: 'Zomato (Hist)', fresh: 100, promoter: 0, litigation: 1, pe: -1, gmp: 55, sub: 40, qib: 52, nii: 35, retail: 8 },
];

const EMPTY_INVESTMENTS: Investment[] = [];

const IPOWarRoom: React.FC<IPOWarRoomProps> = () => {
    const investments = usePortfolioStore(useShallow(s => s.investments));
    const refreshPortfolio = usePortfolioStore(s => s.refreshPortfolio);
    const [activeSubTab, setActiveSubTab] = useState<'WAR_ROOM' | 'SYNDICATE'>('WAR_ROOM');


    const [calendarPresets, setCalendarPresets] = useState<IPOListing[]>([]);
    const [selectedCalendarIpo, setSelectedCalendarIpo] = useState<IPOListing | null>(null);
    const [applications, setApplications] = useState<IPOApplication[]>([]);
    const [friends, setFriends] = useState<Friend[]>([]);
    const [trades, setTrades] = useState<any[]>([]);

    useEffect(() => {
        const subscription = liveQuery(() => db.friends.toArray()).subscribe(setFriends);
        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        const subscription = liveQuery(() => db.trades.toArray()).subscribe(setTrades);
        return () => subscription.unsubscribe();
    }, []);

    // Luck Stats State
    const [luckStats, setLuckStats] = useState({ total: 0, wins: 0, ratio: 0 });

    // --- Feature 1: The 7-Point Scan State ---
    const [freshIssue, setFreshIssue] = useState<number | ''>('');
    const [promoterHolding, setPromoterHolding] = useState<number | ''>('');
    const [litigationCount, setLitigationCount] = useState<number | ''>('');
    const [peRatio, setPeRatio] = useState<number | ''>('');

    // --- Feature 2: GMP Validator State ---
    const [currentGmp, setCurrentGmp] = useState<number | ''>('');
    const [subProb, setSubProb] = useState<number | ''>('');

    // --- Feature 3: Probability Engine (Linked to Retail Sub) ---
    // Removed standalone subscriptionX state to enforce "Retail Only" logic

    // --- Feature 4: Quota ---
    const [isParentShareholder, setIsParentShareholder] = useState(false);

    // --- Feature 5: Demand Heatmap (Task 9) ---
    const [qibSub, setQibSub] = useState<number | ''>('');
    const [niiSub, setNiiSub] = useState<number | ''>('');
    const [hniSub, setHniSub] = useState<number | ''>('');
    const [retailSub, setRetailSub] = useState<number | ''>('');
    const [totalSub, setTotalSub] = useState<number | ''>('');

    // --- Feature 7: Listing Strategy Generator ---
    const [stratIssuePrice, setStratIssuePrice] = useState<number | ''>('');
    const [stratListPrice, setStratListPrice] = useState<number | ''>('');

    // --- Feature 6: Listing Sentiment (Impact Multiplier) & Swing State ---
    const [marketTrend, setMarketTrend] = useState<number>(0);
    const [swingReturnPct, setSwingReturnPct] = useState<number>(2.5);

    // Automatically synchronize the calculated listing price (open price) based on effective GMP (gmpPct * (1 + marketTrend/100))
    useEffect(() => {
        if (stratIssuePrice !== '' && currentGmp !== '') {
            const effectiveGmp = Number(currentGmp) * (1 + marketTrend / 100);
            const calculatedPrice = Number(stratIssuePrice) * (1 + effectiveGmp / 100);
            setStratListPrice(Math.round(calculatedPrice * 100) / 100);
        } else {
            setStratListPrice('');
        }
    }, [stratIssuePrice, currentGmp, marketTrend]);

    // Dynamic Settings
    const ipoFreshIssueThreshold = useSettingsStore(state => state.ipoFreshIssueThreshold);

    // --- Paste Parser State ---
    const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);

    const handleParsedData = (data: any) => {
        if (data.fresh) setFreshIssue(data.fresh);
        if (data.promoter) setPromoterHolding(data.promoter);
        if (data.gmp) setCurrentGmp(data.gmp);
        if (data.sub) setTotalSub(data.sub);
        if (data.retail) setRetailSub(data.retail);
        if (data.qib) setQibSub(data.qib);
        if (data.nii) {
            setNiiSub(data.nii);
            setHniSub(data.nii);
        }
    };

    // --- Fetch Luck Data ---
    const fetchLuckStats = async () => {
        try {
            const apps = await db.ipo_applications.toArray();
            // Considered "Closed" applications only
            const closedApps = apps.filter(app => ['ALLOTTED', 'REFUNDED', 'LISTED'].includes(app.status));
            const totalClosed = closedApps.length;
            const wins = closedApps.filter(app => ['ALLOTTED', 'LISTED'].includes(app.status)).length;
            const ratio = totalClosed > 0 ? (wins / totalClosed) * 100 : 0;

            setLuckStats({ total: totalClosed, wins, ratio });
        } catch (e) { console.error("Luck fetch error", e); }
    };

    useEffect(() => {
        fetchLuckStats();
    }, []); // Initial load

    useEffect(() => {
        const sub = liveQuery(() => db.ipo_applications.toArray()).subscribe({
            next: (value) => setApplications(value || []),
        });
        return () => sub.unsubscribe();
    }, []);

    useEffect(() => {
        let isMounted = true;

        ipoCalendarService.getAllIPOs()
            .then((ipos) => {
                if (!isMounted) return;
                setCalendarPresets(ipos.map((ipo) => ipoCalendarService.withDerivedFields(ipo)));
            })
            .catch(() => {
                if (!isMounted) return;
                setCalendarPresets([]);
            });

        return () => {
            isMounted = false;
        };
    }, []);

    const handleDataChange = () => {
        fetchLuckStats();
    };

    // Calculate total required capital for the selected calendar IPO based on syndicate entries
    const totalRequiredCapital = useMemo(() => {
        if (!selectedCalendarIpo) return 15000;
        
        // Find applications for this selected calendar IPO (using fuzzy match isNameMatch)
        const ipoApps = applications.filter(
            a => isNameMatch(a.ipoName, selectedCalendarIpo.name) && 
            (a.status === 'BLOCKED' || a.status === 'ALLOTTED')
        );
        
        // Sum their amounts (default to 15,000 if none selected)
        return ipoApps.reduce((sum, app) => sum + app.amount, 0) || 15000;
    }, [applications, selectedCalendarIpo]);

    // Calculate days between close and listing
    const daysCloseToListing = useMemo(() => {
        if (!selectedCalendarIpo) return 4;
        const closeDate = selectedCalendarIpo.timeline?.application_end_date || selectedCalendarIpo.issueCloseDate;
        const listingDate = selectedCalendarIpo.timeline?.listing_date || selectedCalendarIpo.listingDate;
        if (!closeDate || !listingDate) return 4;
        const s = new Date(closeDate).getTime();
        const e = new Date(listingDate).getTime();
        if (Number.isNaN(s) || Number.isNaN(e)) return 4;
        return Math.max(1, Math.ceil((e - s) / (1000 * 60 * 60 * 24)));
    }, [selectedCalendarIpo]);

    const isLiquidityRisk = freshIssue !== '' && Number(freshIssue) < ipoFreshIssueThreshold;
    const isSkipSignal = (retailSub !== '' && currentGmp !== '') && (Number(retailSub) < 1 && Number(currentGmp) < 20);
    const isGoodGmp = currentGmp !== '' && Number(currentGmp) > 50;

    // Listing Strategy Logic
    const listingStrategy = useMemo(() => {
        if (!stratIssuePrice || !stratListPrice) return null;

        const gain = stratListPrice - stratIssuePrice;
        const gainPct = (gain / stratIssuePrice) * 100;

        let title = "";
        let desc = "";
        let color = "";

        // Check if SME IPO
        const isSme = selectedCalendarIpo?.category === 'SME';
        const issueSize = selectedCalendarIpo?.issueSize || 0;
        
        // Valuation & forensic check
        const isOvervalued = peRatio !== '' && Number(peRatio) > 60;
        const isBubble = peRatio !== '' && Number(peRatio) > 100;
        const isLowPromoter = promoterHolding !== '' && Number(promoterHolding) < 30;
        const isHighLitigation = litigationCount !== '' && Number(litigationCount) > 5;
        
        if (gainPct < 0) {
            title = "CAPITAL PROTECTION EXIT";
            desc = isSme 
                ? "SME Listing Discount. Exit the full lot immediately at the pre-open session to secure exit liquidity and prevent circuit lock-down. Do not hold."
                : `Listing at a Discount. Exit 100% immediately to preserve capital. ${isOvervalued ? "High P/E valuations (" + peRatio + ") compound downside risk." : ""}`;
            color = "text-rose-500 border-rose-500 bg-rose-50 dark:bg-rose-900/20";
        } else if (gainPct < 15) {
            if (isSme) {
                title = "EXIT FULL LOT ON OPEN";
                desc = `Flat/Low SME Listing (+${gainPct.toFixed(1)}%). SME shares trade in large lot blocks where liquidity dry-up is extremely common. Exit the entire lot immediately on market open to secure capital.`;
            } else {
                title = "TIGHT TRAILING STOP LOSS";
                desc = `Flat Mainboard Listing. Place a hard Stop Loss at the Issue Price (₹${stratIssuePrice}). ${isOvervalued ? "Warning: High P/E valuations leave little room for upside. " : ""}Exit if the price breaks below the pre-open opening price.`;
            }
            color = "text-amber-500 border-amber-500 bg-amber-50 dark:bg-amber-900/20";
        } else if (gainPct < 45) {
            if (isSme) {
                title = "SECURE GAINS (EXIT LOT)";
                desc = `Healthy listing gain of +${gainPct.toFixed(1)}%. Since partial lot selling is not supported in the SME segment, exit the entire lot in the pre-open/opening minute. Secure absolute profits.`;
            } else {
                title = "BOOK 50% & TRAIL";
                desc = `Moderate Listing. Book profit on 50% of your shares to release your initial capital block. Trail the remaining quantity with a trailing Stop Loss at Day's Low or Opening Price to catch secondary momentum. ${isHighLitigation ? "Note: High litigation count suggests booking profits early." : ""}`;
            }
            color = "text-indigo-500 border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20";
        } else {
            if (isSme) {
                title = "HOLD FOR CIRCUIT LOCK";
                desc = `Blockbuster SME Listing (+${gainPct.toFixed(1)}%). If the stock opens locked in an Upper Circuit, hold and monitor the circuit buyers queue. If the circuit breaks, exit the full lot immediately.`;
            } else {
                title = "RIDE BUMPER WAVE";
                desc = `Blockbuster Listing (+${gainPct.toFixed(1)}%). Hold and ride the momentum. Place a trailing stop loss at +30% or opening price. ${isBubble ? "Note: P/E of " + peRatio + " is inside the bubble range; protect profits on any sign of reversal." : ""}`;
            }
            color = "text-emerald-500 border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20";
        }

        return { title, desc, color, gainPct };
    }, [stratIssuePrice, stratListPrice, selectedCalendarIpo, peRatio, promoterHolding, litigationCount]);



    const totalCash = investments
        .filter(i => i.type === InvestmentType.CASH || i.type === InvestmentType.FD)
        .reduce((acc, curr) => acc + curr.currentValue, 0);

    const applyPreset = (preset: typeof IPO_PRESETS[0]) => {
        setSelectedCalendarIpo(null);
        setFreshIssue(preset.fresh);
        setPromoterHolding(preset.promoter);
        setLitigationCount(preset.litigation);
        setPeRatio(preset.pe);
        setCurrentGmp(preset.gmp);
        setQibSub(preset.qib);
        setNiiSub(preset.nii);
        setHniSub(preset.nii);
        setRetailSub(preset.retail);
        setTotalSub(preset.sub);
    };

    const saveToIpoCache = (field: string, value: any) => {
        if (!selectedCalendarIpo) return;
        const cacheKey = 'alpha_cached_ipos';
        const cached = localStorage.getItem(cacheKey);
        let parsed: any[] = [];
        if (cached) {
            try {
                parsed = JSON.parse(cached);
                if (!Array.isArray(parsed)) parsed = [];
            } catch (e) {
                parsed = [];
            }
        }

        let ipoItem = parsed.find((item: any) => item.id === selectedCalendarIpo.id);
        if (!ipoItem) {
            ipoItem = { id: selectedCalendarIpo.id };
            parsed.push(ipoItem);
        }

        // Map fields
        if (field === 'gmp') {
            ipoItem.gmp = value === '' ? undefined : Number(value);
        } else if (['qib', 'nii', 'retail', 'total'].includes(field)) {
            if (!ipoItem.subscriptionData) ipoItem.subscriptionData = {};
            ipoItem.subscriptionData[field] = value === '' ? undefined : Number(value);
        } else if (field === 'freshIssue') {
            ipoItem.freshIssue = value === '' ? undefined : Number(value);
        } else if (field === 'promoterHolding') {
            ipoItem.promoterHolding = value === '' ? undefined : Number(value);
        } else if (field === 'litigationCount') {
            ipoItem.litigationCount = value === '' ? undefined : Number(value);
        } else if (field === 'peRatio') {
            ipoItem.peRatio = value === '' ? undefined : Number(value);
        } else if (field === 'marketTrend') {
            ipoItem.marketTrend = value === '' ? undefined : Number(value);
        }

        ipoItem.updatedAt = new Date().toISOString();
        localStorage.setItem(cacheKey, JSON.stringify(parsed));
    };

    const handleIpoFieldChange = (field: string, value: any) => {
        if (!selectedCalendarIpo) return;

        if (field === 'gmp') setCurrentGmp(value);
        if (field === 'qib') setQibSub(value);
        if (field === 'nii' || field === 'hni') {
            setNiiSub(value);
            setHniSub(value);
        }
        if (field === 'retail') setRetailSub(value);
        if (field === 'total') setTotalSub(value);

        const subField = field === 'hni' ? 'nii' : field;

        // Update selectedCalendarIpo state
        setSelectedCalendarIpo(prev => {
            if (!prev) return null;
            const updated = { ...prev };
            if (field === 'gmp') {
                updated.gmp = value === '' ? undefined : Number(value);
            } else {
                updated.subscriptionData = {
                    qib: prev.subscriptionData?.qib || 0,
                    nii: prev.subscriptionData?.nii || 0,
                    retail: prev.subscriptionData?.retail || 0,
                    total: prev.subscriptionData?.total || 0,
                    ...prev.subscriptionData,
                    [subField]: value === '' ? 0 : Number(value)
                };
            }
            return updated;
        });

        // Update presets
        setCalendarPresets(prev => prev.map(ipo => {
            if (ipo.id === selectedCalendarIpo.id) {
                const updated = { ...ipo };
                if (field === 'gmp') {
                    updated.gmp = value === '' ? undefined : Number(value);
                } else {
                    updated.subscriptionData = {
                        qib: ipo.subscriptionData?.qib || 0,
                        nii: ipo.subscriptionData?.nii || 0,
                        retail: ipo.subscriptionData?.retail || 0,
                        total: ipo.subscriptionData?.total || 0,
                        ...ipo.subscriptionData,
                        [field]: value === '' ? 0 : Number(value)
                    };
                }
                return updated;
            }
            return ipo;
        }));

        saveToIpoCache(field, value);
    };

    const applyCalendarPreset = async (ipo: IPOListing) => {
        // Load cached details if any
        const cacheKey = 'alpha_cached_ipos';
        const cached = localStorage.getItem(cacheKey);
        let cachedData: any = null;
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed)) {
                    cachedData = parsed.find((item: any) => item.id === ipo.id);
                }
            } catch (e) {
                console.error(e);
            }
        }

        setSelectedCalendarIpo(ipo);

        // Restore cached forensic fields or set defaults
        setFreshIssue(cachedData?.freshIssue !== undefined ? cachedData.freshIssue : (ipo.issueSize > 0 ? 100 : 0));
        setPromoterHolding(cachedData?.promoterHolding !== undefined ? cachedData.promoterHolding : '');
        setLitigationCount(cachedData?.litigationCount !== undefined ? cachedData.litigationCount : '');
        setPeRatio(cachedData?.peRatio !== undefined ? cachedData.peRatio : '');

        // Restore listing sentiment
        setMarketTrend(cachedData?.marketTrend !== undefined ? cachedData.marketTrend : 0);

        setCurrentGmp(cachedData?.gmp !== undefined ? cachedData.gmp : (ipo.gmp !== undefined ? ipo.gmp : ''));
        setQibSub(cachedData?.subscriptionData?.qib !== undefined ? cachedData.subscriptionData.qib : (ipo.subscriptionData?.qib !== undefined ? ipo.subscriptionData.qib : ''));
        const restoredNii = cachedData?.subscriptionData?.nii !== undefined ? cachedData.subscriptionData.nii : (ipo.subscriptionData?.nii !== undefined ? ipo.subscriptionData.nii : '');
        setNiiSub(restoredNii);
        setHniSub(restoredNii);
        setRetailSub(cachedData?.subscriptionData?.retail !== undefined ? cachedData.subscriptionData.retail : (ipo.subscriptionData?.retail !== undefined ? ipo.subscriptionData.retail : ''));
        setTotalSub(cachedData?.subscriptionData?.total !== undefined ? cachedData.subscriptionData.total : (ipo.subscriptionData?.total !== undefined ? ipo.subscriptionData.total : ''));
        
        setStratIssuePrice(ipo.priceRange.max);

        // Calculate and set initial open price based on effective GMP
        const initialGmp = cachedData?.gmp !== undefined ? cachedData.gmp : (ipo.gmp || 0);
        const initialTrend = cachedData?.marketTrend !== undefined ? cachedData.marketTrend : 0;
        const initialEffectiveGmp = initialGmp * (1 + initialTrend / 100);
        setStratListPrice(Math.round(ipo.priceRange.max * (1 + initialEffectiveGmp / 100) * 100) / 100);

        try {
            const details = await ipoCalendarService.getIPODetails(ipo.id);
            if (details) {
                const apiTotal = details.subscriptionData?.total || details.total_subscription;
                const apiQib = details.subscriptionData?.qib || details.qib_sub;
                const apiNii = details.subscriptionData?.nii || details.nii_sub;
                const apiRetail = details.subscriptionData?.retail || details.retail_sub;

                const allotment = details.allotmentDate || details.allotment_date || details.timeline?.allotment_date || details.timeline?.allotment_start_date || ipo.allotmentDate;
                const refund = details.refundDate || details.refund_date || details.timeline?.refund_initiation_date || ipo.refundDate;
                const listing = details.listingDate || details.listing_date || details.timeline?.listing_date || ipo.listingDate;

                setSelectedCalendarIpo(prev => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        ...details,
                        allotmentDate: allotment,
                        refundDate: refund,
                        listingDate: listing,
                        lotSize: details.lot_size || prev.lotSize,
                        issueSize: details.issue_size || prev.issueSize,
                        timeline: details.timeline || prev.timeline,
                        subscriptionData: {
                            qib: cachedData?.subscriptionData?.qib !== undefined ? cachedData.subscriptionData.qib : (apiQib || prev.subscriptionData?.qib || ''),
                            nii: cachedData?.subscriptionData?.nii !== undefined ? cachedData.subscriptionData.nii : (apiNii || prev.subscriptionData?.nii || ''),
                            retail: cachedData?.subscriptionData?.retail !== undefined ? cachedData.subscriptionData.retail : (apiRetail || prev.subscriptionData?.retail || ''),
                            total: cachedData?.subscriptionData?.total !== undefined ? cachedData.subscriptionData.total : (apiTotal || prev.subscriptionData?.total || ''),
                        }
                    };
                });
                
                if (cachedData?.subscriptionData?.total === undefined && apiTotal) setTotalSub(parseFloat(apiTotal) || '');
                if (cachedData?.subscriptionData?.qib === undefined && apiQib) setQibSub(parseFloat(apiQib) || '');
                if (cachedData?.subscriptionData?.nii === undefined && apiNii) setNiiSub(parseFloat(apiNii) || '');
                if (cachedData?.subscriptionData?.retail === undefined && apiRetail) setRetailSub(parseFloat(apiRetail) || '');
            }
        } catch (e) {
            console.error("API details fetch failed", e);
        }
    };

    const filteredPresets = useMemo(() => {
        return calendarPresets.filter(p => p.status === 'OPEN' || p.status === 'CLOSED');
    }, [calendarPresets]);

    const calculatedIssuePrice = useMemo(() => {
        return Number(stratIssuePrice) || Number(selectedCalendarIpo?.priceRange?.max) || 0;
    }, [stratIssuePrice, selectedCalendarIpo]);

    const calculatedLotSize = useMemo(() => {
        return Number(selectedCalendarIpo?.lotSize) || 26;
    }, [selectedCalendarIpo]);

    const lotValue = useMemo(() => {
        return calculatedIssuePrice * calculatedLotSize;
    }, [calculatedIssuePrice, calculatedLotSize]);

    const ledgerSummary = useMemo(() => summarizeIPOApplications(applications, investments, trades), [applications, investments, trades]);

    return (
        <div className="page-shell space-y-6 animate-in fade-in duration-300 pb-24 md:pb-0">

            <TabHero
                eyebrow="Capital Events"
                title={activeSubTab === 'WAR_ROOM' ? 'IPO War Room' : 'Syndicate Tracker'}
                description={activeSubTab === 'WAR_ROOM' ? 'Forensic issue scoring, timeline visibility, and listing-day strategy in one command surface.' : 'Manage family applications, mandates, and pooled participation with better operational clarity.'}
                icon={activeSubTab === 'WAR_ROOM' ? AlertOctagon : Users}
                iconTone={activeSubTab === 'WAR_ROOM' ? 'text-emerald-500' : 'text-indigo-500'}
                gradientClassName={activeSubTab === 'WAR_ROOM' ? 'from-emerald-50 via-white to-indigo-50 dark:from-emerald-950/20 dark:via-slate-950 dark:to-indigo-950/20' : 'from-indigo-50 via-white to-sky-50 dark:from-indigo-950/20 dark:via-slate-950 dark:to-sky-950/20'}
                chips={activeSubTab === 'WAR_ROOM' ? ['Issue scoring', 'Timeline tracking', 'Listing strategy'] : ['Family ledger', 'Mandate tracking', 'Allocation ops']}
                actions={
                    <div className="inline-flex min-h-[38px] items-center rounded-full border border-slate-200 bg-white/85 p-0.5 dark:border-slate-700 dark:bg-slate-900/80">
                        <button
                            onClick={() => setActiveSubTab('WAR_ROOM')}
                            className={`inline-flex min-h-[30px] items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${activeSubTab === 'WAR_ROOM' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                        >
                            <LayoutGrid size={12} /> War Room
                        </button>
                        <button
                            onClick={() => setActiveSubTab('SYNDICATE')}
                            className={`inline-flex min-h-[30px] items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${activeSubTab === 'SYNDICATE' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                        >
                            <Users size={12} /> Syndicate Tracker
                        </button>
                    </div>
                }
            />

            {activeSubTab === 'SYNDICATE' ? (
                <SyndicateTracker
                    totalCash={totalCash}
                    onPortfolioRefresh={refreshPortfolio}
                    onDataChange={handleDataChange}
                    onSelectIpo={(ipo) => {
                        applyCalendarPreset(ipo);
                        setActiveSubTab('WAR_ROOM');
                    }}
                />
            ) : (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4">



                    <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                        <div className="rounded-2xl sm:rounded-[24px] border border-slate-200 bg-white dark:bg-slate-900/60 p-3.5 sm:p-5 md:p-6 shadow-sm backdrop-blur-md dark:border-slate-800">
                            <SectionHeader
                                eyebrow="Live Issue"
                                title="IPO Timeline"
                                description="Track the active issue through allotment and listing."
                                icon={Calendar}
                                tone="info"
                                badge={selectedCalendarIpo?.score !== undefined ? `Score ${selectedCalendarIpo.score}` : undefined}
                                chips={selectedCalendarIpo ? [selectedCalendarIpo.status, selectedCalendarIpo.sector] : ['Timeline view', 'Score drivers']}
                            />

                            {selectedCalendarIpo ? (
                                <div className="mt-4 sm:mt-6 space-y-4 sm:space-y-6">
                                    {/* Selected IPO Header */}
                                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4 rounded-xl border border-slate-200 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-950/30 p-3.5 sm:p-4">
                                        <div>
                                            <p className="text-base sm:text-lg font-black tracking-tight text-slate-900 dark:text-white">{selectedCalendarIpo.name}</p>
                                            <div className="mt-1 flex items-center gap-1.5 sm:gap-2">
                                                <span className="px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                                                    {selectedCalendarIpo.sector}
                                                </span>
                                                <span className="px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                                    {selectedCalendarIpo.category}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-left sm:text-right">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-0.5 sm:mb-1">Current GMP</p>
                                            <p className="text-lg sm:text-xl font-black text-emerald-600 dark:text-emerald-500">+{formatCurrency(selectedCalendarIpo.gmp || 0)}</p>
                                        </div>
                                    </div>

                                    {/* Timeline Steps */}
                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
                                        {buildIPOTimeline(selectedCalendarIpo).map((item) => (
                                            <div key={item.label} className={`rounded-xl border p-2.5 sm:p-3 flex flex-col items-center justify-center transition-all ${
                                                item.status === 'done'
                                                    ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800/50'
                                                    : item.status === 'active'
                                                        ? 'bg-indigo-50 border-indigo-300 dark:bg-indigo-900/30 dark:border-indigo-500/50 shadow-sm ring-1 ring-indigo-500/20'
                                                        : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-slate-800'
                                            }`}>
                                                <p className={`text-[8px] sm:text-[9px] font-black uppercase tracking-widest text-center ${
                                                    item.status === 'done' ? 'text-emerald-600 dark:text-emerald-400' :
                                                    item.status === 'active' ? 'text-indigo-600 dark:text-indigo-400' :
                                                    item.status === 'upcoming' ? 'text-slate-500 dark:text-slate-400' :
                                                    'text-rose-600 dark:text-rose-400'
                                                }`}>{item.label}</p>
                                                <p className="mt-1 text-xs font-bold text-slate-800 dark:text-slate-200 text-center">{item.date || 'TBD'}</p>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Scoring Factors */}
                                    {selectedCalendarIpo.scoreFactors && selectedCalendarIpo.scoreFactors.length > 0 && (
                                        <div className="space-y-2.5 sm:space-y-3 pt-2">
                                            <p className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 pl-1">Score Drivers</p>
                                            {(selectedCalendarIpo.scoreFactors || []).slice(0, 3).map((factor) => (
                                                <div key={factor.label} className="rounded-xl border border-slate-200 bg-white p-2.5 sm:p-3 shadow-sm dark:border-slate-800/50 dark:bg-slate-900/40">
                                                    <div className="flex items-center justify-between gap-3 mb-1">
                                                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{factor.label}</span>
                                                        <span className={`text-[9px] sm:text-[10px] font-black px-2 py-0.5 rounded-full border shadow-sm ${factor.impact === 'positive' ? 'border-emerald-200/50 bg-emerald-50 text-emerald-600 dark:border-emerald-800/50 dark:bg-emerald-900/30 dark:text-emerald-400' : factor.impact === 'negative' ? 'border-rose-200/50 bg-rose-50 text-rose-600 dark:border-rose-800/50 dark:bg-rose-900/30 dark:text-rose-400' : 'border-slate-200/50 bg-slate-100 text-slate-500 dark:border-slate-800/50 dark:bg-slate-900 dark:text-slate-400'}`}>
                                                            {factor.points > 0 ? '+' : ''}{factor.points} PTS
                                                        </span>
                                                    </div>
                                                    <p className="text-[10px] sm:text-[11px] font-medium leading-relaxed text-slate-500 dark:text-slate-400">{factor.rationale}</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="mt-4 sm:mt-6">
                                    <StateSurface
                                        tone="neutral"
                                        icon={Calendar}
                                        title="No live IPO is loaded yet."
                                        description="Load one of the live IPO presets to see timeline stages, score drivers, and issue context here."
                                        className="border-dashed bg-transparent border-slate-200 dark:border-slate-800"
                                    />
                                </div>
                            )}
                        </div>
                        <div className="rounded-2xl sm:rounded-[24px] border border-slate-200 bg-white dark:bg-slate-900/60 p-3.5 sm:p-5 md:p-6 shadow-sm backdrop-blur-md dark:border-slate-800">
                            <SectionHeader
                                eyebrow="Capital Ledger"
                                title="Application Ledger"
                                description="Blocked capital, refunds, and listed P&L across the syndicate."
                                icon={Wallet}
                                tone="success"
                                chips={['Blocked capital', 'Refund loop', 'Listed outcome']}
                            />

                            <div className="mt-4 sm:mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                <MetricTile
                                    label="Blocked Capital"
                                    value={formatCurrency(ledgerSummary.blockedCapital)}
                                    meta={`${ledgerSummary.activeApplications} active application(s)`}
                                    tone="warning"
                                    className="border-amber-200/60 dark:border-amber-500/20 bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-slate-900 shadow-sm"
                                />
                                <MetricTile
                                    label="Refunded"
                                    value={formatCurrency(ledgerSummary.refundedCapital)}
                                    meta="Capital released back to runway"
                                    tone="neutral"
                                    className="border-slate-200/60 dark:border-slate-700/50 bg-gradient-to-br from-slate-50 to-white dark:from-slate-800/30 dark:to-slate-900 shadow-sm"
                                />
                                <MetricTile
                                    label="Allotted"
                                    value={ledgerSummary.allottedApplications}
                                    meta="Won issue(s) in the ledger"
                                    tone="success"
                                    className="border-emerald-200/60 dark:border-emerald-500/20 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-900 shadow-sm"
                                />
                                <MetricTile
                                    label="Listed P&L"
                                    value={formatCurrency(ledgerSummary.listedPnL)}
                                    meta="Realized listing outcome so far"
                                    tone={ledgerSummary.listedPnL >= 0 ? 'success' : 'danger'}
                                    className={ledgerSummary.listedPnL >= 0 
                                        ? "border-emerald-200/60 dark:border-emerald-500/20 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-900 shadow-sm"
                                        : "border-rose-200/60 dark:border-rose-500/20 bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/30 dark:to-slate-900 shadow-sm"
                                    }
                                />
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl sm:rounded-[24px] border border-slate-200 bg-white/60 p-3.5 sm:p-5 md:p-6 shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/60">
                        <SectionHeader
                            eyebrow="Launch Pad"
                            title="Quick Load"
                            description="Jump between live calendar names, saved presets, and paste-based issue intake."
                            icon={Zap}
                            tone="info"
                        />
                        <div className="mt-3 flex w-full flex-wrap items-center gap-2">
                        {filteredPresets.slice(0, 4).map(ipo => (
                            <button
                                key={ipo.id}
                                onClick={() => applyCalendarPreset(ipo)}
                                className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 font-medium transition-colors flex items-center gap-1 group"
                                title={`${ipo.status} • Score ${ipo.score ?? ipoCalendarService.scoreIPO(ipo)}`}
                            >
                                <Calendar size={12} className="opacity-60 group-hover:opacity-100" />
                                {ipo.name}
                            </button>
                        ))}
                        {IPO_PRESETS.map(p => (
                            <button
                                key={p.name}
                                onClick={() => applyPreset(p)}
                                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 font-medium transition-colors flex items-center gap-1 group"
                            >
                                <MousePointerClick size={12} className="opacity-50 group-hover:opacity-100" />
                                {p.name}
                            </button>
                        ))}
                        <div className="w-px h-4 bg-slate-300 dark:bg-slate-700 mx-1"></div>
                        <select 
                            onChange={(e) => {
                                const selected = filteredPresets.find(p => p.id === e.target.value);
                                if (selected) applyCalendarPreset(selected);
                            }}
                            value={selectedCalendarIpo?.id || ''}
                            className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800 text-xs text-indigo-700 dark:text-indigo-300 font-medium outline-none focus:ring-2 focus:ring-indigo-500/25 transition-all"
                        >
                            <option value="">-- Select Any Calendar IPO --</option>
                            {filteredPresets.map(ipo => (
                                <option key={ipo.id} value={ipo.id} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-white">
                                    {ipo.name} ({ipo.status})
                                </option>
                            ))}
                        </select>
                        <div className="w-px h-4 bg-slate-300 dark:bg-slate-700 mx-1"></div>
                        <button
                            onClick={() => setIsPasteModalOpen(true)}
                            className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800 text-xs text-indigo-600 dark:text-indigo-400 font-bold transition-colors flex items-center gap-1"
                        >
                            <Zap size={12} /> Magic Paste
                        </button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <DemandHeatmap
                            qibSub={qibSub}
                            setQibSub={(val) => handleIpoFieldChange('qib', val)}
                            niiSub={niiSub}
                            setNiiSub={(val) => handleIpoFieldChange('nii', val)}
                            retailSub={retailSub}
                            setRetailSub={(val) => handleIpoFieldChange('retail', val)}
                            totalSub={totalSub}
                            setTotalSub={(val) => handleIpoFieldChange('total', val)}
                            currentGmp={Number(currentGmp)}
                            subscriptionX={Number(retailSub)}
                            issueSize={selectedCalendarIpo?.issueSize}
                        />

                        {/* FEATURE 1: PROBABILITY ENGINE */}
                        <ProbabilityEngine
                            subscriptionX={retailSub}
                            setSubscriptionX={(val) => handleIpoFieldChange('retail', val)}
                            hniSubscriptionX={hniSub}
                            setHniSubscriptionX={(val) => handleIpoFieldChange('nii', val)}
                            luckStats={luckStats}
                            friends={friends}
                            selectedIpo={selectedCalendarIpo}
                            applications={applications}
                            currentGmp={Number(currentGmp)}
                        />
                        {/* FEATURE 6: FLIPPER'S MATRIX (NEW) */}
                        <FlippersMatrix
                            capital={totalRequiredCapital}
                            lockInDays={daysCloseToListing}
                            gmpPct={Number(currentGmp) || 0}
                            swingReturnPct={swingReturnPct}
                            setSwingReturnPct={setSwingReturnPct}
                            marketTrend={marketTrend}
                            setMarketTrend={(val) => {
                                setMarketTrend(val);
                                saveToIpoCache('marketTrend', val);
                            }}
                            issuePrice={calculatedIssuePrice}
                            lotValue={lotValue}
                        />
                        
                        {/* FEATURE 7: LISTING STRATEGY GENERATOR (NEW) */}
                        <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                            <SectionHeader
                                eyebrow="Exit Framework"
                                title="Listing Strategy"
                                description="Turn issue price and open price into a listing-day decision posture."
                                icon={CandlestickChart}
                                tone="info"
                            />

                            <div className="mb-4 flex items-center gap-3">
                                <div className="flex-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase">Issue Price</label>
                                    <input
                                        type="number"
                                        value={stratIssuePrice}
                                        onChange={(e) => setStratIssuePrice(parseFloat(e.target.value) || '')}
                                        placeholder="0"
                                        className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm font-bold outline-none focus:border-fuchsia-500"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase">Open Price</label>
                                    <input
                                        type="number"
                                        value={stratListPrice}
                                        onChange={(e) => setStratListPrice(parseFloat(e.target.value) || '')}
                                        placeholder="0"
                                        className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm font-bold outline-none focus:border-fuchsia-500"
                                    />
                                </div>
                            </div>

                            {listingStrategy ? (
                                <div className={`flex-1 p-4 rounded-xl border-2 ${listingStrategy.color} animate-in zoom-in duration-300`}>
                                    <div className="flex justify-between items-start mb-2">
                                        <h4 className="text-lg font-black tracking-tight uppercase">{listingStrategy.title}</h4>
                                        <span className="text-xs font-bold px-2 py-1 bg-white/20 rounded">
                                            {listingStrategy.gainPct > 0 ? '+' : ''}{listingStrategy.gainPct.toFixed(1)}%
                                        </span>
                                    </div>
                                    <p className="text-sm font-medium opacity-90 leading-relaxed">
                                        {listingStrategy.desc}
                                    </p>
                                </div>
                            ) : (
                                <StateSurface
                                    className="flex-1"
                                    tone="neutral"
                                    title="Enter prices to generate strategy."
                                    description="Add issue and open prices to get the launch-day action posture and risk framing."
                                    icon={Scale}
                                />
                            )}
                        </div>

                        {/* FEATURE 2: THE 7-POINT SCAN */}
                        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                            <SectionHeader
                                eyebrow="Forensic Data"
                                title="The 7-Point Scan"
                                description="Compact issue-quality checks for dilution quality, promoter posture, legal load, and valuation."
                                icon={Search}
                                tone="info"
                                badge="Forensic data"
                            />

                            <div className="space-y-5">
                                <div>
                                    <div className="flex justify-between items-end mb-1">
                                        <label className="block text-xs font-bold text-slate-500 uppercase">Fresh Issue % (vs OFS)</label>
                                        {freshIssue !== '' && (
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isLiquidityRisk ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                                {isLiquidityRisk ? 'EXIT LIQUIDITY' : 'GROWTH CAP'}
                                            </span>
                                        )}
                                    </div>
                                    <input
                                        type="number"
                                        value={freshIssue}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value) || '';
                                            setFreshIssue(val);
                                            saveToIpoCache('freshIssue', val);
                                        }}
                                        placeholder="e.g. 65"
                                        className={`w-full p-3 rounded-lg border bg-slate-50 dark:bg-slate-950 outline-none transition-all ${isLiquidityRisk ? 'border-rose-500 focus:ring-2 focus:ring-rose-500/20' : 'border-slate-200 dark:border-slate-800 focus:border-indigo-500'}`}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Promoter Holding %</label>
                                        <input
                                            type="number"
                                            value={promoterHolding}
                                            onChange={(e) => {
                                                const val = parseFloat(e.target.value) || '';
                                                setPromoterHolding(val);
                                                saveToIpoCache('promoterHolding', val);
                                            }}
                                            className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 outline-none focus:border-indigo-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Litigation Count</label>
                                        <input
                                            type="number"
                                            value={litigationCount}
                                            onChange={(e) => {
                                                const val = parseFloat(e.target.value) || '';
                                                setLitigationCount(val);
                                                saveToIpoCache('litigationCount', val);
                                            }}
                                            className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 outline-none focus:border-indigo-500"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">P/E Ratio (vs Sector)</label>
                                    <input
                                        type="number"
                                        value={peRatio}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value) || '';
                                            setPeRatio(val);
                                            saveToIpoCache('peRatio', val);
                                        }}
                                        className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 outline-none focus:border-indigo-500"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-6">
                            {/* FEATURE 3: GMP VALIDATOR */}
                            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                {isSkipSignal && (
                                    <div className="absolute inset-0 bg-rose-950/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center text-center p-6 animate-in zoom-in duration-300">
                                        <XCircle size={64} className="text-rose-500 mb-4 drop-shadow-[0_0_15px_rgba(244,63,94,0.5)]" />
                                        <h2 className="text-3xl font-black text-white tracking-widest uppercase mb-2">SKIP THIS IPO</h2>
                                        <p className="text-rose-200 font-medium">GMP is dead. Retail probability is negligible.</p>
                                        <button
                                            onClick={() => { setCurrentGmp(''); setSubProb(''); }}
                                            className="mt-6 px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm"
                                        >
                                            Reset Analysis
                                        </button>
                                    </div>
                                )}

                                <SectionHeader
                                    eyebrow="Sentiment Gate"
                                    title="GMP Validator"
                                    description="Pressure-test grey-market strength before trusting listing-day enthusiasm."
                                    icon={Banknote}
                                    tone={isGoodGmp ? 'success' : currentGmp !== '' ? 'warning' : 'neutral'}
                                    badge={isGoodGmp ? 'Constructive GMP' : currentGmp !== '' ? 'Weak GMP' : undefined}
                                />

                                <div className="space-y-5">
                                    <div className="p-4 bg-slate-100 dark:bg-slate-950 rounded-xl flex items-center justify-between">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Current GMP %</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    value={currentGmp}
                                                    onChange={(e) => handleIpoFieldChange('gmp', parseFloat(e.target.value) || '')}
                                                    placeholder="0"
                                                    className="w-20 bg-transparent text-2xl font-bold text-slate-900 dark:text-white outline-none placeholder:text-slate-700"
                                                />
                                                <span className="text-slate-400">%</span>
                                            </div>
                                        </div>
                                        <div className={`p-3 rounded-full ${isGoodGmp ? 'bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-400'}`}>
                                            {isGoodGmp ? <ThumbsUp size={24} /> : <ThumbsDown size={24} />}
                                        </div>
                                    </div>

                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-xs font-bold text-slate-500 uppercase">Estimated Listing Gain</label>
                                            {(() => {
                                                const calculatedIssuePrice = Number(stratIssuePrice) || Number(selectedCalendarIpo?.priceRange?.max) || 0;
                                                const calculatedGmp = Number(currentGmp) || 0;
                                                const calculatedLotSize = Number(selectedCalendarIpo?.lotSize) || 26;
                                                const estimatedListingPrice = calculatedIssuePrice * (1 + calculatedGmp / 100);
                                                const gainPerShare = calculatedIssuePrice * (calculatedGmp / 100);
                                                const gainPerLot = calculatedLotSize * gainPerShare;

                                                if (calculatedIssuePrice <= 0) return null;
                                                return (
                                                    <span className="text-xs font-black text-emerald-400">
                                                        Est. Price: ₹{estimatedListingPrice.toFixed(2)} (+{calculatedGmp}%)
                                                    </span>
                                                );
                                            })()}
                                        </div>
                                        <div className="w-full h-4 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden flex mb-2 relative">
                                            <div className="bg-emerald-500 h-full" style={{ width: `${Math.min(Number(currentGmp), 100)}%` }}></div>
                                        </div>
                                        {(() => {
                                            const calculatedIssuePrice = Number(stratIssuePrice) || Number(selectedCalendarIpo?.priceRange?.max) || 0;
                                            const calculatedGmp = Number(currentGmp) || 0;
                                            const calculatedLotSize = Number(selectedCalendarIpo?.lotSize) || 26;
                                            const gainPerShare = calculatedIssuePrice * (calculatedGmp / 100);
                                            const gainPerLot = calculatedLotSize * gainPerShare;

                                            if (calculatedIssuePrice <= 0) return null;
                                            return (
                                                <div className="flex justify-between text-[10px] text-slate-400 font-bold">
                                                    <span>Gain/Share: +₹{gainPerShare.toFixed(2)}</span>
                                                    <span>Gain/Lot: +₹{formatCurrency(gainPerLot)}</span>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                            </div>

                            {/* FEATURE 4: QUOTA REMINDER */}
                            <div className="relative overflow-hidden rounded-2xl border border-blue-800 bg-gradient-to-r from-blue-900 to-indigo-900 p-6 text-white shadow-sm">
                                <div className="absolute top-0 right-0 p-4 opacity-10">
                                    <Users size={80} />
                                </div>
                                <div className="relative z-10">
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-300/80">Eligibility</p>
                                    <h3 className="mt-1 flex items-center gap-2 text-lg font-bold">
                                        <Users size={20} className="text-blue-300" /> Shareholder Quota
                                    </h3>
                                    <p className="mt-1 text-xs text-blue-200/80">Use this reminder when a parent-company quota can change allotment odds.</p>
                                </div>

                                <div className="relative z-10 mt-4 flex items-center gap-3">
                                    <div className="relative flex items-center">
                                        <input
                                            type="checkbox"
                                            checked={isParentShareholder}
                                            onChange={(e) => setIsParentShareholder(e.target.checked)}
                                            className="w-6 h-6 border-2 border-blue-400 rounded-md bg-transparent checked:bg-blue-400 cursor-pointer appearance-none"
                                        />
                                        {isParentShareholder && <CheckCircle2 size={16} className="absolute inset-0 m-auto text-blue-900 pointer-events-none" />}
                                    </div>
                                    <label className="text-sm font-medium text-blue-100">
                                        Are you a shareholder of the Parent Co?
                                    </label>
                                </div>

                                {isParentShareholder && (
                                    <div className="mt-4 p-3 bg-blue-950/50 border border-blue-400/30 rounded-lg flex items-start gap-3 animate-in slide-in-from-bottom-2">
                                        <Calendar className="text-blue-400 shrink-0" size={20} />
                                        <div>
                                            <p className="text-sm font-bold text-blue-200">Action Required</p>
                                            <p className="text-xs text-blue-300/80 mt-1">
                                                Verify the <strong>Record Date</strong> in the RHP. You must own at least 1 share of the parent company before this date.
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}


            <PasteParserModal
                isOpen={isPasteModalOpen}
                onClose={() => setIsPasteModalOpen(false)}
                onParse={handleParsedData}
            />
        </div>
    );
};

// Wrap with React.memo to prevent unnecessary re-renders
export default React.memo(IPOWarRoom);
