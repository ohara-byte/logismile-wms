/**
 * WMS → 製造システム Webhook 送信（2026-06-01 依頼 B2 / doc 13・doc 05 §8）
 *
 * 検品完了通知を製造システムへ送る。
 *   URL    : POST {FACTORY_BASE_URL}/api/wms/inspection-complete
 *   ヘッダ : X-WMS-Signature / X-WMS-Timestamp / Idempotency-Key
 *            Content-Type: application/json; charset=utf-8
 *   署名   : HMAC-SHA256(secret, `${timestamp}\n${body}`) の hex（製造側と同方式）
 *   Idempotency-Key: `${deliveryNo}_${inspectedAt-epoch}`
 *
 * シークレットは FACTORY_OUTBOUND_HMAC_SECRET（製造側 WMS_TO_FACTORY_SECRET と同一値）。
 * FACTORY_DRY_RUN=true の間は実送信せず log のみ（既定・安全側）。
 */

import crypto from 'node:crypto';
import {
  getFactoryOutboundSecret,
  getFactoryBaseUrl,
  isFactoryOutboundDryRun,
} from './factory-mode';

/** 検品完了 Webhook の 1 明細（製造側が期待する形）。 */
export interface InspectionCompleteItem {
  productCode: string;
  /** 納品時に申告された数量 */
  qtyDeclared: number;
  /** WMS で実際に検品した数量 */
  qtyInspected: number;
  /** qtyInspected - qtyDeclared（過不足。0 なら一致） */
  qtyDiff: number;
  /** 差分理由コード（任意） */
  diffReason?: string | null;
  /** 差分の補足メモ（任意） */
  diffNote?: string | null;
}

/** 検品完了 Webhook の payload（製造側が期待する形）。 */
export interface InspectionCompletePayload {
  deliveryNo: string;
  /** ISO8601。例 "2026-06-01T17:55:00Z" */
  inspectedAt: string;
  inspectedBy: string;
  items: InspectionCompleteItem[];
}

export type FactoryNotifyResult =
  | {
      ok: true;
      dryRun: boolean;
      status?: number;
      /** 製造側が差分時に返す追加納品要否 */
      additionalDeliveryRequired?: boolean;
      response?: unknown;
    }
  | { ok: false; status?: number; message: string };

/**
 * X-WMS-Signature を生成。
 * canonical = `${timestamp}\n${body}` を HMAC-SHA256 し hex で返す。
 */
export function signWmsRequest(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}\n${body}`)
    .digest('hex');
}

/** Idempotency-Key を生成： `${deliveryNo}_${inspectedAt-epoch}` */
export function buildIdempotencyKey(
  deliveryNo: string,
  inspectedAt: string,
): string {
  const epoch = Math.floor(new Date(inspectedAt).getTime() / 1000);
  return `${deliveryNo}_${epoch}`;
}

/**
 * 検品完了 Webhook を製造システムへ送信する。
 *
 * @param payload 送信内容
 * @param opts.nowEpochSec 署名タイムスタンプ（テスト用に固定可。省略時は現在時刻）
 * @param opts.timeoutMs   タイムアウト（既定 10 秒）
 */
export async function notifyInspectionComplete(
  payload: InspectionCompletePayload,
  opts: { nowEpochSec?: number; timeoutMs?: number } = {},
): Promise<FactoryNotifyResult> {
  const secret = getFactoryOutboundSecret();
  const baseUrl = getFactoryBaseUrl();

  // 送信内容は確定形に整形（キー順を固定して署名の再現性を担保）
  const body = JSON.stringify({
    deliveryNo: payload.deliveryNo,
    inspectedAt: payload.inspectedAt,
    inspectedBy: payload.inspectedBy,
    items: payload.items.map((it) => ({
      productCode: it.productCode,
      qtyDeclared: it.qtyDeclared,
      qtyInspected: it.qtyInspected,
      qtyDiff: it.qtyDiff,
      diffReason: it.diffReason ?? null,
      diffNote: it.diffNote ?? null,
    })),
  });

  const timestamp = String(
    opts.nowEpochSec ?? Math.floor(Date.now() / 1000),
  );
  const idempotencyKey = buildIdempotencyKey(
    payload.deliveryNo,
    payload.inspectedAt,
  );

  // DRY-RUN：実送信せず log だけ（テスト運用中の既定）
  if (isFactoryOutboundDryRun()) {
    console.info(
      `[factory-notify] DRY-RUN inspection-complete deliveryNo=${payload.deliveryNo} ` +
        `items=${payload.items.length} idem=${idempotencyKey}`,
    );
    return { ok: true, dryRun: true };
  }

  if (!secret) {
    return {
      ok: false,
      message:
        'FACTORY_OUTBOUND_HMAC_SECRET が未設定です（送信実装は必須・16 文字以上）',
    };
  }
  if (!baseUrl) {
    return { ok: false, message: 'FACTORY_BASE_URL が未設定です' };
  }

  const signature = signWmsRequest(secret, timestamp, body);
  const url = `${baseUrl}/api/wms/inspection-complete`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-WMS-Signature': signature,
        'X-WMS-Timestamp': timestamp,
        'Idempotency-Key': idempotencyKey,
      },
      body,
      signal: controller.signal,
    });

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* 応答が JSON でない場合は無視 */
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: `製造システムが ${res.status} を返しました`,
      };
    }

    // 製造側は additionalDeliveryRequired を「不足明細の配列 [{productCode, shortageQty}]」で返す。
    //   空配列＝不足なし。配列長で要否を判定（旧 Boolean 判定だと空配列も truthy で誤判定するため）。
    const adrRaw =
      typeof json === 'object' &&
      json !== null &&
      'additionalDeliveryRequired' in json
        ? (json as Record<string, unknown>).additionalDeliveryRequired
        : undefined;
    const additionalDeliveryRequired =
      adrRaw === undefined
        ? undefined
        : Array.isArray(adrRaw)
          ? adrRaw.length > 0
          : Boolean(adrRaw);

    return {
      ok: true,
      dryRun: false,
      status: res.status,
      additionalDeliveryRequired,
      response: json,
    };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error && e.name === 'AbortError'
          ? '製造システムへの送信がタイムアウトしました'
          : `送信エラー: ${String(e)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
