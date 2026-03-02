import { uid } from '../utils/uid';
import { logger } from './Logger';
import { getBridgeIdToken } from './bridgeAuthFetch';
import { syncEngine } from './SyncEngine';

export interface DeviceSession {
  device_id: string;
  device_name: string;
  device_type: 'mobile' | 'desktop' | 'tablet';
  os: string;
  browser: string;
  ip_address: string;
  first_seen_at: number;
  last_active_at: number;
  is_online: boolean;
  is_current: boolean;
  is_revoked: boolean;
}

export interface DeviceMetadata {
  deviceId: string;
  deviceName: string;
  deviceType: 'mobile' | 'desktop' | 'tablet';
  os: string;
  browser: string;
}

function detectDeviceMetadata(): DeviceMetadata {
  if (typeof window === 'undefined') {
    return {
      deviceId: 'server',
      deviceName: 'Server',
      deviceType: 'desktop',
      os: 'Linux',
      browser: 'Node'
    };
  }

  // 1. Get or create persistent hardware device ID
  let deviceId = localStorage.getItem('wealthos_device_id');
  if (!deviceId) {
    deviceId = `dev_${uid()}`;
    localStorage.setItem('wealthos_device_id', deviceId);
  }

  // 2. Detect OS & Platform
  const ua = window.navigator.userAgent;
  let os = 'Unknown OS';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Windows NT 10.0/i.test(ua)) os = 'Windows 10/11';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  // 3. Detect Browser
  let browser = 'Unknown Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';

  // 4. Detect Device Type
  let deviceType: 'mobile' | 'desktop' | 'tablet' = 'desktop';
  const isMobileUa = /Mobile|Android|iP(hone|od)/i.test(ua);
  const isTabletUa = /Tablet|iPad/i.test(ua) || (isMobileUa && window.innerWidth >= 768);
  if (isTabletUa) deviceType = 'tablet';
  else if (isMobileUa || window.innerWidth < 768) deviceType = 'mobile';

  // 5. Friendly Device Name
  const customNickname = localStorage.getItem('wealthos_device_nickname');
  const deviceName = customNickname || (
    deviceType === 'mobile'
      ? `${browser} on ${os}`
      : `${browser} Workstation (${os})`
  );

  return {
    deviceId,
    deviceName,
    deviceType,
    os,
    browser
  };
}

class DeviceSessionManager {
  private metadata: DeviceMetadata;
  private heartbeatInterval: number | null = null;
  private isChecking = false;

  constructor() {
    this.metadata = detectDeviceMetadata();
    if (typeof window !== 'undefined') {
      this.initHeartbeat();
      window.addEventListener('focus', () => this.sendHeartbeat());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.sendHeartbeat();
        }
      });
    }
  }

  public getDeviceId(): string {
    return this.metadata.deviceId;
  }

  public getMetadata(): DeviceMetadata {
    return this.metadata;
  }

  public setCustomNickname(nickname: string) {
    if (typeof window === 'undefined') return;
    localStorage.setItem('wealthos_device_nickname', nickname.trim());
    this.metadata.deviceName = nickname.trim();
    this.sendHeartbeat();
  }

  private initHeartbeat() {
    if (this.heartbeatInterval) {
      window.clearInterval(this.heartbeatInterval);
    }
    // Send heartbeat every 60 seconds
    this.heartbeatInterval = window.setInterval(() => {
      this.sendHeartbeat();
    }, 60000);

    // Initial heartbeat after 2s
    window.setTimeout(() => this.sendHeartbeat(), 2000);
  }

  public async sendHeartbeat(): Promise<boolean> {
    if (this.isChecking || typeof window === 'undefined') return false;
    const uid = localStorage.getItem('wealthos_data_owner_uid');
    if (!uid) return false;

    this.isChecking = true;
    try {
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const apiBase = isLocal ? 'http://127.0.0.1:8765' : `${window.location.origin}/api/python-nse`;
      const idToken = await getBridgeIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Device-Id': this.metadata.deviceId
      };
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

      const res = await fetch(`${apiBase}/api/sync/device/heartbeat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: uid,
          device_id: this.metadata.deviceId,
          device_name: this.metadata.deviceName,
          device_type: this.metadata.deviceType,
          os: this.metadata.os,
          browser: this.metadata.browser
        })
      });

      if (res.status === 401 || res.status === 403) {
        logger.warn('[DeviceSessionManager] Session has been remotely revoked or terminated.');
        await this.handleRemoteRevocation();
        return false;
      }

      if (res.ok) {
        const data = await res.json();
        if (data.is_revoked) {
          logger.warn('[DeviceSessionManager] Device session revoked by user from another device.');
          await this.handleRemoteRevocation();
          return false;
        }
      }
      return true;
    } catch (e) {
      // Heartbeat failure is non-blocking
      return false;
    } finally {
      this.isChecking = false;
    }
  }

  private async handleRemoteRevocation() {
    if (typeof window === 'undefined') return;
    try {
      await syncEngine.clearLocalDataForUserSwitch('');
    } catch {
      // ignore
    }
    window.alert('Your WealthOS session on this device has been remotely logged out from another active session.');
    window.location.reload();
  }

  public async fetchActiveSessions(): Promise<DeviceSession[]> {
    const uid = typeof window !== 'undefined' ? localStorage.getItem('wealthos_data_owner_uid') : null;
    if (!uid) return [];

    try {
      const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      const apiBase = isLocal ? 'http://127.0.0.1:8765' : `${window.location.origin}/api/python-nse`;
      const idToken = await getBridgeIdToken();

      const headers: Record<string, string> = {
        'X-Device-Id': this.metadata.deviceId
      };
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

      const res = await fetch(`${apiBase}/api/sync/devices?user_id=${encodeURIComponent(uid)}`, {
        headers
      });

      if (!res.ok) return [];
      const data = await res.json();
      return (data.devices || []).map((d: any) => ({
        ...d,
        is_current: d.device_id === this.metadata.deviceId
      }));
    } catch (err) {
      logger.warn('[DeviceSessionManager] Failed to fetch device sessions:', err);
      return [];
    }
  }

  public async revokeRemoteDevice(targetDeviceId: string): Promise<boolean> {
    const uid = typeof window !== 'undefined' ? localStorage.getItem('wealthos_data_owner_uid') : null;
    if (!uid) return false;

    try {
      const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      const apiBase = isLocal ? 'http://127.0.0.1:8765' : `${window.location.origin}/api/python-nse`;
      const idToken = await getBridgeIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Device-Id': this.metadata.deviceId
      };
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

      const res = await fetch(`${apiBase}/api/sync/device/revoke`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: uid,
          device_id: targetDeviceId
        })
      });

      return res.ok;
    } catch (err) {
      logger.warn('[DeviceSessionManager] Failed to revoke remote device:', err);
      return false;
    }
  }
}

export const deviceSessionManager = new DeviceSessionManager();
