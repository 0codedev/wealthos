import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockForwardDuels: any[] = [];

// Mock the database before importing anything that depends on it
vi.mock('../database', () => {
  return {
    db: {
      forward_duels: {
        clear: vi.fn(async () => {
          mockForwardDuels.length = 0;
        }),
        toArray: vi.fn(async () => {
          return [...mockForwardDuels];
        }),
        put: vi.fn(async (duel: any) => {
          const idx = mockForwardDuels.findIndex(d => d.id === duel.id);
          if (idx !== -1) {
            mockForwardDuels[idx] = duel;
          } else {
            if (!duel.id) duel.id = mockForwardDuels.length + 1;
            mockForwardDuels.push(duel);
          }
          return duel.id;
        }),
        add: vi.fn(async (duel: any) => {
          if (!duel.id) duel.id = mockForwardDuels.length + 1;
          mockForwardDuels.push(duel);
          return duel.id;
        }),
        update: vi.fn(async (id: any, changes: any) => {
          const duel = mockForwardDuels.find(d => d.id === id);
          if (duel) {
            Object.assign(duel, changes);
          }
          return 1;
        }),
        where: vi.fn((key: string) => {
          return {
            equals: vi.fn((value: any) => {
              return {
                toArray: vi.fn(async () => {
                  return mockForwardDuels.filter(d => d[key] === value);
                })
              };
            })
          };
        })
      }
    }
  };
});

// Import service after mock setup
import { quantDuelService } from '../services/backtester/QuantDuelService';
import { db } from '../database';

describe('QuantDuelService PnL Calculations', () => {
  it('should calculate long trade PnLs correctly based on R-multiple', () => {
    const entry = 100;
    const stop = 95; // Risk = 5
    const target = 110; // Target = +2R (+10)

    // Target hit
    expect(quantDuelService.calculateDuelPnL(entry, 110, stop, target)).toBe(40);
    expect(quantDuelService.calculateDuelPnL(entry, 115, stop, target)).toBe(40);

    // Stop hit
    expect(quantDuelService.calculateDuelPnL(entry, 95, stop, target)).toBe(-20);
    expect(quantDuelService.calculateDuelPnL(entry, 90, stop, target)).toBe(-20);

    // Proportional returns (in-between)
    // Exit at entry -> 0%
    expect(quantDuelService.calculateDuelPnL(entry, 100, stop, target)).toBe(0);
    // Exit at 102.5 (+0.5R) -> +10%
    expect(quantDuelService.calculateDuelPnL(entry, 102.5, stop, target)).toBe(10);
    // Exit at 97.5 (-0.5R) -> -10%
    expect(quantDuelService.calculateDuelPnL(entry, 97.5, stop, target)).toBe(-10);
  });

  it('should calculate short trade PnLs correctly based on R-multiple', () => {
    const entry = 100;
    const stop = 105; // Risk = 5
    const target = 90; // Target = +2R (-10)

    // Target hit (price goes down to or below 90)
    expect(quantDuelService.calculateDuelPnL(entry, 90, stop, target)).toBe(40);
    expect(quantDuelService.calculateDuelPnL(entry, 85, stop, target)).toBe(40);

    // Stop hit (price goes up to or above 105)
    expect(quantDuelService.calculateDuelPnL(entry, 105, stop, target)).toBe(-20);
    expect(quantDuelService.calculateDuelPnL(entry, 110, stop, target)).toBe(-20);

    // Proportional returns (in-between)
    // Exit at entry -> 0%
    expect(quantDuelService.calculateDuelPnL(entry, 100, stop, target)).toBe(0);
    // Exit at 97.5 (+0.5R) -> +10%
    expect(quantDuelService.calculateDuelPnL(entry, 97.5, stop, target)).toBe(10);
    // Exit at 102.5 (-0.5R) -> -10%
    expect(quantDuelService.calculateDuelPnL(entry, 102.5, stop, target)).toBe(-10);
  });
});

describe('QuantDuelService Database storage', () => {
  beforeEach(async () => {
    await db.forward_duels.clear();
  });

  it('should initialize a duel with target, stop-loss and modelRunTime', async () => {
    const duel = await quantDuelService.initializeTodayDuel('INFY', 1400, 1380, 1440, '10:30');
    expect(duel.systemTicker).toBe('INFY');
    expect(duel.systemEntryPrice).toBe(1400);
    expect(duel.systemStopLoss).toBe(1380);
    expect(duel.systemTarget).toBe(1440);
    expect(duel.modelRunTime).toBe('10:30');

    const fetched = await quantDuelService.getTodayDuel();
    expect(fetched).not.toBeNull();
    expect(fetched?.systemStopLoss).toBe(1380);
    expect(fetched?.systemTarget).toBe(1440);
  });
});
