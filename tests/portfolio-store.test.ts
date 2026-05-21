import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock settingsStore to return 0 loan principal for portfolio calculation tests
vi.mock('../store/settingsStore', () => {
  const mockStore = {
    getState: vi.fn(() => ({ loanPrincipal: 0 })),
    subscribe: vi.fn(() => () => {})
  };
  return {
    useSettingsStore: mockStore
  };
});

import { usePortfolioStore } from '../store/portfolioStore';
import { db } from '../database';
import { Investment, InvestmentType } from '../types';

// Mock Dexie database
// NOTE: deleteInvestment routes through lib/deleteWithUndo, which requires
// softDelete/restore on the target table and .toArray() on every cascade
// where().equals() chain (the old mock only exposed delete(), so the store
// threw 'Soft-delete failed for investment.').
vi.mock('../database', () => ({
  db: {
    investments: {
      toArray: vi.fn(),
      add: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      softDelete: vi.fn().mockResolvedValue(undefined),
      restore: vi.fn().mockResolvedValue(undefined)
    },
    history: {
      toArray: vi.fn()
    },
    life_events: {
      toArray: vi.fn(),
      add: vi.fn(),
      delete: vi.fn()
    },
    realized_transactions: {
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          delete: vi.fn().mockResolvedValue(undefined),
          toArray: vi.fn().mockResolvedValue([])
        })
      })
    }
  }
}));

// Mock liveQuery
vi.mock('dexie', () => ({
  liveQuery: vi.fn(() => ({
    subscribe: vi.fn((callback) => {
      callback([]);
      return { unsubscribe: vi.fn() };
    })
  }))
}));

// Mock SecurityService
vi.mock('../services/SecurityService', () => ({
  auditTrail: {
    log: vi.fn()
  }
}));

// Mock Logger
vi.mock('../services/Logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('Portfolio Store', () => {
  beforeEach(() => {
    // Reset store state
    const store = usePortfolioStore.getState();
    usePortfolioStore.setState({
      investments: [],
      history: [],
      lifeEvents: [],
      stats: {
        totalValue: 0,
        totalCurrent: 0,
        totalInvested: 0,
        totalAssets: 0,
        totalGain: 0,
        totalPL: 0,
        totalGainPercent: '0.00',
        totalPLPercent: '0.00',
        dayChange: 0,
        dayChangePercent: 0,
        diversityScore: 0,
        topAsset: { name: 'None', percent: 0 },
        totalLiability: 0
      },
      allocationData: [],
      assetClassData: [],
      platformData: [],
      isLoading: false,
      error: null
    });

    // Reset mocks
    vi.clearAllMocks();
  });

  describe('Portfolio Calculations', () => {
    it('should calculate total value correctly', () => {
      const mockInvestments: Investment[] = [
        {
          id: '1',
          name: 'Stock A',
          type: InvestmentType.STOCKS,
          platform: 'Zerodha',
          investedAmount: 10000,
          currentValue: 12000,
          lastUpdated: new Date().toISOString()
        },
        {
          id: '2',
          name: 'MF B',
          type: InvestmentType.MUTUAL_FUND,
          platform: 'Groww',
          investedAmount: 5000,
          currentValue: 5500,
          lastUpdated: new Date().toISOString()
        }
      ];

      const store = usePortfolioStore.getState();
      
      act(() => {
        store.setPortfolioData(mockInvestments, [], []);
      });

      const { stats } = usePortfolioStore.getState();
      expect(stats.totalValue).toBe(17500);
      expect(stats.totalInvested).toBe(15000);
      expect(stats.totalGain).toBe(2500);
    });

    it('should calculate diversity score correctly', () => {
      const mockInvestments: Investment[] = [
        { id: '1', name: 'Stock', type: InvestmentType.STOCKS, platform: 'P1', investedAmount: 1000, currentValue: 1000, lastUpdated: '' },
        { id: '2', name: 'MF', type: InvestmentType.MUTUAL_FUND, platform: 'P1', investedAmount: 1000, currentValue: 1000, lastUpdated: '' },
        { id: '3', name: 'Gold', type: InvestmentType.DIGITAL_GOLD, platform: 'P1', investedAmount: 1000, currentValue: 1000, lastUpdated: '' },
        { id: '4', name: 'Crypto', type: InvestmentType.CRYPTO, platform: 'P1', investedAmount: 1000, currentValue: 1000, lastUpdated: '' },
        { id: '5', name: 'FD', type: InvestmentType.FD, platform: 'P1', investedAmount: 1000, currentValue: 1000, lastUpdated: '' }
      ];

      const store = usePortfolioStore.getState();
      
      act(() => {
        store.setPortfolioData(mockInvestments, [], []);
      });

      const { stats } = usePortfolioStore.getState();
      expect(stats.diversityScore).toBeGreaterThan(0);
    });

    it('should handle empty portfolio', () => {
      const store = usePortfolioStore.getState();
      
      act(() => {
        store.setPortfolioData([], [], []);
      });

      const { stats } = usePortfolioStore.getState();
      expect(stats.totalValue).toBe(0);
      expect(stats.totalGain).toBe(0);
      expect(stats.diversityScore).toBe(0);
    });
  });

  describe('Portfolio Actions', () => {
    it('should add investment correctly', async () => {
      const mockAdd = vi.fn().mockResolvedValue(1);
      (db.investments.add as any) = mockAdd;

      const newInvestment: Omit<Investment, 'id'> = {
        name: 'New Stock',
        type: InvestmentType.STOCKS,
        platform: 'Zerodha',
        investedAmount: 5000,
        currentValue: 5000,
        lastUpdated: new Date().toISOString()
      };

      const store = usePortfolioStore.getState();
      
      await act(async () => {
        await store.addInvestment(newInvestment as Investment);
      });

      expect(mockAdd).toHaveBeenCalled();
    });

    it('should update investment correctly', async () => {
      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      const mockGet = vi.fn().mockResolvedValue({
        id: '1',
        name: 'Test Stock',
        type: InvestmentType.STOCKS,
        platform: 'Zerodha',
        investedAmount: 10000,
        currentValue: 10000,
        lastUpdated: new Date().toISOString()
      });
      (db.investments.update as any) = mockUpdate;
      (db.investments.get as any) = mockGet;

      const store = usePortfolioStore.getState();
      
      await act(async () => {
        await store.updateInvestment('1', { currentValue: 15000 });
      });

      expect(mockGet).toHaveBeenCalledWith('1');
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should delete investment correctly', async () => {
      // deleteInvestment soft-deletes via deleteWithUndo (not hard delete)
      const mockSoftDelete = vi.fn().mockResolvedValue(undefined);
      const mockGet = vi.fn().mockResolvedValue({
        id: '1',
        name: 'Test Stock',
        type: InvestmentType.STOCKS,
        platform: 'Zerodha',
        investedAmount: 10000,
        currentValue: 10000,
        lastUpdated: new Date().toISOString()
      });
      (db.investments.softDelete as any) = mockSoftDelete;
      (db.investments.get as any) = mockGet;

      const store = usePortfolioStore.getState();

      await act(async () => {
        await store.deleteInvestment('1');
      });

      expect(mockGet).toHaveBeenCalledWith('1');
      expect(mockSoftDelete).toHaveBeenCalledWith('1');
    });

    it('should throw error when updating non-existent investment', async () => {
      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      const mockGet = vi.fn().mockResolvedValue(null);
      (db.investments.update as any) = mockUpdate;
      (db.investments.get as any) = mockGet;

      const store = usePortfolioStore.getState();
      
      await expect(async () => {
        await act(async () => {
          await store.updateInvestment('non-existent', { currentValue: 15000 });
        });
      }).rejects.toThrow('Investment with id non-existent not found');
    });

    it('should throw error when deleting non-existent investment', async () => {
      const mockDelete = vi.fn().mockResolvedValue(undefined);
      const mockGet = vi.fn().mockResolvedValue(null);
      (db.investments.delete as any) = mockDelete;
      (db.investments.get as any) = mockGet;

      const store = usePortfolioStore.getState();
      
      await expect(async () => {
        await act(async () => {
          await store.deleteInvestment('non-existent');
        });
      }).rejects.toThrow('Investment with id non-existent not found');
    });

    it('should validate investment data on add', async () => {
      const mockAdd = vi.fn().mockResolvedValue(1);
      (db.investments.add as any) = mockAdd;

      const invalidInvestment = {
        name: '',
        type: InvestmentType.STOCKS,
        platform: 'Zerodha',
        investedAmount: 5000,
        currentValue: 5000,
        lastUpdated: new Date().toISOString()
      };

      const store = usePortfolioStore.getState();
      
      await expect(async () => {
        await act(async () => {
          await store.addInvestment(invalidInvestment as Investment);
        });
      }).rejects.toThrow('Investment name is required');
    });

    it('should validate negative invested amount on add', async () => {
      const mockAdd = vi.fn().mockResolvedValue(1);
      (db.investments.add as any) = mockAdd;

      const invalidInvestment = {
        name: 'Test',
        type: InvestmentType.STOCKS,
        platform: 'Zerodha',
        investedAmount: -1000,
        currentValue: 5000,
        lastUpdated: new Date().toISOString()
      };

      const store = usePortfolioStore.getState();
      
      await expect(async () => {
        await act(async () => {
          await store.addInvestment(invalidInvestment as Investment);
        });
      }).rejects.toThrow('Invested amount must be a non-negative number');
    });
  });
});

describe('Investment Calculations', () => {
  it('should calculate returns correctly', () => {
    const invested = 10000;
    const current = 12000;
    const returns = ((current - invested) / invested) * 100;
    
    expect(returns).toBe(20);
  });

  it('should calculate losses correctly', () => {
    const invested = 10000;
    const current = 8000;
    const returns = ((current - invested) / invested) * 100;
    
    expect(returns).toBe(-20);
  });

  it('should handle zero investment', () => {
    const invested = 0;
    const current = 0;
    const returns = invested > 0 ? ((current - invested) / invested) * 100 : 0;
    
    expect(returns).toBe(0);
  });
});