import { beforeEach, describe, expect, it } from 'vitest';
import { resolveCommandActionRoute } from '../services/CommandActionRoutingService';
import { useNavigationIntentStore } from '../store/navigationIntentStore';
import {
  clearConfirmedBrokerExecutionHandoffs,
  clearMatchedBrokerExecutionHandoffs,
  getActiveBrokerExecutionHandoffs,
  registerBrokerExecutionHandoff,
} from '../services/BrokerExecutionHandoffService';

describe('preservation regression tests', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useNavigationIntentStore.getState().clearIntent();
  });

  describe('command action routing', () => {
    it('routes standardized premium actions correctly', () => {
      // Portfolio & Broker Lane
      expect(resolveCommandActionRoute('broker-sync')).toEqual({ category: 'portfolio', subTab: 'portfolio' });
      expect(resolveCommandActionRoute('broker-verify')).toEqual({ category: 'portfolio', subTab: 'portfolio' });
      expect(resolveCommandActionRoute('rebalance')).toEqual({ category: 'portfolio', subTab: 'portfolio' });
      expect(resolveCommandActionRoute('portfolio-rebalance')).toEqual({ category: 'portfolio', subTab: 'portfolio' });
      expect(resolveCommandActionRoute('deploy-cash')).toEqual({ category: 'portfolio', subTab: 'portfolio' });
      expect(resolveCommandActionRoute('cash-deployment')).toEqual({ category: 'portfolio', subTab: 'portfolio' });
      expect(resolveCommandActionRoute('idle-cash')).toEqual({ category: 'portfolio', subTab: 'portfolio' });
      expect(resolveCommandActionRoute('tax-harvest')).toEqual({ category: 'portfolio', subTab: 'portfolio' });
      expect(resolveCommandActionRoute('tax-harvesting')).toEqual({ category: 'portfolio', subTab: 'portfolio' });

      // Journal & Coaching
      expect(resolveCommandActionRoute('trade-review')).toEqual({ category: 'journal', subTab: 'journal' });
      expect(resolveCommandActionRoute('journal-coach')).toEqual({ category: 'journal', subTab: 'journal' });
      expect(resolveCommandActionRoute('journal-coaching')).toEqual({ category: 'journal', subTab: 'journal' });

      // Alpha Engine
      expect(resolveCommandActionRoute('alpha-screener')).toEqual({ category: 'alpha', subTab: 'screener' });
      expect(resolveCommandActionRoute('alpha-shadow')).toEqual({ category: 'alpha', subTab: 'screener' });
      expect(resolveCommandActionRoute('search_stock')).toEqual({ category: 'alpha', subTab: 'screener' });
      expect(resolveCommandActionRoute('add-from-alpha')).toEqual({ category: 'alpha', subTab: 'screener' });

      // Backtester
      expect(resolveCommandActionRoute('backtest-run')).toEqual({ category: 'backtester', subTab: 'backtester' });

      // Fallback
      expect(resolveCommandActionRoute('unknown-action')).toEqual({ category: 'dashboard', subTab: 'dashboard' });
    });
  });

  describe('navigation intent storage', () => {
    it('successfully handles extended premium intent targets', () => {
      useNavigationIntentStore.getState().setIntent({
        target: 'alpha',
        action: 'search_stock',
        createdAt: 100,
        payload: { symbol: 'RELIANCE' }
      });
      expect(useNavigationIntentStore.getState().intent).toEqual({
        target: 'alpha',
        action: 'search_stock',
        createdAt: 100,
        payload: { symbol: 'RELIANCE' }
      });

      useNavigationIntentStore.getState().setIntent({
        target: 'backtester',
        action: 'backtest-run',
        createdAt: 200,
        payload: { strategyId: 'premium-momentum' }
      });
      expect(useNavigationIntentStore.getState().intent?.target).toBe('backtester');
      expect(useNavigationIntentStore.getState().intent?.action).toBe('backtest-run');

      useNavigationIntentStore.getState().clearIntent();
      expect(useNavigationIntentStore.getState().intent).toBeNull();
    });
  });

  describe('broker execution handoffs', () => {
    it('registers and filters active execution handoffs accurately', () => {
      registerBrokerExecutionHandoff('TCS', 'BUY', 'algo', 1000);
      registerBrokerExecutionHandoff('INFY', 'SELL', 'manual', 2000);

      // Verify active handoffs within active window (sorted descending by createdAt)
      const active = getActiveBrokerExecutionHandoffs(2500);
      expect(active).toHaveLength(2);
      expect(active[0].ticker).toBe('INFY');
      expect(active[1].ticker).toBe('TCS');

      // Verify expiration TTL (expires after 15 minutes / 900000ms)
      const activeLater = getActiveBrokerExecutionHandoffs(1000000);
      expect(activeLater).toHaveLength(0);
    });

    it('matches and clears broker execution handoffs correctly', () => {
      registerBrokerExecutionHandoff('SBIN', 'BUY', 'scale', 5000);
      registerBrokerExecutionHandoff('HDFC', 'SELL', 'hedge', 6000);

      const cleared = clearMatchedBrokerExecutionHandoffs([
        { ticker: 'SBIN', action: 'BUY' }
      ], 7000);

      expect(cleared).toBe(1);
      const remaining = getActiveBrokerExecutionHandoffs(7000);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].ticker).toBe('HDFC');
    });
  });
});
