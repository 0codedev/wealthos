/**
 * CC105 — Inline form validation primitives.
 *
 * Three small hooks/utilities that make a form feel "alive" without
 * pulling in a 50KB form library.
 *
 *   1. `useFieldValidation` — per-field validator that runs on change,
 *      blur, and submit, with debounce, error message, and dirty/touched
 *      state.
 *   2. `validateForm` — synchronous full-form validator that returns
 *      `Record<field, error>`.
 *   3. `formatters` — common input formatters (currency, percent,
 *      account-number, IFSC, PAN) used at input boundaries.
 *
 * Pattern: each validator returns either `null` (valid) or a string
 * (the user-facing error). Errors are displayed only after the field is
 * touched AND dirty, which matches what every modern form library does
 * (Formik, react-hook-form, react-final-form).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type Validator<T> = (value: T) => string | null;
export type AsyncValidator<T> = (value: T) => Promise<string | null>;

export interface FieldValidationResult {
    error: string | null;
    touched: boolean;
    dirty: boolean;
    validating: boolean;
    onBlur: () => void;
    validate: () => Promise<void>;
    reset: () => void;
}

/**
 * Per-field validation state. Runs the validator on every change, but
 * only **shows** the error after the field is touched (i.e. blurred once)
 * AND dirty (i.e. the user has typed something).
 */
export function useFieldValidation<T>(
    value: T,
    validator: Validator<T> | AsyncValidator<T>,
    options: { debounceMs?: number; showOnMount?: boolean } = {}
): FieldValidationResult {
    const { debounceMs = 250, showOnMount = false } = options;
    const [error, setError] = useState<string | null>(null);
    const [touched, setTouched] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [validating, setValidating] = useState(false);
    const initialValue = useRef(value);

    const runValidate = useCallback(async () => {
        setValidating(true);
        try {
            const result = await validator(value);
            setError(result);
        } catch {
            setError('Validation failed');
        } finally {
            setValidating(false);
        }
    }, [validator, value]);

    // Debounced re-validate on value change.
    useEffect(() => {
        if (value !== initialValue.current) setDirty(true);
        if (!showOnMount && !touched) return;
        const t = setTimeout(() => { runValidate(); }, debounceMs);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, touched, debounceMs, showOnMount]);

    const onBlur = useCallback(() => {
        setTouched(true);
        runValidate();
    }, [runValidate]);

    const reset = useCallback(() => {
        setError(null);
        setTouched(false);
        setDirty(false);
    }, []);

    return {
        error: touched && dirty ? error : null,
        touched,
        dirty,
        validating,
        onBlur,
        validate: runValidate,
        reset,
    };
}

export type FormErrors<T extends Record<string, unknown>> = {
    [K in keyof T]?: string;
};

/**
 * Synchronous full-form validator. Returns a `FormErrors` object.
 * Caller is responsible for early-returning on any truthy error.
 *
 * Example:
 *   const errs = validateForm(values, {
 *     email: v => v.includes('@') ? null : 'Email is required',
 *     amount: v => Number(v) > 0 ? null : 'Amount must be positive',
 *   });
 *   if (Object.keys(errs).length) return; // abort submit
 */
export function validateForm<T extends Record<string, unknown>>(
    values: T,
    schema: { [K in keyof T]?: Validator<T[K]> }
): FormErrors<T> {
    const errors: FormErrors<T> = {};
    (Object.keys(schema) as (keyof T)[]).forEach((key) => {
        const validator = schema[key];
        if (!validator) return;
        const result = validator(values[key]);
        if (result) errors[key] = result;
    });
    return errors;
}

/**
 * Common input formatters applied at the input boundary. These do NOT
 * validate — they normalize. Pair with a validator that runs the
 * post-format value.
 */
export const formatters = {
    /** Indian-locale currency string → number (strips ₹, commas). */
    currency: (text: string): number => {
        if (!text) return 0;
        const cleaned = text.replace(/[^\d.\-]/g, '');
        const n = Number(cleaned);
        return Number.isFinite(n) ? n : 0;
    },
    /** Trim, collapse whitespace, capitalize first letter. */
    text: (text: string): string =>
        text.replace(/\s+/g, ' ').trim(),
    /** A-Z, 0-9, no spaces, uppercased. Good for ticket IDs. */
    alphanumeric: (text: string): string =>
        text.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
    /** Indian mobile number → 10-digit, no leading 0 or +91. */
    phone: (text: string): string => {
        const digits = text.replace(/\D/g, '');
        if (digits.startsWith('91') && digits.length === 12) return digits.slice(2);
        if (digits.startsWith('0') && digits.length === 11) return digits.slice(1);
        return digits.slice(0, 10);
    },
    /** IFSC code: 4 letters + 0 + 6 alphanumeric. */
    ifsc: (text: string): string => {
        const cleaned = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        return cleaned.slice(0, 11);
    },
    /** PAN: 5 letters + 4 digits + 1 letter. */
    pan: (text: string): string => {
        const cleaned = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        return cleaned.slice(0, 10);
    },
};

/**
 * Common validators. Each takes a value and returns `null` or a string.
 */
export const validators = {
    required: (msg = 'Required'): Validator<unknown> =>
        (v) => (v == null || v === '' || (Array.isArray(v) && v.length === 0) ? msg : null),
    email: (msg = 'Enter a valid email'): Validator<string> =>
        (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '') ? null : msg),
    minLength: (n: number, msg?: string): Validator<string> =>
        (v) => ((v || '').length >= n ? null : msg ?? `Must be at least ${n} characters`),
    numberRange: (min: number, max: number): Validator<number> =>
        (v) => (Number.isFinite(v) && v >= min && v <= max ? null : `Must be between ${min} and ${max}`),
    isFiniteNumber: (msg = 'Must be a number'): Validator<number> =>
        (v) => (Number.isFinite(v) ? null : msg),
    isPositive: (msg = 'Must be positive'): Validator<number> =>
        (v) => (Number.isFinite(v) && v > 0 ? null : msg),
    isNonNegative: (msg = 'Must be zero or positive'): Validator<number> =>
        (v) => (Number.isFinite(v) && v >= 0 ? null : msg),
};

/**
 * Helper to compose multiple validators. Each runs in order, the first
 * non-null result wins.
 *
 * Example:
 *   const validate = compose<string>(
 *     validators.required('Email is required'),
 *     validators.email(),
 *   );
 */
export function compose<T>(...vs: Validator<T>[]): Validator<T> {
    return (v) => {
        for (const vfn of vs) {
            const result = vfn(v);
            if (result) return result;
        }
        return null;
    };
}
