// INDICATORS list
export const INDICATORS = [
  { id: 'ema', label: 'EMA (Exponential Moving Average)' },
  { id: 'sma', label: 'SMA (Simple Moving Average)' },
  { id: 'wma', label: 'WMA (Weighted Moving Average)' },
  { id: 'ohlc', label: 'OHLC Patterns' },
  { id: 'fibonacci', label: 'Fibonacci' },
  { id: 'vwap', label: 'VWAP' },
  { id: 'pivot-points', label: 'Pivot Points' },
  { id: 'volatility', label: 'Overlay (Bollinger Bands)' },
  { id: 'trend-indicators', label: 'Trend Indicators' },
  { id: 'volume', label: 'Volume Based' },
  { id: 'momentum-oscillators', label: 'Overbought/Sold (RSI)' },
  { id: 'price-action', label: 'Price Action' },
];

// CONDITIONS grouped by category and sub-indicator
export const CONDITIONS: Record<string, Record<string, { id: string; label: string }[]>> = {
  'ema': {
    'Price Cross Above': [
      { id: 'close_cross_above_5_ema', label: 'Price Cross Above 5 Ema' },
      { id: 'close_cross_above_10_ema', label: 'Price Cross Above 10 Ema' },
      { id: 'close_cross_above_15_ema', label: 'Price Cross Above 15 Ema' },
      { id: 'close_cross_above_20_ema', label: 'Price Cross Above 20 Ema' },
      { id: 'close_cross_above_25_ema', label: 'Price Cross Above 25 Ema' },
      { id: 'close_cross_above_30_ema', label: 'Price Cross Above 30 Ema' },
      { id: 'close_cross_above_40_ema', label: 'Price Cross Above 40 Ema' },
      { id: 'close_cross_above_50_ema', label: 'Price Cross Above 50 Ema' },
      { id: 'close_cross_above_100_ema', label: 'Price Cross Above 100 Ema' },
      { id: 'close_cross_above_200_ema', label: 'Price Cross Above 200 Ema' },
    ],
    'Price Cross Below': [
      { id: 'close_cross_below_5_ema', label: 'Price Cross Below 5 Ema' },
      { id: 'close_cross_below_10_ema', label: 'Price Cross Below 10 Ema' },
      { id: 'close_cross_below_15_ema', label: 'Price Cross Below 15 Ema' },
      { id: 'close_cross_below_20_ema', label: 'Price Cross Below 20 Ema' },
      { id: 'close_cross_below_25_ema', label: 'Price Cross Below 25 Ema' },
      { id: 'close_cross_below_30_ema', label: 'Price Cross Below 30 Ema' },
      { id: 'close_cross_below_40_ema', label: 'Price Cross Below 40 Ema' },
      { id: 'close_cross_below_50_ema', label: 'Price Cross Below 50 Ema' },
      { id: 'close_cross_below_100_ema', label: 'Price Cross Below 100 Ema' },
      { id: 'close_cross_below_200_ema', label: 'Price Cross Below 200 Ema' },
    ],
    'Price Just Above': [
      { id: 'close_above_5_ema', label: 'Price Just Above 5 Ema' },
      { id: 'close_above_10_ema', label: 'Price Just Above 10 Ema' },
      { id: 'close_above_15_ema', label: 'Price Just Above 15 Ema' },
      { id: 'close_above_20_ema', label: 'Price Just Above 20 Ema' },
      { id: 'close_above_25_ema', label: 'Price Just Above 25 Ema' },
      { id: 'close_above_30_ema', label: 'Price Just Above 30 Ema' },
      { id: 'close_above_40_ema', label: 'Price Just Above 40 Ema' },
      { id: 'close_above_50_ema', label: 'Price Just Above 50 Ema' },
      { id: 'close_above_100_ema', label: 'Price Just Above 100 Ema' },
      { id: 'close_above_200_ema', label: 'Price Just Above 200 Ema' },
    ],
    'Price Just Below': [
      { id: 'close_below_5_ema', label: 'Price Just Below 5 Ema' },
      { id: 'close_below_10_ema', label: 'Price Just Below 10 Ema' },
      { id: 'close_below_15_ema', label: 'Price Just Below 15 Ema' },
      { id: 'close_below_20_ema', label: 'Price Just Below 20 Ema' },
      { id: 'close_below_25_ema', label: 'Price Just Below 25 Ema' },
      { id: 'close_below_30_ema', label: 'Price Just Below 30 Ema' },
      { id: 'close_below_40_ema', label: 'Price Just Below 40 Ema' },
      { id: 'close_below_50_ema', label: 'Price Just Below 50 Ema' },
      { id: 'close_below_100_ema', label: 'Price Just Below 100 Ema' },
      { id: 'close_below_200_ema', label: 'Price Just Below 200 Ema' },
    ],
    'Crossovers': [
      { id: 'ema_5_cross_above_15_ema', label: '5 Ema Cross Above 15' },
      { id: 'ema_5_cross_above_20_ema', label: '5 Ema Cross Above 20' },
      { id: 'ema_15_cross_above_50_ema', label: '15 Ema Cross Above 50' },
      { id: 'ema_20_cross_above_50_ema', label: '20 Ema Cross Above 50' },
      { id: 'ema_15_cross_above_100_ema', label: '15 Ema Cross Above 100' },
      { id: 'ema_20_cross_above_100_ema', label: '20 Ema Cross Above 100' },
      { id: 'ema_50_cross_above_100_ema', label: '50 Ema Cross Above 100' },
      { id: 'ema_50_cross_above_200_ema', label: '50 Ema Cross Above 200' },
      { id: 'ema_5_cross_below_15_ema', label: '5 Ema Cross Below 15' },
      { id: 'ema_5_cross_below_20_ema', label: '5 Ema Cross Below 20' },
      { id: 'ema_15_cross_below_50_ema', label: '15 Ema Cross Below 50' },
      { id: 'ema_20_cross_below_50_ema', label: '20 Ema Cross Below 50' },
      { id: 'ema_15_cross_below_100_ema', label: '15 Ema Cross Below 100' },
      { id: 'ema_20_cross_below_100_ema', label: '20 Ema Cross Below 100' },
      { id: 'ema_50_cross_below_100_ema', label: '50 Ema Cross Below 100' },
      { id: 'ema_50_cross_below_200_ema', label: '50 Ema Cross Below 200' },
    ],
  },
  'sma': {
    'Price Cross Above': [
      { id: 'close_cross_above_5_sma', label: 'Price Cross Above 5 Sma' },
      { id: 'close_cross_above_10_sma', label: 'Price Cross Above 10 Sma' },
      { id: 'close_cross_above_15_sma', label: 'Price Cross Above 15 Sma' },
      { id: 'close_cross_above_20_sma', label: 'Price Cross Above 20 Sma' },
      { id: 'close_cross_above_25_sma', label: 'Price Cross Above 25 Sma' },
      { id: 'close_cross_above_30_sma', label: 'Price Cross Above 30 Sma' },
      { id: 'close_cross_above_40_sma', label: 'Price Cross Above 40 Sma' },
      { id: 'close_cross_above_50_sma', label: 'Price Cross Above 50 Sma' },
      { id: 'close_cross_above_100_sma', label: 'Price Cross Above 100 Sma' },
      { id: 'close_cross_above_200_sma', label: 'Price Cross Above 200 Sma' },
    ],
    'Price Cross Below': [
      { id: 'close_cross_below_5_sma', label: 'Price Cross Below 5 Sma' },
      { id: 'close_cross_below_10_sma', label: 'Price Cross Below 10 Sma' },
      { id: 'close_cross_below_15_sma', label: 'Price Cross Below 15 Sma' },
      { id: 'close_cross_below_20_sma', label: 'Price Cross Below 20 Sma' },
      { id: 'close_cross_below_25_sma', label: 'Price Cross Below 25 Sma' },
      { id: 'close_cross_below_30_sma', label: 'Price Cross Below 30 Sma' },
      { id: 'close_cross_below_40_sma', label: 'Price Cross Below 40 Sma' },
      { id: 'close_cross_below_50_sma', label: 'Price Cross Below 50 Sma' },
      { id: 'close_cross_below_100_sma', label: 'Price Cross Below 100 Sma' },
      { id: 'close_cross_below_200_sma', label: 'Price Cross Below 200 Sma' },
    ],
    'Price Just Above': [
      { id: 'close_above_5_sma', label: 'Price Just Above 5 Sma' },
      { id: 'close_above_10_sma', label: 'Price Just Above 10 Sma' },
      { id: 'close_above_15_sma', label: 'Price Just Above 15 Sma' },
      { id: 'close_above_20_sma', label: 'Price Just Above 20 Sma' },
      { id: 'close_above_25_sma', label: 'Price Just Above 25 Sma' },
      { id: 'close_above_30_sma', label: 'Price Just Above 30 Sma' },
      { id: 'close_above_40_sma', label: 'Price Just Above 40 Sma' },
      { id: 'close_above_50_sma', label: 'Price Just Above 50 Sma' },
      { id: 'close_above_100_sma', label: 'Price Just Above 100 Sma' },
      { id: 'close_above_200_sma', label: 'Price Just Above 200 Sma' },
    ],
    'Price Just Below': [
      { id: 'close_below_5_sma', label: 'Price Just Below 5 Sma' },
      { id: 'close_below_10_sma', label: 'Price Just Below 10 Sma' },
      { id: 'close_below_15_sma', label: 'Price Just Below 15 Sma' },
      { id: 'close_below_20_sma', label: 'Price Just Below 20 Sma' },
      { id: 'close_below_25_sma', label: 'Price Just Below 25 Sma' },
      { id: 'close_below_30_sma', label: 'Price Just Below 30 Sma' },
      { id: 'close_below_40_sma', label: 'Price Just Below 40 Sma' },
      { id: 'close_below_50_sma', label: 'Price Just Below 50 Sma' },
      { id: 'close_below_100_sma', label: 'Price Just Below 100 Sma' },
      { id: 'close_below_200_sma', label: 'Price Just Below 200 Sma' },
    ],
    'Crossovers': [
      { id: 'sma_5_cross_above_15_sma', label: '5 Sma Cross Above 15' },
      { id: 'sma_5_cross_above_20_sma', label: '5 Sma Cross Above 20' },
      { id: 'sma_15_cross_above_50_sma', label: '15 Sma Cross Above 50' },
      { id: 'sma_20_cross_above_50_sma', label: '20 Sma Cross Above 50' },
      { id: 'sma_15_cross_above_100_sma', label: '15 Sma Cross Above 100' },
      { id: 'sma_20_cross_above_100_sma', label: '20 Sma Cross Above 100' },
      { id: 'sma_50_cross_above_100_sma', label: '50 Sma Cross Above 100' },
      { id: 'sma_50_cross_above_200_sma', label: '50 Sma Cross Above 200' },
      { id: 'sma_5_cross_below_15_sma', label: '5 Sma Cross Below 15' },
      { id: 'sma_5_cross_below_20_sma', label: '5 Sma Cross Below 20' },
      { id: 'sma_15_cross_below_50_sma', label: '15 Sma Cross Below 50' },
      { id: 'sma_20_cross_below_50_sma', label: '20 Sma Cross Below 50' },
      { id: 'sma_15_cross_below_100_sma', label: '15 Sma Cross Below 100' },
      { id: 'sma_20_cross_below_100_sma', label: '20 Sma Cross Below 100' },
      { id: 'sma_50_cross_below_100_sma', label: '50 Sma Cross Below 100' },
      { id: 'sma_50_cross_below_200_sma', label: '50 Sma Cross Below 200' },
    ],
  },
  'wma': {
    'Price Cross Above': [
      { id: 'close_cross_above_5_wma', label: 'Price Cross Above 5 Wma' },
      { id: 'close_cross_above_10_wma', label: 'Price Cross Above 10 Wma' },
      { id: 'close_cross_above_15_wma', label: 'Price Cross Above 15 Wma' },
      { id: 'close_cross_above_20_wma', label: 'Price Cross Above 20 Wma' },
      { id: 'close_cross_above_25_wma', label: 'Price Cross Above 25 Wma' },
      { id: 'close_cross_above_30_wma', label: 'Price Cross Above 30 Wma' },
      { id: 'close_cross_above_40_wma', label: 'Price Cross Above 40 Wma' },
      { id: 'close_cross_above_50_wma', label: 'Price Cross Above 50 Wma' },
      { id: 'close_cross_above_100_wma', label: 'Price Cross Above 100 Wma' },
      { id: 'close_cross_above_200_wma', label: 'Price Cross Above 200 Wma' },
    ],
    'Price Cross Below': [
      { id: 'close_cross_below_5_wma', label: 'Price Cross Below 5 Wma' },
      { id: 'close_cross_below_10_wma', label: 'Price Cross Below 10 Wma' },
      { id: 'close_cross_below_15_wma', label: 'Price Cross Below 15 Wma' },
      { id: 'close_cross_below_20_wma', label: 'Price Cross Below 20 Wma' },
      { id: 'close_cross_below_25_wma', label: 'Price Cross Below 25 Wma' },
      { id: 'close_cross_below_30_wma', label: 'Price Cross Below 30 Wma' },
      { id: 'close_cross_below_40_wma', label: 'Price Cross Below 40 Wma' },
      { id: 'close_cross_below_50_wma', label: 'Price Cross Below 50 Wma' },
      { id: 'close_cross_below_100_wma', label: 'Price Cross Below 100 Wma' },
      { id: 'close_cross_below_200_wma', label: 'Price Cross Below 200 Wma' },
    ],
    'Price Just Above': [
      { id: 'close_above_5_wma', label: 'Price Just Above 5 Wma' },
      { id: 'close_above_10_wma', label: 'Price Just Above 10 Wma' },
      { id: 'close_above_15_wma', label: 'Price Just Above 15 Wma' },
      { id: 'close_above_20_wma', label: 'Price Just Above 20 Wma' },
      { id: 'close_above_25_wma', label: 'Price Just Above 25 Wma' },
      { id: 'close_above_30_wma', label: 'Price Just Above 30 Wma' },
      { id: 'close_above_40_wma', label: 'Price Just Above 40 Wma' },
      { id: 'close_above_50_wma', label: 'Price Just Above 50 Wma' },
      { id: 'close_above_100_wma', label: 'Price Just Above 100 Wma' },
      { id: 'close_above_200_wma', label: 'Price Just Above 200 Wma' },
    ],
    'Price Just Below': [
      { id: 'close_below_5_wma', label: 'Price Just Below 5 Wma' },
      { id: 'close_below_10_wma', label: 'Price Just Below 10 Wma' },
      { id: 'close_below_15_wma', label: 'Price Just Below 15 Wma' },
      { id: 'close_below_20_wma', label: 'Price Just Below 20 Wma' },
      { id: 'close_below_25_wma', label: 'Price Just Below 25 Wma' },
      { id: 'close_below_30_wma', label: 'Price Just Below 30 Wma' },
      { id: 'close_below_40_wma', label: 'Price Just Below 40 Wma' },
      { id: 'close_below_50_wma', label: 'Price Just Below 50 Wma' },
      { id: 'close_below_100_wma', label: 'Price Just Below 100 Wma' },
      { id: 'close_below_200_wma', label: 'Price Just Below 200 Wma' },
    ],
    'Crossovers': [
      { id: 'wma_5_cross_above_15_wma', label: '5 Wma Cross Above 15' },
      { id: 'wma_5_cross_above_20_wma', label: '5 Wma Cross Above 20' },
      { id: 'wma_15_cross_above_50_wma', label: '15 Wma Cross Above 50' },
      { id: 'wma_20_cross_above_50_wma', label: '20 Wma Cross Above 50' },
      { id: 'wma_15_cross_above_100_wma', label: '15 Wma Cross Above 100' },
      { id: 'wma_20_cross_above_100_wma', label: '20 Wma Cross Above 100' },
      { id: 'wma_50_cross_above_100_wma', label: '50 Wma Cross Above 100' },
      { id: 'wma_50_cross_above_200_wma', label: '50 Wma Cross Above 200' },
      { id: 'wma_5_cross_below_15_wma', label: '5 Wma Cross Below 15' },
      { id: 'wma_5_cross_below_20_wma', label: '5 Wma Cross Below 20' },
      { id: 'wma_15_cross_below_50_wma', label: '15 Wma Cross Below 50' },
      { id: 'wma_20_cross_below_50_wma', label: '20 Wma Cross Below 50' },
      { id: 'wma_15_cross_below_100_wma', label: '15 Wma Cross Below 100' },
      { id: 'wma_20_cross_below_100_wma', label: '20 Wma Cross Below 100' },
      { id: 'wma_50_cross_below_100_wma', label: '50 Wma Cross Below 100' },
      { id: 'wma_50_cross_below_200_wma', label: '50 Wma Cross Below 200' },
    ],
  },
  'ohlc': {
    'OHLC Patterns': [
      { id: 'open_equals_low', label: 'Open Equals Low' },
      { id: 'gap_up', label: 'Gap Up' },
      { id: 'breakout_20', label: 'Breakout 20' },
      { id: 'five_green_candles', label: 'Five Green Candles' },
      { id: 'price_high_trending_up_3', label: 'Price High Trending Up 3' },
      { id: 'lower_high_and_lower_low_bullish_reversal', label: 'Lower High Lower Low Bullish Reversal' },
      { id: 'price_volume_trending_up_3', label: 'Price Volume Trending Up 3' },
      { id: 'open_equals_high', label: 'Open Equals High' },
      { id: 'gap_down', label: 'Gap Down' },
      { id: 'breakdown_20', label: 'Breakdown 20' },
      { id: 'five_red_candles', label: 'Five Red Candles' },
      { id: 'price_low_trending_down_3', label: 'Price Low Trending Down 3' },
      { id: 'higher_high_higher_low_bearish_reversal', label: 'Higher High Higher Low Bearish Reversal' },
      { id: 'price_volume_trending_down_3', label: 'Price Volume Trending Down 3' },
    ],
  },
  'fibonacci': {
    'Fibonacci Levels': [
      { id: 'near_23_6_support', label: 'Near 23 6 Support' },
      { id: 'near_38_2_support', label: 'Near 38 2 Support' },
      { id: 'near_50_support', label: 'Near 50 Support' },
      { id: 'near_61_8_support', label: 'Near 61 8 Support' },
      { id: 'near_78_6_support', label: 'Near 78 6 Support' },
      { id: 'breakdown_23_6_support', label: 'Breakdown 23 6 Support' },
      { id: 'breakdown_38_2_support', label: 'Breakdown 38 2 Support' },
      { id: 'breakdown_50_support', label: 'Breakdown 50 Support' },
      { id: 'breakdown_61_8_support', label: 'Breakdown 61 8 Support' },
      { id: 'breakdown_78_6_support', label: 'Breakdown 78 6 Support' },
      { id: 'retracing_from_23_6_support', label: 'Retracing From 23 6 Support' },
      { id: 'retracing_from_38_2_support', label: 'Retracing From 38 2 Support' },
      { id: 'retracing_from_50_support', label: 'Retracing From 50 Support' },
      { id: 'retracing_from_61_8_support', label: 'Retracing From 61 8 Support' },
      { id: 'retracing_from_78_6_support', label: 'Retracing From 78 6 Support' },
      { id: 'near_23_6_resistance', label: 'Near 23 6 Resistance' },
      { id: 'near_38_2_resistance', label: 'Near 38 2 Resistance' },
      { id: 'near_50_resistance', label: 'Near 50 Resistance' },
      { id: 'near_61_8_resistance', label: 'Near 61 8 Resistance' },
      { id: 'near_78_6_resistance', label: 'Near 78 6 Resistance' },
      { id: 'breakout_23_6_resistance', label: 'Breakout 23 6 Resistance' },
      { id: 'breakout_38_2_resistance', label: 'Breakout 38 2 Resistance' },
      { id: 'breakout_50_resistance', label: 'Breakout 50 Resistance' },
      { id: 'breakout_61_8_resistance', label: 'Breakout 61 8 Resistance' },
      { id: 'breakout_78_6_resistance', label: 'Breakout 78 6 Resistance' },
      { id: 'retracing_from_23_6_resistance', label: 'Retracing From 23 6 Resistance' },
      { id: 'retracing_from_38_2_resistance', label: 'Retracing From 38 2 Resistance' },
      { id: 'retracing_from_50_resistance', label: 'Retracing From 50 Resistance' },
      { id: 'retracing_from_61_8_resistance', label: 'Retracing From 61 8 Resistance' },
      { id: 'retracing_from_78_6_resistance', label: 'Retracing From 78 6 Resistance' },
    ],
  },
  'vwap': {
    'Price Cross Above': [
      { id: 'vwap_5min_cross_above', label: 'Vwap 5Min Cross Above' },
      { id: 'vwap_10min_cross_above', label: 'Vwap 10Min Cross Above' },
      { id: 'vwap_15min_cross_above', label: 'Vwap 15Min Cross Above' },
    ],
    'Price Cross Below': [
      { id: 'vwap_5min_cross_below', label: 'Vwap 5Min Cross Below' },
      { id: 'vwap_10min_cross_below', label: 'Vwap 10Min Cross Below' },
      { id: 'vwap_15min_cross_below', label: 'Vwap 15Min Cross Below' },
    ],
    'General Signals': [
      { id: 'vwap_trending_up_5_ticks', label: 'Vwap Trending Up 5 Ticks' },
      { id: 'vwap_trending_down_5_ticks', label: 'Vwap Trending Down 5 Ticks' },
    ],
  },
  'pivot-points': {
    'Pivot Points': [
      { id: 'list_support_resistance', label: 'List Support Resistance' },
      { id: 'price_above_r1', label: 'Price Above R1' },
      { id: 'price_above_r2', label: 'Price Above R2' },
      { id: 'price_above_r3', label: 'Price Above R3' },
      { id: 'price_below_s1', label: 'Price Below S1' },
      { id: 'price_below_s2', label: 'Price Below S2' },
      { id: 'price_below_s3', label: 'Price Below S3' },
      { id: 'camarilla_pivot_point_list', label: 'Camarilla Pivot Point List' },
      { id: 'fibonacci_pivot_point_list', label: 'Fibonacci Pivot Point List' },
      { id: 'woodie_pivot_point_list', label: 'Woodie Pivot Point List' },
      { id: 'demark_pivot_point_list', label: 'Demark Pivot Point List' },
    ],
  },
  'volatility': {
    'Bollinger Bands': [
      { id: 'price_above_bollinger_band', label: 'Price Above Bollinger Band' },
      { id: 'price_below_bollinger_band', label: 'Price Below Bollinger Band' },
      { id: 'narrowing_bollinger_band', label: 'Narrowing Bollinger Band' },
      { id: 'narrowing_bollinger_band_breakout', label: 'Narrowing Bollinger Band Breakout' },
      { id: 'narrowing_bollinger_band_breakdown', label: 'Narrowing Bollinger Band Breakdown' },
    ],
    'Volatility Overlay': [
      { id: 'price_crossed_above_central_line', label: 'Price Crossed Above Central Line' },
      { id: 'price_crossed_below_central_line', label: 'Price Crossed Below Central Line' },
      { id: 'price_above_psar', label: 'Price Above Psar' },
      { id: 'price_below_psar', label: 'Price Below Psar' },
      { id: 'psar_bullish_reversal', label: 'Psar Bullish Reversal' },
      { id: 'psar_bearish_reversal', label: 'Psar Bearish Reversal' },
      { id: 'price_above_ichimoku_cloud', label: 'Price Above Ichimoku Cloud' },
      { id: 'price_below_ichimoku_cloud', label: 'Price Below Ichimoku Cloud' },
      { id: 'price_within_ichimoku_cloud', label: 'Price Within Ichimoku Cloud' },
      { id: 'price_cross_above_ichimoku_cloud', label: 'Price Cross Above Ichimoku Cloud' },
      { id: 'price_cross_below_ichimoku_cloud', label: 'Price Cross Below Ichimoku Cloud' },
      { id: 'leading_span_a_cross_above_b', label: 'Leading Span A Cross Above B' },
      { id: 'leading_span_a_cross_below_b', label: 'Leading Span A Cross Below B' },
      { id: 'leading_span_a_above_b', label: 'Leading Span A Above B' },
      { id: 'leading_span_a_below_b', label: 'Leading Span A Below B' },
    ],
  },
  'trend-indicators': {
    'MACD': [
      { id: 'macd_cross_above_signal_line', label: 'Macd Cross Above Signal Line' },
      { id: 'macd_cross_below_signal_line', label: 'Macd Cross Below Signal Line' },
      { id: 'macd_above_zero_line', label: 'Macd Above Zero Line' },
      { id: 'macd_below_zero_line', label: 'Macd Below Zero Line' },
      { id: 'macd_bullish_divergence', label: 'Macd Bullish Divergence' },
      { id: 'macd_bearish_divergence', label: 'Macd Bearish Divergence' },
      { id: 'macd_histogram_bullish_divergence', label: 'Macd Histogram Bullish Divergence' },
      { id: 'macd_histogram_bearish_divergence', label: 'Macd Histogram Bearish Divergence' },
      { id: 'macd_signal_line_cross_above_zero_line', label: 'Macd Signal Line Cross Above Zero Line' },
      { id: 'macd_signal_line_cross_below_zero_line', label: 'Macd Signal Line Cross Below Zero Line' },
    ],
    'ADX': [
      { id: 'adx_mild_trending_stocks', label: 'Adx Mild Trending Stocks' },
      { id: 'adx_trending_stocks', label: 'Adx Trending Stocks' },
      { id: 'adx_strong_trending_stocks', label: 'Adx Strong Trending Stocks' },
      { id: 'adx_non_trending_stocks', label: 'Adx Non Trending Stocks' },
      { id: 'pdi_cross_above_mdi', label: 'Pdi Cross Above Mdi' },
      { id: 'mdi_cross_above_pdi', label: 'Mdi Cross Above Pdi' },
      { id: 'adx_bullish_divergence', label: 'Adx Bullish Divergence' },
      { id: 'adx_bearish_divergence', label: 'Adx Bearish Divergence' },
    ],
    'Supertrend': [
      { id: 'price_above_supertrend', label: 'Price Above Supertrend' },
      { id: 'price_below_supertrend', label: 'Price Below Supertrend' },
      { id: 'supertrend_bullish_reversal', label: 'Supertrend Bullish Reversal' },
      { id: 'supertrend_bearish_reversal', label: 'Supertrend Bearish Reversal' },
    ],
    'Trend Signals': [
      { id: 'awesome_oscillator_bullish_reversal', label: 'Awesome Oscillator Bullish Reversal' },
      { id: 'awesome_oscillator_bullish_saucer', label: 'Awesome Oscillator Bullish Saucer' },
      { id: 'awesome_oscillator_bullish_twin_peak', label: 'Awesome Oscillator Bullish Twin Peak' },
      { id: 'awesome_oscillator_bearish_reversal', label: 'Awesome Oscillator Bearish Reversal' },
      { id: 'awesome_oscillator_bearish_saucer', label: 'Awesome Oscillator Bearish Saucer' },
      { id: 'awesome_oscillator_bearish_twin_peak', label: 'Awesome Oscillator Bearish Twin Peak' },
      { id: 'awesome_oscillator_bullish_divergence', label: 'Awesome Oscillator Bullish Divergence' },
      { id: 'awesome_oscillator_bearish_divergence', label: 'Awesome Oscillator Bearish Divergence' },
      { id: 'rate_of_change_cross_above_zero', label: 'Rate Of Change Cross Above Zero' },
      { id: 'rate_of_change_cross_below_zero', label: 'Rate Of Change Cross Below Zero' },
      { id: 'rate_of_change_bullish_divergence', label: 'Rate Of Change Bullish Divergence' },
      { id: 'rate_of_change_bearish_divergence', label: 'Rate Of Change Bearish Divergence' },
    ],
  },
  'volume': {
    'Chaikin Money Flow (CMF)': [
      { id: 'cmf_very_strong_buying_pressure', label: 'Cmf Very Strong Buying Pressure' },
      { id: 'cmf_strong_buying_pressure', label: 'Cmf Strong Buying Pressure' },
      { id: 'cmf_some_buying_pressure', label: 'Cmf Some Buying Pressure' },
      { id: 'cmf_some_selling_pressure', label: 'Cmf Some Selling Pressure' },
      { id: 'cmf_strong_selling_pressure', label: 'Cmf Strong Selling Pressure' },
      { id: 'cmf_very_strong_selling_pressure', label: 'Cmf Very Strong Selling Pressure' },
      { id: 'cmf_bullish_trend_change', label: 'Cmf Bullish Trend Change' },
      { id: 'cmf_bearish_trend_change', label: 'Cmf Bearish Trend Change' },
      { id: 'cmf_bullish_divergence', label: 'Cmf Bullish Divergence' },
      { id: 'cmf_bearish_divergence', label: 'Cmf Bearish Divergence' },
    ],
  },
  'momentum-oscillators': {
    'RSI': [
      { id: 'rsi_overbought', label: 'Rsi Overbought' },
      { id: 'rsi_cross_below_central_line', label: 'Rsi Cross Below Central Line' },
      { id: 'rsi_overbought_for_more_than_3_days', label: 'Rsi Overbought For More Than 3 Days' },
      { id: 'rsi_oversold', label: 'Rsi Oversold' },
      { id: 'rsi_bullish_swing_rejection', label: 'Rsi Bullish Swing Rejection' },
      { id: 'rsi_cross_above_ma', label: 'Rsi Cross Above Ma' },
      { id: 'rsi_cross_above_central_line', label: 'Rsi Cross Above Central Line' },
      { id: 'rsi_double_bottom', label: 'Rsi Double Bottom' },
      { id: 'rsi_oversold_for_more_than_3_days', label: 'Rsi Oversold For More Than 3 Days' },
      { id: 'rsi_bullish_divergence', label: 'Rsi Bullish Divergence' },
      { id: 'rsi_bearish_divergence', label: 'Rsi Bearish Divergence' },
      { id: 'rsi_bearish_swing_rejection', label: 'Rsi Bearish Swing Rejection' },
      { id: 'rsi_cross_below_ma', label: 'Rsi Cross Below Ma' },
      { id: 'rsi_double_top', label: 'Rsi Double Top' },
      { id: 'rsi_fast_overbought', label: 'Rsi Fast Overbought' },
      { id: 'rsi_fast_cross_below_central_line', label: 'Rsi Fast Cross Below Central Line' },
      { id: 'rsi_fast_overbought_for_more_than_3_days', label: 'Rsi Fast Overbought For More Than 3 Days' },
      { id: 'rsi_fast_oversold', label: 'Rsi Fast Oversold' },
      { id: 'rsi_fast_bullish_swing_rejection', label: 'Rsi Fast Bullish Swing Rejection' },
      { id: 'rsi_fast_cross_above_ma', label: 'Rsi Fast Cross Above Ma' },
      { id: 'rsi_fast_cross_above_central_line', label: 'Rsi Fast Cross Above Central Line' },
      { id: 'rsi_fast_double_bottom', label: 'Rsi Fast Double Bottom' },
      { id: 'rsi_fast_oversold_for_more_than_3_days', label: 'Rsi Fast Oversold For More Than 3 Days' },
      { id: 'rsi_fast_bullish_divergence', label: 'Rsi Fast Bullish Divergence' },
      { id: 'rsi_fast_bearish_divergence', label: 'Rsi Fast Bearish Divergence' },
      { id: 'rsi_fast_bearish_swing_rejection', label: 'Rsi Fast Bearish Swing Rejection' },
      { id: 'rsi_fast_cross_below_ma', label: 'Rsi Fast Cross Below Ma' },
      { id: 'rsi_fast_double_top', label: 'Rsi Fast Double Top' },
    ],
    'Other Oscillators': [
      { id: 'overbought_falling_rsi', label: 'Overbought Falling Rsi' },
      { id: 'oversold_rising_rsi', label: 'Oversold Rising Rsi' },
      { id: 'overbought_falling_rsi_fast', label: 'Overbought Falling Rsi Fast' },
      { id: 'oversold_rising_rsi_fast', label: 'Oversold Rising Rsi Fast' },
      { id: 'overbought_falling_williams_r', label: 'Overbought Falling Williams R' },
      { id: 'oversold_rising_williams_r', label: 'Oversold Rising Williams R' },
      { id: 'overbought_falling_cci', label: 'Overbought Falling Cci' },
      { id: 'oversold_rising_cci', label: 'Oversold Rising Cci' },
      { id: 'overbought_falling_mfi', label: 'Overbought Falling Mfi' },
      { id: 'oversold_rising_mfi', label: 'Oversold Rising Mfi' },
      { id: 'overbought_falling_stochastic_fast', label: 'Overbought Falling Stochastic Fast' },
      { id: 'oversold_rising_stochastic_fast', label: 'Oversold Rising Stochastic Fast' },
      { id: 'overbought_falling_stochastic_slow', label: 'Overbought Falling Stochastic Slow' },
      { id: 'oversold_rising_stochastic_slow', label: 'Oversold Rising Stochastic Slow' },
      { id: 'overbought_falling_stochastic_rsi', label: 'Overbought Falling Stochastic Rsi' },
      { id: 'oversold_rising_stochastic_rsi', label: 'Oversold Rising Stochastic Rsi' },
      { id: 'overbought_falling_stochastic_rsi_fast', label: 'Overbought Falling Stochastic Rsi Fast' },
      { id: 'oversold_rising_stochastic_rsi_fast', label: 'Oversold Rising Stochastic Rsi Fast' },
      { id: 'ultimate_oscillator_overbought', label: 'Ultimate Oscillator Overbought' },
      { id: 'overbought_falling_ultimate_oscillator', label: 'Overbought Falling Ultimate Oscillator' },
      { id: 'ultimate_oscillator_cross_below_central_line', label: 'Ultimate Oscillator Cross Below Central Line' },
      { id: 'ultimate_oscillator_overbought_for_more_than_3_days', label: 'Ultimate Oscillator Overbought For More Than 3 Days' },
      { id: 'ultimate_oscillator_oversold', label: 'Ultimate Oscillator Oversold' },
      { id: 'ultimate_oscillator_cross_above_ma', label: 'Ultimate Oscillator Cross Above Ma' },
      { id: 'oversold_rising_ultimate_oscillator', label: 'Oversold Rising Ultimate Oscillator' },
      { id: 'ultimate_oscillator_cross_above_central_line', label: 'Ultimate Oscillator Cross Above Central Line' },
      { id: 'ultimate_oscillator_oversold_for_more_than_3_days', label: 'Ultimate Oscillator Oversold For More Than 3 Days' },
      { id: 'ultimate_oscillator_bullish_divergence', label: 'Ultimate Oscillator Bullish Divergence' },
      { id: 'ultimate_oscillator_bearish_divergence', label: 'Ultimate Oscillator Bearish Divergence' },
      { id: 'ultimate_oscillator_cross_below_ma', label: 'Ultimate Oscillator Cross Below Ma' },
      { id: 'aroon_oscillator_overbought', label: 'Aroon Oscillator Overbought' },
      { id: 'overbought_falling_aroon_oscillator', label: 'Overbought Falling Aroon Oscillator' },
      { id: 'aroon_oscillator_cross_below_central_line', label: 'Aroon Oscillator Cross Below Central Line' },
      { id: 'aroon_oscillator_overbought_for_more_than_3_days', label: 'Aroon Oscillator Overbought For More Than 3 Days' },
      { id: 'aroon_oscillator_oversold', label: 'Aroon Oscillator Oversold' },
      { id: 'aroon_oscillator_cross_above_ma', label: 'Aroon Oscillator Cross Above Ma' },
      { id: 'oversold_rising_aroon_oscillator', label: 'Oversold Rising Aroon Oscillator' },
      { id: 'aroon_oscillator_cross_above_central_line', label: 'Aroon Oscillator Cross Above Central Line' },
      { id: 'aroon_oscillator_oversold_for_more_than_3_days', label: 'Aroon Oscillator Oversold For More Than 3 Days' },
      { id: 'aroon_oscillator_bullish_divergence', label: 'Aroon Oscillator Bullish Divergence' },
      { id: 'aroon_oscillator_bearish_divergence', label: 'Aroon Oscillator Bearish Divergence' },
      { id: 'aroon_oscillator_cross_below_ma', label: 'Aroon Oscillator Cross Below Ma' },
    ],
    'Williams %R': [
      { id: 'williams_r_overbought', label: 'Williams R Overbought' },
      { id: 'williams_r_cross_below_central_line', label: 'Williams R Cross Below Central Line' },
      { id: 'williams_r_overbought_for_more_than_3_days', label: 'Williams R Overbought For More Than 3 Days' },
      { id: 'williams_r_oversold', label: 'Williams R Oversold' },
      { id: 'williams_r_cross_above_central_line', label: 'Williams R Cross Above Central Line' },
      { id: 'williams_r_oversold_for_more_than_3_days', label: 'Williams R Oversold For More Than 3 Days' },
      { id: 'williams_r_bullish_divergence', label: 'Williams R Bullish Divergence' },
      { id: 'williams_r_bearish_divergence', label: 'Williams R Bearish Divergence' },
    ],
    'CCI': [
      { id: 'cci_overbought', label: 'Cci Overbought' },
      { id: 'cci_cross_below_central_line', label: 'Cci Cross Below Central Line' },
      { id: 'cci_overbought_for_more_than_3_days', label: 'Cci Overbought For More Than 3 Days' },
      { id: 'cci_oversold', label: 'Cci Oversold' },
      { id: 'cci_cross_above_central_line', label: 'Cci Cross Above Central Line' },
      { id: 'cci_oversold_for_more_than_3_days', label: 'Cci Oversold For More Than 3 Days' },
      { id: 'cci_bullish_divergence', label: 'Cci Bullish Divergence' },
      { id: 'cci_bearish_divergence', label: 'Cci Bearish Divergence' },
      { id: 'cci_cross_below_ma', label: 'Cci Cross Below Ma' },
    ],
    'MFI': [
      { id: 'mfi_overbought', label: 'Mfi Overbought' },
      { id: 'mfi_cross_below_central_line', label: 'Mfi Cross Below Central Line' },
      { id: 'mfi_overbought_for_more_than_3_days', label: 'Mfi Overbought For More Than 3 Days' },
      { id: 'mfi_oversold', label: 'Mfi Oversold' },
      { id: 'mfi_cross_above_ma', label: 'Mfi Cross Above Ma' },
      { id: 'mfi_cross_above_central_line', label: 'Mfi Cross Above Central Line' },
      { id: 'mfi_oversold_for_more_than_3_days', label: 'Mfi Oversold For More Than 3 Days' },
      { id: 'mfi_bullish_divergence', label: 'Mfi Bullish Divergence' },
      { id: 'mfi_bearish_divergence', label: 'Mfi Bearish Divergence' },
      { id: 'mfi_cross_below_ma', label: 'Mfi Cross Below Ma' },
    ],
    'Stochastic': [
      { id: 'stochastic_fast_overbought', label: 'Stochastic Fast Overbought' },
      { id: 'stochastic_fast_cross_below_central_line', label: 'Stochastic Fast Cross Below Central Line' },
      { id: 'stochastic_fast_overbought_for_more_than_3_days', label: 'Stochastic Fast Overbought For More Than 3 Days' },
      { id: 'stochastic_fast_oversold', label: 'Stochastic Fast Oversold' },
      { id: 'stochastic_fast_k_above_d_crossover', label: 'Stochastic Fast K Above D Crossover' },
      { id: 'stochastic_fast_k_above_d_crossover_within', label: 'Stochastic Fast K Above D Crossover Within' },
      { id: 'stochastic_fast_cross_above_central_line', label: 'Stochastic Fast Cross Above Central Line' },
      { id: 'stochastic_fast_oversold_for_more_than_3_days', label: 'Stochastic Fast Oversold For More Than 3 Days' },
      { id: 'stochastic_fast_bullish_divergence', label: 'Stochastic Fast Bullish Divergence' },
      { id: 'stochastic_fast_bearish_divergence', label: 'Stochastic Fast Bearish Divergence' },
      { id: 'stochastic_fast_k_below_d_crossover', label: 'Stochastic Fast K Below D Crossover' },
      { id: 'stochastic_fast_k_below_d_crossover_within', label: 'Stochastic Fast K Below D Crossover Within' },
      { id: 'stochastic_slow_overbought', label: 'Stochastic Slow Overbought' },
      { id: 'stochastic_slow_cross_below_central_line', label: 'Stochastic Slow Cross Below Central Line' },
      { id: 'stochastic_slow_overbought_for_more_than_3_days', label: 'Stochastic Slow Overbought For More Than 3 Days' },
      { id: 'stochastic_slow_oversold', label: 'Stochastic Slow Oversold' },
      { id: 'stochastic_slow_k_above_d_crossover', label: 'Stochastic Slow K Above D Crossover' },
      { id: 'stochastic_slow_k_above_d_crossover_within', label: 'Stochastic Slow K Above D Crossover Within' },
      { id: 'stochastic_slow_cross_above_central_line', label: 'Stochastic Slow Cross Above Central Line' },
      { id: 'stochastic_slow_oversold_for_more_than_3_days', label: 'Stochastic Slow Oversold For More Than 3 Days' },
      { id: 'stochastic_slow_bullish_divergence', label: 'Stochastic Slow Bullish Divergence' },
      { id: 'stochastic_slow_bearish_divergence', label: 'Stochastic Slow Bearish Divergence' },
      { id: 'stochastic_slow_k_below_d_crossover', label: 'Stochastic Slow K Below D Crossover' },
      { id: 'stochastic_slow_k_below_d_crossover_within', label: 'Stochastic Slow K Below D Crossover Within' },
    ],
    'Stochastic RSI': [
      { id: 'stochastic_rsi_overbought', label: 'Stochastic Rsi Overbought' },
      { id: 'stochastic_rsi_cross_below_central_line', label: 'Stochastic Rsi Cross Below Central Line' },
      { id: 'stochastic_rsi_overbought_for_more_than_3_days', label: 'Stochastic Rsi Overbought For More Than 3 Days' },
      { id: 'stochastic_rsi_oversold', label: 'Stochastic Rsi Oversold' },
      { id: 'stochastic_rsi_k_above_d_crossover', label: 'Stochastic Rsi K Above D Crossover' },
      { id: 'stochastic_rsi_k_above_d_crossover_within', label: 'Stochastic Rsi K Above D Crossover Within' },
      { id: 'stochastic_rsi_cross_above_central_line', label: 'Stochastic Rsi Cross Above Central Line' },
      { id: 'stochastic_rsi_oversold_for_more_than_3_days', label: 'Stochastic Rsi Oversold For More Than 3 Days' },
      { id: 'stochastic_rsi_bullish_divergence', label: 'Stochastic Rsi Bullish Divergence' },
      { id: 'stochastic_rsi_bearish_divergence', label: 'Stochastic Rsi Bearish Divergence' },
      { id: 'stochastic_rsi_k_below_d_crossover', label: 'Stochastic Rsi K Below D Crossover' },
      { id: 'stochastic_rsi_k_below_d_crossover_within', label: 'Stochastic Rsi K Below D Crossover Within' },
      { id: 'stochastic_rsi_fast_overbought', label: 'Stochastic Rsi Fast Overbought' },
      { id: 'stochastic_rsi_fast_cross_below_central_line', label: 'Stochastic Rsi Fast Cross Below Central Line' },
      { id: 'stochastic_rsi_fast_overbought_for_more_than_3_days', label: 'Stochastic Rsi Fast Overbought For More Than 3 Days' },
      { id: 'stochastic_rsi_fast_oversold', label: 'Stochastic Rsi Fast Oversold' },
      { id: 'stochastic_rsi_fast_k_above_d_crossover_within', label: 'Stochastic Rsi Fast K Above D Crossover Within' },
      { id: 'stochastic_rsi_fast_cross_above_central_line', label: 'Stochastic Rsi Fast Cross Above Central Line' },
      { id: 'stochastic_rsi_fast_oversold_for_more_than_3_days', label: 'Stochastic Rsi Fast Oversold For More Than 3 Days' },
      { id: 'stochastic_rsi_fast_bullish_divergence', label: 'Stochastic Rsi Fast Bullish Divergence' },
      { id: 'stochastic_rsi_fast_bearish_divergence', label: 'Stochastic Rsi Fast Bearish Divergence' },
      { id: 'stochastic_rsi_fast_k_below_d_crossover', label: 'Stochastic Rsi Fast K Below D Crossover' },
    ],
  },
  'price-action': {
    'Narrow Range': [
      { id: 'is_nr4', label: 'NR4 (Narrow Range 4)' },
      { id: 'is_nr7', label: 'NR7 (Narrow Range 7)' },
    ],
    'Day Breakouts': [
      { id: 'prev_day_open_breakout', label: 'Previous Day Open Breakout' },
      { id: 'prev_day_high_breakout', label: 'Previous Day High Breakout' },
      { id: 'prev_day_low_breakout', label: 'Previous Day Low Breakout' },
    ],
    'Range Breakouts': [
      { id: 'range_high_breakout', label: 'Range High Breakout' },
      { id: 'range_low_breakout', label: 'Range Low Breakout' },
    ],
    'Crossovers': [
      { id: 'bullish_cross', label: 'Bullish Cross' },
      { id: 'bearish_cross', label: 'Bearish Cross' },
    ],
    'VWAP & Volume': [
      { id: 'vwap_breakout', label: 'VWAP Breakout' },
      { id: 'volume_shocker', label: 'Volume Shocker' },
    ],
  },
};

export interface ConditionMetadata {
  description: string;
  tags: string[];
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
}

export const CONDITION_METADATA: Record<string, ConditionMetadata> = {
  // Price Action
  'is_nr4': {
    description: 'Stocks trading in the narrowest range of the last 4 days. This contraction in volatility typically precedes an explosive breakout move.',
    tags: ['Volatility Squeeze', 'Breakout'],
    sentiment: 'Bullish'
  },
  'is_nr7': {
    description: 'Stocks consolidating in the tightest 7-day range. Volatility is highly contracted, signaling a high-probability breakout is imminent.',
    tags: ['Volatility Squeeze', 'Breakout'],
    sentiment: 'Bullish'
  },
  'prev_day_high_breakout': {
    description: "Price has broken above the previous day's high, confirming strong intraday buyer dominance and potential continuation upward.",
    tags: ['Price Action', 'Breakout', 'Momentum'],
    sentiment: 'Bullish'
  },
  'prev_day_low_breakout': {
    description: "Price has broken below the previous day's low, indicating strong selling pressure and potential further downward momentum.",
    tags: ['Price Action', 'Breakdown', 'Momentum'],
    sentiment: 'Bearish'
  },
  'prev_day_open_breakout': {
    description: "Price has broken out significantly from the prior day's opening price, highlighting strong intraday trend formation.",
    tags: ['Price Action', 'Breakout'],
    sentiment: 'Bullish'
  },
  'range_high_breakout': {
    description: 'Price has broken above a multi-day consolidation high range, signaling strength and a new bullish trend starting.',
    tags: ['Range Breakout', 'Trend Start'],
    sentiment: 'Bullish'
  },
  'range_low_breakout': {
    description: 'Price has broken below a multi-day support range low, indicating trend breakdown and possible continuation of a bearish phase.',
    tags: ['Range Breakdown', 'Trend Start'],
    sentiment: 'Bearish'
  },
  'bullish_cross': {
    description: 'Short-term indicator or moving average has crossed above a long-term one, indicating buyers are gaining control and the trend is turning positive.',
    tags: ['Crossover', 'Trend Reversal'],
    sentiment: 'Bullish'
  },
  'bearish_cross': {
    description: 'Short-term indicator or moving average has crossed below a long-term one, signaling sellers are gaining control and the trend is turning negative.',
    tags: ['Crossover', 'Trend Reversal'],
    sentiment: 'Bearish'
  },
  'vwap_breakout': {
    description: 'Price has crossed above the Volume Weighted Average Price (VWAP), showing that current buying momentum is stronger than the daily average.',
    tags: ['VWAP', 'Intraday Strength'],
    sentiment: 'Bullish'
  },
  'volume_shocker': {
    description: 'Trading volume has spiked significantly compared to its 20-day average, indicating massive institutional participation and a potential major price expansion.',
    tags: ['Volume', 'Institutional Buying'],
    sentiment: 'Bullish'
  }
};

export const getConditionMetadata = (indicatorId: string, conditionId: string, label: string = ''): ConditionMetadata => {
  // 1. Check explicit registry
  if (CONDITION_METADATA[conditionId]) {
    return CONDITION_METADATA[conditionId];
  }

  // 2. Generate dynamic fallback based on keywords
  const condLower = conditionId.toLowerCase();
  
  let sentiment: 'Bullish' | 'Bearish' | 'Neutral' = 'Neutral';
  let description = '';
  let tags: string[] = [];

  // Determine sentiment
  if (condLower.includes('cross_above') || condLower.includes('above') || condLower.includes('bullish') || condLower.includes('crossover_above') || condLower.includes('rising') || condLower.includes('oversold') || condLower.includes('support') || condLower.includes('breakout') || condLower.includes('gap_up') || condLower.includes('green')) {
    sentiment = 'Bullish';
  } else if (condLower.includes('cross_below') || condLower.includes('below') || condLower.includes('bearish') || condLower.includes('crossover_below') || condLower.includes('falling') || condLower.includes('overbought') || condLower.includes('resistance') || condLower.includes('breakdown') || condLower.includes('gap_down') || condLower.includes('red')) {
    sentiment = 'Bearish';
  }

  // Build descriptive tags and texts
  if (indicatorId === 'ema' || indicatorId === 'sma' || indicatorId === 'wma') {
    const maName = indicatorId.toUpperCase();
    const periodMatch = condLower.match(/\d+/);
    const period = periodMatch ? periodMatch[0] : 'selected';
    
    tags.push(maName, 'Moving Average');
    if (condLower.includes('cross_above')) {
      description = `Price has crossed above the ${period}-period ${maName}. This is a bullish momentum breakout signal indicating a potential upward trend.`;
      tags.push('Crossover', 'Momentum');
    } else if (condLower.includes('cross_below')) {
      description = `Price has crossed below the ${period}-period ${maName}. This is a bearish momentum breakdown signal indicating potential downward continuation.`;
      tags.push('Crossover', 'Momentum');
    } else if (condLower.includes('above')) {
      description = `Price is currently trading above the ${period}-period ${maName}, which acts as dynamic support for the ongoing bullish trend.`;
      tags.push('Support', 'Trend Following');
    } else if (condLower.includes('below')) {
      description = `Price is currently trading below the ${period}-period ${maName}, which acts as dynamic resistance for the ongoing bearish trend.`;
      tags.push('Resistance', 'Trend Following');
    } else {
      description = `Moving average crossover condition involving the ${period}-period ${maName} to identify trend shifts.`;
      tags.push('Crossover');
    }
  } else if (indicatorId === 'momentum-oscillators') {
    tags.push('Oscillator');
    if (condLower.includes('rsi')) {
      tags.push('RSI');
    } else if (condLower.includes('stochastic')) {
      tags.push('Stochastic');
    } else if (condLower.includes('cci')) {
      tags.push('CCI');
    } else if (condLower.includes('mfi')) {
      tags.push('MFI');
    }
    
    if (condLower.includes('overbought')) {
      description = `The momentum oscillator indicates overbought conditions. Buying pressure may be overextended, signaling potential pullback or consolidation.`;
      tags.push('Overbought', 'Pullback');
    } else if (condLower.includes('oversold')) {
      description = `The momentum oscillator indicates oversold conditions. Selling pressure may be overextended, suggesting a potential bullish bounce.`;
      tags.push('Oversold', 'Bounce');
    } else if (condLower.includes('divergence')) {
      description = `Bullish or bearish divergence detected between price movements and the oscillator, indicating a probable momentum shift.`;
      tags.push('Divergence', 'Reversal');
    } else {
      description = `Momentum oscillator condition: ${label || conditionId} indicating volatility or strength levels.`;
      tags.push('Momentum');
    }
  } else if (indicatorId === 'ohlc') {
    tags.push('OHLC Patterns', 'Price Action');
    if (condLower.includes('open_equals_low')) {
      description = 'Open equals Low indicates that buyers took aggressive charge right from the opening bell, leading to strong intraday buying pressure.';
      tags.push('Bullish', 'Open=Low');
    } else if (condLower.includes('open_equals_high')) {
      description = 'Open equals High indicates that sellers dominated right from the market open, driving the price down throughout the session.';
      tags.push('Bearish', 'Open=High');
    } else if (condLower.includes('gap')) {
      description = 'A gap-up or gap-down indicates a strong imbalance between supply and demand overnight, creating opening price voids.';
      tags.push('Gap Window');
    } else {
      description = `OHLC candlestick pattern: ${label || conditionId} reflecting price relationships and market participant actions.`;
    }
  } else {
    // General fallback
    description = `Technical analysis condition: ${label || conditionId} used to identify key breakout, crossover, or support/resistance zones.`;
    tags.push('Technical');
    if (sentiment !== 'Neutral') {
      tags.push(sentiment);
    }
  }

  return {
    description,
    tags,
    sentiment
  };
};

