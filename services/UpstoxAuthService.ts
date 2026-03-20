import { useSettingsStore } from '../store/settingsStore';
import { logger } from './Logger';

class UpstoxAuthService {
  private readonly LOCAL_STORAGE_KEY = 'upstox_access_token';

  /**
   * Get the current Upstox token.
   * Priority: Zustand Settings Store > LocalStorage > Process Env
   */
  getToken(): string {
    const storeToken = useSettingsStore.getState().upstoxAccessToken;
    if (storeToken) return storeToken;

    const cached = localStorage.getItem(this.LOCAL_STORAGE_KEY);
    if (cached) return cached;

    if (typeof process !== 'undefined' && process.env?.UPSTOX_ACCESS_TOKEN) {
      return process.env.UPSTOX_ACCESS_TOKEN;
    }

    return '';
  }

  /**
   * Sets the Upstox access token in local storage, Zustand store, and synchronizes with Python bridge.
   */
  async setToken(token: string): Promise<boolean> {
    if (!token) return false;

    // Save locally
    localStorage.setItem(this.LOCAL_STORAGE_KEY, token);
    localStorage.setItem('upstox_token_created_at', Date.now().toString());
    useSettingsStore.getState().updateSetting('upstoxAccessToken', token);

    // Synchronize with python bridge
    try {
      const response = await fetch('/api/python-nse/api/upstox/set-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      if (response.ok) {
        logger.info('✅ Upstox token successfully synced with Python bridge');
        return true;
      } else {
        logger.error('❌ Failed to sync Upstox token with Python bridge:', response.statusText);
      }
    } catch (err: unknown) {
      logger.error('❌ Network error syncing Upstox token with Python bridge:', err);
    }
    return false;
  }

  /**
   * Synchronize Upstox API credentials (Key, Secret, Redirect URI) with Python bridge.
   */
  async syncCredentials(apiKey?: string, apiSecret?: string, redirectUri?: string): Promise<boolean> {
    try {
      const response = await fetch('/api/python-nse/api/upstox/set-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey || useSettingsStore.getState().upstoxApiKey,
          api_secret: apiSecret || useSettingsStore.getState().upstoxApiSecret,
          redirect_uri: redirectUri || useSettingsStore.getState().upstoxRedirectUri,
        }),
      });
      if (response.ok) {
        logger.info('✅ Upstox credentials successfully synced with Python bridge');
        return true;
      }
    } catch (err) {
      logger.error('❌ Network error syncing Upstox credentials:', err);
    }
    return false;
  }

  /**
   * Checks if the Upstox token is valid by parsing its JWT expiration (if applicable)
   * or by checking connection health.
   */
  isTokenValid(): boolean {
    const token = this.getToken();
    if (!token) return false;

    // 1. Primary verification: Parse JWT expiration directly from token payload
    const parts = token.split('.');
    if (parts.length === 3) {
      try {
        let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const payload = JSON.parse(atob(b64));
        if (payload && typeof payload.exp === 'number') {
          const expirationTime = payload.exp * 1000; // exp is in seconds
          const isValid = Date.now() < expirationTime;
          if (!isValid) {
            logger.info('Upstox JWT token has expired (exp timestamp exceeded).');
            return false;
          }
          return true;
        }
      } catch (err: unknown) {
        logger.warn('Failed to parse Upstox JWT token expiration, falling back to timestamp check.', err);
      }
    }

    // 2. Fallback check: 24h lifespan from creation timestamp if non-JWT token
    const createdAtStr = localStorage.getItem('upstox_token_created_at');
    if (createdAtStr) {
      const createdAt = parseInt(createdAtStr, 10);
      if (!isNaN(createdAt)) {
        if (Date.now() - createdAt > 24 * 60 * 60 * 1000) {
          return false;
        }
      }
    }

    // Default: If token exists, assume valid.
    return true;
  }

  /**
   * Builds the Upstox OAuth login URL.
   */
  buildAuthUrl(): string {
    const settings = useSettingsStore.getState();
    const dynamicRedirect = typeof window !== 'undefined' ? `${window.location.origin}/upstox/callback` : 'http://localhost:3000/upstox/callback';
    const apiKey = settings.upstoxApiKey || (typeof process !== 'undefined' && process.env?.UPSTOX_API_KEY) || '';

    if (!apiKey) {
      logger.warn('Upstox API Key is missing. Cannot build auth URL.');
      return '';
    }

    return `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${encodeURIComponent(apiKey)}&redirect_uri=${encodeURIComponent(dynamicRedirect)}`;
  }

  /**
   * Checks connection health with Python bridge and Upstox API
   */
  async checkHealth(): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      const response = await fetch('/api/python-nse/api/upstox/health');
      if (response.ok) {
        const data = await response.json();
        return {
          success: data.valid,
          message: data.valid ? '✅ Upstox connection is active and healthy.' : `❌ ${data.message || 'Token is invalid or expired.'}`,
          details: data
        };
      }
      return {
        success: false,
        message: `❌ Python bridge returned status ${response.status}`
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `❌ Failed to connect to Python bridge: ${message}`
      };
    }
  }
}

export const upstoxAuthService = new UpstoxAuthService();
