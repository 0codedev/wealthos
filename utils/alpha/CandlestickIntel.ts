
export interface PatternIntel {
  name: string;
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  definition: string;
  psychology: string;
  strategy: {
    entry: string;
    stopLoss: string;
    target: string;
  };
  reliability: 'High' | 'Medium' | 'Low';
}

export const CANDLESTICK_INTEL: Record<string, PatternIntel> = {
  "bullish engulfing": {
    name: "Bullish Engulfing",
    sentiment: "Bullish",
    definition: "A large green candle that completely 'engulfs' the previous day's small red candle.",
    psychology: "Indicates a massive shift in sentiment where buyers have completely overwhelmed sellers after a downtrend.",
    strategy: {
      entry: "Above the high of the engulfing candle.",
      stopLoss: "Below the low of the engulfing candle.",
      target: "Next major resistance level or 2:1 Reward ratio."
    },
    reliability: "High"
  },
  "bearish engulfing": {
    name: "Bearish Engulfing",
    sentiment: "Bearish",
    definition: "A large red candle that completely 'engulfs' the previous day's small green candle.",
    psychology: "Sellers have taken total control, drowning out the previous bullish momentum. Often marks a top.",
    strategy: {
      entry: "Below the low of the engulfing candle.",
      stopLoss: "Above the high of the engulfing candle.",
      target: "Next major support level."
    },
    reliability: "High"
  },
  "hammer": {
    name: "Hammer",
    sentiment: "Bullish",
    definition: "Small body at the top with a long lower wick (2x the body size).",
    psychology: "Market tested deep lows but buyers pushed back strongly to close near the open. Capitulation signal.",
    strategy: {
      entry: "Above the hammer's high on a bullish confirmation candle.",
      stopLoss: "Below the hammer's wick.",
      target: "1.5x the candle's range."
    },
    reliability: "Medium"
  },
  "doji": {
    name: "Doji",
    sentiment: "Neutral",
    definition: "Open and close are almost identical, creating a cross-like shape.",
    psychology: "Complete indecision between buyers and sellers. Trend reversal is imminent.",
    strategy: {
      entry: "Wait for the breakout of the Doji's range in the direction of the trend.",
      stopLoss: "Opposite side of the Doji.",
      target: "Trend continuation depth."
    },
    reliability: "Medium"
  },
  "inverted hammer": {
    name: "Inverted Hammer",
    sentiment: "Bullish",
    definition: "Small body at the bottom with a long upper wick.",
    psychology: "Buyers tried to push up but failed initially; however, the pressure is building for a reversal.",
    strategy: {
      entry: "Confirmation above the body high.",
      stopLoss: "Below the body low.",
      target: "Immediate resistance."
    },
    reliability: "Medium"
  },
  "morning star": {
    name: "Morning Star",
    sentiment: "Bullish",
    definition: "3-candle pattern: Large red, small indecision candle, large green.",
    psychology: "A perfect reversal sequence showing the death of a downtrend and birth of a new uptrend.",
    strategy: {
      entry: "Close of the 3rd green candle.",
      stopLoss: "Low of the middle (star) candle.",
      target: "Previous swing high."
    },
    reliability: "High"
  },
  "evening star": {
    name: "Evening Star",
    sentiment: "Bearish",
    definition: "3-candle pattern: Large green, small indecision candle, large red.",
    psychology: "The bulls are exhausted; the 'star' shows hesitation, and the final red candle confirms the collapse.",
    strategy: {
      entry: "Close of the 3rd red candle.",
      stopLoss: "High of the middle candle.",
      target: "Previous swing low."
    },
    reliability: "High"
  }
};

export const getPatternIntel = (name: string): PatternIntel => {
  return CANDLESTICK_INTEL[name.toLowerCase()] || {
    name: name,
    sentiment: "Neutral",
    definition: "A technical candlestick formation requiring volume confirmation.",
    psychology: "Represents a specific balance of power between buyers and sellers at this price level.",
    strategy: {
      entry: "Confirmation of the next candle.",
      stopLoss: "Previous candle low/high.",
      target: "Calculated risk-reward."
    },
    reliability: "Medium"
  };
};
