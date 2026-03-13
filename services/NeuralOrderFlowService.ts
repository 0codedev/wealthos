// NeuralOrderFlowService.ts
import { optionChainService, OptionChainSnapshot } from './OptionChainService';
import { logger } from './Logger';

export interface OrderFlowReport {
  symbol: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number; // 0 to 100
  pcr: number;
  maxPain: number;
  oiSignal: string;
  ivSkew: string;
  underlyingValue: number;
  oiDistribution: { strike: number; callsOI: number; putsOI: number }[];
  ivSkewData: { strike: number; callsIV: number; putsIV: number }[];
}

class NeuralOrderFlowService {
  /**
   * Computes Order Flow indicators from raw option chain data
   */
  public async analyzeOrderFlow(symbol: string = 'NIFTY'): Promise<OrderFlowReport | null> {
    try {
      const snap = await optionChainService.fetchOptionChain(symbol, undefined, true);
      if (!snap) return null;

      const { underlyingValue, pcr, maxPain, strikes } = snap;

      // 1. OI Buildup Analysis
      // Find strikes with the highest Call and Put OI addition
      let highestCallStrike = 0;
      let maxCallChange = -Infinity;
      let highestPutStrike = 0;
      let maxPutChange = -Infinity;

      strikes.forEach(s => {
        if (s.CE && s.CE.changeInOi > maxCallChange) {
          maxCallChange = s.CE.changeInOi;
          highestCallStrike = s.strikePrice;
        }
        if (s.PE && s.PE.changeInOi > maxPutChange) {
          maxPutChange = s.PE.changeInOi;
          highestPutStrike = s.strikePrice;
        }
      });

      let oiSignal = 'Neutral Accumulation';
      if (maxCallChange > maxPutChange && highestCallStrike > underlyingValue) {
        oiSignal = `Heavy Call Buildup at ${highestCallStrike} (Resistance)`;
      } else if (maxPutChange > maxCallChange && highestPutStrike < underlyingValue) {
        oiSignal = `Heavy Put Buildup at ${highestPutStrike} (Support)`;
      } else if (maxCallChange > maxPutChange && highestCallStrike < underlyingValue) {
        oiSignal = `In-the-Money Call Buying at ${highestCallStrike} (Strong Bullish)`;
      }

      // 2. IV Skew Analysis
      // Compare IV of OTM calls (+5% of spot) vs OTM puts (-5% of spot)
      const callTarget = underlyingValue * 1.05;
      const putTarget = underlyingValue * 0.95;

      let otmCallIV = 0;
      let otmPutIV = 0;
      let callMin = Infinity;
      let putMin = Infinity;

      strikes.forEach(s => {
        const ceDiff = Math.abs(s.strikePrice - callTarget);
        if (ceDiff < callMin && s.CE && s.CE.iv > 0) {
          callMin = ceDiff;
          otmCallIV = s.CE.iv;
        }
        const peDiff = Math.abs(s.strikePrice - putTarget);
        if (peDiff < putMin && s.PE && s.PE.iv > 0) {
          putMin = peDiff;
          otmPutIV = s.PE.iv;
        }
      });

      let ivSkew = 'Symmetric hedging';
      if (otmPutIV > otmCallIV + 3.0) {
        ivSkew = `Downside skew (Puts IV ${otmPutIV.toFixed(1)}% vs Calls IV ${otmCallIV.toFixed(1)}%) — Hedging activity high`;
      } else if (otmCallIV > otmPutIV + 3.0) {
        ivSkew = `Upside skew (Calls IV ${otmCallIV.toFixed(1)}% vs Puts IV ${otmPutIV.toFixed(1)}%) — Speculative Call buying`;
      }

      // 3. Direction and Confidence
      let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
      let confidenceScore = 50;

      // Rules based quantitative score
      let score = 0;
      if (pcr > 1.25) score += 20; // Bullish PCR
      if (pcr < 0.75) score -= 20; // Bearish PCR
      
      if (underlyingValue > maxPain) score += 15; // Price above Max Pain (Bullish)
      if (underlyingValue < maxPain) score -= 15;

      if (maxPutChange > maxCallChange) score += 15;
      if (maxCallChange > maxPutChange) score -= 15;

      if (otmPutIV > otmCallIV + 4) score -= 10; // Defensive hedging (bearish skew)
      if (otmCallIV > otmPutIV + 4) score += 10;

      if (score >= 15) {
        direction = 'BULLISH';
        confidenceScore = 50 + Math.min(40, score);
      } else if (score <= -15) {
        direction = 'BEARISH';
        confidenceScore = 50 + Math.min(40, Math.abs(score));
      } else {
        direction = 'NEUTRAL';
        confidenceScore = 50 + Math.abs(score);
      }

      // 4. Distribution and Skew Charts data
      // Filter strikes around spot (±10 strikes) to keep charts clean
      const sortedStrikes = [...strikes].sort((a, b) => a.strikePrice - b.strikePrice);
      const atmIndex = sortedStrikes.findIndex(s => s.strikePrice >= underlyingValue);
      const startIdx = Math.max(0, atmIndex - 8);
      const endIdx = Math.min(sortedStrikes.length, atmIndex + 9);
      const chartStrikes = sortedStrikes.slice(startIdx, endIdx);

      const oiDistribution = chartStrikes.map(s => ({
        strike: s.strikePrice,
        callsOI: s.CE?.oi || 0,
        putsOI: s.PE?.oi || 0,
      }));

      const ivSkewData = chartStrikes.map(s => ({
        strike: s.strikePrice,
        callsIV: s.CE?.iv || 0,
        putsIV: s.PE?.iv || 0,
      }));

      return {
        symbol,
        direction,
        confidence: confidenceScore,
        pcr,
        maxPain,
        oiSignal,
        ivSkew,
        underlyingValue,
        oiDistribution,
        ivSkewData,
      };

    } catch (err) {
      logger.error(`[NeuralOrderFlow] Analysis failed for ${symbol}`, err);
      return null;
    }
  }
}

export const neuralOrderFlowService = new NeuralOrderFlowService();
export default neuralOrderFlowService;
