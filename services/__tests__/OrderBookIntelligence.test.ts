import { describe, it, expect } from 'vitest';
import { orderBookIntelligenceService } from '../OrderBookIntelligenceService';
import { DepthLevel } from '../UpstoxWebSocketService';

describe('OrderBookIntelligenceService', () => {
  it('should compute CONTINUE signal for strong bid wall + no ask wall + high volume', () => {
    const buy: DepthLevel[] = [
      { price: 100, quantity: 5000, orders: 0 },
      { price: 99.5, quantity: 1000, orders: 0 },
      { price: 99.0, quantity: 800, orders: 0 },
      { price: 98.5, quantity: 700, orders: 0 },
      { price: 98.0, quantity: 500, orders: 0 },
    ];
    const sell: DepthLevel[] = [
      { price: 100.5, quantity: 800, orders: 0 },
      { price: 101.0, quantity: 700, orders: 0 },
      { price: 101.5, quantity: 600, orders: 0 },
      { price: 102.0, quantity: 500, orders: 0 },
      { price: 102.5, quantity: 400, orders: 0 },
    ];

    const tick = {
      instrument_key: 'TEST_STOCK_1',
      timestamp: new Date().toISOString(),
      ltp: 100.2,
      close: 100,
      volume: 10000,
      oi: 0,
      iv: 0,
      greeks: null,
      depth: { buy, sell }
    };

    const result = orderBookIntelligenceService.processDepthTick(tick, 2.0, 0.8);

    expect(result.momentumContinuationScore).toBeGreaterThanOrEqual(70);
    expect(result.signal).toBe('CONTINUE');
  });

  it('should compute REVERSAL_RISK signal for large ask wall + weak bids', () => {
    const buy: DepthLevel[] = [
      { price: 99.8, quantity: 500, orders: 0 },
      { price: 99.5, quantity: 400, orders: 0 },
      { price: 99.0, quantity: 300, orders: 0 },
      { price: 98.5, quantity: 200, orders: 0 },
      { price: 98.0, quantity: 100, orders: 0 },
    ];
    const sell: DepthLevel[] = [
      { price: 100.2, quantity: 6000, orders: 0 },
      { price: 100.5, quantity: 800, orders: 0 },
      { price: 101.0, quantity: 700, orders: 0 },
      { price: 101.5, quantity: 600, orders: 0 },
      { price: 102.0, quantity: 500, orders: 0 },
    ];

    const tick = {
      instrument_key: 'TEST_STOCK_2',
      timestamp: new Date().toISOString(),
      ltp: 100.0,
      close: 100,
      volume: 10000,
      oi: 0,
      iv: 0,
      greeks: null,
      depth: { buy, sell }
    };

    const result = orderBookIntelligenceService.processDepthTick(tick, 1.0, 0.1);

    expect(result.momentumContinuationScore).toBeLessThan(50);
    expect(result.signal).toBe('REVERSAL_RISK');
  });

  it('should compute CAUTION signal for balanced order book and normal volume', () => {
    const buy: DepthLevel[] = [
      { price: 99.8, quantity: 1000, orders: 0 },
      { price: 99.5, quantity: 1000, orders: 0 },
      { price: 99.0, quantity: 1000, orders: 0 },
      { price: 98.5, quantity: 1000, orders: 0 },
      { price: 98.0, quantity: 1000, orders: 0 },
    ];
    const sell: DepthLevel[] = [
      { price: 100.2, quantity: 1000, orders: 0 },
      { price: 100.5, quantity: 1000, orders: 0 },
      { price: 101.0, quantity: 1000, orders: 0 },
      { price: 101.5, quantity: 1000, orders: 0 },
      { price: 102.0, quantity: 1000, orders: 0 },
    ];

    const tick = {
      instrument_key: 'TEST_STOCK_3',
      timestamp: new Date().toISOString(),
      ltp: 100.0,
      close: 100,
      volume: 10000,
      oi: 0,
      iv: 0,
      greeks: null,
      depth: { buy, sell }
    };

    const result = orderBookIntelligenceService.processDepthTick(tick, 1.0, 0.2);

    expect(result.signal).toBe('CAUTION');
  });
});
