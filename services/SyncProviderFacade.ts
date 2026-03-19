import * as FirebaseSync from './FirebaseSyncService';
import * as SupabaseSync from './SupabaseSyncService';
import { localPersistence } from './LocalPersistenceService';
import { isSideEffectAllowed } from '../lib/demoMode';
import { gateNetworkAction, isNetworkActionAllowed } from '../lib/offline';

export interface SyncResult {
  success: boolean;
  message: string;
}

export interface SyncProvider {
  name: 'firebase' | 'supabase';
  syncToCloud(userId: string): Promise<SyncResult>;
  pullFromCloud(userId: string): Promise<SyncResult>;
  previewPullFromCloud(userId: string): Promise<any>;
}

const fallbackPreview = async () => ({
  source: 'fallback',
  generatedAt: new Date().toISOString(),
  tables: [],
  totals: {
    tables: 0,
    newTables: 0,
    unchangedTables: 0,
    changedTables: 0,
    wipeTables: 0,
    conflictTables: 0,
  },
});

class SyncProviderFacade {
  /**
   * Resolves the currently active sync provider from local storage.
   * Defaults to 'firebase'.
   */
  public getActiveProviderName(): 'firebase' | 'supabase' {
    return localPersistence.get('active_sync_provider', 'firebase') as 'firebase' | 'supabase';
  }

  /**
   * Sets the active sync provider.
   */
  public setActiveProviderName(provider: 'firebase' | 'supabase'): void {
    localPersistence.set('active_sync_provider', provider);
  }

  /**
   * Resolves and returns the active provider implementation.
   */
  private getProvider(): SyncProvider {
    const active = this.getActiveProviderName();
    if (active === 'supabase') {
      return {
        name: 'supabase',
        syncToCloud: SupabaseSync.syncToCloud,
        pullFromCloud: SupabaseSync.pullFromCloud,
        previewPullFromCloud: SupabaseSync.previewPullFromCloud || fallbackPreview,
      };
    }
    
    return {
      name: 'firebase',
      syncToCloud: FirebaseSync.syncToCloud,
      pullFromCloud: FirebaseSync.pullFromCloud,
      previewPullFromCloud: FirebaseSync.previewPullFromCloud || fallbackPreview,
    };
  }

  public async syncToCloud(userId: string): Promise<SyncResult> {
    // Top-10 #4 — network gate runs first so the offline toast fires
    // before the demo gate's blocked message.
    if (!isNetworkActionAllowed('cloud-sync')) {
      return {
        ok: false,
        provider: this.getProvider().name,
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        errors: ['Offline — cloud sync will retry when online.'],
      } as unknown as SyncResult;
    }
    // --- Demo-mode side-effect gate (Top-10 #1, audit gap G1) ---
    // Demo data must NEVER be uploaded to Firebase/Supabase.
    if (!isSideEffectAllowed('cloud-sync')) {
      return {
        ok: false,
        provider: this.getProvider().name,
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        errors: ['Demo mode active — cloud sync is blocked. Clear demo data to continue.'],
      } as unknown as SyncResult;
    }
    const provider = this.getProvider();
    console.log(`[SyncFacade] Delegating syncToCloud to provider: ${provider.name}`);
    return provider.syncToCloud(userId);
  }

  public async pullFromCloud(userId: string): Promise<SyncResult> {
    const provider = this.getProvider();
    console.log(`[SyncFacade] Delegating pullFromCloud to provider: ${provider.name}`);
    return provider.pullFromCloud(userId);
  }

  public async previewPullFromCloud(userId: string): Promise<any> {
    const provider = this.getProvider();
    console.log(`[SyncFacade] Delegating previewPullFromCloud to provider: ${provider.name}`);
    return provider.previewPullFromCloud(userId);
  }
}

export const syncProviderFacade = new SyncProviderFacade();
export default syncProviderFacade;
