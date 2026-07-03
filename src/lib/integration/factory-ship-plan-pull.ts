/**
 * WMS → 製造(CraftSmile) 発送予定ライブ取得（検品照合グリッド用）。
 *   GET {FACTORY_BASE_URL}/api/wms/ship-plan?date=YYYY-MM-DD
 *   署名：X-WMS-Signature / X-WMS-Timestamp（HMAC `${ts}\n` ＝body空・FACTORY_OUTBOUND_HMAC_SECRET）。
 *
 * 検品照合を開く/更新するたびに呼び、その発送日の 発送予定数/18時確定数/製造部署 を「今の値」で取得する。
 * 連携未設定/不達時は null を返す（呼び出し側は FactoryShipPlan キャッシュにフォールバック）。
 */

import { getFactoryBaseUrl, getFactoryOutboundSecret } from './factory-mode';
import { signWmsRequest } from './factory-notify';

export type LiveShipPlanItem = {
  productCode: string;
  productName: string | null;
  productionDeptCode: string | null;
  productionDeptName: string | null;
  plannedQty: number;
  confirmedQty: number | null;
};

export async function fetchLiveShipPlan(
  dateYmd: string,
  timeoutMs = 8000,
): Promise<LiveShipPlanItem[] | null> {
  const baseUrl = getFactoryBaseUrl();
  const secret = getFactoryOutboundSecret();
  if (!baseUrl || !secret) return null;

  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signWmsRequest(secret, timestamp, '');
  const url = `${baseUrl}/api/wms/ship-plan?date=${encodeURIComponent(dateYmd)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-WMS-Signature': signature, 'X-WMS-Timestamp': timestamp },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as
      | { data?: { items?: LiveShipPlanItem[] } }
      | null;
    return json?.data?.items ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
