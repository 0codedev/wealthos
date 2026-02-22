/**
 * Production-grade logger utility (CC80).
 *
 * Replaces raw `console.*` calls. In production builds, `log` and `debug` are
 * no-ops and `warn`/`error` keep a single-line trace. In dev (or when
 * `localStorage["wa:debug"] === "1"`), all calls render with a `[CC80]`
 * namespace prefix.
 *
 * The component-name convention is `[ComponentName]` — the same shape the
 * raw `console.*` calls already use, so search-and-replace preserves
 * context.
 */

const isDev = (): boolean => {
    if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) return true;
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('wa:debug') === '1') return true;
    } catch {
        /* localStorage may not exist in SSR/test */
    }
    return false;
};

const stamp = (component: string): string => `[CC80][${component}]`;

export const logger = {
    log(component: string, message: string, ...args: unknown[]): void {
        if (!isDev()) return;
        // eslint-disable-next-line no-console
        console.log(stamp(component), message, ...args);
    },
    debug(component: string, message: string, ...args: unknown[]): void {
        if (!isDev()) return;
        // eslint-disable-next-line no-console
        console.debug(stamp(component), message, ...args);
    },
    warn(component: string, message: string, ...args: unknown[]): void {
        if (!isDev()) return;
        // eslint-disable-next-line no-console
        console.warn(stamp(component), message, ...args);
    },
    error(component: string, message: string, ...args: unknown[]): void {
        // Errors always surface — but in prod we drop the verbose trailing
        // error arg, keeping only the message.
        if (!isDev()) {
            // eslint-disable-next-line no-console
            console.error(stamp(component), message);
            return;
        }
        // eslint-disable-next-line no-console
        console.error(stamp(component), message, ...args);
    },
};

export default logger;
