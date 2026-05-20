import { describe, expect, it } from 'vitest';
import { buildOrderPreflight, buildOrderPreviewFingerprint, isOrderPreviewFresh } from '../services/DhanOrderService';
import { DhanOrderRequest } from '../services/DhanBrokerService';

const baseRequest: DhanOrderRequest = {
  transactionType: 'BUY',
  exchangeSegment: 'NSE_EQ',
  productType: 'INTRADAY',
  orderType: 'MARKET',
  validity: 'DAY',
  tradingSymbol: 'RELIANCE',
  securityId: '2885',
  quantity: 100,
  price: 0,
};

describe('dhan order preflight', () => {
  it('blocks orders that exceed available buying power', () => {
    const result = buildOrderPreflight({
      request: baseRequest,
      estimatedPrice: 2500,
      totalAssets: 1_000_000,
      currentTickerExposure: 50_000,
      availableBalance: 100_000,
      requiredMargin: 180_000,
      vix: 16,
    });

    expect(result.issues.some((issue) => issue.code === 'insufficient-balance' && issue.blocking)).toBe(true);
  });

  it('flags concentration and weak risk reward without blocking by default', () => {
    const result = buildOrderPreflight({
      request: {
        ...baseRequest,
        productType: 'BO',
        orderType: 'LIMIT',
        price: 2500,
      },
      estimatedPrice: 2500,
      totalAssets: 800_000,
      currentTickerExposure: 120_000,
      availableBalance: 300_000,
      requiredMargin: 90_000,
      vix: 26,
      stopLossPoints: 10,
      targetPoints: 8,
    });

    expect(result.projectedTickerExposurePercent).toBeGreaterThan(35);
    expect(result.issues.some((issue) => issue.code === 'high-concentration')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'weak-risk-reward')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'leveraged-volatility')).toBe(true);
  });

  it('treats previews as stale when the order draft changes or they age out', () => {
    const fingerprint = buildOrderPreviewFingerprint(baseRequest, { currentPrice: 2500 });

    expect(isOrderPreviewFresh(fingerprint, fingerprint, Date.now())).toBe(true);
    expect(isOrderPreviewFresh(fingerprint, buildOrderPreviewFingerprint({ ...baseRequest, quantity: 101 }, { currentPrice: 2500 }), Date.now())).toBe(false);
    expect(isOrderPreviewFresh(fingerprint, fingerprint, Date.now() - 91_000)).toBe(false);
  });

  it('maps TATAMOTRS and TATAMOTORS to security ID 3456', async () => {
    const { SECURITY_IDS } = await import('../services/DhanBrokerService');
    expect(SECURITY_IDS['TATAMOTRS']).toBeDefined();
    expect(SECURITY_IDS['TATAMOTRS'].id).toBe('3456');
    expect(SECURITY_IDS['TATAMOTORS']).toBeDefined();
    expect(SECURITY_IDS['TATAMOTORS'].id).toBe('3456');
  });

  it('safely handles sandbox placeOrder with TATAMOTRS without live broker traffic', async () => {
    const { dhanBrokerService } = await import('../services/DhanBrokerService');
    const { useSandboxStore } = await import('../store/sandboxStore');
    
    // Ensure sandbox mode is enabled
    useSandboxStore.setState({ isSandboxMode: true });

    const orderRes = await dhanBrokerService.placeOrder({
      transactionType: 'BUY',
      exchangeSegment: 'NSE_EQ',
      productType: 'BO',
      orderType: 'LIMIT',
      validity: 'DAY',
      tradingSymbol: 'TATAMOTRS',
      securityId: '',
      quantity: 1,
      price: 980,
      boProfitValue: 15,
      boStopLossValue: 10,
    });

    expect(orderRes.isSandbox).toBe(true);
    expect(orderRes.orderId).toContain('SANDBOX-');
    expect(orderRes.orderStatus).toBe('TRANSIT');
  });
});

