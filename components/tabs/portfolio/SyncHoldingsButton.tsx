import React, { useState } from 'react';
import { RefreshCw, DownloadCloud, AlertTriangle, ShieldCheck, X, Database, PlusCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePortfolioStore } from '../../../store/portfolioStore';
import { dhanBrokerService, DhanHoldingResponse } from '../../../services/DhanBrokerService';
import { logger } from '../../../utils/logger';
import { useToast } from '../../shared/ToastProvider';
import { Investment, InvestmentType } from '../../../types';
import { useSettingsStore } from '../../../store/settingsStore';
import { fetchIndianStockQuote } from '../../../services/RealDataService';
import { COPY } from '../../../utils/appCopy';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise a ticker/symbol for fuzzy comparison */
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Try to get live prices from Dhan's Marketfeed API.
 * Returns a map of { securityId → price }.
 * If the API fails entirely (403/400/timeout), returns an EMPTY map — caller
 * should fall back to avgCostPrice from holdings, NOT to sequential AI calls.
 */
async function tryFetchLivePrices(
    dhanHoldings: DhanHoldingResponse[]
): Promise<Record<string, { price: number; changePercent?: number; source?: string }>> {
    const ltpMap: Record<string, { price: number; changePercent?: number; source?: string }> = {};

    const instruments = dhanHoldings
        .filter(h => h.securityId)
        .map(h => {
            const exch = (h as any).exchange || h.exchangeSegment || 'NSE';
            return {
                segment: exch === 'BSE' ? 'BSE_EQ' : 'NSE_EQ',
                securityId: String(h.securityId),
            };
        });

    if (instruments.length === 0) return ltpMap;

    // Attempt 1: NSE_EQ bulk fetch
    try {
        const batchMap = await dhanBrokerService.fetchLTP(instruments);
        for (const [sid, price] of Object.entries(batchMap)) {
            if (price > 0) ltpMap[sid] = { price, source: 'dhan' };
        }
    } catch (e) {
        console.warn('[DhanSync] Bulk NSE fetchLTP failed:', e);
    }

    // Attempt 2: BSE retry for anything that got 0 on NSE (gold/silver ETFs)
    const bseRetry = instruments
        .filter(i => i.segment === 'NSE_EQ' && !ltpMap[i.securityId])
        .map(i => ({ segment: 'BSE_EQ', securityId: i.securityId }));

    if (bseRetry.length > 0) {
        try {
            const bseMap = await dhanBrokerService.fetchLTP(bseRetry);
            for (const [sid, price] of Object.entries(bseMap)) {
                if (price > 0) ltpMap[sid] = { price, source: 'dhan' };
            }
        } catch (e) {
            console.warn('[DhanSync] Bulk BSE fetchLTP failed:', e);
        }
    }

    // Fallback: Yahoo Finance & Official Sources via RealDataService
    // Only for instruments that failed Dhan's bulk LTP
    const missing = dhanHoldings.filter(h => !ltpMap[h.securityId]);
    if (missing.length > 0) {
        logger.log('DhanSync', `Attempting free fallback for ${missing.length} missing instruments...`);
        // Use Promise.all with concurrency limit or just batch them
        await Promise.all(missing.map(async (h) => {
            try {
                const quote = await fetchIndianStockQuote(h.tradingSymbol);
                if (quote && quote.price > 0) {
                    ltpMap[h.securityId] = { 
                        price: quote.price, 
                        changePercent: quote.changePercent,
                        source: quote.source 
                    };
                }
            } catch (e) { /* ignore */ }
        }));
    }

    const priced = Object.values(ltpMap).filter(v => v.price > 0).length;
    logger.log('DhanSync', `LTP result: ${priced}/${instruments.length} instruments priced`, ltpMap);
    return ltpMap;
}

export const SyncHoldingsButton: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const investments = usePortfolioStore(s => s.investments);
    const updateInvestment = usePortfolioStore(s => s.updateInvestment);
    const addInvestment = usePortfolioStore(s => s.addInvestment);
    const deleteInvestment = usePortfolioStore(s => s.deleteInvestment);
    const refreshPortfolio = usePortfolioStore(s => s.refreshPortfolio);
    const { toast } = useToast();
    const isConfigured = useSettingsStore(s => (
        !!s.dhanClientId && (!!s.dhanAccessToken || (!!s.dhanPin && !!s.dhanTotpSecret))
    ));

    // ── Smart Price Update ───────────────────────────────────────────────────
    // 1. Fetch holdings from Dhan (same API that Full Import uses — PROVEN to work)
    // 2. Try Dhan Marketfeed LTP (optional — may fail if no Data API subscription)
    // 3. Build price map: securityId → livePrice OR avgCostPrice
    // 4. Match portfolio investments by dhanSecurityId / id / ticker / name
    // 5. Update currentValue = price × quantity
    const handleRefreshPrices = async () => {
        setIsOpen(false);
        if (!isConfigured) return toast.error('DhanHQ not configured in Settings.');
        setIsSyncing(true);
        toast.info('Fetching live prices from DhanHQ...');

        try {
            // ── Step 1: Fetch holdings (proven to work — same as Full Import) ──
            const dhanHoldings = await dhanBrokerService.fetchHoldings();
            if (!dhanHoldings || dhanHoldings.length === 0) {
                toast.warning(COPY.toasts.noHoldingsFound);
                return;
            }
            logger.log('DhanSync', `Got ${dhanHoldings.length} holdings:`, dhanHoldings.map(h => `${h.tradingSymbol}(${h.securityId})`));

            // ── Step 2: Try live LTP (best-effort, may return empty) ──────────
            const ltpMap = await tryFetchLivePrices(dhanHoldings);
            const hasLivePrices = Object.values(ltpMap).some(p => p.price > 0);

            // ── Step 3: Build a COMPLETE price map from holdings ──────────────
            // Key insight: Dhan holdings ALWAYS have avgCostPrice.
            // If LTP succeeded → use live price. If not → use avgCostPrice.
            // This guarantees we ALWAYS have a price for every holding.
            const holdingsMap: Record<string, { price: number; symbol: string; qty: number; avgCost: number; changePercent?: number; source?: string }> = {};
            const symbolToSecId: Record<string, string> = {};

            for (const h of dhanHoldings) {
                const sid = String(h.securityId);
                const ltp = ltpMap[sid];
                const livePrice = ltp?.price || 0;
                
                holdingsMap[sid] = {
                    price: livePrice > 0 ? livePrice : h.avgCostPrice,
                    symbol: h.tradingSymbol,
                    qty: h.totalQty,
                    avgCost: h.avgCostPrice,
                    changePercent: ltp?.changePercent,
                    source: ltp?.source || (livePrice > 0 ? 'dhan' : 'avgCost')
                };
                // Also index by normalised symbol for ticker matching
                symbolToSecId[norm(h.tradingSymbol)] = sid;
            }

            // ── Step 4: Match portfolio investments ──────────────────────────
            const currentInvestments = usePortfolioStore.getState().investments;
            let updatedCount = 0;

            for (const inv of currentInvestments) {
                let matchedSid = '';

                // Strategy 1: Direct dhanSecurityId (set by Full Import — most reliable)
                if (inv.dhanSecurityId && holdingsMap[String(inv.dhanSecurityId)]) {
                    matchedSid = String(inv.dhanSecurityId);
                }

                // Strategy 2: Extract securityId from ID format "dhan_TIMESTAMP_SECID"
                if (!matchedSid && inv.id?.startsWith('dhan_')) {
                    const sid = inv.id.split('_').pop() || '';
                    if (sid && holdingsMap[sid]) matchedSid = sid;
                }

                // Strategy 3: Exact ticker match
                if (!matchedSid && inv.ticker) {
                    const sid = symbolToSecId[norm(inv.ticker)];
                    if (sid && holdingsMap[sid]) matchedSid = sid;
                }

                // Strategy 4: Name fuzzy match (DhanHQ platform only)
                if (!matchedSid && inv.platform === 'DhanHQ' && inv.name) {
                    const normName = norm(inv.name);
                    for (const [normSym, sid] of Object.entries(symbolToSecId)) {
                        if (holdingsMap[sid] &&
                            (normName.includes(normSym.substring(0, 4)) ||
                             normSym.includes(normName.substring(0, 4)))) {
                            matchedSid = sid;
                            break;
                        }
                    }
                }

                // ── Apply update ─────────────────────────────────────────────
                if (matchedSid && holdingsMap[matchedSid]) {
                    const hd = holdingsMap[matchedSid];
                    const qty = inv.quantity || hd.qty || 0;
                    const price = hd.price;

                    const updates: Partial<Investment> = {
                        currentValue: qty > 0 ? price * qty : price,
                        lastUpdated: new Date().toISOString(),
                    };
                    
                    // Update percentage change if available
                    if (hd.changePercent !== undefined) {
                        (updates as any).percentageChange = hd.changePercent;
                    }

                    // Auto-save dhanSecurityId for instant future matches
                    if (!inv.dhanSecurityId) updates.dhanSecurityId = matchedSid;

                    await updateInvestment(inv.id, updates);
                    updatedCount++;
                    logger.log('DhanSync', `Updated holding price for ${inv.ticker || 'instrument'} (${hd.source})`);
                }
            }

            await refreshPortfolio();

            if (updatedCount > 0) {
                const priceSource = hasLivePrices ? 'live market prices' : 'latest cost prices from Dhan';
                toast.success(COPY.toasts.pricesUpdated(updatedCount, priceSource));
            } else {
                toast.warning(COPY.toasts.noMatchesFound);
                logger.warn('DhanSync', `No matches found among ${Object.keys(holdingsMap).length} broker holdings.`);
            }

        } catch (error: unknown) {
            console.error('[DhanSync] Smart Refresh failed:', error);
            const message = error instanceof Error ? error.message : String(error);
            toast.error(message || 'Failed to refresh prices.');
        } finally {
            setIsSyncing(false);
        }
    };

    // ── Full Dhan Import ─────────────────────────────────────────────────────
    // Wipes all Dhan-related entries and re-imports everything fresh.
    const handleFullImport = async () => {
        setIsOpen(false);
        if (!isConfigured) return toast.error('DhanHQ not configured in Settings.');
        setIsSyncing(true);
        toast.info('Re-importing everything from DhanHQ...');

        try {
            const dhanHoldings = await dhanBrokerService.fetchHoldings();
            if (!dhanHoldings || dhanHoldings.length === 0) {
                toast.warning(COPY.toasts.noHoldingsFound);
                return;
            }

            const ltpMap = await tryFetchLivePrices(dhanHoldings);

            // FIX: More aggressive filter to prevent duplicates
            // Delete anything that is explicitly marked as 'dhan' or has a Dhan security ID
            const existingDhan = investments.filter(i => 
                i.source === 'dhan' || 
                i.platform === 'DhanHQ' || 
                (i.dhanSecurityId && i.dhanSecurityId.length > 0)
            );
            
            logger.log('DhanSync', `Cleaning up ${existingDhan.length} existing Dhan entries...`);
            for (const old of existingDhan) {
                await deleteInvestment(old.id);
            }

            let importedCount = 0;
            for (const h of dhanHoldings) {
                const qty = h.totalQty || 0;
                if (qty === 0) continue;

                const ltp = ltpMap[String(h.securityId)];
                const price = (ltp && ltp.price > 0) ? ltp.price : h.avgCostPrice;

                await addInvestment({
                    id: `dhan_${Date.now()}_${h.securityId}_${Math.random().toString(36).substring(2,5)}`,
                    name: h.tradingSymbol,
                    ticker: h.tradingSymbol,
                    type: InvestmentType.STOCKS,
                    platform: 'DhanHQ',
                    investedAmount: (h.avgCostPrice || 0) * qty,
                    currentValue: price * qty,
                    percentageChange: ltp?.changePercent,
                    quantity: qty,
                    dhanSecurityId: String(h.securityId),
                    source: 'dhan',
                    lastUpdated: new Date().toISOString(),
                    owner: 'SELF',
                    status: 'ACTIVE',
                } as any);
                importedCount++;
            }

            await refreshPortfolio();
            toast.success(`Successfully re-imported ${importedCount} holdings!`);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[DhanSync] Full Import failed:', error);
            toast.error(message || 'Failed to re-import holdings.');
        } finally {
            setIsSyncing(false);
        }
    };

    // ── Incremental Sync (Update & Add Missing) ───────────────────────────────
    // Matches existing holdings and updates them, adds any missing ones.
    const handleIncrementalSync = async () => {
        setIsOpen(false);
        if (!isConfigured) return toast.error('DhanHQ not configured in Settings.');
        setIsSyncing(true);
        toast.info('Syncing: Adding missing & updating existing...');

        try {
            const dhanHoldings = await dhanBrokerService.fetchHoldings();
            if (!dhanHoldings || dhanHoldings.length === 0) {
                toast.warning(COPY.toasts.noHoldingsFound);
                return;
            }

            const ltpMap = await tryFetchLivePrices(dhanHoldings);
            
            // Build symbol index for matching
            const symbolToSecId: Record<string, string> = {};
            for (const h of dhanHoldings) symbolToSecId[norm(h.tradingSymbol)] = String(h.securityId);

            let updatedCount = 0;
            let addedCount = 0;
            
            // Track which Dhan holdings we've processed as matches
            const matchedDhanSids = new Set<string>();

            // Part A: Update existing investments
            for (const inv of investments) {
                let matchedSid = '';
                if (inv.dhanSecurityId && dhanHoldings.some(h => String(h.securityId) === inv.dhanSecurityId)) {
                    matchedSid = inv.dhanSecurityId;
                } else if (inv.ticker && symbolToSecId[norm(inv.ticker)]) {
                    matchedSid = symbolToSecId[norm(inv.ticker)];
                }

                if (matchedSid) {
                    const h = dhanHoldings.find(holding => String(holding.securityId) === matchedSid);
                    if (h) {
                        matchedDhanSids.add(matchedSid);
                        const ltp = ltpMap[matchedSid];
                        const price = ltp?.price || h.avgCostPrice;
                        const qty = h.totalQty || inv.quantity || 0;

                        await updateInvestment(inv.id, {
                            quantity: qty,
                            investedAmount: (h.avgCostPrice || 0) * qty,
                            currentValue: price * qty,
                            percentageChange: ltp?.changePercent,
                            dhanSecurityId: matchedSid,
                            lastUpdated: new Date().toISOString(),
                        } as any);
                        updatedCount++;
                    }
                }
            }

            // Part B: Add missing holdings
            for (const h of dhanHoldings) {
                const sid = String(h.securityId);
                if (!matchedDhanSids.has(sid)) {
                    const ltp = ltpMap[sid];
                    const price = ltp?.price || h.avgCostPrice;
                    const qty = h.totalQty || 0;
                    if (qty === 0) continue;

                    await addInvestment({
                        id: `dhan_${Date.now()}_${sid}`,
                        name: h.tradingSymbol,
                        ticker: h.tradingSymbol,
                        type: InvestmentType.STOCKS,
                        platform: 'DhanHQ',
                        investedAmount: (h.avgCostPrice || 0) * qty,
                        currentValue: price * qty,
                        percentageChange: ltp?.changePercent,
                        quantity: qty,
                        dhanSecurityId: sid,
                        source: 'dhan',
                        lastUpdated: new Date().toISOString(),
                        owner: 'SELF',
                        status: 'ACTIVE',
                    } as any);
                    addedCount++;
                }
            }

            await refreshPortfolio();
            toast.success(COPY.toasts.syncComplete(updatedCount, addedCount));
        } catch (error: unknown) {
            console.error('[DhanSync] Incremental Sync failed:', error);
            const message = error instanceof Error ? error.message : String(error);
            toast.error(message || 'Failed to sync holdings.');
        } finally {
            setIsSyncing(false);
        }
    };

    const menuRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    return (
        <div className="relative z-50" ref={menuRef}>
            <motion.button
                onClick={() => setIsOpen(!isOpen)}
                disabled={isSyncing}
                className={`w-7 h-7 md:w-8 md:h-8 rounded-lg transition-colors flex items-center justify-center ${
                    isOpen || isSyncing
                        ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400'
                        : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
                title="DhanHQ Sync"
            >
                <Database className={`w-3.5 h-3.5 md:w-4 md:h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            </motion.button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 z-50 overflow-hidden backdrop-blur-xl"
                    >
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
                            <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2 uppercase tracking-tight">
                                <ShieldCheck size={16} className="text-emerald-600 dark:text-emerald-500" />
                                DhanHQ Sync
                            </h3>
                            <button onClick={() => setIsOpen(false)} className="p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
                                <X size={14} />
                            </button>
                        </div>

                        <div className="p-2 flex flex-col gap-1">
                            <button
                                onClick={handleRefreshPrices}
                                className="w-full text-left flex items-start p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors group"
                            >
                                <RefreshCw size={18} className="text-sky-600 dark:text-sky-500 mt-0.5 mr-3 shrink-0" />
                                <div>
                                    <div className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-sky-600 dark:group-hover:text-sky-400">
                                        Smart Price Update
                                    </div>
                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-medium leading-relaxed">
                                        Matches existing holdings and updates prices from Dhan.
                                    </div>
                                </div>
                            </button>

                            <button
                                onClick={handleIncrementalSync}
                                className="w-full text-left flex items-start p-3 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors group"
                            >
                                <PlusCircle size={18} className="text-emerald-600 dark:text-emerald-500 mt-0.5 mr-3 shrink-0" />
                                <div>
                                    <div className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                                        Update & Add Missing
                                    </div>
                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-medium leading-relaxed">
                                        Safely adds new holdings and updates quantities. No data deleted.
                                    </div>
                                </div>
                            </button>

                            <button
                                onClick={handleFullImport}
                                className="w-full text-left flex items-start p-3 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors group"
                            >
                                <DownloadCloud size={18} className="text-rose-600 dark:text-rose-500 mt-0.5 mr-3 shrink-0" />
                                <div>
                                    <div className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-rose-600 dark:group-hover:text-rose-400">
                                        Full Dhan Re-Import
                                    </div>
                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex gap-1.5 font-medium leading-relaxed">
                                        <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
                                        <span>Wipes all auto-synced data first. Use to fix major desyncs.</span>
                                    </div>
                                </div>
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
