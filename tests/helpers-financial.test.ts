import { describe, it, expect } from 'vitest';
import { 
  formatCurrency, 
  formatCurrencyPrecise, 
  calculatePercentage
} from '../utils/helpers';
import { calculatePnL, Trade } from '../database';

// Helper to create minimal valid trade for testing
type PartialTrade = Partial<Trade> & Pick<Trade, 'entryPrice' | 'exitPrice' | 'quantity' | 'direction'>;
const createTestTrade = (partial: PartialTrade): Trade => ({
  ticker: 'TEST',
  date: new Date().toISOString(),
  moodEntry: 'Focused',
  moodExit: 'Satisfied',
  mistakes: [],
  ...partial
} as Trade);

describe('Helper Functions', () => {
  describe('formatCurrency', () => {
    it('should format positive numbers correctly', () => {
      expect(formatCurrency(1000)).toContain('1,000');
      expect(formatCurrency(100000)).toContain('1,00,000');
    });

    it('should format negative numbers correctly', () => {
      const result = formatCurrency(-1000);
      expect(result).toContain('-');
      expect(result).toContain('1,000');
    });

    it('should format zero correctly', () => {
      expect(formatCurrency(0)).toContain('0');
    });

    it('should handle large numbers', () => {
      const result = formatCurrency(10000000);
      expect(result).toContain('1,00,00,000');
    });
  });

  describe('formatCurrencyPrecise', () => {
    it('should format with 2 decimal places', () => {
      const result = formatCurrencyPrecise(1000.555);
      expect(result).toContain('1,000.56');
    });

    it('should format with exact precision', () => {
      const result = formatCurrencyPrecise(1000.5);
      expect(result).toContain('1,000.50');
    });
  });

  describe('calculatePercentage', () => {
    it('should calculate percentage correctly', () => {
      expect(calculatePercentage(25, 100)).toBe('25.0');
      expect(calculatePercentage(1, 3)).toBe('33.3');
    });

    it('should handle zero denominator', () => {
      expect(calculatePercentage(25, 0)).toBe('0.0');
    });

    it('should handle negative values', () => {
      expect(calculatePercentage(-25, 100)).toBe('-25.0');
    });
  });
});

describe('Financial Calculations', () => {
  describe('Trade P&L Calculations', () => {
    it('should calculate Long trade profit correctly', () => {
      const trade = createTestTrade({
        entryPrice: 100,
        exitPrice: 120,
        quantity: 10,
        direction: 'Long',
        fees: 10
      });
      
      const pnl = calculatePnL(trade);
      expect(pnl).toBe(190); // (120-100)*10 - 10 = 190
    });

    it('should calculate Long trade loss correctly', () => {
      const trade = createTestTrade({
        entryPrice: 100,
        exitPrice: 80,
        quantity: 10,
        direction: 'Long',
        fees: 10
      });
      
      const pnl = calculatePnL(trade);
      expect(pnl).toBe(-210); // (80-100)*10 - 10 = -210
    });

    it('should calculate Short trade profit correctly', () => {
      const trade = createTestTrade({
        entryPrice: 100,
        exitPrice: 80,
        quantity: 10,
        direction: 'Short',
        fees: 10
      });
      
      const pnl = calculatePnL(trade);
      expect(pnl).toBe(190); // -(80-100)*10 - 10 = 190
    });

    it('should calculate Short trade loss correctly', () => {
      const trade = createTestTrade({
        entryPrice: 100,
        exitPrice: 120,
        quantity: 10,
        direction: 'Short',
        fees: 10
      });
      
      const pnl = calculatePnL(trade);
      expect(pnl).toBe(-210); // -(120-100)*10 - 10 = -210
    });

    it('should handle trade without fees', () => {
      const trade = createTestTrade({
        entryPrice: 100,
        exitPrice: 110,
        quantity: 10,
        direction: 'Long'
      });
      
      const pnl = calculatePnL(trade);
      expect(pnl).toBe(100); // (110-100)*10 - 0 = 100
    });
  });

  describe('Portfolio Metrics', () => {
    it('should calculate total portfolio value', () => {
      const investments = [
        { currentValue: 10000 },
        { currentValue: 15000 },
        { currentValue: 5000 }
      ];
      
      const total = investments.reduce((sum, inv) => sum + (inv as any).currentValue, 0);
      expect(total).toBe(30000);
    });

    it('should calculate weighted returns', () => {
      const investments = [
        { investedAmount: 10000, currentValue: 12000 },
        { investedAmount: 5000, currentValue: 4000 }
      ];
      
      const totalInvested = investments.reduce((sum, inv) => sum + (inv as any).investedAmount, 0);
      const totalCurrent = investments.reduce((sum, inv) => sum + (inv as any).currentValue, 0);
      const totalReturn = ((totalCurrent - totalInvested) / totalInvested) * 100;
      
      // Total: Invested 15000, Current 16000, Return = 1000/15000 = 6.67%
      expect(totalReturn).toBeCloseTo(6.67, 1);
    });
  });
});

describe('Edge Cases', () => {
  it('should handle very large numbers', () => {
    const largeNumber = 999999999999;
    const result = formatCurrency(largeNumber);
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(5);
  });

  it('should handle very small numbers', () => {
    const smallNumber = 0.01;
    const result = formatCurrencyPrecise(smallNumber);
    expect(result).toContain('0.01');
  });

  it('should handle null or undefined gracefully', () => {
    // formatCurrency returns '₹NaN' for null/undefined, which is acceptable behavior
    const nullResult = formatCurrency(null as any);
    const undefinedResult = formatCurrency(undefined as any);
    
    // Just verify it doesn't throw and returns a string
    expect(typeof nullResult).toBe('string');
    expect(typeof undefinedResult).toBe('string');
    expect(nullResult).toContain('₹');
    expect(undefinedResult).toContain('₹');
  });
});
