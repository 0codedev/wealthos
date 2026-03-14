import { logger } from './Logger';
import { greeksService } from './GreeksService';
import { pnseaService } from './PnseaService';
import { useSettingsStore } from '../store/settingsStore';
import { upstoxCacheService } from './UpstoxCacheService';

export interface StrikeData {
    strike: number;
    oi: number;
    changeInOi: number;
    volume: number;
    iv: number;
    ltp: number;
    netChange: number;
    oiVelocity: number;
    delta?: number;
    theta?: number;
    vega?: number;
    gamma?: number;
    pop?: number;
    instrumentKey?: string;
}

export interface OptionChainSnapshot {
    symbol: string;
    underlyingValue: number;
    timestamp: string;
    totalPutOI: number;
    totalCallOI: number;
    pcr: number;
    maxPain: number;
    strikes: {
        strikePrice: number;
        CE: StrikeData | null;
        PE: StrikeData | null;
    }[];
}

export interface UnusualFlowAlert {
    id: string;
    timestamp: string;
    symbol: string;
    strike: number;
    optionType: 'CE' | 'PE';
    alertType: 'OI_SPIKE' | 'IV_JUMP' | 'BLOCK_VOLUME';
    description: string;
    details: string;
    value: number;
}

class OptionChainService {
    private static instance: OptionChainService;
    private previousSnapshots: Record<string, Record<string, number>> = {}; // symbol -> strike_type -> last_oi

    public isFallbackActive: boolean = false;
    public unusualFlowAlerts: UnusualFlowAlert[] = [];
    public isFlowScanningActive: boolean = false;
    private flowScanningInterval: any = null;
    private lastSnapshots: Record<string, OptionChainSnapshot> = {};
    private scanningCallback: ((alerts: UnusualFlowAlert[]) => void) | null = null;

    // CC68.27: 60-second in-memory cache for per-stock chain fetches.
    // The MCE orchestrator can hammer `fetchOptionChain` for every F&O stock
    // on the watchlist when `gexPerStockEnabled` is on. Without this cache
    // we'd hit PNSEA 50+ times per refresh. Keyed by `${symbol}|${expiry||'nearest'}`.
    // Values: { snapshot: OptionChainSnapshot, ts: number }.
    private perStockMemoryCache: Record<string, { snapshot: OptionChainSnapshot; ts: number }> = {};
    private static readonly PER_STOCK_CACHE_TTL_MS = 60_000;

    private constructor() {}

    static getInstance(): OptionChainService {
        if (!OptionChainService.instance) {
            OptionChainService.instance = new OptionChainService();
        }
        return OptionChainService.instance;
    }

    private getSessionItem(key: string): any {
        if (typeof window === 'undefined') return null;
        try {
            const item = sessionStorage.getItem(key);
            return item ? JSON.parse(item) : null;
        } catch {
            return null;
        }
    }

    private setSessionItem(key: string, val: any): void {
        if (typeof window === 'undefined') return;
        try {
            sessionStorage.setItem(key, JSON.stringify(val));
        } catch {}
    }

    /**
     * Get cached option chain snapshot for a symbol if available and not expired (60s TTL)
     */
    public getCachedSnapshot(symbol: string): OptionChainSnapshot | null {
        const cacheKey = `${symbol.toUpperCase()}|nearest`;
        const hit = this.perStockMemoryCache[cacheKey];
        if (hit && Date.now() - hit.ts < 60000) {
            return hit.snapshot;
        }
        return null;
    }

    /**
     * Get fallback active status
     */
    getFallbackStatus(): boolean {
        return this.isFallbackActive;
    }

    /**
     * CC68.33: Explicit per-stock option chain fetch. Routes to the
     * PNSEA path directly (skipping the NSE index proxy) for any F&O stock.
     * Uses the 60s in-memory per-stock cache from Phase 1.
     *
     * Used by `gexExtractor` when `mceStore.gexPerStockEnabled` is on.
     * Returns null on failure (never throws) so the GEX path always has
     * a safe fallback to 0.5 (neutral).
     */
    async getOptionChainForStock(
        symbol: string,
        expiry?: string,
        forceRefresh: boolean = false,
    ): Promise<OptionChainSnapshot | null> {
        // Reuse fetchOptionChain with force. The 60s in-memory cache kicks
        // in for non-index symbols (NIFTY/BANKNIFTY etc. already have a
        // 60s background scanner that keeps them fresh).
        return this.fetchOptionChain(symbol, expiry, forceRefresh);
    }

    /**
     * Fetch raw NSE Option Chain for a symbol (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX or F&O stocks)
     */
    async fetchOptionChain(
        symbol: string = 'NIFTY',
        expiry?: string,
        forceRefresh: boolean = false
    ): Promise<OptionChainSnapshot | null> {
        const cacheKey = `option_chain_${symbol}_${expiry || 'nearest'}`;
        const isIndexSymbol = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX']
            .includes(symbol.toUpperCase());
        try {
            // CC68.27: 60-second in-memory per-stock cache (skip for indices —
            // they have a 60s background scanner that already keeps them fresh,
            // and skipping here ensures user-initiated refreshes see new data).
            if (!isIndexSymbol && !forceRefresh) {
                const memoryHit = this.perStockMemoryCache[cacheKey];
                if (memoryHit && Date.now() - memoryHit.ts < OptionChainService.PER_STOCK_CACHE_TTL_MS) {
                    return memoryHit.snapshot;
                }
            }

            if (!forceRefresh) {
                const cached = this.getSessionItem(cacheKey);
                if (cached) {
                    // Promote to memory cache for the next 60s
                    if (!isIndexSymbol) {
                        this.perStockMemoryCache[cacheKey] = { snapshot: cached, ts: Date.now() };
                    }
                    return cached;
                }
            }

            const isUpstoxEnabled = useSettingsStore.getState().isUpstoxEnabled;
            let data: any = null;
            let isUpstoxUsed = false;

            if (isUpstoxEnabled) {
                const upstoxCacheKey = `upstox_option_chain_${symbol}_${expiry || 'nearest'}`;
                try {
                    data = await upstoxCacheService.executeWithCache(
                        upstoxCacheKey,
                        async () => {
                            const expiryParam = expiry ? `&expiry=${expiry}` : '';
                            const response = await fetch(`/api/python-nse/api/upstox/option-chain?symbol=${encodeURIComponent(symbol)}${expiryParam}`);
                            if (response.ok) {
                                return await response.json();
                            }
                            throw new Error(`Upstox option chain status ${response.status}`);
                        }
                    );
                    if (data) {
                        isUpstoxUsed = true;
                        this.isFallbackActive = false;
                    }
                } catch (upstoxError) {
                    logger.warn(`[OptionChainService] Upstox option chain failed, falling back to NSE:`, upstoxError);
                }
            } else {
                const upstoxCacheKey = `upstox_option_chain_${symbol}_${expiry || 'nearest'}`;
                const staleData = upstoxCacheService.getStale<any>(upstoxCacheKey);
                if (staleData) {
                    data = staleData;
                    isUpstoxUsed = true;
                    this.isFallbackActive = false;
                }
            }

            if (isUpstoxUsed) {
                const chainData = data.data; // Array of strikes
                if (!chainData || !chainData.length) return null;
                
                const spotPrice = chainData[0].underlying_spot_price || 0;
                if (!this.previousSnapshots[symbol]) this.previousSnapshots[symbol] = {};
                
                const strikes = chainData.map((item: any) => {
                    const ceKey = `${item.strike_price}_CE`;
                    const peKey = `${item.strike_price}_PE`;
                    
                    const currentCeOi = item.call_options?.market_data?.oi || 0;
                    const currentPeOi = item.put_options?.market_data?.oi || 0;
                    
                    const lastCeOi = this.previousSnapshots[symbol][ceKey] || currentCeOi;
                    const lastPeOi = this.previousSnapshots[symbol][peKey] || currentPeOi;
                    
                    const ceVelocity = lastCeOi > 0 ? ((currentCeOi - lastCeOi) / lastCeOi) * 100 : 0;
                    const peVelocity = lastPeOi > 0 ? ((currentPeOi - lastPeOi) / lastPeOi) * 100 : 0;
                    
                    if (item.call_options) this.previousSnapshots[symbol][ceKey] = currentCeOi;
                    if (item.put_options) this.previousSnapshots[symbol][peKey] = currentPeOi;
                    
                    // Fallback to local Black-Scholes calculation if server Greeks are missing
                    let ceDelta = item.call_options?.option_greeks?.delta;
                    let ceTheta = item.call_options?.option_greeks?.theta;
                    let ceVega = item.call_options?.option_greeks?.vega;
                    let ceGamma = item.call_options?.option_greeks?.gamma;
                    
                    const timeToExpiryYears = 3 / 365;
                    const riskFreeRate = 0.07;
                    
                    if (item.call_options && (ceDelta === undefined || ceDelta === null)) {
                        const ceIv = item.call_options.option_greeks?.iv || item.call_options.market_data?.iv || 0;
                        if (ceIv > 0 && spotPrice > 0) {
                            const ceGreeks = greeksService.calculateGreeks(
                                spotPrice, item.strike_price, timeToExpiryYears,
                                riskFreeRate, ceIv / 100, 'CE'
                            );
                            ceDelta = ceGreeks.delta;
                            ceTheta = ceGreeks.theta;
                            ceVega = ceGreeks.vega;
                            ceGamma = ceGreeks.gamma;
                        }
                    }
                    
                    let peDelta = item.put_options?.option_greeks?.delta;
                    let peTheta = item.put_options?.option_greeks?.theta;
                    let peVega = item.put_options?.option_greeks?.vega;
                    let peGamma = item.put_options?.option_greeks?.gamma;
                    
                    if (item.put_options && (peDelta === undefined || peDelta === null)) {
                        const peIv = item.put_options.option_greeks?.iv || item.put_options.market_data?.iv || 0;
                        if (peIv > 0 && spotPrice > 0) {
                            const peGreeks = greeksService.calculateGreeks(
                                spotPrice, item.strike_price, timeToExpiryYears,
                                riskFreeRate, peIv / 100, 'PE'
                            );
                            peDelta = peGreeks.delta;
                            peTheta = peGreeks.theta;
                            peVega = peGreeks.vega;
                            peGamma = peGreeks.gamma;
                        }
                    }

                    return {
                        strikePrice: item.strike_price,
                        CE: item.call_options ? {
                            strike: item.strike_price,
                            oi: currentCeOi,
                            changeInOi: item.call_options.market_data.oi - (item.call_options.market_data.prev_oi || 0),
                            oiVelocity: ceVelocity,
                            volume: item.call_options.market_data.volume || 0,
                            iv: item.call_options.option_greeks?.iv || 0,
                            ltp: item.call_options.market_data.ltp || 0,
                            netChange: item.call_options.market_data.ltp - (item.call_options.market_data.close_price || 0),
                            delta: ceDelta,
                            theta: ceTheta,
                            vega: ceVega,
                            gamma: ceGamma,
                            pop: item.call_options.option_greeks?.pop,
                            instrumentKey: item.call_options.instrument_key
                        } : null,
                        PE: item.put_options ? {
                            strike: item.strike_price,
                            oi: currentPeOi,
                            changeInOi: item.put_options.market_data.oi - (item.put_options.market_data.prev_oi || 0),
                            oiVelocity: peVelocity,
                            volume: item.put_options.market_data.volume || 0,
                            iv: item.put_options.option_greeks?.iv || 0,
                            ltp: item.put_options.market_data.ltp || 0,
                            netChange: item.put_options.market_data.ltp - (item.put_options.market_data.close_price || 0),
                            delta: peDelta,
                            theta: peTheta,
                            vega: peVega,
                            gamma: peGamma,
                            pop: item.put_options.option_greeks?.pop,
                            instrumentKey: item.put_options.instrument_key
                        } : null
                    };
                });
                
                let totalPutOI = 0;
                let totalCallOI = 0;
                strikes.forEach((s: any) => {
                    if (s.CE) totalCallOI += s.CE.oi;
                    if (s.PE) totalPutOI += s.PE.oi;
                });
                
                const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;
                const maxPain = this.calculateMaxPain(strikes);
                
                const snapshot: OptionChainSnapshot = {
                    symbol,
                    underlyingValue: spotPrice,
                    timestamp: new Date().toISOString(),
                    totalPutOI,
                    totalCallOI,
                    pcr,
                    maxPain,
                    strikes
                };
                
                this.checkForUnusualFlow(symbol, snapshot);
                this.setSessionItem(cacheKey, snapshot);
                if (!isIndexSymbol) {
                    this.perStockMemoryCache[cacheKey] = { snapshot, ts: Date.now() };
                }
                return snapshot;
            }

            // Legacy fallbacks below
            const isIndex = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'].includes(symbol.toUpperCase());
            if (isIndex) {
                try {
                    // Using the existing proxy setup in the project with proper NSE endpoint
                    const response = await fetch(`/api/nse/api/optionChainIndices?index=${encodeURIComponent(symbol)}`);
                    if (!response.ok) throw new Error(`NSE API error: ${response.status}`);
                    data = await response.json();
                    this.isFallbackActive = false;
                } catch (proxyError) {
                    logger.warn(`[OptionChainService] Primary proxy failed, attempting PNSEA fallback for ${symbol}:`, proxyError);
                    try {
                        data = await pnseaService.fetchOptionChain(symbol);
                        this.isFallbackActive = true;
                    } catch (fallbackError) {
                        logger.error(`[OptionChainService] PNSEA fallback also failed for ${symbol}:`, fallbackError);
                        return null;
                    }
                }
            } else {
                // For stocks, query PNSEA directly to optimize and avoid index proxy 404s
                try {
                    data = await pnseaService.fetchOptionChain(symbol);
                    this.isFallbackActive = true;
                } catch (fallbackError) {
                    logger.error(`[OptionChainService] PNSEA fetch failed for stock ${symbol}:`, fallbackError);
                    return null;
                }
            }
            
            const records = data.records;
            const filtered = data.filtered;
            
            if (!records || !filtered) return null;

            if (!this.previousSnapshots[symbol]) this.previousSnapshots[symbol] = {};

            const strikes = filtered.data.map((item: any) => {
                const ceKey = `${item.strikePrice}_CE`;
                const peKey = `${item.strikePrice}_PE`;
                
                const lastCeOi = this.previousSnapshots[symbol][ceKey] || item.CE?.openInterest || 0;
                const lastPeOi = this.previousSnapshots[symbol][peKey] || item.PE?.openInterest || 0;
                
                const ceVelocity = lastCeOi > 0 ? ((item.CE?.openInterest - lastCeOi) / lastCeOi) * 100 : 0;
                const peVelocity = lastPeOi > 0 ? ((item.PE?.openInterest - lastPeOi) / lastPeOi) * 100 : 0;

                if (item.CE) this.previousSnapshots[symbol][ceKey] = item.CE.openInterest;
                if (item.PE) this.previousSnapshots[symbol][peKey] = item.PE.openInterest;

                return {
                    strikePrice: item.strikePrice,
                    CE: item.CE ? {
                        strike: item.CE.strikePrice,
                        oi: item.CE.openInterest,
                        changeInOi: item.CE.changeinOpenInterest,
                        oiVelocity: ceVelocity,
                        volume: item.CE.totalTradedVolume,
                        iv: item.CE.impliedVolatility,
                        ltp: item.CE.lastPrice,
                        netChange: item.CE.change
                    } : null,
                    PE: item.PE ? {
                        strike: item.PE.strikePrice,
                        oi: item.PE.openInterest,
                        changeInOi: item.PE.changeinOpenInterest,
                        oiVelocity: peVelocity,
                        volume: item.PE.totalTradedVolume,
                        iv: item.PE.impliedVolatility,
                        ltp: item.PE.lastPrice,
                        netChange: item.PE.change
                    } : null
                };
            });

            const totalPutOI = filtered.PE.totOI;
            const totalCallOI = filtered.CE.totOI;
            const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;
            const underlyingValue = records.underlyingValue;

            // --- BREAKTHROUGH 6: GREEKS CALCULATION ---
            // Estimate time to expiry (simplified for daily use)
            // In a real app, you'd parse the expiry date from the NSE response
            const timeToExpiryYears = 3 / 365; // Assuming ~3 days to expiry for NIFTY/BANKNIFTY typical trades
            const riskFreeRate = 0.07; // 7% standard Indian rate

            strikes.forEach((s: any) => {
                if (s.CE && s.CE.iv > 0) {
                    const ceGreeks = greeksService.calculateGreeks(
                        underlyingValue, s.strikePrice, timeToExpiryYears, 
                        riskFreeRate, s.CE.iv / 100, 'CE'
                    );
                    s.CE.delta = ceGreeks.delta;
                    s.CE.theta = ceGreeks.theta;
                }
                if (s.PE && s.PE.iv > 0) {
                    const peGreeks = greeksService.calculateGreeks(
                        underlyingValue, s.strikePrice, timeToExpiryYears, 
                        riskFreeRate, s.PE.iv / 100, 'PE'
                    );
                    s.PE.delta = peGreeks.delta;
                    s.PE.theta = peGreeks.theta;
                }
            });
            
            // Calculate Max Pain

            const maxPain = this.calculateMaxPain(strikes);

            const snapshot: OptionChainSnapshot = {
                symbol,
                underlyingValue,
                timestamp: records.timestamp,
                totalPutOI,
                totalCallOI,
                pcr,
                maxPain,
                strikes
            };

            this.checkForUnusualFlow(symbol, snapshot);
            this.setSessionItem(cacheKey, snapshot);
            if (!isIndexSymbol) {
                this.perStockMemoryCache[cacheKey] = { snapshot, ts: Date.now() };
            }
            return snapshot;
        } catch (error) {
            logger.error(`OptionChainService: Failed to fetch ${symbol}`, error);
            
            // Ultimate fallback: serve stale cache if available
            const staleCache = this.getSessionItem(cacheKey) || 
                              (!isIndexSymbol ? this.perStockMemoryCache[cacheKey]?.snapshot : null);
            if (staleCache) {
                logger.warn(`[OptionChainService] Servicing stale cache fallback for ${symbol}`);
                return staleCache;
            }
            return null;
        }
    }

    /**
     * Max Pain Calculation: The strike price where option sellers (writers) 
     * incur the least amount of loss upon expiry.
     */
    private calculateMaxPain(strikes: any[]): number {
        let minPain = Infinity;
        let maxPainStrike = 0;

        // We only check strikes near the current price for performance
        const strikePrices = strikes.map(s => s.strikePrice);
        
        for (const targetStrike of strikePrices) {
            let totalPain = 0;
            
            for (const s of strikes) {
                // Pain for Call Sellers
                if (s.CE && s.strikePrice < targetStrike) {
                    totalPain += s.CE.oi * (targetStrike - s.strikePrice);
                }
                // Pain for Put Sellers
                if (s.PE && s.strikePrice > targetStrike) {
                    totalPain += s.PE.oi * (s.strikePrice - targetStrike);
                }
            }

            if (totalPain < minPain) {
                minPain = totalPain;
                maxPainStrike = targetStrike;
            }
        }

        return maxPainStrike;
    }

    /**
     * Fetch sorted list of unique expiry dates for a symbol
     */
    async fetchOptionExpiries(symbol: string = 'NIFTY'): Promise<string[]> {
        const isUpstoxEnabled = useSettingsStore.getState().isUpstoxEnabled;
        const cacheKey = `upstox_option_expiries_${symbol}`;

        const generateThursdays = () => {
            const fallbacks: string[] = [];
            const today = new Date();
            for (let i = 0; i < 4; i++) {
                const d = new Date(today.getTime());
                d.setDate(today.getDate() + (3 + 7 - today.getDay()) % 7 + (i * 7));
                fallbacks.push(d.toISOString().split('T')[0]);
            }
            return fallbacks;
        };

        if (!isUpstoxEnabled) {
            const stale = upstoxCacheService.getStale<string[]>(cacheKey);
            if (stale) return stale;
            return generateThursdays();
        }

        try {
            return await upstoxCacheService.executeWithCache(
                cacheKey,
                async () => {
                    const response = await fetch(`/api/python-nse/api/upstox/option-contracts?symbol=${symbol}`);
                    if (response.ok) {
                        const contracts = await response.json();
                        if (contracts && contracts.status === 'success' && Array.isArray(contracts.data)) {
                            const todayStr = new Date().toISOString().split('T')[0];
                            const expiries = Array.from(new Set(
                                contracts.data
                                    .map((c: any) => c.expiry)
                                    .filter((exp: string) => exp && exp >= todayStr)
                            )).sort() as string[];
                            return expiries;
                        }
                    }
                    throw new Error(`Upstox contracts status ${response.status}`);
                },
                generateThursdays
            );
        } catch (error) {
            logger.error(`OptionChainService: Failed to fetch expiries for ${symbol}`, error);
            return generateThursdays();
        }
    }

    /**
     * Start background flow scanning for a symbol. Runs every 60s.
     */
    startFlowScanning(symbol: string = 'NIFTY', callback: (alerts: UnusualFlowAlert[]) => void) {
        if (this.flowScanningInterval) {
            clearInterval(this.flowScanningInterval);
        }
        this.isFlowScanningActive = true;
        this.scanningCallback = callback;

        // Perform initial fetch
        this.fetchOptionChain(symbol, undefined, true).then(() => {
            if (this.scanningCallback) {
                this.scanningCallback(this.unusualFlowAlerts);
            }
        });

        // Set up the interval for 60 seconds
        this.flowScanningInterval = setInterval(async () => {
            if (!this.isFlowScanningActive) return;
            logger.info(`[OptionChainService] Running scheduled background flow scan for ${symbol}...`);
            await this.fetchOptionChain(symbol, undefined, true);
        }, 60000);
    }

    /**
     * Stop background flow scanning
     */
    stopFlowScanning() {
        if (this.flowScanningInterval) {
            clearInterval(this.flowScanningInterval);
            this.flowScanningInterval = null;
        }
        this.isFlowScanningActive = false;
        this.scanningCallback = null;
    }

    /**
     * Clear all session-level alerts
     */
    clearFlowAlerts() {
        this.unusualFlowAlerts = [];
        if (this.scanningCallback) {
            this.scanningCallback(this.unusualFlowAlerts);
        }
    }

    /**
     * Check snapshot for unusual flow metrics
     */
    private checkForUnusualFlow(symbol: string, snapshot: OptionChainSnapshot) {
        if (!snapshot || !snapshot.strikes || snapshot.strikes.length === 0) return;

        const prevSnapshot = this.lastSnapshots[symbol];
        
        // Find ATM strike and ATM IV
        let closestStrikeObj = snapshot.strikes[0];
        let minDiff = Math.abs(closestStrikeObj.strikePrice - snapshot.underlyingValue);
        for (const s of snapshot.strikes) {
            const diff = Math.abs(s.strikePrice - snapshot.underlyingValue);
            if (diff < minDiff) {
                minDiff = diff;
                closestStrikeObj = s;
            }
        }
        const atmIV = closestStrikeObj.CE?.iv || closestStrikeObj.PE?.iv || 15;

        // Calculate average strike volume
        let totalVolume = 0;
        let count = 0;
        snapshot.strikes.forEach(s => {
            if (s.CE && s.CE.volume > 0) {
                totalVolume += s.CE.volume;
                count++;
            }
            if (s.PE && s.PE.volume > 0) {
                totalVolume += s.PE.volume;
                count++;
            }
        });
        const avgVolume = count > 0 ? totalVolume / count : 100000;

        snapshot.strikes.forEach(s => {
            // CE contract checks
            if (s.CE) {
                const ce = s.CE;
                const prevCe = prevSnapshot?.strikes.find(ps => ps.strikePrice === s.strikePrice)?.CE;

                // 1. OI Spike check (>50k contract increase)
                let oiChange = 0;
                if (prevCe) {
                    oiChange = ce.oi - prevCe.oi;
                } else {
                    oiChange = ce.changeInOi; // fallback to day's total change
                }
                if (oiChange > 50000) {
                    this.addAlert(
                        symbol,
                        s.strikePrice,
                        'CE',
                        'OI_SPIKE',
                        `OI Spike: +${oiChange.toLocaleString()} contracts`,
                        `Open Interest rose to ${ce.oi.toLocaleString()} (${ce.oiVelocity.toFixed(1)}% velocity)`,
                        oiChange
                    );
                }

                // 2. IV Jump check (>15% relative rise)
                if (ce.iv > 0) {
                    let ivJumped = false;
                    let details = '';
                    if (prevCe && prevCe.iv > 0 && (ce.iv - prevCe.iv) / prevCe.iv > 0.15) {
                        ivJumped = true;
                        details = `IV rose by ${((ce.iv - prevCe.iv) / prevCe.iv * 100).toFixed(1)}% from ${prevCe.iv.toFixed(1)}% to ${ce.iv.toFixed(1)}%`;
                    } else if (ce.iv > atmIV * 1.15) {
                        ivJumped = true;
                        details = `IV of ${ce.iv.toFixed(1)}% is 15%+ higher than ATM IV of ${atmIV.toFixed(1)}%`;
                    }
                    if (ivJumped) {
                        this.addAlert(
                            symbol,
                            s.strikePrice,
                            'CE',
                            'IV_JUMP',
                            `IV Jump: ${ce.iv.toFixed(1)}%`,
                            details,
                            ce.iv
                        );
                    }
                }

                // 3. Block Volume check (>3x avg strike volume)
                if (ce.volume > 3 * avgVolume && ce.volume > 100000) {
                    this.addAlert(
                        symbol,
                        s.strikePrice,
                        'CE',
                        'BLOCK_VOLUME',
                        `Block Volume: ${(ce.volume / 1000000).toFixed(2)}M`,
                        `Volume of ${ce.volume.toLocaleString()} exceeds average strike volume of ${Math.round(avgVolume).toLocaleString()} by ${(ce.volume / avgVolume).toFixed(1)}x`,
                        ce.volume
                    );
                }
            }

            // PE contract checks
            if (s.PE) {
                const pe = s.PE;
                const prevPe = prevSnapshot?.strikes.find(ps => ps.strikePrice === s.strikePrice)?.PE;

                // 1. OI Spike check (>50k contract increase)
                let oiChange = 0;
                if (prevPe) {
                    oiChange = pe.oi - prevPe.oi;
                } else {
                    oiChange = pe.changeInOi;
                }
                if (oiChange > 50000) {
                    this.addAlert(
                        symbol,
                        s.strikePrice,
                        'PE',
                        'OI_SPIKE',
                        `OI Spike: +${oiChange.toLocaleString()} contracts`,
                        `Open Interest rose to ${pe.oi.toLocaleString()} (${pe.oiVelocity.toFixed(1)}% velocity)`,
                        oiChange
                    );
                }

                // 2. IV Jump check (>15% relative rise)
                if (pe.iv > 0) {
                    let ivJumped = false;
                    let details = '';
                    if (prevPe && prevPe.iv > 0 && (pe.iv - prevPe.iv) / prevPe.iv > 0.15) {
                        ivJumped = true;
                        details = `IV rose by ${((pe.iv - prevPe.iv) / prevPe.iv * 100).toFixed(1)}% from ${prevPe.iv.toFixed(1)}% to ${pe.iv.toFixed(1)}%`;
                    } else if (pe.iv > atmIV * 1.15) {
                        ivJumped = true;
                        details = `IV of ${pe.iv.toFixed(1)}% is 15%+ higher than ATM IV of ${atmIV.toFixed(1)}%`;
                    }
                    if (ivJumped) {
                        this.addAlert(
                            symbol,
                            s.strikePrice,
                            'PE',
                            'IV_JUMP',
                            `IV Jump: ${pe.iv.toFixed(1)}%`,
                            details,
                            pe.iv
                        );
                    }
                }

                // 3. Block Volume check (>3x avg strike volume)
                if (pe.volume > 3 * avgVolume && pe.volume > 100000) {
                    this.addAlert(
                        symbol,
                        s.strikePrice,
                        'PE',
                        'BLOCK_VOLUME',
                        `Block Volume: ${(pe.volume / 1000000).toFixed(2)}M`,
                        `Volume of ${pe.volume.toLocaleString()} exceeds average strike volume of ${Math.round(avgVolume).toLocaleString()} by ${(pe.volume / avgVolume).toFixed(1)}x`,
                        pe.volume
                    );
                }
            }
        });

        // Store snapshot for next comparison
        this.lastSnapshots[symbol] = snapshot;
    }

    /**
     * Add and broadcast alert
     */
    private addAlert(
        symbol: string,
        strike: number,
        optionType: 'CE' | 'PE',
        alertType: 'OI_SPIKE' | 'IV_JUMP' | 'BLOCK_VOLUME',
        description: string,
        details: string,
        value: number
    ) {
        const timestampStr = new Date().toLocaleTimeString();
        const existing = this.unusualFlowAlerts.find(a => 
            a.symbol === symbol && 
            a.strike === strike && 
            a.optionType === optionType && 
            a.alertType === alertType &&
            Math.abs(a.value - value) / value < 0.05
        );
        if (existing) return;

        const newAlert: UnusualFlowAlert = {
            id: Math.random().toString(36).substring(2, 11),
            timestamp: timestampStr,
            symbol,
            strike,
            optionType,
            alertType,
            description,
            details,
            value
        };

        this.unusualFlowAlerts = [newAlert, ...this.unusualFlowAlerts].slice(0, 100);

        if (this.scanningCallback) {
            this.scanningCallback(this.unusualFlowAlerts);
        }
    }
}

export const optionChainService = OptionChainService.getInstance();
