const CACHE = 'smmd-v12';
const ASSETS = [
    './',
    './index.html',
    './user.html',
    './chef.html',
    './admin.html',
    './config.js',
    './tailwind.css',
    './user.js',
    './chef.js',
    './admin.js',
    './chat.js',
    './chat.html',
    './manifest.json',
    './icon-192.png',
    './icon-192-maskable.png',
    './icon-512.png',
    './icon-512-maskable.png',
    './v2/index.html',
    './v2/style.css',
    './v2/commun.js',
    './v2/membre.html',
    './v2/membre.js',
    './v2/chef.html',
    './v2/chef.js',
    './v2/admin.html',
    './v2/admin.js',
    './v2/chat-theme.css'
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
    if (e.request.method !== 'GET') return;
    const url = new URL(e.request.url);
    // Jamais de cache pour les données Supabase (API, fonctions, stockage)
    if (url.hostname.includes('supabase.co')) return;

    // Fichiers de l'app et bibliothèques (CDN) : réseau d'abord, cache si hors connexion
    e.respondWith(
        fetch(e.request, url.origin === location.origin ? { cache: 'no-cache' } : undefined)
            .then(res => {
                if (res && (res.status === 200 || res.type === 'opaque')) {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return res;
            })
            .catch(() => caches.match(e.request).then(r => r || caches.match(e.request, { ignoreSearch: true })))
    );
});

self.addEventListener('message', e => {
    if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
