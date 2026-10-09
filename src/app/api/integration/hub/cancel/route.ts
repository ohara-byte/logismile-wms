/**
 * POST /api/integration/hub/cancel
 *
 * HUB → LogiSmile 当日キャンセル（2026-10-09・小原様「WMS へチャット連絡と検品遮断をしたい」）。
 * callHUB でキャンセルを確定すると HUB が送ってくる。伝票に印を付けて検品を止め、現場へ連絡事項を出す。
 * 本体は hub-cancel.ts（処理順・文面をテストで固定）と hub-cancel-apply.ts（DB）。
 *
 * 認証：HMAC-SHA256（X-Hub-Signature / X-Hub-Timestamp）＋ Idempotency-Key・鍵 HUB_TO_WMS_SECRET。
 * 同じ冪等キーの再送には保存済みの応答を返す（連絡事項を 2 回出さない）。
 * HUB_INTEGRATION_ENABLED=true のときだけ有効（既定は 503）。
 */

import { getHubInboundSecret, isHubIntegrationEnabled } from '@/lib/integration/hub-auth';
import { handleHubCancel } from '@/lib/integration/hub-cancel';
import { applyHubCancel } from '@/lib/integration/hub-cancel-apply';
import { findSavedHubResponse, saveHubResponse } from '@/lib/integration/hub-idempotency';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handleHubCancel(req, {
    enabled: isHubIntegrationEnabled(),
    secret: getHubInboundSecret(),
    findSaved: findSavedHubResponse,
    save: saveHubResponse,
    cancelOrder: applyHubCancel,
  });
}
