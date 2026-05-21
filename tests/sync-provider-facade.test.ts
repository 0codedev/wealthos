import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncProviderFacade } from '../services/SyncProviderFacade';

vi.mock('../services/FirebaseSyncService', () => ({
  syncToCloud: vi.fn(() => Promise.resolve({ success: true, message: 'Firebase Sync Success' })),
  pullFromCloud: vi.fn(() => Promise.resolve({ success: true, message: 'Firebase Pull Success' })),
  previewPullFromCloud: vi.fn(() => Promise.resolve({ source: 'firebase', generatedAt: 'now', tables: [], totals: {} })),
}));

vi.mock('../services/SupabaseSyncService', () => ({
  syncToCloud: vi.fn(() => Promise.resolve({ success: true, message: 'Supabase Sync Success' })),
  pullFromCloud: vi.fn(() => Promise.resolve({ success: true, message: 'Supabase Pull Success' })),
  previewPullFromCloud: vi.fn(() => Promise.resolve({ source: 'supabase', generatedAt: 'now', tables: [], totals: {} })),
}));

vi.mock('../lib/demoMode', () => ({
  isSideEffectAllowed: vi.fn(() => true),
}));

vi.mock('../lib/offline', () => ({
  gateNetworkAction: vi.fn(() => true),
}));

describe('SyncProviderFacade', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('defaults active provider to firebase', () => {
    expect(syncProviderFacade.getActiveProviderName()).toBe('firebase');
  });

  it('allows setting active provider', () => {
    syncProviderFacade.setActiveProviderName('supabase');
    expect(syncProviderFacade.getActiveProviderName()).toBe('supabase');
  });

  it('delegates syncToCloud to active provider (firebase)', async () => {
    const FirebaseSync = await import('../services/FirebaseSyncService');
    const SupabaseSync = await import('../services/SupabaseSyncService');
    
    syncProviderFacade.setActiveProviderName('firebase');
    const result = await syncProviderFacade.syncToCloud('test-user');
    
    expect(result.message).toBe('Firebase Sync Success');
    expect(FirebaseSync.syncToCloud).toHaveBeenCalledWith('test-user');
    expect(SupabaseSync.syncToCloud).not.toHaveBeenCalled();
  });

  it('delegates syncToCloud to active provider (supabase)', async () => {
    const FirebaseSync = await import('../services/FirebaseSyncService');
    const SupabaseSync = await import('../services/SupabaseSyncService');
    
    syncProviderFacade.setActiveProviderName('supabase');
    const result = await syncProviderFacade.syncToCloud('test-user2');
    
    expect(result.message).toBe('Supabase Sync Success');
    expect(SupabaseSync.syncToCloud).toHaveBeenCalledWith('test-user2');
    expect(FirebaseSync.syncToCloud).not.toHaveBeenCalled();
  });

  it('delegates pullFromCloud and previewPullFromCloud correctly', async () => {
    const FirebaseSync = await import('../services/FirebaseSyncService');
    const SupabaseSync = await import('../services/SupabaseSyncService');

    syncProviderFacade.setActiveProviderName('supabase');
    await syncProviderFacade.pullFromCloud('user-pull');
    await syncProviderFacade.previewPullFromCloud('user-pull');

    expect(SupabaseSync.pullFromCloud).toHaveBeenCalledWith('user-pull');
    expect(SupabaseSync.previewPullFromCloud).toHaveBeenCalledWith('user-pull');
    expect(FirebaseSync.pullFromCloud).not.toHaveBeenCalled();
  });
});
