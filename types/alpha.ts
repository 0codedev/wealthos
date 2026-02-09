export interface OREResult {
  symbol: string;
  oreScore: number;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  bsr?: number;
  vs?: number;
  cd?: number;
  compression?: number;
  timestamp?: number;
}
