import { useSettingsStore } from '../../store/settingsStore';

export interface DataEnvelope<T> {
  status: 'ok' | 'degraded' | 'unavailable' | 'demo_only';
  data: T | null;
  [key: string]: any;
}

export class ProvenanceGuard {
  /**
   * Guards a scoring function against synthetic or unavailable data.
   * Throws an error if the data envelope is degraded, unavailable, or demo-only in LIVE mode.
   */
  static guard<T>(payload: any): T {
    const isLive = useSettingsStore.getState().dataMode === 'LIVE';
    if (!payload) {
      throw new Error('Data is empty (null or undefined)');
    }
    
    if (typeof payload === 'object') {
      const status = payload.status || (payload.data && payload.data.status);
      const error = payload.error || payload.error_code || payload.detail?.error;
      const message = payload.message || payload.detail?.message || 'Data error';
      
      if (status === 'unavailable' || error === 'unavailable' || error === 'entitlement_required') {
        throw new Error(`Data is unavailable from upstream source: ${message}`);
      }
      if (status === 'demo_only' || error === 'demo_only') {
        if (isLive) {
          throw new Error('Synthetic / Demo-only data cannot be used in production scoring');
        }
      }
      if (status === 'degraded' || error === 'degraded') {
        if (isLive) {
          throw new Error('Data is degraded and cannot be trusted for production conviction');
        }
      }
      
      // If the envelope wraps the data under a 'data' field
      if ('status' in payload && 'data' in payload) {
        if (payload.data === null) {
          throw new Error('Data payload is missing');
        }
        return payload.data as T;
      }
    }
    return payload as T;
  }
}
