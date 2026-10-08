/**
 * OENO EC Hub（HUB）→ LogiSmile 受信 API の認証（2026-10-08・ohara 様「HUB 起点で連携」）。
 *
 * 方式は工場連携（factory-auth.ts）と同じ HMAC-SHA256
 *   canonical = `${timestamp}\n${rawBody}` / hex / 時刻 ±300 秒 / Idempotency-Key 必須
 * をヘッダ名だけ変えて使う（X-Hub-Signature / X-Hub-Timestamp）。Craftsmile の HUB 受け口
 * （craftsmile-mfg src/lib/hub/auth.ts・ADR-044）と同じ式・同じ基準値。
 *
 * 工場連携と違う点（意図的）：
 *   - 鍵は **32 文字以上**（未満・未設定は 503）
 *   - 署名は hex として比較し、hex 以外は 401
 *   - 冪等キーは DB に持つ（hub-idempotency.ts。工場連携はプロセス内メモリで再起動で消える）
 *
 * ★ 基準値は src/lib/__tests__/hub-contract.test.ts で HUB・Craftsmile と共有している。
 */

import crypto from 'node:crypto';

export const HUB_HEADERS = {
  signature: 'x-hub-signature',
  timestamp: 'x-hub-timestamp',
  idempotencyKey: 'idempotency-key',
} as const;

export const HUB_SECRET_MIN_LENGTH = 32;
export const HUB_TIMESTAMP_TOLERANCE_SEC = 300;

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/** HUB 連携の受け口を開けるか（既定は閉じる）。 */
export function isHubIntegrationEnabled(): boolean {
  return (process.env.HUB_INTEGRATION_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/** HUB → LogiSmile の鍵（HUB 側 ECHUB_LOGISMILE_HMAC_SECRET と同じ値）。32 文字未満は null。 */
export function getHubInboundSecret(): string | null {
  const s = (process.env.HUB_TO_WMS_SECRET ?? '').trim();
  return s.length >= HUB_SECRET_MIN_LENGTH ? s : null;
}

export function hubSignature(secret: string, timestamp: number, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}\n${rawBody}`).digest('hex');
}

export type HubAuthInput = {
  secret: string | null | undefined;
  signature: string | null;
  timestamp: string | null;
  idempotencyKey: string | null;
  rawBody: string;
  /** 現在時刻（UNIX 秒）。省略時は Date.now() */
  nowSec?: number;
};

export type HubAuthResult =
  | { ok: true; idempotencyKey: string }
  | { ok: false; status: 400 | 401 | 503; message: string };

export function verifyHubRequest(input: HubAuthInput): HubAuthResult {
  const secret = input.secret ?? '';
  if (secret.length < HUB_SECRET_MIN_LENGTH) {
    return { ok: false, status: 503, message: 'HUB 連携の鍵（HUB_TO_WMS_SECRET）が未設定です' };
  }
  if (!input.signature || !input.timestamp) {
    return { ok: false, status: 401, message: 'X-Hub-Signature / X-Hub-Timestamp が必要です' };
  }
  if (!/^\d+$/.test(input.timestamp)) {
    return { ok: false, status: 401, message: 'タイムスタンプが不正です' };
  }
  const ts = Number(input.timestamp);
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > HUB_TIMESTAMP_TOLERANCE_SEC) {
    return { ok: false, status: 401, message: `タイムスタンプの差が大きすぎます（許容 ${HUB_TIMESTAMP_TOLERANCE_SEC}s）` };
  }
  const expected = hubSignature(secret, ts, input.rawBody);
  if (!/^[0-9a-f]{64}$/.test(input.signature)) {
    return { ok: false, status: 401, message: '署名が一致しません' };
  }
  if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(input.signature, 'hex'))) {
    return { ok: false, status: 401, message: '署名が一致しません' };
  }
  const key = input.idempotencyKey ?? '';
  if (!IDEMPOTENCY_KEY_RE.test(key)) {
    return { ok: false, status: 400, message: 'Idempotency-Key が無いか不正です' };
  }
  return { ok: true, idempotencyKey: key };
}
