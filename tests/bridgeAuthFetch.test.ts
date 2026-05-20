// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock firebase services - no network, no real auth.
const { mockAuth } = vi.hoisted(() => ({
    mockAuth: {
        currentUser: {
            getIdToken: vi.fn().mockResolvedValue('test-firebase-token'),
        } as any,
    },
}));

vi.mock('../lib/firebase', () => ({
    getFirebaseAuthServices: vi.fn().mockResolvedValue({ auth: mockAuth }),
}));

describe('bridgeAuthFetch', () => {
    let originalFetch: typeof window.fetch;
    let spy: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        delete (window as unknown as { __bridgeAuthFetchInstalled?: boolean }).__bridgeAuthFetchInstalled;
        originalFetch = window.fetch;
        mockAuth.currentUser = {
            getIdToken: vi.fn().mockResolvedValue('test-firebase-token'),
        };
        // Spy goes in FIRST, then install() wraps it.
        spy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
        window.fetch = spy as unknown as typeof window.fetch;
    });

    afterEach(() => {
        window.fetch = originalFetch;
    });

    const install = async () => {
        const mod = await import('../services/bridgeAuthFetch');
        mod.installBridgeAuthFetch();
        return mod;
    };

    const authHeaderOf = (callIndex = 0): string | null => {
        const [input, init] = spy.mock.calls[callIndex];
        const source = init?.headers ?? (typeof input !== 'string' && !(input instanceof URL) ? (input as Request).headers : undefined);
        return new Headers(source).get('Authorization');
    };

    it('attaches Firebase token to /api/python-nse requests', async () => {
        await install();
        await window.fetch('http://localhost:3000/api/python-nse/api/backup/upload', { method: 'POST' });
        expect(authHeaderOf()).toBe('Bearer test-firebase-token');
    });

    it('attaches token to /api/agentic-bridge requests', async () => {
        await install();
        await window.fetch('/api/agentic-bridge/api/sync/push');
        expect(authHeaderOf()).toBe('Bearer test-firebase-token');
    });

    it('does NOT touch non-bridge requests', async () => {
        await install();
        await window.fetch('https://api.upstox.com/quote');
        expect(authHeaderOf()).toBeNull();
        expect(String(spy.mock.calls[0][0])).toContain('upstox');
    });

    it('preserves existing Authorization headers on Request objects', async () => {
        await install();
        const req = new Request('http://localhost:3000/api/python-nse/api/health', {
            headers: { Authorization: 'Bearer existing', 'X-Custom': 'yes' },
        });
        await window.fetch(req);
        const [input] = spy.mock.calls[0];
        const headers = new Headers((input as Request).headers);
        expect(headers.get('Authorization')).toBe('Bearer existing');
        expect(headers.get('X-Custom')).toBe('yes');
    });

    it('is idempotent - double install does not double-wrap', async () => {
        await install();
        const afterFirst = window.fetch;
        await install();
        expect(window.fetch).toBe(afterFirst);
    });

    it('skips decoration when no user is logged in', async () => {
        mockAuth.currentUser = null;
        await install();
        await window.fetch('http://localhost:3000/api/python-nse/api/health');
        expect(authHeaderOf()).toBeNull();
    });
});
