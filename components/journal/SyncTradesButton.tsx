import React, { useState } from 'react';
import { DownloadCloud } from 'lucide-react';
import { dhanBrokerService } from '../../services/DhanBrokerService';
import { db, Trade } from '../../database';
import { useToast } from '../shared/ToastProvider';
import { getISTDate } from '../../utils/helpers';
import { logger } from '../../utils/logger';

/** Parse Dhan's exchangeTime format "YYYY-MM-DD HH:mm:ss" safely. */
const parseDhanTime = (timeStr: string | undefined): number => {
    if (!timeStr || timeStr === 'NA') return 0;
    const d = new Date(String(timeStr).replace(' ', 'T'));
    return isNaN(d.getTime()) ? 0 : d.getTime();
};

/** Return a YYYY-MM-DD string N calendar days before a given date string. */
const daysBack = (dateStr: string, n: number): string => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
};

/**
 * Determine whether a trade is "delivery" / "carry-forward" (can be held overnight).
 */
const isDeliveryTrade = (productType: any, exchangeSegment: any): boolean => {
    const pt = String(productType || '').toUpperCase();
    return pt === 'CNC' || pt === 'MARGIN' || pt === 'MTF' || pt === 'NRML' || pt === 'NORMAL';
};

/**
 * Normalize a productType for GROUPING purposes.
 */
const normalizeProductType = (productType: any, exchangeSegment: any): string => {
    if (isDeliveryTrade(productType, exchangeSegment)) return 'CARRY_FORWARD';
    return 'INTRADAY';
};

/**
 * Canonical display label for product type shown in the journal.
 */
const resolvedProductType = (productType: any, exchangeSegment: any): string => {
    const pt = String(productType || '').toUpperCase();
    if (pt === 'MTF') return 'MTF';
    if (pt === 'CNC') return 'CNC';
    if (pt === 'MARGIN' || pt === 'NRML' || pt === 'NORMAL') return 'MARGIN';
    return 'MIS';
};

interface SyncTradesButtonProps {
    selectedDate?: string | null;
}

export const SyncTradesButton: React.FC<SyncTradesButtonProps> = ({ selectedDate }) => {
    const [isSyncing, setIsSyncing] = useState(false);
    const { toast } = useToast();

    const handleSync = async () => {
        if (!dhanBrokerService.isConfigured()) {
            toast.error('DhanHQ is not configured. Please add credentials in Settings.');
            return;
        }

        setIsSyncing(true);
        try {
            // Fix: Use IST Date instead of UTC Date to prevent midnight date-skip bugs
            const istDate = getISTDate();
            const year = istDate.getFullYear();
            const month = String(istDate.getMonth() + 1).padStart(2, '0');
            const day = String(istDate.getDate()).padStart(2, '0');
            const todayStr = `${year}-${month}-${day}`;
            
            const targetDate = selectedDate || todayStr;
            const isToday = targetDate === todayStr;

            // ── STEP 1: Fetch executed trades for the target date ─────────────────────────
            let dhanTrades: any[] = [];
            if (isToday) {
                // Today's trades API usually returns all trades or doesn't support explicit deep pagination like history
                dhanTrades = await dhanBrokerService.fetchTrades();
            } else {
                // Historical trades are explicitly paginated. We must fetch all pages to catch all legs of a trade (e.g. 35+ trades)
                let page = 0;
                let hasMore = true;
                const maxPages = 6; // Safety cap (total 300+ trades)
                
                while (hasMore && page < maxPages) {
                    try {
                        const pageData = await dhanBrokerService.fetchTradeHistory(targetDate, targetDate, page);
                        if (pageData && pageData.length > 0) {
                            dhanTrades = [...dhanTrades, ...pageData];
                            page++;
                            // If we got a full page (usually 50 results), assume there might be more
                            hasMore = pageData.length >= 20; // Dhan page size is often 50, but playing it safe with 20
                        } else {
                            hasMore = false;
                        }
                    } catch (err) {
                        console.error(`[DhanSync] Failed to fetch trade history page ${page}:`, err);
                        hasMore = false;
                    }
                }
                console.log(`[DhanSync] Fetched total ${dhanTrades.length} legs across ${page} pages for ${targetDate}`);
            }

            if (!dhanTrades || dhanTrades.length === 0) {
                toast.info(`No executed trades found for ${targetDate} on DhanHQ.`);
                setIsSyncing(false);
                return;
            }

            // ── STEP 2: Build cost-basis map for delivery/MTF sells ───────────────────────
            // Key: securityId (primary) AND customSymbol (fallback) → avg buy price
            // Sources (in priority order):
            //   A. Dhan /positions (has buyAvg + realizedProfit — works perfectly for same-day)
            //   B. Paginated trade history (pages 0 & 1, 10-day lookback — works for past dates)

            // Map: symbol/secid → { avgBuyPrice, realizedProfit (if available) }
            const costBasisMap: Record<string, { avgBuyPrice: number; realizedProfit?: number }> = {};

            const hasDeliverySell = dhanTrades.some(t =>
                (t.productType === 'CNC' || t.productType === 'MTF') &&
                t.transactionType === 'SELL'
            );

            if (hasDeliverySell) {
                // ── Source A: /positions (buyAvg + realizedProfit) ────────────────────────
                try {
                    const positions = await dhanBrokerService.fetchPositions();
                    for (const pos of positions) {
                        // Index by both securityId and tradingSymbol for maximum match coverage
                        const keys = [pos.securityId, pos.tradingSymbol].filter(Boolean);
                        for (const k of keys) {
                            if (!costBasisMap[k]) costBasisMap[k] = { avgBuyPrice: 0 };
                            if (pos.buyAvg > 0) costBasisMap[k].avgBuyPrice = pos.buyAvg;
                            if (pos.realizedProfit !== undefined) costBasisMap[k].realizedProfit = pos.realizedProfit;
                        }
                    }
                } catch { /* non-fatal */ }

                // ── Source B: Paginated trade history (10-day lookback, pages 0+1) ────────
                // This is the fallback for past-date syncs where /positions is stale
                try {
                    const fromDate = daysBack(targetDate, 10);
                    const [page0, page1] = await Promise.all([
                        dhanBrokerService.fetchTradeHistory(fromDate, targetDate, 0),
                        dhanBrokerService.fetchTradeHistory(fromDate, targetDate, 1),
                    ]);
                    const historyTrades = [...(page0 || []), ...(page1 || [])];

                    // Accumulate all BUY legs (any product type) — weighted average price
                    const buyAccum: Record<string, { totalVal: number; totalQty: number }> = {};
                    for (const t of historyTrades) {
                        if (t.transactionType !== 'BUY') continue;
                        const keys = [t.securityId, t.customSymbol, t.tradingSymbol].filter(Boolean) as string[];
                        for (const k of keys) {
                            if (!buyAccum[k]) buyAccum[k] = { totalVal: 0, totalQty: 0 };
                            buyAccum[k].totalVal += (t.tradedPrice || 0) * (t.tradedQuantity || 0);
                            buyAccum[k].totalQty += (t.tradedQuantity || 0);
                        }
                    }

                    // Only insert into costBasisMap if NOT already found via positions
                    for (const [k, acc] of Object.entries(buyAccum)) {
                        if (acc.totalQty > 0 && !costBasisMap[k]?.avgBuyPrice) {
                            if (!costBasisMap[k]) costBasisMap[k] = { avgBuyPrice: 0 };
                            costBasisMap[k].avgBuyPrice = acc.totalVal / acc.totalQty;
                        }
                    }
                } catch (err) {
                    console.warn('[DhanSync] Trade history fetch for buy catalog failed:', err);
                }

                // ── Source C: Local Database Lookup (Permanent History) ────────────────
                // If we still haven't found a cost basis, check our own DB for previous buy entries
                try {
                    const sellLegs = dhanTrades.filter(t => isDeliveryTrade(t.productType || '', t.exchangeSegment || '') && t.transactionType === 'SELL');
                    for (const sell of sellLegs) {
                        const rawSym = sell.customSymbol || sell.tradingSymbol;
                        if (!rawSym) continue;
                        
                        const sym = rawSym.trim().toUpperCase();
                        const secId = sell.securityId;
                        const lookupKey = (secId && secId.trim() !== '') ? secId : rawSym;
                        
                        if (!costBasisMap[lookupKey]?.avgBuyPrice) {
                            // Find most recent buy in our DB for this stock
                            // We search all trades and manually filter for robustness
                            const allStockTrades = await db.trades
                                .where('ticker').equalsIgnoreCase(sym)
                                .toArray();

                            const prevTrades = allStockTrades.filter(t => 
                                (t.date || '') < targetDate && 
                                t.direction === 'Long' &&
                                (t.entryPrice || 0) > 0
                            );
                            
                            // Get most recent trade
                            const matchingTrade = prevTrades
                                .sort((a, b) => new Date(b.date || '').getTime() - new Date(a.date || '').getTime())[0];

                            if (matchingTrade) {
                                if (!costBasisMap[lookupKey]) costBasisMap[lookupKey] = { avgBuyPrice: 0 };
                                costBasisMap[lookupKey].avgBuyPrice = matchingTrade.entryPrice;
                                logger.log('DhanSync', `Recovered cost-basis from local DB for ${sym}`);
                            } else {
                                logger.log('DhanSync', `No local cost-basis found for ${sym} in previous trades.`);
                            }
                        }
                    }
                } catch (err) {
                    logger.warn('DhanSync', `Local DB cost-basis lookup error: ${err}`);
                }

                // Debug: show catalog summary without leaking symbol lists to console
                const catalogKeys = Object.keys(costBasisMap);
                logger.log('DhanSync', `Cost basis catalog built: ${catalogKeys.length} entries`);
            }

            // ── STEP 3: Group target-date trades by SecurityId + NormalizedProductType ────
            //
            // Two bugs were previously causing Gross P&L = ₹0 for some trades:
            //
            // Bug A: Symbol mismatch — Dhan occasionally returns slightly different
            //        customSymbol strings for BUY vs SELL legs of the same contract.
            //        Fix: group by securityId (stable exchange ID) instead of symbol name.
            //
            // Bug B: ProductType mismatch — Dhan returns 'MTF' for one leg and 'MIS'
            //        for another leg of the same FNO/MCX trade.  MTF is equity-only;
            //        on derivatives it's meaningless.  Fix: normalize all intraday
            //        product types to a single canonical bucket before grouping.
            //
            let addedCount = 0;
            // ── STEP 3: Unified Grouping & Auto-Cleanup ─────────────────────────────────
            const groupedTrades: Record<string, typeof dhanTrades> = {};
            
            // AUTO-CLEANUP: Wipe existing DAS trades for this date to allow a fresh, unified re-sync
            await db.trades
                .where('date').equals(targetDate)
                .filter(t => t.setup === 'DAS' || t.setup === 'Dhan Auto-Sync')
                .delete();

            for (const t of dhanTrades) {
                if (!t) continue; // Safety check
                // SMART GROUPING: We group by securityId AND a Product Category.
                // For Equity: Split Delivery (CNC/MTF) from Intraday (MIS/BO/CO) to prevent mixing 
                // long-term holdings with same-day scalps.
                // For FNO/MCX/Currency: Group EVERYTHING for the same strike together. 
                // Brokers often mix 'MARGIN', 'NORMAL', and 'MIS' tags for the same trade.
                const fallbackSym = String(t.customSymbol || t.tradingSymbol || 'Unknown');
                const secIdStr = t.securityId ? String(t.securityId) : '';
                const baseKey = secIdStr.trim() !== '' ? secIdStr : fallbackSym;
                const segment = String(t.exchangeSegment || '');
                
                let groupingCategory = 'DERIVATIVE';
                if (segment === 'NSE_EQ' || segment === 'BSE_EQ') {
                    groupingCategory = isDeliveryTrade(t.productType || '', segment) ? 'DELIVERY' : 'INTRADAY';
                }

                const key = `${baseKey}_${groupingCategory}`;

                if (!groupedTrades[key]) groupedTrades[key] = [];
                groupedTrades[key].push(t);
            }

            for (const key of Object.keys(groupedTrades)) {
                const legs = groupedTrades[key];
                legs.sort((a, b) => parseDhanTime(a.exchangeTime || a.createTime) - parseDhanTime(b.exchangeTime || b.createTime));

                let buyQty = 0, buyValue = 0;
                let sellQty = 0, sellValue = 0;
                let totalCharges = 0;
                let totalStt = 0, totalSebi = 0, totalBrokerage = 0;
                let totalServiceTax = 0, totalExchangeCharges = 0, totalStampDuty = 0;

                for (const leg of legs) {
                    const qty = leg.tradedQuantity || 0;
                    const price = leg.tradedPrice || 0;
                    if (leg.transactionType === 'BUY') { buyQty += qty; buyValue += price * qty; }
                    else { sellQty += qty; sellValue += price * qty; }
                    totalStt += (leg.stt || 0);
                    totalSebi += (leg.sebiTax || 0);
                    totalBrokerage += (leg.brokerageCharges || 0);
                    totalServiceTax += (leg.serviceTax || 0);
                    totalExchangeCharges += (leg.exchangeTransactionCharges || 0);
                    totalStampDuty += (leg.stampDuty || 0);
                    totalCharges += (leg.sebiTax || 0) + (leg.stt || 0) + (leg.brokerageCharges || 0) +
                                    (leg.serviceTax || 0) + (leg.exchangeTransactionCharges || 0) + (leg.stampDuty || 0);
                }

                const totalQty = Math.max(buyQty, sellQty);
                const closedQty = Math.min(buyQty, sellQty);
                const excessSellQty = sellQty - closedQty;
                const excessBuyQty = buyQty - closedQty;

                const sampleLeg = legs[0];
                const segment = String(sampleLeg.exchangeSegment || '');

                // Display symbol: pick the longest/most descriptive name across all legs
                const sym = legs
                    .map(l => String(l.customSymbol || l.tradingSymbol || ''))
                    .sort((a, b) => b.length - a.length)[0] || 'Unknown';

                // Use the resolved (canonical) product type for storage — never 'MTF' on options
                const productType = resolvedProductType(sampleLeg.productType || '', segment);
                const securityId = sampleLeg.securityId ? String(sampleLeg.securityId) : '';

                const avgBuyPrice = buyQty > 0 ? buyValue / buyQty : 0;
                const avgSellPrice = sellQty > 0 ? sellValue / sellQty : 0;

                // ── PNL CALCULATION ──────────────────────────────────────────────────────
                
                // 1. Same-day PnL (for the paired quantities)
                const sameDayGrossPnl = (closedQty > 0) ? (avgSellPrice - avgBuyPrice) * closedQty : 0;
                let effectiveGrossPnl = sameDayGrossPnl;
                let historicBuyPrice = 0;
                let usedRealizedProfit = false;

                // Check if any leg in this group is considered Delivery/Carry-Forward
                const hasDeliveryLeg = legs.some(l => isDeliveryTrade(l.productType || '', l.exchangeSegment || segment));

                if (hasDeliveryLeg && excessSellQty > 0) {
                    // 2. Cross-date PnL (We sold more than we bought today, MUST be from holding)
                    const lookupKeys = [securityId, sym, String(sampleLeg.tradingSymbol || ''), String(sampleLeg.customSymbol || '')].filter(k => k.trim() !== '');
                    let entry = lookupKeys.map(k => costBasisMap[k]).find(e => e && e.avgBuyPrice > 0);

                    if (entry) {
                        if (entry.realizedProfit !== undefined && entry.realizedProfit !== 0) {
                            // If we have Dhan's exact realized profit for this position, use it as the source of truth.
                            // RealizedProfit from Dhan is NET profit for the ENTIRE closed position today.
                            // To store it properly, we convert it back to gross by adding totalCharges.
                            effectiveGrossPnl = entry.realizedProfit + totalCharges;
                            historicBuyPrice = entry.avgBuyPrice;
                            usedRealizedProfit = true;
                        } else {
                            historicBuyPrice = entry.avgBuyPrice;
                            const crossDatePnl = (avgSellPrice - historicBuyPrice) * excessSellQty;
                            effectiveGrossPnl += crossDatePnl;
                        }
                    } else {
                        console.warn(`[DhanSync] Excess sell of ${excessSellQty} for ${sym} but no cost basis found.`);
                    }
                }

                const netPnl = effectiveGrossPnl - totalCharges;

                // ── TRADE DIRECTION & ENTRY/EXIT PRICES ──────────────────────────────────
                let direction: 'Long' | 'Short' = 'Long';
                
                if (hasDeliveryLeg) {
                    direction = (buyQty >= sellQty) ? 'Long' : 'Short';
                    if (excessSellQty > 0) direction = 'Long'; // Closing a historic long position
                } else {
                    // Intraday
                    const firstLegDirection = legs[0]?.transactionType;
                    const isShortIntraday = firstLegDirection === 'SELL' && buyQty > 0 && sellQty > 0;
                    if (isShortIntraday) direction = 'Short';
                    else if (buyQty === 0 && sellQty > 0) direction = 'Short'; // Open short
                }

                // If cross-date sell, entry was the historic price
                const entryPrice = (hasDeliveryLeg && excessSellQty > 0)
                    ? (historicBuyPrice || avgSellPrice)
                    : (direction === 'Short' ? avgSellPrice : avgBuyPrice);

                const exitPrice = (excessBuyQty > 0 && sellQty === 0)
                    ? avgBuyPrice // Open buy, not exited
                    : (direction === 'Short' ? avgBuyPrice : (avgSellPrice || avgBuyPrice));


                // Since we auto-cleanup at the start of the loop, we can safely add all processed trades.
                if (totalQty > 0) {
                    let assetClass: Trade['assetClass'] = 'Equity';
                    const segment = sampleLeg.exchangeSegment || '';
                    if (segment.includes('FNO') || segment.includes('OPT')) assetClass = 'Options';
                    else if (segment.includes('COMM')) assetClass = 'Commodities' as any;
                    else if (segment.includes('CUR')) assetClass = 'Forex';

                    const isIntraday = !hasDeliveryLeg;
                    const isCrossDateSell = hasDeliveryLeg && excessSellQty > 0;
                    const isCrossDateBuy = hasDeliveryLeg && excessBuyQty > 0 && sellQty === 0;
                    const isSameDayRoundtrip = closedQty > 0;

                    let brokerProfile: Trade['brokerProfile'] = 'Delivery Equity';
                    if (assetClass === 'Options') brokerProfile = 'Options';
                    else if (isIntraday) brokerProfile = 'Intraday Equity';

                    let optionsData;
                    if (assetClass === 'Options' && sampleLeg.drvExpiryDate && sampleLeg.drvExpiryDate !== 'NA') {
                        const tradeDateMs = parseDhanTime(sampleLeg.exchangeTime || sampleLeg.createTime);
                        const expiryDateMs = new Date(sampleLeg.drvExpiryDate).getTime();
                        let dte = 0;
                        if (!isNaN(tradeDateMs) && !isNaN(expiryDateMs) && tradeDateMs > 0) {
                            dte = Math.max(0, Math.floor((expiryDateMs - tradeDateMs) / (1000 * 60 * 60 * 24)));
                        }
                        optionsData = {
                            strikePrice: sampleLeg.drvStrikePrice || 0,
                            optionType: sampleLeg.drvOptionType || '',
                            expiryDate: sampleLeg.drvExpiryDate,
                            daysToExpiry: dte
                        };
                    }

                    // Universal Time Parser Fix (Removes the fatal new Date() fallback)
                    const extractTime = (raw: string | undefined | null): string | null => {
                        if (!raw || raw === 'NA') return null;
                        try {
                            // Normalize format: replace space with T
                            let clean = raw.trim().replace(' ', 'T');
                            
                            // Dhan API returns historical timestamps in IST, but formatted as ISO without timezone.
                            // E.g. "2026-04-24T13:41:00". By NOT appending 'Z', new Date() treats it as Local Time (IST).
                            // If we append 'Z', it treats it as UTC and incorrectly adds another 5.5 hours.
                            if (clean.endsWith('Z')) {
                                // If Dhan ever starts sending actual UTC, keep the Z.
                            }

                            const d = new Date(clean);
                            if (!isNaN(d.getTime())) {
                                return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                            }
                            return null;
                        } catch {
                            return null;
                        }
                    };

                    // Extract entry time from first leg and exit time from last leg
                    const firstLeg = legs[0];
                    const lastLeg = legs[legs.length - 1];

                    const entryTimeStr = extractTime(firstLeg.exchangeTime) 
                                || extractTime(firstLeg.createTime) 
                                || extractTime(firstLeg.updateTime) 
                                || '09:15';

                    const exitTimeStr = (legs.length > 1)
                                ? (extractTime(lastLeg.exchangeTime) || extractTime(lastLeg.createTime) || extractTime(lastLeg.updateTime))
                                : undefined;

                    const tradeNote = isCrossDateSell
                        ? `Cross-day SELL | Buy@₹${historicBuyPrice.toFixed(2)} → Sell@₹${avgSellPrice.toFixed(2)} | Gross: ₹${effectiveGrossPnl.toFixed(2)} | Fees: ₹${totalCharges.toFixed(2)}`
                        : isCrossDateBuy
                        ? `Cross-day BUY (open) | Entry@₹${avgBuyPrice.toFixed(2)} | Fees: ₹${totalCharges.toFixed(2)}`
                        : `Same-day | Buy@₹${avgBuyPrice.toFixed(2)} → Sell@₹${avgSellPrice.toFixed(2)} | Gross: ₹${effectiveGrossPnl.toFixed(2)} | Fees: ₹${totalCharges.toFixed(2)}`;

                    const newTrade: Trade = {
                        ticker: sym,
                        direction,
                        quantity: isSameDayRoundtrip ? closedQty : totalQty,
                        entryPrice: Number((entryPrice || 0).toFixed(2)),
                        exitPrice: Number((exitPrice || 0).toFixed(2)),
                        date: targetDate,
                        entryTime: entryTimeStr,
                        exitTime: exitTimeStr && exitTimeStr !== entryTimeStr ? exitTimeStr : undefined,
                        moodEntry: 'Focused',
                        moodExit: 'Satisfied',
                        mistakes: [],
                        setup: 'DAS',
                        pnl: Number((netPnl || 0).toFixed(2)),
                        fees: Number((totalCharges || 0).toFixed(2)),
                        assetClass,
                        brokerProfile,
                        notes: `Product: ${productType} | Legs: ${legs.length} | ${tradeNote}`,
                        feeBreakdown: {
                            stt: Number(totalStt.toFixed(2)),
                            sebiTax: Number(totalSebi.toFixed(2)),
                            brokerage: Number(totalBrokerage.toFixed(2)),
                            serviceTax: Number(totalServiceTax.toFixed(2)),
                            exchangeTransactionCharges: Number(totalExchangeCharges.toFixed(2)),
                            stampDuty: Number(totalStampDuty.toFixed(2))
                        },
                        orderType: sampleLeg.orderType || 'MARKET',
                        optionsData,
                        productType: productType,
                        legsCount: legs.length,
                        isin: sampleLeg.isin,
                        isImported: true,
                        securityId: securityId || undefined,  // stored for dedup on re-sync
                    } as Trade & { securityId?: string };

                    await db.trades.add(newTrade);
                    addedCount++;
                }
            }

            if (addedCount > 0) {
                toast.success(`Synced ${addedCount} trade(s) from DhanHQ for ${targetDate}!`);
            } else {
                toast.info(`Trades for ${targetDate} are already synced.`);
            }

        } catch (error) {
            console.error('Failed to sync trades:', error);
            toast.error('Failed to sync trades from DhanHQ.');
        } finally {
            setIsSyncing(false);
        }
    };


    if (!dhanBrokerService.isConfigured()) return null;

    return (
        <div className="flex items-center gap-2">
            <button
                onClick={handleSync}
                disabled={isSyncing}
                className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-xs font-bold rounded-lg border border-indigo-200 dark:border-indigo-500/20 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors disabled:opacity-50 shadow-sm"
                title={`Pull trades from DhanHQ for ${selectedDate || 'today'}`}
            >
                <DownloadCloud size={14} className={isSyncing ? "animate-bounce" : ""} />
                {isSyncing ? 'Syncing...' : 'Sync Dhan Trades'}
            </button>
        </div>
    );
};
