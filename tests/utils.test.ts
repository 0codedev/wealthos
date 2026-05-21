
import { describe, it, expect, vi } from 'vitest';
import { formatCurrency, calculateStreaks, getFiscalYearRange, getISTDateString } from '../utils/helpers';
import { splitCSVLine, cleanNumber, cleanQuantity } from '../components/journal/BrokerCSVImport';
import { ITRGeneratorService } from '../services/ITRGeneratorService';
import { generateMatchKey } from '../contexts/TransactionContext';
import { getSignal } from '../services/alpha/StrategyEngine';

describe('Utility Helpers', () => {

    describe('formatCurrency', () => {
        it('formats number to INR currency', () => {
            const result = formatCurrency(150000);
            expect(result).toContain('₹');
            expect(result).toContain('1,50,000');
        });

        it('handles zero', () => {
            const result = formatCurrency(0);
            expect(result).toContain('₹');
            expect(result).toContain('0');
        });

        it('handles negative numbers', () => {
            const result = formatCurrency(-5000);
            expect(result).toContain('₹');
            expect(result).toContain('-')
            expect(result).toContain('5,000');
        });

        it('handles large numbers (Crores)', () => {
            const result = formatCurrency(15000000); // 1.5 Cr
            expect(result).toContain('₹');
            expect(result).toContain('1,50,00,000');
        });

        it('handles NaN gracefully', () => {
            const result = formatCurrency(NaN);
            expect(result).toContain('NaN');
        });
    });

    describe('calculateStreaks', () => {
        it('calculates winning streaks correctly', () => {
            const trades = [
                { symbol: 'A', entryPrice: 100, exitPrice: 110, quantity: 1, direction: 'LONG', pnl: 10, date: '2024-01-01' } as any,
                { symbol: 'A', entryPrice: 100, exitPrice: 110, quantity: 1, direction: 'LONG', pnl: 20, date: '2024-01-02' } as any,
                { symbol: 'A', entryPrice: 100, exitPrice: 110, quantity: 1, direction: 'LONG', pnl: 30, date: '2024-01-03' } as any,
            ];
            const result = calculateStreaks(trades);
            expect(result.currentWinStreak).toBe(3);
            expect(result.currentLoseStreak).toBe(0);
        });

        it('calculates losing streaks correctly', () => {
            const trades = [
                { symbol: 'A', entryPrice: 100, exitPrice: 90, quantity: 1, direction: 'LONG', pnl: -10, date: '2024-01-01' } as any,
                { symbol: 'A', entryPrice: 100, exitPrice: 90, quantity: 1, direction: 'LONG', pnl: -20, date: '2024-01-02' } as any,
            ];
            const result = calculateStreaks(trades);
            expect(result.currentLoseStreak).toBe(2);
            expect(result.currentWinStreak).toBe(0);
        });

        it('resets streak on mixed results', () => {
            // Newest first order simulated by date? function sorts internally.
            const trades = [
                { symbol: 'A', pnl: 10, date: '2024-01-03' } as any, // Win (Newest)
                { symbol: 'A', pnl: -10, date: '2024-01-02' } as any, // Loss
            ];
            const result = calculateStreaks(trades);
            // Most recent is win, so win streak 1.
            expect(result.currentWinStreak).toBe(1);
            expect(result.currentLoseStreak).toBe(0);
        });
    });

    describe('getFiscalYearRange', () => {
        it('returns correct FY for current date', () => {
            // Mock System Date using vi.useFakeTimers
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2024-05-15')); // May 2024

            const result = getFiscalYearRange(0);
            expect(result.label).toBe('FY 24-25');
            expect(result.startDate.getMonth()).toBe(3); // April
            expect(result.startDate.getDate()).toBe(1);

            vi.useRealTimers();
        });

        it('handles March correctly (previous FY)', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2024-03-15')); // March 2024

            const result = getFiscalYearRange(0);
            expect(result.label).toBe('FY 23-24');

            vi.useRealTimers();
        });
    });

    describe('getISTDateString', () => {
        it('returns date in YYYY-MM-DD format for given Date', () => {
            const date = new Date('2026-09-22T20:00:00.000Z'); // 20:00 UTC = 01:30 IST on Sept 23
            const istDateStr = getISTDateString(date);
            expect(istDateStr).toBe('2026-09-23');
        });

        it('returns today in IST format if no argument passed', () => {
            const today = getISTDateString();
            expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
    });

    describe('Broker CSV Parser Utilities', () => {
        it('splitCSVLine splits columns properly handling quotes and commas inside quotes', () => {
            const line = '"12345","TCS","BUY","1,000","3,450.50"';
            const cols = splitCSVLine(line);
            expect(cols).toEqual(['12345', 'TCS', 'BUY', '1,000', '3,450.50']);
        });

        it('cleanNumber cleans currency symbols, quotes, commas and rejects invalid values', () => {
            expect(cleanNumber('₹1,234.50')).toBe(1234.5);
            expect(cleanNumber('"3,500"')).toBe(3500);
            expect(cleanNumber('0')).toBe(0);
            expect(cleanNumber('-100')).toBe(0);
            expect(cleanNumber('Infinity')).toBe(0);
            expect(cleanNumber(undefined)).toBe(0);
            expect(cleanNumber(null)).toBe(0);
        });

        it('cleanQuantity ensures positive safe integers', () => {
            expect(cleanQuantity('1,000')).toBe(1000);
            expect(cleanQuantity('50.99')).toBe(50);
            expect(cleanQuantity('0')).toBe(0);
            expect(cleanQuantity('-5')).toBe(0);
        });
    });

    describe('ITRGeneratorService Capital Gains Classification', () => {
        const itrService = new ITRGeneratorService('2024-25');

        it('classifies intraday trades as STCG Section 111A with holding period 0', async () => {
            const mockTrade = {
                id: 'T1',
                ticker: 'RELIANCE',
                brokerProfile: 'Intraday Equity',
                date: '2024-06-15',
                direction: 'Long',
                entryPrice: 2800,
                exitPrice: 2900,
                quantity: 10,
                fees: 50,
            } as any;

            const { schedule } = await itrService.generateScheduleCG([mockTrade]);
            expect(schedule.shortTermGains.section111A.gains).toBe(950); // (2900 - 2800) * 10 - 50
            expect(schedule.longTermGains.section112A.gainsBeforeExemption).toBe(0);
        });

        it('classifies long-term trades with holdingDays >= 365 as LTCG Section 112A', async () => {
            const mockTrade = {
                id: 'T2',
                ticker: 'INFY',
                date: '2024-06-15',
                holdingDays: 400,
                direction: 'Long',
                entryPrice: 1400,
                exitPrice: 1800,
                quantity: 10,
                fees: 100,
            } as any;

            const { schedule } = await itrService.generateScheduleCG([mockTrade]);
            expect(schedule.longTermGains.section112A.gainsBeforeExemption).toBe(3900); // (1800 - 1400) * 10 - 100
            expect(schedule.shortTermGains.section111A.gains).toBe(0);
        });
    });

    describe('generateMatchKey', () => {
        it('uses upiRef when available', () => {
            const key = generateMatchKey({
                id: '1',
                upiRef: 'UPI123456',
                amount: 500,
                date: '2026-09-22',
                type: 'DEBIT',
                category: 'Food'
            } as any);
            expect(key).toBe('upi:UPI123456');
        });

        it('generates fallback key with formatted date and amount', () => {
            const key = generateMatchKey({
                id: '2',
                amount: 250.5,
                date: '2026-09-22T10:00:00.000Z',
                type: 'CREDIT',
                category: 'Income'
            } as any);
            expect(key).toBe('fallback:2026-09-22:250.50:CREDIT');
        });

        it('safely handles invalid date strings without throwing RangeError', () => {
            expect(() => {
                const key = generateMatchKey({
                    id: '3',
                    amount: 100,
                    date: 'invalid-date-string',
                    type: 'DEBIT',
                    category: 'Shopping'
                } as any);
                expect(key).toBe('fallback:unknown-date:100.00:DEBIT');
            }).not.toThrow();
        });
    });

    describe('Alpha Strategy getSignal', () => {
        it('calculates open-low, open-high, gap-up, and gap-down correctly', () => {
            const stockOL = { Open: 100, Low: 100, High: 105, prevClose: 98 } as any;
            const sigOL = getSignal(stockOL);
            expect(sigOL.isOpenLow).toBe(true);
            expect(sigOL.isOpenHigh).toBe(false);
            expect(sigOL.isGapUp).toBe(true);
            expect(sigOL.isGapDown).toBe(false);

            const stockOH = { Open: 100, Low: 95, High: 100, prevClose: 102 } as any;
            const sigOH = getSignal(stockOH);
            expect(sigOH.isOpenLow).toBe(false);
            expect(sigOH.isOpenHigh).toBe(true);
            expect(sigOH.isGapUp).toBe(false);
            expect(sigOH.isGapDown).toBe(true);
        });
    });
});

