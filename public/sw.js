const CACHE_NAME = 'earth-reboot-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
];

// インストール時にキャッシュ
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// 古いキャッシュを削除
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ネットワーク優先、失敗時はキャッシュを返す
self.addEventListener('fetch', (e) => {
  // APIリクエストとPOSTはキャッシュしない
  if (e.request.url.includes('/api/') || e.request.method !== 'GET') {
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── プッシュ通知受信 ──────────────────────────
self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || '🌍 地球再起動時間';
  const options = {
    body: data.body || '地球の状況を確認してください。',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    data: { url: data.url || 'https://earth-reboot.vercel.app' },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// 通知タップで画面を開く
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || 'https://earth-reboot.vercel.app';
  e.waitUntil(clients.openWindow(url));
});
