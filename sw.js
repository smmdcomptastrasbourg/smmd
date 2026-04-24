const CACHE = 'smmd-v4';
const ASSETS = [
    './',
    './index.html',
    './user.html',
    './chef.html',
    './admin.html',
    './config.js',
    './manifest.json',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
    // Note: tailwindcss CDN intentionnellement exclu (bloque CORS depuis SW)
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE)
            .then(c => c.addAll(ASSETS))
            .catch(() => {}) // Ne pas bloquer l'install si un asset échoue
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

    // Ne jamais cacher : Supabase API, tailwindcss CDN, Edge Functions
    if (url.hostname.includes('supabase.co') ||
        url.hostname.includes('tailwindcss.com') ||
        url.hostname.includes('googleapis.com')) {
        return;
    }

    // Assets statiques → network-first avec fallback cache
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
