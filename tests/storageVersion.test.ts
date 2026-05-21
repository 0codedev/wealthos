import { beforeEach, describe, expect, it } from 'vitest';
import { migrateStorageKey, cleanLegacyVersionedKeys, getStorageKeyVersion } from '../utils/storageVersion';

describe('storageVersion', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    describe('migrateStorageKey', () => {
        it('returns the default when nothing is stored', () => {
            const out = migrateStorageKey<string[]>({
                currentKey: 'widgets',
                defaultValue: ['a', 'b'],
            });
            expect(out).toEqual(['a', 'b']);
        });

        it('returns the current key value when present', () => {
            window.localStorage.setItem('widgets', JSON.stringify(['x', 'y']));
            const out = migrateStorageKey<string[]>({
                currentKey: 'widgets',
                legacyKeys: ['widgets-v9'],
                defaultValue: [],
            });
            expect(out).toEqual(['x', 'y']);
        });

        it('falls back to legacy key and migrates forward', () => {
            window.localStorage.setItem('widgets-v9', JSON.stringify(['legacy']));
            const out = migrateStorageKey<string[]>({
                currentKey: 'widgets',
                legacyKeys: ['widgets-v9'],
                defaultValue: [],
            });
            expect(out).toEqual(['legacy']);
            // Should have been migrated
            expect(window.localStorage.getItem('widgets')).toBe(JSON.stringify(['legacy']));
        });

        it('walks legacy keys in priority order', () => {
            window.localStorage.setItem('widgets-v8', JSON.stringify(['old']));
            const out = migrateStorageKey<string[]>({
                currentKey: 'widgets',
                legacyKeys: ['widgets-v9', 'widgets-v8'],
                defaultValue: [],
            });
            expect(out).toEqual(['old']);
        });

        it('respects the validator and falls back when invalid', () => {
            window.localStorage.setItem('widgets', 'not-an-array');
            const out = migrateStorageKey<string[]>({
                currentKey: 'widgets',
                defaultValue: ['default'],
                validate: (raw) => Array.isArray(raw) ? raw as string[] : null,
            });
            expect(out).toEqual(['default']);
        });

        it('handles plain (non-JSON) string values', () => {
            window.localStorage.setItem('theme', 'dark');
            const out = migrateStorageKey<string>({
                currentKey: 'theme',
                defaultValue: 'light',
            });
            expect(out).toBe('dark');
        });
    });

    describe('cleanLegacyVersionedKeys', () => {
        it('removes all but the most recent version', () => {
            window.localStorage.setItem('foo-v1', 'a');
            window.localStorage.setItem('foo-v2', 'b');
            window.localStorage.setItem('foo-v3', 'c');
            const removed = cleanLegacyVersionedKeys('foo', 3);
            expect(removed).toBe(2);
            expect(window.localStorage.getItem('foo-v1')).toBe(null);
            expect(window.localStorage.getItem('foo-v2')).toBe(null);
            expect(window.localStorage.getItem('foo-v3')).toBe('c');
        });
        it('does not touch unrelated keys', () => {
            window.localStorage.setItem('bar-v1', 'keep');
            window.localStorage.setItem('foo-v1', 'remove');
            cleanLegacyVersionedKeys('foo', 5);
            expect(window.localStorage.getItem('bar-v1')).toBe('keep');
            expect(window.localStorage.getItem('foo-v1')).toBe(null);
        });
    });

    describe('getStorageKeyVersion', () => {
        it('parses version suffix', () => {
            expect(getStorageKeyVersion('foo-v9')).toBe(9);
            expect(getStorageKeyVersion('foo-v123')).toBe(123);
        });
        it('returns 0 for un-versioned keys', () => {
            expect(getStorageKeyVersion('foo')).toBe(0);
            expect(getStorageKeyVersion('')).toBe(0);
        });
    });
});
