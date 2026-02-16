import { create } from 'zustand';
import { showToast } from '../components/shared/ToastProvider';

export interface BiometricLockState {
    isEnabled: boolean;
    isLocked: boolean;
    pinHash: string | null;
    isBiometricSupported: boolean;
    autoLockMinutes: number;
    lastActivity: number;
    enableLock: (pin: string) => void;
    disableLock: () => void;
    lockApp: () => void;
    unlockWithPin: (pin: string) => boolean;
    unlockWithBiometric: () => Promise<boolean>;
    recordActivity: () => void;
}

const BIO_STORAGE_KEY = 'wealth_biometric_lock_settings';

function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

const loadInitialState = () => {
    if (typeof window === 'undefined') return { isEnabled: false, pinHash: null, autoLockMinutes: 10 };
    try {
        const raw = localStorage.getItem(BIO_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                isEnabled: !!parsed.isEnabled,
                pinHash: parsed.pinHash || null,
                autoLockMinutes: parsed.autoLockMinutes || 10
            };
        }
    } catch { /* ignore */ }
    return { isEnabled: false, pinHash: null, autoLockMinutes: 10 };
};

export const useBiometricLockStore = create<BiometricLockState>((set, get) => {
    const initial = loadInitialState();

    const isSupported = typeof window !== 'undefined' && 
        !!window.PublicKeyCredential && 
        typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function';

    return {
        isEnabled: initial.isEnabled,
        isLocked: initial.isEnabled, // Lock initially on launch if enabled
        pinHash: initial.pinHash,
        isBiometricSupported: isSupported,
        autoLockMinutes: initial.autoLockMinutes,
        lastActivity: Date.now(),

        enableLock: (pin: string) => {
            const hash = simpleHash(pin);
            const state = { isEnabled: true, pinHash: hash, autoLockMinutes: get().autoLockMinutes };
            if (typeof window !== 'undefined') {
                localStorage.setItem(BIO_STORAGE_KEY, JSON.stringify(state));
            }
            set({ isEnabled: true, pinHash: hash, isLocked: false });
            showToast('🛡️ Biometric & PIN Security Enabled', 'success');
        },

        disableLock: () => {
            if (typeof window !== 'undefined') {
                localStorage.removeItem(BIO_STORAGE_KEY);
            }
            set({ isEnabled: false, pinHash: null, isLocked: false });
            showToast('Security Lock Disabled', 'info');
        },

        lockApp: () => {
            if (get().isEnabled) {
                set({ isLocked: true });
            }
        },

        unlockWithPin: (pin: string) => {
            const state = get();
            if (!state.pinHash) {
                set({ isLocked: false });
                return true;
            }
            if (simpleHash(pin) === state.pinHash) {
                set({ isLocked: false, lastActivity: Date.now() });
                showToast('🔓 WealthOS Unlocked', 'success');
                return true;
            }
            showToast('Incorrect PIN code', 'error');
            return false;
        },

        unlockWithBiometric: async () => {
            try {
                if (!window.PublicKeyCredential) {
                    showToast('Biometrics not supported on this browser', 'info');
                    return false;
                }

                // Check platform authenticator (Touch ID, Windows Hello, Face ID)
                const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
                if (!available) {
                    showToast('No biometric authenticator found. Use PIN instead.', 'info');
                    return false;
                }

                const challenge = new Uint8Array(32);
                crypto.getRandomValues(challenge);

                // Trigger biometric verification
                const credential = await navigator.credentials.create({
                    publicKey: {
                        challenge,
                        rp: { name: 'WealthOS Institutional Platform' },
                        user: {
                            id: new Uint8Array(16),
                            name: 'trader@wealthos.local',
                            displayName: 'WealthOS Master Account'
                        },
                        pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
                        authenticatorSelection: {
                            authenticatorAttachment: 'platform',
                            userVerification: 'required'
                        },
                        timeout: 60000
                    }
                });

                if (credential) {
                    set({ isLocked: false, lastActivity: Date.now() });
                    showToast('✨ Biometric Authentication Verified', 'success');
                    return true;
                }
                return false;
            } catch (err: any) {
                console.warn('[BiometricAuth] Failed or canceled:', err?.message || err);
                return false;
            }
        },

        recordActivity: () => {
            set({ lastActivity: Date.now() });
        }
    };
});
