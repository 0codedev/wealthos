// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleDownloadBackup, restoreFromJSON, previewRestoreFromJSON } from '../services/BackupService';

// Hoisted Mocks
const { mockTables, mockTransaction } = vi.hoisted(() => {
    const tables = [
        {
            name: 'investments',
            toArray: vi.fn(),
            clear: vi.fn(),
            bulkPut: vi.fn(),
        },
        {
            name: 'history',
            toArray: vi.fn(),
            clear: vi.fn(),
            bulkPut: vi.fn(),
        }
    ];

    const transaction = vi.fn(async (mode, tables, callback) => {
        await callback();
    });

    return { mockTables: tables, mockTransaction: transaction };
});

// Mock Database Module
vi.mock('../database', () => ({
    db: {
        tables: mockTables,
        transaction: mockTransaction,
        table: (name: string) => mockTables.find(t => t.name === name),
        // Add specific table accessors if needed by service (though it uses db.tables iteration)
        investments: mockTables[0],
        history: mockTables[1],
    }
}));

// Mock SyncGovernanceService
vi.mock('../services/SyncGovernanceService', () => ({
    recordTableSyncBatch: vi.fn().mockResolvedValue(undefined),
    buildSyncPreview: vi.fn().mockResolvedValue({})
}));

describe('BackupService', () => {
    // LocalStorage Mock
    const localStorageMock = (function () {
        let store: Record<string, string> = {};
        return {
            getItem: vi.fn((key: string) => store[key] || null),
            setItem: vi.fn((key: string, value: string) => {
                store[key] = value.toString();
            }),
            clear: vi.fn(() => {
                store = {};
            }),
            removeItem: vi.fn((key: string) => {
                delete store[key];
            })
        };
    })();

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup Window mocks
        Object.defineProperty(window, 'localStorage', { value: localStorageMock });

        // Mock ShowSaveFilePicker
        Object.defineProperty(window, 'showSaveFilePicker', {
            value: vi.fn().mockResolvedValue({
                createWritable: vi.fn().mockResolvedValue({
                    write: vi.fn(),
                    close: vi.fn(),
                })
            }),
            writable: true
        });

        // Reset Table Mocks
        mockTables.forEach(t => {
            t.toArray.mockResolvedValue([]);
            t.clear.mockResolvedValue(undefined);
            t.bulkPut.mockResolvedValue(undefined);
        });
    });

    describe('handleDownloadBackup (Export)', () => {
        it('should collect data from DB and LocalStorage and trigger download', async () => {
            // Setup DB Data
            // @ts-ignore
            mockTables[0].toArray.mockResolvedValue([{ id: 1, name: 'Stock A' }]);
            // @ts-ignore
            mockTables[1].toArray.mockResolvedValue([{ date: '2023-01-01' }]);

            // Setup Storage Data
            localStorage.setItem('theme', 'dark');

            // Execute
            await handleDownloadBackup();

            // Verify File Picker called
            // @ts-expect-error - showSaveFilePicker is not in lib.dom.d.ts by default
            expect(window.showSaveFilePicker).toHaveBeenCalled();

            // Verify DB access
            expect(mockTables[0].toArray).toHaveBeenCalled();
            expect(mockTables[1].toArray).toHaveBeenCalled();
        });

        it('should fallback to legacy download if FileSystem API fails', async () => {
            // Force FS API failure
            // @ts-expect-error - showSaveFilePicker is not in lib.dom.d.ts by default
            (window.showSaveFilePicker as any).mockRejectedValue(new Error('Not supported'));

            // Mock createElement link
            const mockLink = {
                href: '',
                setAttribute: vi.fn(),
                click: vi.fn(),
                style: {},
            };
            const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
            const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink as any);
            const removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink as any);

            // Execute
            await handleDownloadBackup();

            expect(createElementSpy).toHaveBeenCalledWith('a');
            expect(mockLink.click).toHaveBeenCalled();
            expect(mockLink.setAttribute).toHaveBeenCalledWith('download', expect.stringContaining('WealthBackup'));
            expect(appendChildSpy).toHaveBeenCalled();
            // Wait for setTimeout in implementation
            await new Promise(resolve => setTimeout(resolve, 150));
            expect(removeChildSpy).toHaveBeenCalled();
        });
    });

    describe('restoreFromJSON (Import)', () => {
        it('should restore DB tables and LocalStorage', async () => {
            const backupData = {
                meta: { version: 5 },
                data: {
                    investments: [{ id: 1, name: 'Restored Stock' }],
                    history: [{ date: '2024-01-01' }]
                },
                storage: {
                    theme: 'light'
                }
            };

            await restoreFromJSON(backupData);

            // Verify Transaction
            expect(mockTransaction).toHaveBeenCalled();

            // Verify Clearing
            expect(mockTables[0].clear).toHaveBeenCalled();
            expect(mockTables[1].clear).toHaveBeenCalled();

            // Verify Insertion
            expect(mockTables[0].bulkPut).toHaveBeenCalledWith(backupData.data.investments);
            expect(mockTables[1].bulkPut).toHaveBeenCalledWith([{ date: '2024-01-01T00:00:00.000Z' }]);

            // Verify Storage
            expect(localStorage.setItem).toHaveBeenCalledWith('theme', 'light');
        });

        it('should throw error if format is invalid', async () => {
            await expect(restoreFromJSON({})).rejects.toThrow("Missing 'data'");
        });

        it('should reject a payload with a corrupted checksum', async () => {
            const payload = {
                meta: { formatVersion: 3, version: 49, timestamp: new Date().toISOString(), checksum: 'deadbeef' },
                data: { investments: [{ id: 1 }] },
                storage: {},
            };
            await expect(restoreFromJSON(payload)).rejects.toThrow(/integrity/i);
        });

        it('should restore legacy pretty-printed JSON with a warning', async () => {
            const legacy = JSON.stringify(
                {
                    meta: { version: 5, timestamp: '2024-01-01T00:00:00.000Z' },
                    data: { investments: [{ id: 2, name: 'Legacy' }] },
                    storage: { theme: 'dark' },
                },
                null,
                2
            );
            await restoreFromJSON(legacy);
            expect(mockTables[0].clear).toHaveBeenCalled();
            // @ts-ignore
            expect(mockTables[0].bulkPut).toHaveBeenCalledWith([{ id: 2, name: 'Legacy' }]);
            expect(localStorage.setItem).toHaveBeenCalledWith('theme', 'dark');
        });

        it('previewRestoreFromJSON should surface backup metadata for v3 payloads', async () => {
            const payload = {
                meta: {
                    formatVersion: 3,
                    version: 49,
                    timestamp: '2026-08-23T00:00:00.000Z',
                    mode: 'optimized',
                    checksum: '',
                    counts: { tables: 1, rows: 1 },
                    protectedStorageKeys: ['wealth-aggregator-logic'],
                },
                data: { investments: [{ id: 1 }] },
                storage: {},
            };
            const preview = await previewRestoreFromJSON(payload);
            expect(preview.backupMode).toBe('optimized');
            expect(preview.backupTimestamp).toBe('2026-08-23T00:00:00.000Z');
        });
    });
});
