/**
 * POST /api/integration/hub/orders
 *
 * OENO EC Hub（HUB）→ WMS: 出荷指示（2026-10-08・小原様「HUB 起点で連携」）。
 * Phase1 は田舎主義 → HUB → WMS の中継で、中身は現行の Thomas 出荷指示 17 列（hub-payload.ts）。
 * CSV 取込と**同じ登録処理**（thomas-import.ts）を通し、伝票ごとの結果（slips）を返す。
 *
 * 認証：HMAC-SHA256（X-Hub-Signature / X-Hub-Timestamp）＋ Idempotency-Key・鍵 HUB_TO_WMS_SECRET。
 * HUB_INTEGRATION_ENABLED=true のときだけ有効（既定は 503）。
 */

import { HUB_STAFF_CODE, handleHubImport } from '@/lib/integration/hub-handler';
import { getHubInboundSecret, isHubIntegrationEnabled } from '@/lib/integration/hub-auth';
import { findSavedHubResponse, saveHubResponse } from '@/lib/integration/hub-idempotency';
import { importOrderRows, importProductRows } from '@/lib/integration/thomas-import';
import { allocateImportedOrders } from '@/lib/allocation/allocate-on-import';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handleHubImport('orders', req, {
    enabled: isHubIntegrationEnabled(),
    secret: getHubInboundSecret(),
    findSaved: findSavedHubResponse,
    save: saveHubResponse,
    importOrders: importOrderRows,
    importProducts: importProductRows,
    afterOrdersImported: (importId) => allocateImportedOrders(importId, HUB_STAFF_CODE),
  });
}
