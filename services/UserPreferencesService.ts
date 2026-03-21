/**
 * UserPreferencesService - Dark mode scheduling, theme management, and user settings
 * Covers: Auto dark mode, sunset-based switching, widget preferences
 */

// ==================== DARK MODE SCHEDULING ====================

export interface DarkModeSchedule {
    mode: 'system' | 'manual' | 'scheduled' | 'sunset';
    isDark: boolean;
    startTime?: string; // HH:MM format
    endTime?: string;   // HH:MM format
    location?: { lat: number; lng: number };
}

/**
 * Calculate if it's currently dark based on schedule
 */
export function shouldBeDarkMode(schedule: DarkModeSchedule): boolean {
    switch (schedule.mode) {
        case 'manual':
            return schedule.isDark;

        case 'system':
            return window.matchMedia('(prefers-color-scheme: dark)').matches;

        case 'scheduled':
            return isWithinScheduledTime(schedule.startTime!, schedule.endTime!);

        case 'sunset':
            if (schedule.location) {
                return isAfterSunset(schedule.location);
            }
            // Fallback to 6 PM - 6 AM
            return isWithinScheduledTime('18:00', '06:00');

        default:
            return false;
    }
}

function isWithinScheduledTime(startTime: string, endTime: string): boolean {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const startParts = startTime.split(':').map(Number);
    const endParts = endTime.split(':').map(Number);
    const startH = startParts[0];
    const startM = startParts[1];
    const endH = endParts[0];
    const endM = endParts[1];

    if (startH === undefined || startM === undefined || endH === undefined || endM === undefined) {
        return false;
    }

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes < endMinutes) {
        // Same day (e.g., 18:00 to 22:00)
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
        // Overnight (e.g., 18:00 to 06:00)
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
}

function isAfterSunset(location: { lat: number; lng: number }): boolean {
    const { sunrise, sunset } = calculateSunTimes(location.lat, location.lng);
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    return currentMinutes >= sunset || currentMinutes < sunrise;
}

/**
 * Calculate sunrise and sunset times (simplified algorithm)
 */
function calculateSunTimes(lat: number, lng: number): { sunrise: number; sunset: number } {
    const now = new Date();
    const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));

    // Simplified calculation (accurate enough for scheduling)
    const declination = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180);
    const latRad = lat * Math.PI / 180;
    const decRad = declination * Math.PI / 180;

    const hourAngle = Math.acos(-Math.tan(latRad) * Math.tan(decRad)) * 180 / Math.PI;

    // Convert to minutes from midnight
    const solarNoon = 720 - (lng * 4); // 12:00 adjusted for longitude
    const sunriseMinutes = solarNoon - (hourAngle * 4);
    const sunsetMinutes = solarNoon + (hourAngle * 4);

    return {
        sunrise: Math.round(sunriseMinutes),
        sunset: Math.round(sunsetMinutes)
    };
}

// ==================== THEME PREFERENCES ====================

export interface ThemePreferences {
    primaryColor: string;
    accentColor: string;
    fontFamily: 'inter' | 'roboto' | 'system';
    fontSize: 'small' | 'medium' | 'large';
    reducedMotion: boolean;
    highContrast: boolean;
}

export const DEFAULT_THEME: ThemePreferences = {
    primaryColor: '#4f46e5', // Indigo
    accentColor: '#8b5cf6',  // Purple
    fontFamily: 'inter',
    fontSize: 'medium',
    reducedMotion: false,
    highContrast: false
};

export function applyTheme(theme: ThemePreferences): void {
    const root = document.documentElement;

    root.style.setProperty('--color-primary', theme.primaryColor);
    root.style.setProperty('--color-accent', theme.accentColor);

    // Font size
    const fontSizes = { small: '14px', medium: '16px', large: '18px' };
    root.style.setProperty('--font-size-base', fontSizes[theme.fontSize]);

    // Reduced motion
    if (theme.reducedMotion) {
        root.classList.add('reduce-motion');
    } else {
        root.classList.remove('reduce-motion');
    }

    // High contrast
    if (theme.highContrast) {
        root.classList.add('high-contrast');
    } else {
        root.classList.remove('high-contrast');
    }
}

// ==================== USER PREFERENCES STORAGE ====================

export interface UserPreferences {
    darkMode: DarkModeSchedule;
    theme: ThemePreferences;
    notifications: {
        priceAlerts: boolean;
        sipReminders: boolean;
        taxDeadlines: boolean;
        newsAlerts: boolean;
        dailyBriefing: boolean;
        briefingTime: string;
    };
    privacy: {
        hideValues: boolean;
        hideNames: boolean;
        autoLock: boolean;
        lockTimeout: number; // minutes
    };
    display: {
        currency: 'INR' | 'USD' | 'EUR';
        numberFormat: 'indian' | 'international';
        dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
        showDecimals: boolean;
    };
}

export const DEFAULT_PREFERENCES: UserPreferences = {
    darkMode: {
        mode: 'system',
        isDark: false
    },
    theme: DEFAULT_THEME,
    notifications: {
        priceAlerts: true,
        sipReminders: true,
        taxDeadlines: true,
        newsAlerts: false,
        dailyBriefing: false,
        briefingTime: '08:00'
    },
    privacy: {
        hideValues: false,
        hideNames: false,
        autoLock: false,
        lockTimeout: 5
    },
    display: {
        currency: 'INR',
        numberFormat: 'indian',
        dateFormat: 'DD/MM/YYYY',
        showDecimals: true
    }
};

const STORAGE_KEY = 'wealth_aggregator_preferences';

export function savePreferences(prefs: UserPreferences): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export function loadPreferences(): UserPreferences {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PREFERENCES;

    try {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_PREFERENCES, ...parsed };
    } catch {
        return DEFAULT_PREFERENCES;
    }
}

// ==================== WIDGET PREFERENCES ====================

export interface WidgetConfig {
    id: string;
    type: 'portfolio_value' | 'top_gainers' | 'alerts' | 'sip_tracker' | 'quick_actions';
    enabled: boolean;
    position: number;
    size: 'small' | 'medium' | 'large';
}

export const DEFAULT_WIDGETS: WidgetConfig[] = [
    { id: 'w1', type: 'portfolio_value', enabled: true, position: 0, size: 'large' },
    { id: 'w2', type: 'top_gainers', enabled: true, position: 1, size: 'medium' },
    { id: 'w3', type: 'alerts', enabled: true, position: 2, size: 'medium' },
    { id: 'w4', type: 'sip_tracker', enabled: false, position: 3, size: 'small' },
    { id: 'w5', type: 'quick_actions', enabled: true, position: 4, size: 'small' },
];

// ==================== BIOMETRIC / PIN LOCK ====================

export interface SecuritySettings {
    lockEnabled: boolean;
    lockMethod: 'none' | 'pin' | 'biometric';
    pinHash?: string; // Hashed PIN
    autoLockMinutes: number;
    lastUnlocked?: string;
}

/**
 * Simple hash for PIN (in production, use proper crypto)
 */
export function hashPin(pin: string): string {
    let hash = 0;
    for (let i = 0; i < pin.length; i++) {
        const char = pin.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

/**
 * Check if biometric is available
 */
export async function isBiometricAvailable(): Promise<boolean> {
    if (!window.PublicKeyCredential) return false;

    try {
        const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        return available;
    } catch {
        return false;
    }
}

/**
 * Request biometric authentication (using Web Authentication API)
 */
export async function requestBiometricAuth(): Promise<boolean> {
    try {
        // Create a challenge
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);

        // Request authentication
        const credential = await navigator.credentials.create({
            publicKey: {
                challenge,
                rp: { name: 'Wealth Aggregator' },
                user: {
                    id: new Uint8Array(16),
                    name: 'user@local',
                    displayName: 'User'
                },
                pubKeyCredParams: [
                    { alg: -7, type: 'public-key' }
                ],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform',
                    userVerification: 'required'
                },
                timeout: 60000
            }
        });

        return !!credential;
    } catch (e) {
        console.error('Biometric auth failed:', e);
        return false;
    }
}

export default {
    shouldBeDarkMode,
    calculateSunTimes,
    applyTheme,
    savePreferences,
    loadPreferences,
    hashPin,
    isBiometricAvailable,
    requestBiometricAuth,
    DEFAULT_PREFERENCES,
    DEFAULT_THEME,
    DEFAULT_WIDGETS
};
