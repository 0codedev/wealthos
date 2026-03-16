import { dhanBrokerService } from './DhanBrokerService';
import { greeksService } from './GreeksService';
import { logger } from './Logger';
import { upstoxMarketDataService } from './UpstoxMarketDataService';
import { optionChainService } from './OptionChainService';

export interface PortfolioGreeks {
    totalDelta: number;
    totalGamma: number;
    totalTheta: number;
    totalVega: number;
    positionCount: number;
    lastUpdated: string;
}

export interface ParsedOptionSymbol {
    underlying: string;
    expiryStr: string;
    strike: number;
    optionType: 'CE' | 'PE';
}

/**
 * Parses Dhan option symbols to extract components.
 * Supports space-separated and compact formats.
 */
export function parseDhanOptionSymbol(symbol: string): ParsedOptionSymbol | null {
    const clean = symbol.trim().toUpperCase();
    
    // Space separated: e.g. "NIFTY 28 May 22500 CE" or "NIFTY 28 May 2026 22500 CE"
    const spaceRegex = /^([A-Z0-9]+)\s+(\d{1,2}\s+[A-Z]{3,9}(?:\s+\d{4})?|\d{2}[A-Z]{3}\d{2})\s+(\d+(?:\.\d+)?)\s+(CE|PE)$/;
    const spaceMatch = clean.match(spaceRegex);
    if (spaceMatch) {
        return {
            underlying: spaceMatch[1],
            expiryStr: spaceMatch[2],
            strike: parseFloat(spaceMatch[3]),
            optionType: spaceMatch[4] as 'CE' | 'PE'
        };
    }
    
    // Compact format: e.g. "NIFTY26MAY22500CE" or "NIFTY2652822500CE"
    const underlyingMatch = clean.match(/^([A-Z]+)/);
    const optionTypeMatch = clean.match(/(CE|PE)$/);
    if (underlyingMatch && optionTypeMatch) {
        const underlying = underlyingMatch[1];
        const optionType = optionTypeMatch[1] as 'CE' | 'PE';
        const middle = clean.substring(underlying.length, clean.length - optionType.length);
        const strikeMatch = middle.match(/(\d+(?:\.\d+)?)$/);
        if (strikeMatch) {
            const strike = parseFloat(strikeMatch[1]);
            const expiryStr = middle.substring(0, middle.length - strikeMatch[1].length);
            return {
                underlying,
                expiryStr,
                strike,
                optionType
            };
        }
    }
    
    // Fallback split-based heuristic
    const isCE = clean.endsWith('CE');
    const isPE = clean.endsWith('PE');
    if (isCE || isPE) {
        const optionType = isCE ? 'CE' : 'PE';
        const tokens = clean.split(/\s+/);
        if (tokens.length >= 4) {
            const underlying = tokens[0];
            const strike = parseFloat(tokens[tokens.length - 2]);
            const expiryStr = tokens.slice(1, tokens.length - 2).join(' ');
            if (!isNaN(strike)) {
                return { underlying, expiryStr, strike, optionType };
            }
        }
    }
    
    return null;
}

/**
 * Parses a variety of expiry string formats into a JS Date object.
 */
export function parseExpiryDate(expiryStr: string): Date {
    const clean = expiryStr.trim().toUpperCase();
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    
    // 1. DDMMMYY (e.g. 28MAY26) or DDMMMYYYY (e.g. 28MAY2026)
    const ddmmyyMatch = clean.match(/^(\d{1,2})([A-Z]{3})(\d{2,4})$/);
    if (ddmmyyMatch) {
        const day = parseInt(ddmmyyMatch[1], 10);
        const monthStr = ddmmyyMatch[2];
        const monthIndex = months.indexOf(monthStr);
        let year = parseInt(ddmmyyMatch[3], 10);
        if (year < 100) year += 2000;
        if (monthIndex !== -1) {
            return new Date(year, monthIndex, day);
        }
    }
    
    // 2. DD MMM YYYY or DD MMM (e.g. "28 MAY 2026" or "28 MAY")
    const spaceParts = clean.split(/\s+/);
    if (spaceParts.length >= 2) {
        const day = parseInt(spaceParts[0], 10);
        const monthStr = spaceParts[1].substring(0, 3);
        const monthIndex = months.indexOf(monthStr);
        let year = new Date().getFullYear();
        if (spaceParts.length >= 3) {
            const parsedYear = parseInt(spaceParts[2], 10);
            if (!isNaN(parsedYear)) {
                year = parsedYear;
                if (year < 100) year += 2000;
            }
        }
        if (monthIndex !== -1 && !isNaN(day)) {
            return new Date(year, monthIndex, day);
        }
    }

    // Default: Next Thursday
    const d = new Date();
    d.setDate(d.getDate() + (3 + 7 - d.getDay()) % 7);
    return d;
}

function formatDateToYmd(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

class PortfolioGreeksService {
    private static instance: PortfolioGreeksService;

    private constructor() {}

    static getInstance(): PortfolioGreeksService {
        if (!PortfolioGreeksService.instance) {
            PortfolioGreeksService.instance = new PortfolioGreeksService();
        }
        return PortfolioGreeksService.instance;
    }

    /**
     * Calculate net Greeks for all open options positions.
     * Uses Upstox live Option Chain where possible, falling back to local Black-Scholes.
     */
    async calculatePortfolioGreeks(): Promise<PortfolioGreeks> {
        try {
            const positions = await dhanBrokerService.fetchPositions();
            const optionPositions = positions.filter(p => p.exchangeSegment === 'NSE_FNO' && p.netQty !== 0);
            
            if (optionPositions.length === 0) {
                return { totalDelta: 0, totalGamma: 0, totalTheta: 0, totalVega: 0, positionCount: 0, lastUpdated: new Date().toISOString() };
            }

            // Map of indices key to Upstox key
            const INDICES_MAP: Record<string, string> = {
                "NIFTY": "NSE_INDEX|Nifty 50",
                "NIFTY50": "NSE_INDEX|Nifty 50",
                "BANKNIFTY": "NSE_INDEX|Nifty Bank",
                "FINNIFTY": "NSE_INDEX|Nifty Fin Service",
                "MIDCPNIFTY": "NSE_INDEX|Nifty Midcap 50",
                "SENSEX": "BSE_INDEX|SENSEX"
            };

            // Parse positions and gather underlying symbols to resolve
            const parsedPositions = optionPositions.map(pos => {
                const parsed = parseDhanOptionSymbol(pos.tradingSymbol);
                return { pos, parsed };
            }).filter(item => item.parsed !== null) as { pos: any, parsed: ParsedOptionSymbol }[];

            if (parsedPositions.length === 0) {
                return { totalDelta: 0, totalGamma: 0, totalTheta: 0, totalVega: 0, positionCount: 0, lastUpdated: new Date().toISOString() };
            }

            const uniqueUnderlyings = Array.from(new Set(parsedPositions.map(p => p.parsed.underlying)));
            
            // Resolve all underlying keys for quote fetching in parallel
            const underlyingKeyMap: Record<string, string> = {};
            await Promise.all(uniqueUnderlyings.map(async (symbol) => {
                if (INDICES_MAP[symbol]) {
                    underlyingKeyMap[symbol] = INDICES_MAP[symbol];
                } else {
                    const resolved = await upstoxMarketDataService.resolveSymbol(symbol);
                    if (resolved?.instrument_key) {
                        underlyingKeyMap[symbol] = resolved.instrument_key;
                    }
                }
            }));

            // Include India VIX in the quotes list to use as default Implied Volatility
            const vixKey = "NSE_INDEX|India VIX";
            const keysToFetch = Object.values(underlyingKeyMap);
            if (!keysToFetch.includes(vixKey)) {
                keysToFetch.push(vixKey);
            }

            // Fetch spot quotes in batch
            const quotes = await upstoxMarketDataService.getFullQuotes(keysToFetch) || {};
            const vixQuote = quotes[vixKey];
            const marketVix = vixQuote?.last_price ? vixQuote.last_price / 100 : 0.15; // default 15% IV

            let totalDelta = 0;
            let totalGamma = 0;
            let totalTheta = 0;
            let totalVega = 0;

            // Process each position
            for (const { pos, parsed } of parsedPositions) {
                const qty = pos.netQty;
                const spotKey = underlyingKeyMap[parsed.underlying];
                const spot = quotes[spotKey]?.last_price || parsed.strike; // Fallback to strike if quote unavailable

                const expiryDate = parseExpiryDate(parsed.expiryStr);
                const expiryYmd = formatDateToYmd(expiryDate);
                const today = new Date();
                
                // Calculate time to expiry (t) in years
                const diffTime = expiryDate.getTime() - today.getTime();
                const diffDays = Math.max(0.0001, diffTime / (1000 * 60 * 60 * 24));
                const t = diffDays / 365.0;

                let positionGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
                let resolvedFromChain = false;

                // Step 1: Try resolving Greeks from live Option Chain from Upstox
                try {
                    const optionChain = await optionChainService.fetchOptionChain(parsed.underlying, expiryYmd);
                    if (optionChain && optionChain.strikes) {
                        const strikeMatch = optionChain.strikes.find(s => s.strikePrice === parsed.strike);
                        if (strikeMatch) {
                            const contract = parsed.optionType === 'CE' ? strikeMatch.CE : strikeMatch.PE;
                            if (contract && contract.delta !== undefined && contract.theta !== undefined) {
                                positionGreeks = {
                                    delta: contract.delta,
                                    gamma: contract.gamma ?? 0,
                                    theta: contract.theta,
                                    vega: contract.vega ?? 0
                                };
                                resolvedFromChain = true;
                            }
                        }
                    }
                } catch (err) {
                    logger.debug(`Could not resolve Greeks from chain for ${pos.tradingSymbol}:`, err);
                }

                // Step 2: Local Black-Scholes fallback
                if (!resolvedFromChain) {
                    const localGreeks = greeksService.calculateGreeks(
                        spot, 
                        parsed.strike, 
                        t, 
                        0.07, // Standard risk-free rate
                        marketVix, 
                        parsed.optionType
                    );
                    positionGreeks = {
                        delta: localGreeks.delta,
                        gamma: localGreeks.gamma,
                        theta: localGreeks.theta,
                        vega: localGreeks.vega
                    };
                }

                // Multiply by net quantity to aggregate portfolio risk
                // Option Net Greeks = Greek * Quantity
                totalDelta += positionGreeks.delta * qty;
                totalGamma += positionGreeks.gamma * qty;
                totalTheta += positionGreeks.theta * qty;
                totalVega += positionGreeks.vega * qty;
            }

            return {
                totalDelta,
                totalGamma,
                totalTheta,
                totalVega,
                positionCount: optionPositions.length,
                lastUpdated: new Date().toISOString()
            };
        } catch (err) {
            logger.error('Failed to calculate portfolio Greeks:', err);
            return { totalDelta: 0, totalGamma: 0, totalTheta: 0, totalVega: 0, positionCount: 0, lastUpdated: new Date().toISOString() };
        }
    }
}

export const portfolioGreeksService = PortfolioGreeksService.getInstance();
