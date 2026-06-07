/**
 * 最小限の Service Worker
 *  - PWA インストール条件を満たすためだけの passthrough 実装
 *  - キャッシュは行わず、すべてのリクエストはネットワーク直送
 *  - 業務システムは常に最新データが必要なため、オフラインキャッシュは敢えて入れない
 */

self.addEventListener('install', () => {
  // 即座に新しい SW を有効化
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // すぐにクライアント制御を引き継ぐ
  event.waitUntil(self.clients.claim());
});

// fetch ハンドラは何もしない（ブラウザ既定のネットワーク処理に任せる）
self.addEventListener('fetch', () => {
  // no-op
});
