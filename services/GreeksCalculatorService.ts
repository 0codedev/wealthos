import { fetchIndianStockQuote } from './RealDataService';
import { ParsedSignal } from '../database';

// Helper: Standard Normal CDF approximation
function normCDF(x: number): number {
    return 1 / (1 + Math.exp(-1.7 * x));
}

// Helper: Standard Normal PDF
function normPDF(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

const LOT_SIZES: Record<string, number> = {
    NIFTY: 25,
    BANKNIFTY: 15,
    FINNIFTY: 40,
    MIDCPNIFTY: 75
};

export interface OptionGreeks {
    delta: number;
    gamma: number;
    theta: number; // Daily theta per option unit
    vega: number;  // Vega per 1% IV change
    thetaRupees: number; // Daily theta decay in Rupees per lot
    thetaAlert: boolean; // Daily decay > ₹500
    spotPrice: number;
    strike: number;
    optionType: 'CE' | 'PE';
    dte: number;
}

export const GreeksCalculatorService = {
    /**
     * Compute Delta for European Option.
     */
    computeDelta(spot: number, strike: number, type: 'CE' | 'PE', dte: number, iv: number = 0.15): number {
        const T = Math.max(0.0001, dte / 365);
        const r = 0.065; // Risk-free rate 6.5%
        const d1 = (Math.log(spot / strike) + (r + 0.5 * iv ** 2) * T) / (iv * Math.sqrt(T));
        
        if (type === 'CE') {
            return normCDF(d1);
        } else {
            return normCDF(d1) - 1;
        }
    },

    /**
     * Compute Gamma.
     */
    computeGamma(spot: number, strike: number, dte: number, iv: number = 0.15): number {
        const T = Math.max(0.0001, dte / 365);
        const r = 0.065;
        const d1 = (Math.log(spot / strike) + (r + 0.5 * iv ** 2) * T) / (iv * Math.sqrt(T));
        
        const gamma = normPDF(d1) / (spot * iv * Math.sqrt(T));
        return gamma;
    },

    /**
     * Compute Daily Theta.
     */
    computeTheta(spot: number, strike: number, type: 'CE' | 'PE', dte: number, iv: number = 0.15): number {
        const T = Math.max(0.0001, dte / 365);
        const r = 0.065;
        const d1 = (Math.log(spot / strike) + (r + 0.5 * iv ** 2) * T) / (iv * Math.sqrt(T));
        const d2 = d1 - iv * Math.sqrt(T);

        const term1 = -(spot * normPDF(d1) * iv) / (2 * Math.sqrt(T));
        let thetaAnnual: number;

        if (type === 'CE') {
            thetaAnnual = term1 - r * strike * Math.exp(-r * T) * normCDF(d2);
        } else {
            thetaAnnual = term1 + r * strike * Math.exp(-r * T) * normCDF(-d2);
        }

        // Return daily Theta
        return thetaAnnual / 365;
    },

    /**
     * Compute Vega (per 1% IV change).
     */
    computeVega(spot: number, strike: number, dte: number, iv: number = 0.15): number {
        const T = Math.max(0.0001, dte / 365);
        const r = 0.065;
        const d1 = (Math.log(spot / strike) + (r + 0.5 * iv ** 2) * T) / (iv * Math.sqrt(T));
        
        const vegaAnnual = spot * Math.sqrt(T) * normPDF(d1);
        return vegaAnnual / 100; // Return change per 1% IV
    },

    /**
     * Aggregate all Greeks for a parsed signal option contract.
     */
    async computeAllGreeks(signal: ParsedSignal): Promise<OptionGreeks | null> {
        try {
            // Parse base symbol (e.g. BANKNIFTY)
            const symbolUpper = signal.instrument.toUpperCase();
            let baseSymbol = 'NIFTY';
            if (symbolUpper.includes('BANKNIFTY')) baseSymbol = 'BANKNIFTY';
            else if (symbolUpper.includes('FINNIFTY')) baseSymbol = 'FINNIFTY';
            else if (symbolUpper.includes('MIDCPNIFTY')) baseSymbol = 'MIDCPNIFTY';
            else if (symbolUpper.includes('SENSEX')) baseSymbol = 'SENSEX';

            // Get spot price
            const quote = await fetchIndianStockQuote(baseSymbol);
            const spotPrice = quote?.price || signal.entryPrice || 0;
            if (spotPrice <= 0) return null;

            // Parse strike and type (CE/PE)
            const strikeMatch = symbolUpper.match(/(\d{5})\s*(CE|PE)/);
            if (!strikeMatch) return null;

            const strike = parseFloat(strikeMatch[1]);
            const optionType = strikeMatch[2] as 'CE' | 'PE';

            // Parse Expiry and calculate DTE
            let dte = 2; // Default 2 DTE
            if (signal.expiryDate) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const exp = new Date(signal.expiryDate);
                exp.setHours(0, 0, 0, 0);
                const diff = exp.getTime() - today.getTime();
                dte = Math.max(0.1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
            }

            // Standard implied volatility default for Indian options
            const iv = 0.15; 

            // Calculate Greeks
            const delta = this.computeDelta(spotPrice, strike, optionType, dte, iv);
            const gamma = this.computeGamma(spotPrice, strike, dte, iv);
            const theta = this.computeTheta(spotPrice, strike, optionType, dte, iv);
            const vega = this.computeVega(spotPrice, strike, dte, iv);

            // Calculate daily Theta decay in Rupees per lot
            const lotSize = LOT_SIZES[baseSymbol] || 15;
            const thetaRupees = Math.abs(theta * lotSize);
            const thetaAlert = thetaRupees > 500;

            return {
                delta: parseFloat(delta.toFixed(3)),
                gamma: parseFloat(gamma.toFixed(5)),
                theta: parseFloat(theta.toFixed(3)),
                vega: parseFloat(vega.toFixed(3)),
                thetaRupees: parseFloat(thetaRupees.toFixed(2)),
                thetaAlert,
                spotPrice,
                strike,
                optionType,
                dte
            };
        } catch (err) {
            console.error('Error computing option greeks:', err);
            return null;
        }
    }
};
