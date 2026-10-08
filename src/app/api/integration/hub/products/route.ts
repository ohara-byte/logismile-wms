/**
 * POST /api/integration/hub/products
 *
 * OENO EC Hub（HUB）→ WMS: 商品マスタ（2026-10-08・小原様「HUB 起点で連携」）。
 * Thomas 商品 5 列（「優先連携」= 出荷指示より先に送る）。中身は hub-payload.ts。
 * CSV 取込と**同じ登録処理**（thomas-import.ts）を通し、件数とエラー・警告を返す。
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
  return handleHubImport('products', req, {
    enabled: isHubIntegrationEnabled(),
    secret: getHubInboundSecret(),
    findSaved: findSavedHubResponse,
    save: saveHubResponse,
    importOrders: importOrderRows,
    importProducts: importProductRows,
    afterOrdersImported: (importId) => allocateImportedOrders(importId, HUB_STAFF_CODE),
  });
}
