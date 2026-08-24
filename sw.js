const CACHE = 'smmd-v6';
const ASSETS = [
    './',
    './index.html',
    './user.html',
    './chef.html',
    './admin.html',
    './config.js',
    './manifest.json',
    './icon-192.png',
    './icon-192-maskable.png',
    './icon-512.png',
    './icon-512-maskable.png'
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE)
            .then(c => c.addAll(ASSETS))
            .catch(() => {})
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // Ne jamais cacher : Supabase, CDNs externes, Edge Functions
    if (url.hostname.includes('supabase.co') ||
        url.hostname.includes('tailwindcss.com') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('jsdelivr.net') ||
        url.hostname.includes('cdnjs.cloudflare.com') ||
        url.hostname.includes('fonts.gstatic.com')) {
        return;
    }

    // Assets locaux → network-first avec fallback cache
    e.respondWith(
        fetch(e.request)
            .then(res => {
                if (res && res.status === 200 && res.type !== 'opaque') {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});

self.addEventListener('message', e => {
    if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
