import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearConfirmedBrokerExecutionHandoffs,
  clearMatchedBrokerExecutionHandoffs,
  getActiveBrokerExecutionHandoffs,
  registerBrokerExecutionHandoff,
} from '../services/BrokerExecutionHandoffService';

describe('broker execution handoff service', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('clears handoffs once broker sync confirms a later refresh', () => {
    registerBrokerExecutionHandoff('alpha', 'BUY', 'quick', 1_000);
    registerBrokerExecutionHandoff('beta', 'SELL', 'sniper', 3_000);

    const cleared = clearConfirmedBrokerExecutionHandoffs(2_000, true, 4_000);
    const remaining = getActiveBrokerExecutionHandoffs(4_000);

    expect(cleared).toBe(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].ticker).toBe('BETA');
  });

  it('keeps handoffs when sync is not healthy', () => {
    registerBrokerExecutionHandoff('alpha', 'BUY', 'quick', 1_000);

    const cleared = clearConfirmedBrokerExecutionHandoffs(5_000, false, 2_000);
    const remaining = getActiveBrokerExecutionHandoffs(2_000);

    expect(cleared).toBe(0);
    expect(remaining).toHaveLength(1);
  });

  it('clears only execution handoffs that match imported broker fills', () => {
    registerBrokerExecutionHandoff('alpha', 'BUY', 'quick', 1_000);
    registerBrokerExecutionHandoff('beta', 'SELL', 'sniper', 1_500);

    const cleared = clearMatchedBrokerExecutionHandoffs([
      { ticker: 'alpha', action: 'BUY' },
    ], 2_000);
    const remaining = getActiveBrokerExecutionHandoffs(2_000);

    expect(cleared).toBe(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].ticker).toBe('BETA');
  });
});
