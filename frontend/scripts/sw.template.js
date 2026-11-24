/* LUXA service worker (Fase 5b): caches the in-browser engine so later visits load offline-fast.
 * Engine files (luxa-engine/, samples/) are cache-first under a versioned cache; the app shell is
 * network-first so a new deploy shows up on the next visit. Model files never pass through here
 * (they are read from disk with the File API and kept in IndexedDB). */
const ENGINE_CACHE = 'luxa-engine-__ENGINE_VERSION__';
const SHELL_CACHE = 'luxa-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('luxa-engine-') && k !== ENGINE_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isEngine = url.pathname.includes('/luxa-engine/') || url.pathname.includes('/samples/');
  if (isEngine && !url.pathname.endsWith('/manifest.json')) {
    event.respondWith(
      caches.open(ENGINE_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  if (req.mode === 'navigate' || url.pathname.includes('/assets/')) {
    // Halaman selalu dicek ulang ke server (cache HTTP GitHub Pages bisa menahan index.html
    // sampai 10 menit); file di /assets/ bernama hash jadi aman dari cache biasa.
    const fresh = req.mode === 'navigate' ? fetch(req, { cache: 'no-cache' }) : fetch(req);
    event.respondWith(
      fresh
        .then((res) => {
          if (res.ok) {
            // Salin SEBELUM respons dikembalikan: setelah halaman membaca body, clone() gagal
            // ("Response body is already used") dan file tidak pernah tersimpan ke cache.
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error())),
    );
  }
});
