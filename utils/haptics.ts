/**
 * Safe wrapper for Telegram WebApp Haptic Feedback API.
 * Ensures no crashes or console errors when running in standard web browsers
 * or older Telegram clients (< 6.1).
 */
const getTelegramHaptics = () => {
  const webApp = (window as any).Telegram?.WebApp;
  if (!webApp) return null;
  // HapticFeedback was introduced in Bot API 6.1
  if (typeof webApp.isVersionAtLeast === 'function' && !webApp.isVersionAtLeast('6.1')) {
    return null;
  }
  return webApp.HapticFeedback || null;
};

export const triggerHapticImpact = (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'light') => {
  try {
    const haptics = getTelegramHaptics();
    if (haptics && typeof haptics.impactOccurred === 'function') {
      haptics.impactOccurred(style);
    }
  } catch (e) {
    // Fail silently in normal browser or unsupported client
  }
};

export const triggerHapticNotification = (type: 'success' | 'warning' | 'error') => {
  try {
    const haptics = getTelegramHaptics();
    if (haptics && typeof haptics.notificationOccurred === 'function') {
      haptics.notificationOccurred(type);
    }
  } catch (e) {
    // Fail silently in normal browser or unsupported client
  }
};

export const triggerHapticSelection = () => {
  try {
    const haptics = getTelegramHaptics();
    if (haptics && typeof haptics.selectionChanged === 'function') {
      haptics.selectionChanged();
    }
  } catch (e) {
    // Fail silently in normal browser or unsupported client
  }
};
