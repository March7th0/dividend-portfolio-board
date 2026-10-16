/* ============================================================
   sw.js —— 长期组合作战台 PWA Service Worker（R75）
   ============================================================
   策略：
   · 应用外壳（HTML / manifest / 图标）：cache-first + 后台静默更新
     （stale-while-revalidate）——离线秒开，联网自动换新；
   · GitHub API / raw.githubusercontent：一律直连不缓存
     （数据必须新鲜，SW 不做数据层的中间商——数据真相源在私有数据仓，
      离线时页面靠自身 localStorage 缓存兜底）；
   · 导航请求：network-first，失败回落缓存的外壳（离线可用）；
   · 升级：activate 时清旧版本缓存，skipWaiting + clients.claim 即时接管。
   注意：本文件会被 sync_public.ps1 同步进公开仓；除公开信息外不含任何内容。
   ============================================================ */
'use strict';
var CACHE = 'zzt-v61-r75';
var SHELL = [
  './',
  './index.html',
  './portfolio-workbench.html',
  './manifest.webmanifest',
  './tools/icons/icon-192.png',
  './tools/icons/icon-512.png',
  './tools/icons/icon-512-maskable.png',
  './tools/icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* 逐个 add：单个 404 不拖垮整个安装 */
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       /* 写操作不进 SW */
  var u = new URL(req.url);
  if (u.origin !== self.location.origin) return;          /* 跨域（GitHub API）直连 */

  if (req.mode === 'navigate') {
    /* 导航：先网后缓存，保证永远拿得到可用页面 */
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match('./portfolio-workbench.html').then(function (r) {
          return r || new Response('离线且无缓存', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        });
      })
    );
    return;
  }

  /* 同源静态资源：cache-first + 后台更新 */
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) {
          var cp = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, cp); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
