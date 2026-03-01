// BTST Engine - Pre-Close Strategy AI
// Calculates Probability of Gap Up/Down and dynamic capital constraints based on leading live indicators.

import { fetchIndiaVIX, fetchGlobalIndex, fetchIndianStockQuote } from './RealDataService';
import { askGemini } from './aiService';
import { logger } from './Logger';

export interface BTSTPrediction {
    direction: 'GAP_UP' | 'GAP_DOWN' | 'FLAT';
    probability: number; // 0-100
    expectedGapPercentage: number; // unsigned percentage
    recommendedCapital: number; // Exact capital to deploy based on probability
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    signals: {
        giftNiftyPremium: number; // points proxy
        indiaVixChange: number; // %
        pcr: number;
    };
    action: string;
}

class BTSTEngine {
    // Dynamic Capital limits
    private MIN_CAPITAL = 500;
    private MAX_LOTTO_CAPITAL = 1500;
    private MAX_HIGH_PROB_CAPITAL = 10000;

    /**
     * Executes a true Live Data EOD pull and pushes it through the Gemini LLM for Quant Parsing.
     */
    async runLiveEODScan(instrument: string, spotPrice: number): Promise<BTSTPrediction> {
        logger.info(`Initiating Live BTST Pre-Close Scan on ${instrument} at Spot: ${spotPrice}`);

        // 1. Ingest Live Indicators asynchronously
        const [vix, sp500, nasdaq] = await Promise.all([
            fetchIndiaVIX(),
            fetchGlobalIndex('^GSPC', 'S&P 500'),
            fetchGlobalIndex('^IXIC', 'NASDAQ')
        ]);

        // Synthesize global momentum since GIFT free reliable API is hard to acquire.
        // We use S&P 500 and Nasdaq as the fundamental directional proxy.
        const avgGlobalChange = (sp500.change + nasdaq.change) / 2;
        const globalTrend = avgGlobalChange > 0.5 ? 'Strong Bullish' : avgGlobalChange < -0.5 ? 'Strong Bearish' : 'Flat/Choppy';

        // 2. Core AI Prompt Construction
        const prompt = `
        You are a high-end quantitative hedge fund BTST (Buy Today Sell Tomorrow) Engine.
        Your job is to analyze real-time market data pre-close (3:15 PM) and predict tomorrow's Opening Gap direction and severity.
        
        LIVE MARKET DATA (Instrument: ${instrument}):
        - Current Spot Price: ${spotPrice}
        - India VIX Level: ${vix.value} (Change: ${vix.change}%)
        - Global Market Sentiment Proxy (US Futures Change): S&P500 ${sp500.change}%, NASDAQ ${nasdaq.change}%
        - Macro Trend: ${globalTrend}
        
        YOUR LOGIC ENGINE:
        - If US Indices are violently surging and VIX is dropping, probability of GAP_UP surges >80%.
        - If US Indices are violently bleeding and VIX is spiking rapidly (>4%), probability of GAP_DOWN surges >80%.
        - If everything is relatively flat or mixed (-0.2% to 0.2%), assume FLAT (IV Crush Event) and keep probabilities between 40-60%.
        - Output a synthetic "pcr" (Put Call Ratio) metric based on what the sentiment dictates institutions would be doing. Flat = 1.0, Bearish = 0.6, Bullish = 1.4.
        
        OUTPUT STRICTLY RAW JSON in the following format WITHOUT markdown blocks:
        {
            "direction": "GAP_UP" | "GAP_DOWN" | "FLAT",
            "probability": <number from 0 to 100>,
            "expectedGapPercentage": <number unsigned, e.g., 0.5 for half percent>,
            "syntheticGiftNiftyPoints": <number simulating the proxy gap shift expected in points, can be negative>,
            "syntheticPCR": <number between 0.5 to 1.5>
        }
        `;

        let aiResult: any = null;
        try {
            // Ask Gemini (True) using the Pro layer for intelligence
            const aiResponse = await askGemini(prompt, true);
            
            // Clean markdown if AI includes it
            const cleanJsonStr = aiResponse.replace(/```json/gi, '').replace(/```/gi, '').trim();
            aiResult = JSON.parse(cleanJsonStr);
            logger.info('Live BTST Quant Engine Computed response:', aiResult);
        } catch (error) {
            logger.error('BTST AI Parser mapping failed, utilizing dynamic failsafe.', error);
            // Default failsafe if AI rate limits or errors
            aiResult = {
                direction: globalTrend.includes('Bullish') ? 'GAP_UP' : globalTrend.includes('Bearish') ? 'GAP_DOWN' : 'FLAT',
                probability: globalTrend.includes('Flat') ? 75 : 65,
                expectedGapPercentage: 0.5,
                syntheticGiftNiftyPoints: avgGlobalChange > 0 ? 50 : -50,
                syntheticPCR: globalTrend.includes('Bullish') ? 1.2 : 0.8
            };
        }

        // Sanitize Output
        const direction = aiResult.direction as 'GAP_UP' | 'GAP_DOWN' | 'FLAT';
        const probability = Math.min(99.9, Math.max(0, parseFloat(aiResult.probability || 50)));
        const expectedGapPercentage = Math.max(0.1, parseFloat(aiResult.expectedGapPercentage || 0.5));
        
        // 3. Capital Allocation Edge System (The mathematical edge against IV)
        let recommendedCapital = 0;
        let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' = 'LOW';
        let action = '';

        if (direction === 'FLAT' || probability < 70) {
            recommendedCapital = this.MIN_CAPITAL;
            riskLevel = 'LOW';
            action = 'AVOID OR PURE LOTTO: Deploy strictly ₹500 on far OTMs. Market suggests absolute chop or IV crush via flat opening.';
        } else if (probability >= 70 && probability <= 85) {
            recommendedCapital = this.MAX_LOTTO_CAPITAL;
            riskLevel = 'MEDIUM';
            action = `STRONG CONFIDENCE: Bias is ${direction === 'GAP_UP' ? 'Bullish' : 'Bearish'}. Deploy ₹1,000 - ₹1,500 safely. Limit risk.`;
        } else if (probability > 85) {
            // Scale capital heavily if probability > 85% indicating alpha setups
            const growthFactor = (probability - 85) / 15; // Normalize 0 to 1
            recommendedCapital = this.MAX_LOTTO_CAPITAL + (this.MAX_HIGH_PROB_CAPITAL - this.MAX_LOTTO_CAPITAL) * growthFactor;
            riskLevel = probability > 92 ? 'EXTREME' : 'HIGH';
            action = `ALPHA STRIKE ALIGNMENT: 90%+ Confirmation of ${direction === 'GAP_UP' ? 'Massive Gap Up' : 'Massive Gap Down'}. Institutions are heavily biased. Size up dynamically up to limits.`;
        }

        // Clean integer mapping for capital allocation (multiples of 500)
        recommendedCapital = Math.ceil(recommendedCapital / 500) * 500;
        if (recommendedCapital < this.MIN_CAPITAL) recommendedCapital = this.MIN_CAPITAL;

        return {
            direction,
            probability: parseFloat(probability.toFixed(1)),
            expectedGapPercentage: parseFloat(expectedGapPercentage.toFixed(2)),
            recommendedCapital,
            riskLevel,
            action,
            signals: { 
                giftNiftyPremium: aiResult.syntheticGiftNiftyPoints || 0,
                indiaVixChange: parseFloat(vix.change.toFixed(2)) || 0, 
                pcr: aiResult.syntheticPCR || 1.0 
            }
        };
    }
}

export const btstEngine = new BTSTEngine();
