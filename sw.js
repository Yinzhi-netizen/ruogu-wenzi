const cachePrefix = "ruogu-wenzi-";
const cacheName = `${cachePrefix}v4`;
const strokeCache = `${cachePrefix}strokes`;
const assets = [
  "./",
  "./index.html",
  "./wenzi.css?v=4",
  "./app.js?v=3",
  "./writing.js?v=4",
  "./data/writing.js?v=3",
  "./data/writing-usage.js?v=4",
  "./data/word-pinyin.js?v=4",
  "./assets/文字印刷机.jpg",
  "./assets/fonts/ruogu-kai.woff2",
  "./licenses/COW-LICENSE.txt",
  "./licenses/WenKai-OFL.txt",
  "./vendor/hanzi-writer.min.js",
  "./data/chars.js?v=1",
  "./data/lexicon.js?v=3",
  "./data/cards.js?v=1",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(
        keys.filter((key) => key.startsWith(cachePrefix) && key !== cacheName && key !== strokeCache).map((key) => caches.delete(key))
      )),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  // 笔顺数据不会变：缓存优先，查过一次就离线可用
  if (url.pathname.includes("/strokes/")) {
    event.respondWith(caches.open(strokeCache).then((cache) => cache.match(request).then((hit) => hit || fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    }))));
    return;
  }
  // 代码与词库：网络优先，确保更新立即生效；断网回退缓存
  event.respondWith(
    fetch(request).then((response) => {
      if (!response.ok) return caches.match(request).then(hit => hit || response);
      const copy = response.clone();
      caches.open(cacheName).then((cache) => cache.put(request, copy)).catch(() => {});
      return response;
    }).catch(() => caches.match(request))
  );
});
