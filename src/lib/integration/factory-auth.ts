/**
 * 工場連携 HMAC 認証（Sprint Z-8）
 *
 * 製造システムからの Push リクエストを検証する。
 * 仕様詳細は `WMS_工場連携IF仕様書_v0.1.md` 参照。
 *
 * 検証順:
 *   1. X-Factory-Signature / X-Factory-Timestamp ヘッダの存在
 *   2. タイムスタンプの ±300 秒以内
 *   3. HMAC-SHA256(secret, timestamp + "\n" + body) の一致
 *   4. Idempotency-Key の重複チェック（呼び出し側で実施）
 */

import crypto from 'node:crypto';
import {
  getFactoryWebhookSecret,
  FACTORY_TIMESTAMP_TOLERANCE_SEC,
} from './factory-mode';

export type FactoryAuthResult =
  | { ok: true; idempotencyKey: string }
  | { ok: false; status: number; message: string };

/**
 * リクエストの認証ヘッダ＆署名を検証。
 * 呼び出し側で `await req.text()` 済の生 body 文字列を渡すこと
 * （`req.json()` 経由だとシリアライズ差で署名が一致しなくなるため）。
 */
export function verifyFactoryRequest(
  req: Request,
  rawBody: string,
): FactoryAuthResult {
  const secret = getFactoryWebhookSecret();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      message:
        'FACTORY_WEBHOOK_SECRET が未設定です（factory_api モード時は必須）',
    };
  }

  const sig = req.headers.get('X-Factory-Signature');
  const ts = req.headers.get('X-Factory-Timestamp');
  const idem = req.headers.get('Idempotency-Key');
  if (!sig || !ts) {
    return {
      ok: false,
      status: 401,
      message: 'X-Factory-Signature / X-Factory-Timestamp が必要です',
    };
  }
  if (!idem) {
    return {
      ok: false,
      status: 400,
      message: 'Idempotency-Key ヘッダが必要です',
    };
  }

  // タイムスタンプチェック（±300 秒）
  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, status: 401, message: 'タイムスタンプが不正です' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > FACTORY_TIMESTAMP_TOLERANCE_SEC) {
    return {
      ok: false,
      status: 401,
      message: `タイムスタンプの差が大きすぎます（許容 ${FACTORY_TIMESTAMP_TOLERANCE_SEC}s）`,
    };
  }

  // HMAC 計算
  const canonical = `${ts}\n${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(canonical)
    .digest('hex');

  // 定数時間比較
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 401, message: '署名が一致しません' };
  }

  return { ok: true, idempotencyKey: idem };
}

/**
 * Idempotency-Key の重複検出（in-memory・本番は Redis 推奨）。
 * 30 日以内に同一 key を見たら true。
 */
const idempotencyStore = new Map<string, { storedAt: number; response: unknown }>();
const IDEM_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function checkIdempotency(key: string): { duplicate: false } | { duplicate: true; response: unknown } {
  const now = Date.now();
  // 古い key の掃除（軽量 GC）
  if (idempotencyStore.size > 5000) {
    for (const [k, v] of idempotencyStore) {
      if (now - v.storedAt > IDEM_TTL_MS) idempotencyStore.delete(k);
    }
  }
  const existing = idempotencyStore.get(key);
  if (existing && now - existing.storedAt <= IDEM_TTL_MS) {
    return { duplicate: true, response: existing.response };
  }
  return { duplicate: false };
}

export function rememberIdempotency(key: string, response: unknown): void {
  idempotencyStore.set(key, { storedAt: Date.now(), response });
}
