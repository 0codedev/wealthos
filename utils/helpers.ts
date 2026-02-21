
import { Trade } from '../database';

export const getCountdownToTarget = (targetDateStr: string): { days: number; hours: number; isExpired: boolean } => {
  const targetDate = new Date(`${targetDateStr}T23:59:59`);
  const now = new Date();
  const diff = targetDate.getTime() - now.getTime();

  if (diff <= 0) return { days: 0, hours: 0, isExpired: true };

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  return { days, hours, isExpired: false };
};

export const calculateProgress5L = (currentNetWorth: number, target: number): string => {
  if (target === 0) return "0.0";
  const progress = (currentNetWorth / target) * 100;
  return Math.min(progress, 100).toFixed(1);
};

// --- Formatting Helpers (Moved from App.tsx to avoid Cycles) ---

/**
 * Formats a number into a fixed-width, tabular-numeric string.
 * @pure
 *
 * CC49 — wraps the formatted number in a `<span class="font-mono tabular-nums">`
 * element so the digits always line up vertically inside tables and KPI
 * strips. The wrapper is what the design system calls the "tabular" cell.
 */
export const tabular = (n: number, fractionDigits = 0): string => {
  if (!Number.isFinite(n)) return '<span class="font-mono tabular-nums">NaN</span>';
  const safe = n;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: true,
  }).format(safe);
  return `<span class="font-mono tabular-nums">${formatted}</span>`;
};

/**
 * Formats a plain Indian-locale integer (no ₹ prefix). Useful for non-currency
 * counts that should still use lakh/crore grouping (OI, volume, net qty).
 * @pure
 */
export const formatNumberIndian = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);
};

/**
 * Formats a number into Indian currency (e.g., ₹1,23,456).
 * @pure
 */
export const formatCurrency = (value: number) => {
  if (Number.isNaN(value)) return 'NaN';
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(safe);
};

/**
 * CC99 — Sign-prefixed currency formatter.
 *
 * Use in P&L / gain-loss contexts where the *sign* is the dominant signal,
 * not the magnitude. Indian locale puts the ₹ symbol first, so a negative
 * number renders as "-₹1,234" which the eye has to parse. Moving the sign
 * to the front ("-₹1,234") preserves the convention while making the
 * direction legible at a glance. This is the same pattern used by
 * Bloomberg / Kite / Groww P&L cells.
 *
 * Example:
 *   formatCurrencySigned(1234)   → "+₹1,234"
 *   formatCurrencySigned(-1234)  → "-₹1,234"
 *   formatCurrencySigned(0)      → "₹0"
 */
export const formatCurrencySigned = (value: number): string => {
    if (Number.isNaN(value)) return 'NaN';
    const safe = Number.isFinite(value) ? value : 0;
    if (safe === 0) return '₹0';
    const sign = safe > 0 ? '+' : '-';
    const formatted = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
        signDisplay: 'never', // we add the sign manually so it lands before ₹
    }).format(Math.abs(safe));
    return `${sign}${formatted}`;
};

export const formatCurrencyPrecise = (value: number) => {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(safe);
};

export const formatCurrencyCompact = (val: number) => {
  const safe = Number.isFinite(val) ? val : 0;
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
};

export const calculatePercentage = (part: number, total: number) => {
  if (!total || !Number.isFinite(total)) return '0.0';
  const safePart = Number.isFinite(part) ? part : 0;
  return ((safePart / total) * 100).toFixed(1);
};

// --- Streak Calculator (Slump Buster) ---
export const calculateStreaks = (trades: Trade[]): { currentWinStreak: number; currentLoseStreak: number; bestTrade: Trade | null } => {
  // 1. Group PnL by Date
  const dailyPnL: Record<string, number> = {};
  trades.forEach(t => {
    const date = t.date; // YYYY-MM-DD
    dailyPnL[date] = (dailyPnL[date] || 0) + (t.pnl || 0);
  });

  // 2. Sort dates descending (newest first)
  const sortedDates = Object.keys(dailyPnL).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  let currentWinStreak = 0;
  let currentLoseStreak = 0;

  // 3. Calculate current streak
  for (const date of sortedDates) {
    const pnl = dailyPnL[date];
    if (pnl === undefined) continue;
    if (currentLoseStreak === 0 && currentWinStreak === 0) {
      // First day determines which streak we are checking
      if (pnl < 0) currentLoseStreak = 1;
      else if (pnl > 0) currentWinStreak = 1;
    } else if (currentLoseStreak > 0) {
      if (pnl < 0) currentLoseStreak++;
      else break; // Streak broken
    } else if (currentWinStreak > 0) {
      if (pnl > 0) currentWinStreak++;
      else break; // Streak broken
    }
  }

  // Find Best Trade for Slump Buster
  const bestTrade = trades.length > 0 ? trades.reduce((prev, current) => ((prev.pnl || 0) > (current.pnl || 0)) ? prev : current) : null;

  return { currentWinStreak, currentLoseStreak, bestTrade };
};

/**
 * Safely parse Dhan's date-time string ("YYYY-MM-DD HH:mm:ss") into a local Date object.
 * This prevents the common 5:30 hour shift (UTC/IST mismatch) caused by new Date() 
 * treating space-separated strings inconsistently across environments.
 */
export const parseDhanDateTime = (dhanStr: string | undefined): Date | null => {
  if (!dhanStr || dhanStr === 'NA') return null;
  
  try {
    // Expected format: "2023-10-25 10:15:30"
    const parts = dhanStr.trim().split(' ');
    
    if (parts.length === 1) {
        // Just date? Treat as local midnight
        const part0 = parts[0];
        if (part0 !== undefined) {
            const dateParts = part0.split('-').map(Number);
            const y = dateParts[0];
            const m = dateParts[1];
            const d = dateParts[2];
            if (y !== undefined && m !== undefined && d !== undefined) {
                const local = new Date(y, m - 1, d, 0, 0, 0);
                return isNaN(local.getTime()) ? null : local;
            }
        }
        return null;
    }

    const datePart = parts[0];
    const timePart = parts[1];
    if (datePart === undefined || timePart === undefined) return null;
    
    const dateComponents = datePart.split('-').map(Number);
    const timeComponents = timePart.split(':').map(Number);
    
    const year = dateComponents[0];
    const month = dateComponents[1];
    const day = dateComponents[2];
    
    const hh = timeComponents[0];
    const mm = timeComponents[1];
    const ss = timeComponents[2];
    
    if (year === undefined || month === undefined || day === undefined ||
        hh === undefined || mm === undefined) {
        return null;
    }
    
    // Using local time constructor (year, monthIndex, day, hours, minutes, seconds)
    const localDate = new Date(year, month - 1, day, hh, mm, ss || 0);
    return isNaN(localDate.getTime()) ? null : localDate;
  } catch (e) {
    console.warn(`[parseDhanDateTime] Error parsing "${dhanStr}":`, e);
    return null;
  }
};

// --- Timezone Utilities (IST for Tax Compliance) ---

/**
 * Get current date in IST (Indian Standard Time) timezone.
 * Critical for tax deadline calculations to ensure consistency regardless of user's local timezone.
 */
export const getISTDate = (): Date => {
  // Fix #20: Use Intl API to reliably get the current time in IST timezone
  const istString = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date());

  // Parse the formatted string 'MM/DD/YYYY, HH:mm:ss' back into a Date object
  const parts = istString.split(', ');
  const datePart = parts[0];
  const timePart = parts[1];
  if (datePart === undefined || timePart === undefined) return new Date();
  const dateComponents = datePart.split('/');
  const month = dateComponents[0];
  const day = dateComponents[1];
  const year = dateComponents[2];
  if (month === undefined || day === undefined || year === undefined) return new Date();
  return new Date(`${year}-${month}-${day}T${timePart}+05:30`);
};

/**
 * Get current date string (YYYY-MM-DD) formatted in Indian Standard Time (IST).
 * Prevents UTC slicing (toISOString().split('T')[0]) from shifting trade dates
 * to yesterday when creating or logging entries between 00:00 and 05:29 IST.
 */
export const getISTDateString = (date: Date = new Date()): string => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    const ist = getISTDate();
    const y = ist.getFullYear();
    const m = String(ist.getMonth() + 1).padStart(2, '0');
    const d = String(ist.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
};

/**
 * Calculate days difference between two dates, IST-aware.
 * @param fromDate Start date
 * @param toDate End date
 * @returns Number of days (rounded up)
 */
export const calculateDaysDiff = (fromDate: Date, toDate: Date): number => {
  const diff = toDate.getTime() - fromDate.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

/**
 * Calculate days held for an asset based on purchase date (IST-aware).
 * @param dateStr Date string (ISO format or YYYY-MM-DD)
 * @returns Days held from purchase to today (IST)
 */
export const calculateDaysHeld = (dateStr: string): number => {
  const purchaseDate = new Date(dateStr);
  const today = getISTDate();
  const diff = Math.abs(today.getTime() - purchaseDate.getTime());
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

// --- Fiscal Year Utilities (Compliance) ---

export interface FiscalYearInfo {
  startDate: Date;
  endDate: Date;
  label: string; // "FY 24-25"
}

export const getFiscalYearRange = (offset: number = 0): FiscalYearInfo => {
  const today = new Date();
  const currentMonth = today.getMonth(); // 0-11
  const currentYear = today.getFullYear();

  // If Jan(0), Feb(1), Mar(2), the FY started in previous year
  // Example: March 2024 is part of FY 23-24. April 2024 is start of FY 24-25.
  const baseStartYear = currentMonth < 3 ? currentYear - 1 : currentYear;

  const startYear = baseStartYear + offset;
  const endYear = startYear + 1;

  // FY Starts April 1st
  const startDate = new Date(startYear, 3, 1);
  // FY Ends March 31st of next year
  const endDate = new Date(endYear, 2, 31, 23, 59, 59);

  const label = `FY ${String(startYear).slice(2)}-${String(endYear).slice(2)}`;

  return { startDate, endDate, label };
};

// --- Image Compression & Blob Utilities ---

export const compressImage = async (file: File): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1024;
        const scaleSize = MAX_WIDTH / img.width;

        // Resize logic: Keep aspect ratio, max width 1024px
        if (scaleSize < 1) {
          canvas.width = MAX_WIDTH;
          canvas.height = img.height * scaleSize;
        } else {
          canvas.width = img.width;
          canvas.height = img.height;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error("Failed to get canvas context"));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Compress to WebP at 70% quality
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Compression failed"));
        }, 'image/webp', 0.7);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// IMPROVED: Synchronous, Offline-Safe, No-Fetch Blob Converter
export const base64ToBlob = (base64: string): Blob => {
  try {
    // Check if it has the data prefix
    const arr = base64.split(',');

    // Default to png if mime type is missing/invalid
    let mime = 'image/png';
    let bstr = '';

    if (arr.length > 1) {
      // Has prefix (e.g. data:image/png;base64,...)
      const arr0 = arr[0];
      const arr1 = arr[1];
      if (arr0 !== undefined && arr1 !== undefined) {
        const mimeMatch = arr0.match(/:(.*?);/);
        if (mimeMatch) {
          const matchedMime = mimeMatch[1];
          if (matchedMime !== undefined) mime = matchedMime;
        }
        bstr = atob(arr1);
      }
    } else {
      // Raw base64 string
      const arr0 = arr[0];
      if (arr0 !== undefined) {
        bstr = atob(arr0);
      }
    }

    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (e) {
    console.error("Blob conversion failed", e);
    // Return empty blob to prevent crash, but log error
    return new Blob([], { type: 'image/png' });
  }
};
