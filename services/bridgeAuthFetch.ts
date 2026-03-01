/**
 * bridgeAuthFetch.ts
 * -----------------------------------------------------------------------------
 * Installs a one-time global fetch wrapper that attaches the logged-in user's
 * Firebase ID token to every request heading to the Python bridge
 * (/api/python-nse, /api/agentic-bridge).
 *
 * Why: the bridge rejects remote (proxied/tunnel) requests without a valid
 * identity token (python-bridge/services/auth_guard.py). Direct localhost
 * calls never need it, so local tooling is unaffected.
 *
 * Token lifecycle: getIdToken() auto-refreshes expired tokens; we cache for
 * 50 minutes to keep the hot path synchronous-cheap.
 * -----------------------------------------------------------------------------
 */

import { getFirebaseAuthServices } from '../lib/firebase';

const BRIDGE_PATH_PREFIXES = ['/api/python-nse', '/api/agentic-bridge', '/api/sync'];

const TOKEN_TTL_MS = 50 * 60 * 1000; // refresh well before the 60min expiry

let cachedToken: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

export async function getBridgeIdToken(): Promise<string | null> {
    if (cachedToken && Date.now() < cachedToken.expiresAt) {
        return cachedToken.token;
    }
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            const { auth } = await getFirebaseAuthServices();
            const user = auth.currentUser;
            if (!user) {
                cachedToken = null;
                return null;
            }
            const token = await user.getIdToken();
            cachedToken = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
            return token;
        } catch {
            return null;
        } finally {
            inflight = null;
        }
    })();

    return inflight;
}

function extractPath(url: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) {
        try {
            return new URL(url).pathname;
        } catch {
            return '';
        }
    }
    return url.split('?')[0];
}

/** True when this fetch targets the Python bridge and needs the identity header. */
export function isBridgeRequest(url: string): boolean {
    if (url.includes(':8765/') || url.includes('/api/sync') || url.includes('wealthos-sudhanshu.xyz/api/python-nse')) {
        return true;
    }
    const path = extractPath(url);
    return BRIDGE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Idempotently patches window.fetch so every bridge call carries the
 * Firebase identity token. Safe to call multiple times.
 */
export function installBridgeAuthFetch(): void {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { __bridgeAuthFetchInstalled?: boolean };
    if (w.__bridgeAuthFetchInstalled) return;

    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        try {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (isBridgeRequest(url)) {
                const token = await getBridgeIdToken();
                if (token) {
                    const headers = new Headers(init?.headers ?? (typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined));
                    if (!headers.has('Authorization')) {
                        headers.set('Authorization', `Bearer ${token}`);
                    }
                    init = { ...(init ?? {}), headers };
                }
            }
        } catch {
            // Never let auth decoration break a request.
        }
        return originalFetch(input, init);
    };

    w.__bridgeAuthFetchInstalled = true;
}
