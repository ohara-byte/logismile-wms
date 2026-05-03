/**
 * GET /api/progress/stream  — Server-Sent Events
 *
 * 管理 PC のリアルタイム更新チャネル。
 *
 * イベント:
 *   init      : 接続直後に現在のバッジ件数を送信
 *   badge     : バッジ件数が変化したときに送信
 *   :hb       : 30 秒ごとのハートビート（コメント行）
 *
 * フェーズ 1 はサーバ側で 5 秒ポーリングし、変化があれば push する
 * 「擬似 SSE」。将来 Postgres LISTEN/NOTIFY 等に置き換える前提。
 *
 * EventSource はブラウザ側で自動再接続するため、サーバはストリームを
 * 単に閉じれば良い。
 */

import { requireRole } from '@/lib/auth/permissions';
import { getBadgeCounts, badgesEqual, type BadgeCounts } from '@/lib/dashboard/badges';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastBadges: BadgeCounts | null = null;

      function safeEnqueue(chunk: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* connection already gone */
        }
      }

      function sendEvent(event: string, data: unknown) {
        safeEnqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }

      function sendHeartbeat() {
        safeEnqueue(`: hb ${Date.now()}\n\n`);
      }

      // 初期送信
      try {
        lastBadges = await getBadgeCounts();
        sendEvent('init', lastBadges);
      } catch (e) {
        sendEvent('error', { message: String(e) });
      }

      // 5 秒ポーリング → 差分があれば badge イベント
      const pollTimer = setInterval(async () => {
        if (closed) return;
        try {
          const cur = await getBadgeCounts();
          if (!lastBadges || !badgesEqual(cur, lastBadges)) {
            sendEvent('badge', cur);
            lastBadges = cur;
          }
        } catch {
          /* スキップ */
        }
      }, POLL_INTERVAL_MS);

      // 30 秒ハートビート（プロキシのアイドルタイムアウト対策）
      const hbTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

      // クライアント切断のクリーンアップ
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(pollTimer);
        clearInterval(hbTimer);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      };
      req.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx 等が来ても buffer しないように
      'X-Accel-Buffering': 'no',
    },
  });
}
