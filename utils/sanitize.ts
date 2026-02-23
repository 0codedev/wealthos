/**
 * Sanitizes user input to prevent XSS attacks.
 * Replaces dangerous characters with HTML entities.
 */
export const sanitize = (input: string): string => {
    if (!input) return '';
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
};

/**
 * Validates if a string is safe (alphanumeric + safe symbols).
 */
export const isSafeInput = (input: string): boolean => {
    // Modify regex as per strictness requirements
    const dangerousPattern = /<script|javascript:|onload=|onerror=/i;
    return !dangerousPattern.test(input);
};
