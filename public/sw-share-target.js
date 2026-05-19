/* A3 — share-target service worker.
 *
 * Registered lazily by `services/shareIngestService.ts` on first call.
 * Stays a static file in public/ so vite-plugin-pwa's Workbox SW (sw.js)
 * is unaffected. We co-exist by handling ONLY the share POST.
 *
 *   - Listens for POST /?shared=1
 *   - Parses the multipart/form-data body
 *   - Stashes image blob in `share-inbox` Cache API under /blob/<uuid>
 *   - Stashes title/text/url in same cache under /meta/<uuid>
 *   - Redirects to /?shared=1&ready=1&sid=<uuid>
 *
 * The page then reads the stashed payload via `caches.open('share-inbox')`
 * in `shareIngestService.readSharePayload(sid)`.
 */
const SHARE_INBOX_CACHE = 'share-inbox';

self.addEventListener('install', () => {
    // Activate this SW immediately so the first share after install works.
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'POST') return;
    let url;
    try {
        url = new URL(req.url);
    } catch {
        return;
    }
    if (url.pathname !== '/' || !url.search.includes('shared=1')) return;
    event.respondWith(handleShare(req));
});

async function handleShare(request) {
    let form;
    try {
        form = await request.formData();
    } catch (err) {
        // Could not parse multipart. Fall through to a 400.
        return new Response('Could not read share payload.', { status: 400 });
    }

    const title = stringOrEmpty(form.get('title'));
    const text = stringOrEmpty(form.get('text'));
    const url = stringOrEmpty(form.get('url'));
    const file = form.get('image'); // File | string | null

    const id = randomId();
    const cache = await caches.open(SHARE_INBOX_CACHE);

    // Stash the image blob (if any). File.size is the spec signal for
    // "no file" — when a form field is missing, form.get returns null.
    if (file && typeof file === 'object' && typeof file.size === 'number' && file.size > 0) {
        const headers = { 'content-type': file.type || 'application/octet-stream' };
        await cache.put(`/blob/${id}`, new Response(file, { headers }));
    }

    // Stash the metadata (always present, even if image is null).
    const meta = { id, title, text, url };
    await cache.put(
        `/meta/${id}`,
        new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } })
    );

    // 303 See Other so the browser issues a GET to the redirect target.
    return Response.redirect(`/?shared=1&ready=1&sid=${encodeURIComponent(id)}`, 303);
}

function stringOrEmpty(v) {
    if (typeof v === 'string') return v;
    return '';
}

function randomId() {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
        /* fall through */
    }
    // Fallback for environments without crypto.randomUUID.
    return 'sid-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
