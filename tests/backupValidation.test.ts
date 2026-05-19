import { describe, expect, it } from 'vitest';
import {
    isFiniteNumber,
    isValidDate,
    toFiniteNumber,
    toValidDateString,
    sanitizeBackupRow,
    sanitizeBackupRows,
    isSafeTableName,
} from '../utils/backupValidation';

describe('backupValidation', () => {
    describe('isFiniteNumber', () => {
        it('returns true for normal numbers', () => {
            expect(isFiniteNumber(0)).toBe(true);
            expect(isFiniteNumber(-123.45)).toBe(true);
            expect(isFiniteNumber(1e10)).toBe(true);
        });
        it('returns false for NaN, Infinity, -Infinity', () => {
            expect(isFiniteNumber(NaN)).toBe(false);
            expect(isFiniteNumber(Infinity)).toBe(false);
            expect(isFiniteNumber(-Infinity)).toBe(false);
        });
        it('returns false for non-number types', () => {
            expect(isFiniteNumber('123' as any)).toBe(false);
            expect(isFiniteNumber(null as any)).toBe(false);
            expect(isFiniteNumber(undefined as any)).toBe(false);
        });
    });

    describe('isValidDate', () => {
        it('accepts ISO strings', () => {
            expect(isValidDate('2024-01-15')).toBe(true);
            expect(isValidDate('2024-01-15T10:30:00Z')).toBe(true);
            expect(isValidDate('2024-01-15T10:30:00+05:30')).toBe(true);
        });
        it('accepts Date instances', () => {
            expect(isValidDate(new Date())).toBe(true);
        });
        it('rejects garbage', () => {
            expect(isValidDate('not-a-date')).toBe(false);
            expect(isValidDate('')).toBe(false);
            expect(isValidDate(null as any)).toBe(false);
            expect(isValidDate(undefined as any)).toBe(false);
            expect(isValidDate(new Date('invalid'))).toBe(false);
        });
    });

    describe('toFiniteNumber', () => {
        it('coerces numeric strings', () => {
            expect(toFiniteNumber('123.45')).toBe(123.45);
            expect(toFiniteNumber('-50', 0)).toBe(-50);
        });
        it('coerces booleans', () => {
            expect(toFiniteNumber(true)).toBe(1);
            expect(toFiniteNumber(false)).toBe(0);
        });
        it('falls back to default for garbage', () => {
            expect(toFiniteNumber('abc', 42)).toBe(42);
            expect(toFiniteNumber(null, 99)).toBe(99);
            expect(toFiniteNumber(undefined, 7)).toBe(7);
        });
        it('falls back for NaN/Infinity strings', () => {
            expect(toFiniteNumber(NaN, 1)).toBe(1);
            expect(toFiniteNumber(Infinity, 2)).toBe(2);
        });
    });

    describe('toValidDateString', () => {
        it('returns ISO string for valid dates', () => {
            expect(toValidDateString('2024-01-15')).toBe('2024-01-15T00:00:00.000Z');
        });
        it('returns null for null/undefined/empty', () => {
            expect(toValidDateString(null)).toBe(null);
            expect(toValidDateString(undefined)).toBe(null);
            expect(toValidDateString('')).toBe(null);
        });
        it('returns null for invalid strings', () => {
            expect(toValidDateString('not-a-date')).toBe(null);
        });
        it('converts Date objects', () => {
            const d = new Date('2024-06-15T10:00:00Z');
            expect(toValidDateString(d)).toBe('2024-06-15T10:00:00.000Z');
        });
        it('converts epoch millis', () => {
            const d = new Date(0);
            expect(toValidDateString(0)).toBe(d.toISOString());
        });
    });

    describe('sanitizeBackupRow', () => {
        it('returns null for non-objects', () => {
            expect(sanitizeBackupRow(null)).toBe(null);
            expect(sanitizeBackupRow('string' as any)).toBe(null);
            expect(sanitizeBackupRow(123 as any)).toBe(null);
            expect(sanitizeBackupRow([1, 2, 3])).toBe(null);
        });
        it('preserves a clean row', () => {
            const row = { id: 'abc', name: 'Reliance', quantity: 10 };
            const out = sanitizeBackupRow(row) as any;
            expect(out).toEqual(row);
        });
        it('replaces NaN/Infinity in known numeric fields with 0', () => {
            const row = { investedAmount: NaN, currentValue: Infinity, unrealizedPnL: -Infinity, pnl: 100 };
            const out = sanitizeBackupRow(row) as any;
            expect(out.investedAmount).toBe(0);
            expect(out.currentValue).toBe(0);
            expect(out.unrealizedPnL).toBe(0);
            expect(out.pnl).toBe(100);
        });
        it('coerces date strings to ISO', () => {
            const row = { date: '2024-01-15', lastUpdated: '2024-01-15T10:30:00Z', createdAt: 'not-a-date' };
            const out = sanitizeBackupRow(row) as any;
            expect(out.date).toBe('2024-01-15T00:00:00.000Z');
            expect(out.lastUpdated).toBe('2024-01-15T10:30:00.000Z');
            expect(out.createdAt).toBe(null);
        });
        it('strips prototype-pollution keys', () => {
            const row = { id: 'abc', name: 'foo', __proto__: { polluted: true }, constructor: 'bad' } as any;
            const out = sanitizeBackupRow(row) as any;
            // The output must not *own* these keys as own properties:
            expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(false);
            expect(Object.prototype.hasOwnProperty.call(out, 'constructor')).toBe(false);
            expect(out.id).toBe('abc');
            expect((out as any).polluted).toBeUndefined();
        });
        it('strips undefined values (Dexie quirk)', () => {
            const row = { id: 'abc', name: undefined as any };
            const out = sanitizeBackupRow(row) as any;
            expect('name' in out).toBe(false);
        });
        it('replaces out-of-range numeric values', () => {
            const row = { investedAmount: 1e20, quantity: -1e20 };
            const out = sanitizeBackupRow(row) as any;
            expect(out.investedAmount).toBe(0);
            expect(out.quantity).toBe(0);
        });
        it('supports strict mode (throws on bad number)', () => {
            expect(() => sanitizeBackupRow({ quantity: NaN }, { mode: 'strict' })).toThrow();
        });
    });

    describe('sanitizeBackupRows', () => {
        it('returns empty for non-array input', () => {
            expect(sanitizeBackupRows(null).rows).toEqual([]);
            expect(sanitizeBackupRows('string').rows).toEqual([]);
            expect(sanitizeBackupRows({}).rows).toEqual([]);
        });
        it('drops non-object rows and counts them', () => {
            const out = sanitizeBackupRows([
                { id: 'a', name: 'foo' },
                null,
                'string',
                42,
                { id: 'b', name: 'bar' },
            ]);
            expect(out.rows).toHaveLength(2);
            expect(out.dropped).toBe(3);
        });
        it('cleans each surviving row', () => {
            const out = sanitizeBackupRows([
                { id: 'a', investedAmount: NaN },
                { id: 'b', investedAmount: 500 },
            ]);
            expect((out.rows[0] as any).investedAmount).toBe(0);
            expect((out.rows[1] as any).investedAmount).toBe(500);
        });
    });

    describe('isSafeTableName', () => {
        it('accepts valid Dexie table names', () => {
            expect(isSafeTableName('trades')).toBe(true);
            expect(isSafeTableName('alphaSnapshots')).toBe(true);
            expect(isSafeTableName('_private')).toBe(true);
        });
        it('rejects unsafe names', () => {
            expect(isSafeTableName('drop table')).toBe(false);
            expect(isSafeTableName('a'.repeat(60))).toBe(false);
            expect(isSafeTableName('123start')).toBe(false);
            expect(isSafeTableName('')).toBe(false);
            expect(isSafeTableName(null as any)).toBe(false);
        });
    });
});
