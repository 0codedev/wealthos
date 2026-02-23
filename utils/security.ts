/**
 * Security utilities for XSS prevention and input sanitization
 *
 * CC12 additions:
 *   - sanitizePasteText / safeFiniteNumber for the paste-parser XSS fix
 *   - sanitizeStyleFragment for the 3 dangerouslySetInnerHTML / <style>
 *     sites
 *   - redactApiKey / redactApiKeys for safe display in logs
 *   - sanitizeVoiceTranscript to harden the Jarvis voice pipeline
 *
 * These run alongside the existing escapeHtml / sanitizeInput / etc.
 */

// HTML entity encoding map
const htmlEntities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;'
};

/**
 * Escape HTML to prevent XSS attacks
 */
export const escapeHtml = (unsafe: string): string => {
  if (!unsafe || typeof unsafe !== 'string') return '';
  return unsafe.replace(/[&<>"'`=/]/g, (char) => htmlEntities[char] || char);
};

/**
 * Sanitize user input for display
 * Removes potentially dangerous content
 */
export const sanitizeInput = (input: string, maxLength: number = 500): string => {
  if (!input || typeof input !== 'string') return '';

  // Trim whitespace
  let sanitized = input.trim();

  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Remove control characters except newlines and tabs
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

  return sanitized;
};

/**
 * Validate and sanitize URL
 */
export const sanitizeUrl = (url: string): string => {
  if (!url || typeof url !== 'string') return '';

  // Only allow http and https protocols
  const allowedProtocols = ['http:', 'https:'];

  try {
    const parsed = new URL(url);
    if (!allowedProtocols.includes(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
  } catch {
    // If URL parsing fails, check if it starts with allowed protocols
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return '';
  }
};

/**
 * Validate email address
 */
export const isValidEmail = (email: string): boolean => {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
};

/**
 * Validate safe file name (prevent directory traversal)
 */
export const sanitizeFilename = (filename: string): string => {
  if (!filename || typeof filename !== 'string') return '';

  // Remove path separators and dangerous characters
  return filename
    .replace(/[/\\]/g, '')
    .replace(/\.\./g, '')
    .replace(/[<>:"|?*]/g, '')
    .trim()
    .substring(0, 255);
};

/**
 * Deep sanitize object properties
 */
export const deepSanitize = <T extends Record<string, any>>(obj: T): T => {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeInput(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = deepSanitize(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as T;
};

/**
 * Security headers configuration for CSP
 */
export const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://fonts.googleapis.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https://generativelanguage.googleapis.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()'
};

/**
 * Apply security headers to document.
 * NOTE: CSP is already defined in index.html meta tags.
 * Adding a second, more restrictive CSP at runtime was causing
 * blank screen in production by blocking Tailwind CDN, inline scripts,
 * and eval() needed by bundled code. This function is now a safe no-op.
 */
export const applySecurityHeaders = (): void => {
  // CSP is managed via index.html meta tag.
  // Do NOT inject additional CSP meta tags at runtime as they
  // create conflicts and silently break the application.
};

/**
 * Rate limiting helper
 */
export class RateLimiter {
  private attempts: Map<string, number[]> = new Map();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts: number = 5, windowMs: number = 60000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  private loadSessionAttempts(key: string): number[] {
    try {
      const stored = sessionStorage.getItem(`rate_limit_${key}`);
      if (stored) return JSON.parse(stored);
    } catch {}
    return this.attempts.get(key) || [];
  }

  private saveSessionAttempts(key: string, attempts: number[]): void {
    this.attempts.set(key, attempts);
    try {
      sessionStorage.setItem(`rate_limit_${key}`, JSON.stringify(attempts));
    } catch {}
  }

  /**
   * Check if action is allowed
   */
  canProceed(key: string): boolean {
    const now = Date.now();
    const attempts = this.loadSessionAttempts(key);

    // Remove old attempts outside window
    const validAttempts = attempts.filter(time => now - time < this.windowMs);

    if (validAttempts.length >= this.maxAttempts) {
      this.saveSessionAttempts(key, validAttempts);
      return false;
    }

    validAttempts.push(now);
    this.saveSessionAttempts(key, validAttempts);
    return true;
  }

  /**
   * Get remaining attempts
   */
  getRemainingAttempts(key: string): number {
    const now = Date.now();
    const attempts = this.loadSessionAttempts(key);
    const validAttempts = attempts.filter(time => now - time < this.windowMs);
    return Math.max(0, this.maxAttempts - validAttempts.length);
  }

  /**
   * Reset attempts for key
   */
  reset(key: string): void {
    this.attempts.delete(key);
    try {
      sessionStorage.removeItem(`rate_limit_${key}`);
    } catch {}
  }
}

// Global rate limiter instance
export const apiRateLimiter = new RateLimiter(10, 60000); // 10 requests per minute

// ===================================================================
// CC12 — Paste-parser, HTML-fragment, voice, and key-redaction helpers
// ===================================================================

/** Max length the paste parser should accept in one shot. */
export const PASTE_TEXT_MAX_LENGTH = 8_192;

/** Max length an HTML fragment should be allowed to occupy. */
export const HTML_FRAGMENT_MAX_LENGTH = 32_768;

// Invisible / dangerous Unicode ranges that have been used for prompt
// injection in real-world CVEs:
//   U+202A–U+202E  bidirectional overrides
//   U+2066–U+2069  isolate controls
//   U+200B–U+200F  zero-width chars
//   U+FEFF        BOM
//   U+0000–U+001F / U+007F–U+009F  control characters
const UNICODE_CONTROL_STRIP = /[ -‏‪-‮⁦-⁩﻿]/g;

/**
 * Strip control chars, bidi overrides, and zero-width sequences from a
 * paste-text payload before it reaches the regex parsers. Truncates
 * to PASTE_TEXT_MAX_LENGTH so a malicious 200MB paste can't lock the
 * main thread.
 */
export function sanitizePasteText(input: string): string {
    if (typeof input !== 'string') return '';
    let cleaned = input.replace(UNICODE_CONTROL_STRIP, '');
    if (cleaned.length > PASTE_TEXT_MAX_LENGTH) {
        cleaned = cleaned.slice(0, PASTE_TEXT_MAX_LENGTH);
    }
    return cleaned;
}

/**
 * A defense-in-depth check that a numeric paste-parser output is
 * finite and within sensible bounds. Returns `null` if the value is
 * unsafe.
 */
export function safeFiniteNumber(value: unknown, min = -1e12, max = 1e12): number | null {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return null;
    if (n < min || n > max) return null;
    return n;
}

// Matches a `<style>…</style>` block, allowing only the static CSS that
// the 3 known dangerouslySetInnerHTML sites inject.
const STYLE_BLOCK_PATTERN = /<style[^>]*>([\s\S]*?)<\/style>/gi;

// Reject patterns inside a style block (expression() and javascript:
// URLs are classic XSS vectors that survived in some legacy code).
const STYLE_BAD_PATTERNS = [
    /expression\s*\(/i,
    /behavior\s*:/i,
    /javascript\s*:/i,
    /@import/i,
    /url\(\s*['"]?\s*javascript:/i
];

/**
 * Sanitize a HTML fragment that is known to be CSS / keyframe blocks
 * (the only use case in the app today). Strips anything that is not a
 * `<style>` block, and rejects style blocks that contain expression()
 * or javascript: URLs.
 */
export function sanitizeStyleFragment(input: string): string {
    if (typeof input !== 'string') return '';
    if (input.length > HTML_FRAGMENT_MAX_LENGTH) {
        input = input.slice(0, HTML_FRAGMENT_MAX_LENGTH);
    }
    const matches = input.match(STYLE_BLOCK_PATTERN);
    if (!matches) return '';
    return matches.filter(block => {
        for (const bad of STYLE_BAD_PATTERNS) {
            if (bad.test(block)) return false;
        }
        return true;
    }).join('\n');
}

/**
 * Redact an API key for safe display in logs, debug panels, and error
 * messages. Returns a `sk-…xyz` form. If the key is shorter than 8
 * chars, fully redact it.
 */
export function redactApiKey(key: string | null | undefined): string {
    if (!key || typeof key !== 'string') return '∅';
    if (key.length < 8) return '••••';
    return `${key.slice(0, 3)}…${key.slice(-3)}`;
}

/** Redact a list of API keys. Useful for the "key pool" debug screen. */
export function redactApiKeys(keys: ReadonlyArray<string>): string[] {
    return keys.map(redactApiKey);
}

/**
 * The voice transcript comes in raw from the browser's
 * `SpeechRecognition` API. Sanitize by:
 *   1. Truncating to 256 chars (real voice commands are <50).
 *   2. Stripping the same Unicode control set as the paste-parser.
 *   3. Trimming whitespace.
 */
export function sanitizeVoiceTranscript(transcript: string): string {
    if (typeof transcript !== 'string') return '';
    let cleaned = transcript.replace(UNICODE_CONTROL_STRIP, '');
    if (cleaned.length > 256) cleaned = cleaned.slice(0, 256);
    return cleaned.trim();
}
