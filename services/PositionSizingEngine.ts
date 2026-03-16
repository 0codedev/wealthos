import type { ParsedSignal } from '../database';

const LOT_SIZES: Record<string, number> = {
    NIFTY: 25,
    BANKNIFTY: 15,
    FINNIFTY: 40,
    MIDCPNIFTY: 75
};

export interface PositionSizeResult {
    lots: number;
    capitalAtRisk: number;
    kellyFraction: number;
    cappedKelly: number;
    ifSLHit: number;
    ifT1Hit: number;
}

export const PositionSizingEngine = {
    /**
     * Calculates recommended lot size using the Kelly Criterion and maximum portfolio risk percentage.
     */
    computeRecommendedSize(
        signal: ParsedSignal,
        portfolioValue: number,
        riskPct: number = 0.015, // default 1.5% risk
        providerWinRate: number = 0.5, // default 50% win rate
        options?: {
          mlHitProb?: number;
          anomalyScore?: number;
          regime?: 'HIGH_VIX' | 'CHOPPY' | 'TRENDING_UP' | 'TRENDING_DOWN' | string;
        }
    ): PositionSizeResult {
        const entryPrice = signal.entryPrice || 100;
        const stopLoss = signal.stopLoss || entryPrice * 0.95; // default 5% stop loss
        const target1 = signal.target1 || entryPrice * 1.05; // default 5% target

        const riskPerUnit = Math.abs(entryPrice - stopLoss);
        const rewardPerUnit = Math.abs(target1 - entryPrice);

        // Calculate R:R
        const rrRatio = riskPerUnit > 0 ? (rewardPerUnit / riskPerUnit) : 1.5;

        // Kelly Criterion formula: f* = p - (1-p)/b
        // p = winRate (or ML hitProb if provided), b = rrRatio
        const winRate = options?.mlHitProb ?? providerWinRate;
        const kellyFraction = winRate - ((1 - winRate) / rrRatio);
        
        // Multipliers for market regime & anomaly status
        const regime = options?.regime ?? 'TRENDING_UP';
        const regimeMultiplier = regime === 'HIGH_VIX' ? 0.5 : regime === 'CHOPPY' ? 0.7 : regime === 'TRENDING_DOWN' ? 0.8 : 1.0;
        const anomalyFactor = 1.0 - Math.min(0.8, options?.anomalyScore ?? 0);
        
        // HALF-KELLY STANDARD: Full Kelly exhibits extreme volatility and high drawdown risk.
        // Institutional prop desks enforce Half-Kelly (0.5 * f*) for long-term asymptotic growth with safety.
        const halfKelly = kellyFraction * 0.5;
        const adaptiveKelly = halfKelly * regimeMultiplier * anomalyFactor;

        // STRICT RISK GATE: If Kelly fraction is <= 0 or adaptive Kelly is <= 0,
        // this is a NEGATIVE-EXPECTANCY trade setup. We MUST NOT force risk or lots!
        if (kellyFraction <= 0 || adaptiveKelly <= 0) {
            return {
                lots: 0,
                capitalAtRisk: 0,
                kellyFraction: parseFloat(kellyFraction.toFixed(4)),
                cappedKelly: 0,
                ifSLHit: 0,
                ifT1Hit: 0
            };
        }

        // Cap Kelly fraction at user-defined maximum risk percentage (e.g. 1.5% - 2.5%)
        const cappedKelly = Math.min(adaptiveKelly, riskPct, 0.025);

        // Recommended capital to allocate
        const maxRiskCapital = portfolioValue * cappedKelly;

        // Get lot size based on instrument
        const instrumentUpper = (signal.instrument || '').toUpperCase();
        let lotSize = 15; // default lot size (e.g. BankNifty)
        
        if (instrumentUpper.includes('BANKNIFTY')) lotSize = LOT_SIZES.BANKNIFTY;
        else if (instrumentUpper.includes('NIFTY')) lotSize = LOT_SIZES.NIFTY;
        else if (instrumentUpper.includes('FINNIFTY')) lotSize = LOT_SIZES.FINNIFTY;
        else if (instrumentUpper.includes('MIDCPNIFTY')) lotSize = LOT_SIZES.MIDCPNIFTY;

        // Calculate risk per lot
        const riskPerLot = riskPerUnit * lotSize;

        // Calculate recommended lots based on capital at risk.
        // If maxRiskCapital is less than riskPerLot, recommended lots is 0 (account cannot afford without breaching risk ceiling).
        const recommendedLots = riskPerLot > 0
            ? Math.floor(maxRiskCapital / riskPerLot)
            : Math.floor(maxRiskCapital / (entryPrice * lotSize));

        // Est outcome PnLs
        const ifSLHit = recommendedLots * lotSize * riskPerUnit;
        const ifT1Hit = recommendedLots * lotSize * rewardPerUnit;
        const capitalAtRisk = ifSLHit; // Risk is equal to the SL hit loss

        return {
            lots: recommendedLots,
            capitalAtRisk: parseFloat(capitalAtRisk.toFixed(2)),
            kellyFraction: parseFloat(kellyFraction.toFixed(4)),
            cappedKelly: parseFloat(cappedKelly.toFixed(4)),
            ifSLHit: parseFloat(ifSLHit.toFixed(2)),
            ifT1Hit: parseFloat(ifT1Hit.toFixed(2))
        };
    }
};
