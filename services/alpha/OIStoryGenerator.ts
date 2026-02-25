import { logger } from '../Logger';

export interface OIStory {
  sentence: string;
  sentiment: 'bullish' | 'bearish' | 'neutral' | 'caution';
  strike: number;
}

export interface StrikeBuildup {
  strikePrice: number;
  CE?: {
    oi: number;
    oiChange: number;
    iv?: number;
  };
  PE?: {
    oi: number;
    oiChange: number;
    iv?: number;
  };
}

/**
 * OIStoryGenerator: Translates complex options open interest data into plain English narratives.
 */
export class OIStoryGenerator {
  /**
   * Generates option buildup narratives based on strike open interest configurations.
   */
  static generateOIStory(strikes: StrikeBuildup[], underlyingLTP: number, maxPainStrike?: number): OIStory[] {
    const stories: OIStory[] = [];
    if (!strikes || strikes.length === 0 || !underlyingLTP) {
      return stories;
    }

    // Sort strikes by strikePrice
    const sortedStrikes = [...strikes].sort((a, b) => a.strikePrice - b.strikePrice);

    // Find overall walls
    let maxCallOI = -1;
    let maxCallOIStrike = 0;
    let maxPutOI = -1;
    let maxPutOIStrike = 0;

    let maxCallOIChange = -1;
    let maxCallOIChangeStrike = 0;
    let maxPutOIChange = -1;
    let maxPutOIChangeStrike = 0;

    sortedStrikes.forEach(s => {
      if (s.CE) {
        if (s.CE.oi > maxCallOI) {
          maxCallOI = s.CE.oi;
          maxCallOIStrike = s.strikePrice;
        }
        if (s.CE.oiChange > maxCallOIChange) {
          maxCallOIChange = s.CE.oiChange;
          maxCallOIChangeStrike = s.strikePrice;
        }
      }
      if (s.PE) {
        if (s.PE.oi > maxPutOI) {
          maxPutOI = s.PE.oi;
          maxPutOIStrike = s.strikePrice;
        }
        if (s.PE.oiChange > maxPutOIChange) {
          maxPutOIChange = s.PE.oiChange;
          maxPutOIChangeStrike = s.strikePrice;
        }
      }
    });

    // 1. Dominant Walls
    if (maxCallOIStrike > 0) {
      stories.push({
        sentence: `Major Call Wall detected at ₹${maxCallOIStrike.toLocaleString('en-IN')} — this forms the strongest overhead resistance for this session.`,
        sentiment: 'bearish',
        strike: maxCallOIStrike
      });
    }

    if (maxPutOIStrike > 0) {
      stories.push({
        sentence: `Strong Put Wall established at ₹${maxPutOIStrike.toLocaleString('en-IN')} — this is the dominant floor and key technical support.`,
        sentiment: 'bullish',
        strike: maxPutOIStrike
      });
    }

    // 2. Max Pain Magnet
    if (maxPainStrike) {
      stories.push({
        sentence: `Max Pain strike is situated at ₹${maxPainStrike.toLocaleString('en-IN')} — expectation of options settlement pinning gravity near this zone.`,
        sentiment: 'neutral',
        strike: maxPainStrike
      });
    }

    // 3. Significant Buildups / Unwinding near Spot (within ±3% of LTP)
    const rangeLimit = underlyingLTP * 0.03;
    const nearSpotStrikes = sortedStrikes.filter(
      s => Math.abs(s.strikePrice - underlyingLTP) <= rangeLimit
    );

    nearSpotStrikes.forEach(s => {
      // Call Side Buildup
      if (s.CE && s.CE.oiChange > 0) {
        // High volume call writing
        const threshold = maxCallOIChange * 0.25; // 25% of maximum call change
        if (s.CE.oiChange >= threshold && s.strikePrice > underlyingLTP) {
          stories.push({
            sentence: `Aggressive call writing observed at ₹${s.strikePrice.toLocaleString('en-IN')} — sellers capping upside momentum above current price.`,
            sentiment: 'bearish',
            strike: s.strikePrice
          });
        }
      }

      // Call Side Unwinding (Short Covering)
      if (s.CE && s.CE.oiChange < 0 && s.strikePrice > underlyingLTP) {
        const threshold = -10000; // arbitrary threshold or relative
        if (s.CE.oiChange <= threshold) {
          stories.push({
            sentence: `Short covering in calls at ₹${s.strikePrice.toLocaleString('en-IN')} — writers escaping, clearing a path for potential upward breakout.`,
            sentiment: 'bullish',
            strike: s.strikePrice
          });
        }
      }

      // Put Side Buildup
      if (s.PE && s.PE.oiChange > 0 && s.strikePrice < underlyingLTP) {
        const threshold = maxPutOIChange * 0.25;
        if (s.PE.oiChange >= threshold) {
          stories.push({
            sentence: `Active put writing at ₹${s.strikePrice.toLocaleString('en-IN')} — writers building support floor, expressing intraday confidence.`,
            sentiment: 'bullish',
            strike: s.strikePrice
          });
        }
      }

      // Put Side Unwinding (Long Unwinding / Fear)
      if (s.PE && s.PE.oiChange < 0 && s.strikePrice < underlyingLTP) {
        const threshold = -10000;
        if (s.PE.oiChange <= threshold) {
          stories.push({
            sentence: `Put writers unwinding positions at ₹${s.strikePrice.toLocaleString('en-IN')} — support is softening; caution advised on downside risks.`,
            sentiment: 'caution',
            strike: s.strikePrice
          });
        }
      }
    });

    // Fallback if no specific near-spot story is generated
    if (stories.length <= 2) {
      stories.push({
        sentence: "OI distribution is evenly balanced near spot strikes. Rotational trading within established Call/Put walls expected.",
        sentiment: 'neutral',
        strike: Math.round(underlyingLTP / 100) * 100
      });
    }

    return stories.slice(0, 5); // Return top 5 narratives to avoid overwhelming UI
  }
}
