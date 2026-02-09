export type CapabilityAuthMode = 'public' | 'analytics' | 'interactive';

export type CapabilityState = 'available' | 'degraded' | 'unavailable' | 'demo_only' | 'oauth_required' | 'entitlement_required';

export interface ProviderCapability {
  provider: string;
  capability: string;
  auth_mode: CapabilityAuthMode;
  state: CapabilityState;
  checked_at: string | null;
  diagnostic: string;
  needs_reauth?: boolean;
}

/**
 * Single source of truth for checking if a capability is usable.
 * Returns true for available, degraded, or demo_only states.
 */
export function isUsable(cap: ProviderCapability): boolean {
  return cap.state === 'available' || cap.state === 'degraded' || cap.state === 'demo_only';
}
