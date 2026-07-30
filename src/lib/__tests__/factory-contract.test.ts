/**
 * CraftSmile（製造システム）↔ LogiSmile WMS 連携契約テスト
 *
 * 実行: npm test
 *
 * 目的：**両システムのデータ処理の差分を機械的に検知する**こと。
 * 2026-06-01 の連携契約レビューおよび 7 月のライブ pull 連携で合意した
 * 「署名方式・ヘッダ名・URL・payload のキー名」を固定する。
 *
 * 本ファイルの oracle（期待値の根拠）は **CraftSmile 側の実装**：
 *   - `src/lib/wms/hmac.ts`                      … canonical = `${timestamp}\n${body}` / hex
 *   - `src/app/api/wms/ship-plan/route.ts`       … GET・body 空・{ data: { items } } を返す
 *   - `src/app/api/wms/inspection-diff/route.ts` … DiffItem のキー名
 *   - `src/lib/wms/real-client.ts`               … X-Factory-* で WMS へ送信
 * ここでは CraftSmile 側のアルゴリズムを**独立に再実装**して突き合わせる
 * （相手リポジトリを import できないため。差分が出たらどちらかの実装が動いた合図）。
 */

import { test, expect, vi, afterEach } from 'vitest';
import crypto from 'node:crypto';

import { signWmsRequest, buildIdempotencyKey, notifyInspectionDiff } from '../integration/factory-notify';
import { fetchLiveShipPlan } from '../integration/factory-ship-plan-pull';
import { verifyFactoryRequest } from '../integration/factory-auth';
import { parseQrPrintFlag } from '../integration/mapping';

/** テスト用シークレット（16 文字以上でないと factory-mode が null を返す） */
const SECRET = 'test-shared-secret-32bytes-longer';
const BASE_URL = 'https://craftsmile.example.jp';

// ───────────────────────────────────────────────────────────
// CraftSmile 側の実装を独立に再現（oracle）
// craftsmile-mfg/src/lib/wms/hmac.ts と同一アルゴリズム
// ───────────────────────────────────────────────────────────

/** craftsmile: calculateSignature(secret, timestamp, body) */
function craftsmileCalculateSignature(secret: string, timestamp: number, body: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}\n${body}`).digest('hex');
}

/** craftsmile: verifySignature(secret, timestamp, body, signature) */
function craftsmileVerifySignature(
  secret: string,
  timestamp: number,
  body: string,
  signature: string,
): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) return false;
  const expected = craftsmileCalculateSignature(secret, timestamp, body);
  if (expected.length !== signature.length) return false;
  try {
    // craftsmile は hex デコードして定数時間比較（WMS は utf8 比較。W2 の差異）
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────
// 1. 署名の相互運用（WMS → CraftSmile）
// ───────────────────────────────────────────────────────────

test('契約: WMS が生成した X-WMS-Signature を CraftSmile が検証できる（POST・body あり）', () => {
  const ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ shipDate: '2026-07-30', items: [] });

  const sig = signWmsRequest(SECRET, ts, body);

  expect(craftsmileVerifySignature(SECRET, Number(ts), body, sig)).toBe(true);
});

test('契約: GET（body 空）の署名も CraftSmile が検証できる — canonical は `${ts}\\n`', () => {
  const ts = String(Math.floor(Date.now() / 1000));

  // ship-plan の live pull は body 空で署名する
  const sig = signWmsRequest(SECRET, ts, '');

  expect(craftsmileVerifySignature(SECRET, Number(ts), '', sig)).toBe(true);
  // canonical が `${ts}\n` であることを直接固定（区切りが変わると相手が全滅する）
  expect(sig).toBe(crypto.createHmac('sha256', SECRET).update(`${ts}\n`).digest('hex'));
});

test('契約: 署名は hex 64 文字（base64 等に変えたら CraftSmile 側の長さ比較で落ちる）', () => {
  const sig = signWmsRequest(SECRET, '1780000000', '{}');
  expect(sig).toMatch(/^[0-9a-f]{64}$/);
});

test('契約: body が 1 バイトでも違えば検証は失敗する', () => {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = signWmsRequest(SECRET, ts, '{"a":1}');
  expect(craftsmileVerifySignature(SECRET, Number(ts), '{"a":2}', sig)).toBe(false);
});

// ───────────────────────────────────────────────────────────
// 2. 署名の相互運用（CraftSmile → WMS）
// ───────────────────────────────────────────────────────────

function craftsmileDeliveryRequest(body: string, ts: number, secret = SECRET): Request {
  // craftsmile/src/lib/wms/real-client.ts pushDelivery() と同一のヘッダ構成
  return new Request(`${BASE_URL}/api/integration/factory/delivery`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Factory-Signature': craftsmileCalculateSignature(secret, ts, body),
      'X-Factory-Timestamp': String(ts),
      'Idempotency-Key': 'D20260730-ABC123_1780000000',
    },
    body,
  });
}

test('契約: CraftSmile が送る X-Factory-* リクエストを WMS が受理する', () => {
  vi.stubEnv('FACTORY_INBOUND_HMAC_SECRET', SECRET);
  const body = JSON.stringify({ deliveryNo: 'D20260730-ABC123', items: [] });
  const ts = Math.floor(Date.now() / 1000);

  const result = verifyFactoryRequest(craftsmileDeliveryRequest(body, ts), body);

  expect(result.ok).toBe(true);
});

test('契約: タイムスタンプ許容は ±300 秒（両側一致）', () => {
  vi.stubEnv('FACTORY_INBOUND_HMAC_SECRET', SECRET);
  const body = '{}';
  const now = Math.floor(Date.now() / 1000);

  // 299 秒前 → 受理
  expect(verifyFactoryRequest(craftsmileDeliveryRequest(body, now - 299), body).ok).toBe(true);
  // 301 秒前 → 拒否
  const stale = verifyFactoryRequest(craftsmileDeliveryRequest(body, now - 301), body);
  expect(stale.ok).toBe(false);
  if (!stale.ok) expect(stale.status).toBe(401);
});

test('契約: Idempotency-Key 欠如は 400（CraftSmile は必ず付ける）', () => {
  vi.stubEnv('FACTORY_INBOUND_HMAC_SECRET', SECRET);
  const body = '{}';
  const ts = Math.floor(Date.now() / 1000);
  const req = new Request(`${BASE_URL}/x`, {
    method: 'POST',
    headers: {
      'X-Factory-Signature': craftsmileCalculateSignature(SECRET, ts, body),
      'X-Factory-Timestamp': String(ts),
    },
    body,
  });

  const r = verifyFactoryRequest(req, body);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.status).toBe(400);
});

test('契約: シークレット不一致は 401（鍵の取り違えを検知）', () => {
  vi.stubEnv('FACTORY_INBOUND_HMAC_SECRET', SECRET);
  const body = '{}';
  const ts = Math.floor(Date.now() / 1000);

  const r = verifyFactoryRequest(
    craftsmileDeliveryRequest(body, ts, 'another-secret-that-is-32-bytes!!'),
    body,
  );

  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.status).toBe(401);
});

// ───────────────────────────────────────────────────────────
// 3. Idempotency-Key の形式（doc 13 §2-10）
// ───────────────────────────────────────────────────────────

test('契約: 検品完了の Idempotency-Key は `{deliveryNo}_{inspectedAt-epoch}`', () => {
  // 1780336500 = 2026-06-01T17:55:00Z（秒精度・ミリ秒は切り捨て）
  expect(buildIdempotencyKey('D20260601-0001', '2026-06-01T17:55:00Z')).toBe(
    'D20260601-0001_1780336500',
  );
  // ミリ秒付きでも同一キーになる（再送時に別キーになると冪等が壊れる）
  expect(buildIdempotencyKey('D20260601-0001', '2026-06-01T17:55:00.999Z')).toBe(
    'D20260601-0001_1780336500',
  );
});

// ───────────────────────────────────────────────────────────
// 4. inspection-diff の送信形（CraftSmile DiffItem と一致すること）
// ───────────────────────────────────────────────────────────

/** fetch を差し替えて送信内容を捕まえる */
function captureFetch(response: unknown = { data: { additionalDeliveryRequired: [] } }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => response,
      } as unknown as Response;
    }),
  );
  return calls;
}

function stubOutboundEnv() {
  vi.stubEnv('FACTORY_OUTBOUND_HMAC_SECRET', SECRET);
  vi.stubEnv('FACTORY_BASE_URL', BASE_URL);
  vi.stubEnv('FACTORY_DRY_RUN', 'false');
}

test('契約: inspection-diff の URL・ヘッダ・item キー名が CraftSmile の受信口と一致', async () => {
  stubOutboundEnv();
  const calls = captureFetch();

  const res = await notifyInspectionDiff({
    shipDate: '2026-07-30',
    inspectedAt: '2026-07-30T08:00:00Z',
    inspectedBy: '検品担当',
    pattern: 'prev',
    items: [{ productCode: '6036-10', qtyDeclared: 22, qtyInspected: 20, qtyDiff: -2 }],
  });

  expect(res.ok).toBe(true);
  expect(calls).toHaveLength(1);

  // URL（craftsmile: src/app/api/wms/inspection-diff/route.ts）
  expect(calls[0].url).toBe(`${BASE_URL}/api/wms/inspection-diff`);

  // ヘッダ名（craftsmile が読むのは小文字化した x-wms-signature / x-wms-timestamp / idempotency-key）
  const headers = calls[0].init.headers as Record<string, string>;
  expect(Object.keys(headers).sort()).toEqual([
    'Content-Type',
    'Idempotency-Key',
    'X-WMS-Signature',
    'X-WMS-Timestamp',
  ]);
  expect(headers['Content-Type']).toBe('application/json; charset=utf-8');

  // 送った body は CraftSmile が検証できる署名になっていること
  const body = calls[0].init.body as string;
  expect(
    craftsmileVerifySignature(SECRET, Number(headers['X-WMS-Timestamp']), body, headers['X-WMS-Signature']),
  ).toBe(true);

  // payload のキー名 — craftsmile の DiffBody / DiffItem と完全一致
  const parsed = JSON.parse(body) as Record<string, unknown>;
  expect(Object.keys(parsed).sort()).toEqual([
    'inspectedAt',
    'inspectedBy',
    'items',
    'pattern',
    'shipDate',
  ]);
  const item = (parsed.items as Array<Record<string, unknown>>)[0];
  expect(Object.keys(item).sort()).toEqual([
    'productCode',
    'qtyDeclared',
    'qtyDiff',
    'qtyInspected',
  ]);
  // 突合キーは自社商品CD（B3・JAN を入れてはいけない）
  expect(item.productCode).toBe('6036-10');
});

test('契約: pattern 未指定なら pattern キーを送らない（CraftSmile は全伝票対象＝後方互換）', async () => {
  stubOutboundEnv();
  const calls = captureFetch();

  await notifyInspectionDiff({
    shipDate: '2026-07-30',
    inspectedAt: '2026-07-30T08:00:00Z',
    inspectedBy: '検品担当',
    items: [{ productCode: '6036-10', qtyDeclared: 10, qtyInspected: 9, qtyDiff: -1 }],
  });

  const parsed = JSON.parse(calls[0].init.body as string) as Record<string, unknown>;
  expect('pattern' in parsed).toBe(false);
});

test('契約: inspection-diff の Idempotency-Key は `diff_{shipDate}_{epoch}`', async () => {
  stubOutboundEnv();
  const calls = captureFetch();

  await notifyInspectionDiff(
    {
      shipDate: '2026-07-30',
      inspectedAt: '2026-07-30T08:00:00Z',
      inspectedBy: '検品担当',
      items: [{ productCode: '6036-10', qtyDeclared: 1, qtyInspected: 1, qtyDiff: 0 }],
    },
    { nowEpochSec: 1780000000 },
  );

  const headers = calls[0].init.headers as Record<string, string>;
  expect(headers['Idempotency-Key']).toBe('diff_2026-07-30_1780000000');
});

test('DRY-RUN 既定では実送信しない（安全側・シークレット未交換でも事故らない）', async () => {
  vi.stubEnv('FACTORY_OUTBOUND_HMAC_SECRET', SECRET);
  vi.stubEnv('FACTORY_BASE_URL', BASE_URL);
  vi.stubEnv('FACTORY_DRY_RUN', ''); // 未設定相当 → 既定 true
  const calls = captureFetch();
  vi.spyOn(console, 'info').mockImplementation(() => {});

  const res = await notifyInspectionDiff({
    shipDate: '2026-07-30',
    inspectedAt: '2026-07-30T08:00:00Z',
    inspectedBy: '検品担当',
    items: [{ productCode: '6036-10', qtyDeclared: 1, qtyInspected: 1, qtyDiff: 0 }],
  });

  expect(res.ok).toBe(true);
  if (res.ok) expect(res.dryRun).toBe(true);
  expect(calls).toHaveLength(0);
});

// ───────────────────────────────────────────────────────────
// 5. ship-plan ライブ pull（CraftSmile の応答形を解釈できること）
// ───────────────────────────────────────────────────────────

test('契約: CraftSmile の { data: { shipDate, items } } から items を取り出せる', async () => {
  stubOutboundEnv();
  // craftsmile: gatherShipPlanItems() が返す ShipPlanItem の 6 フィールド
  const items = [
    {
      productCode: '6036-10',
      productName: 'ぷりん10個',
      productionDeptCode: 'ATELIER',
      productionDeptName: 'アトリエ',
      plannedQty: 22,
      confirmedQty: 20,
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ data: { shipDate: '2026-07-30', items } }) }) as unknown as Response),
  );

  const got = await fetchLiveShipPlan('2026-07-30');

  expect(got).toEqual(items);
  // フィールド名が 1 つでも変わったら検品照合グリッドが空になるので固定する
  expect(Object.keys(got![0]).sort()).toEqual([
    'confirmedQty',
    'plannedQty',
    'productCode',
    'productName',
    'productionDeptCode',
    'productionDeptName',
  ]);
});

test('契約: ship-plan の pull は GET・body 空署名・?date= を送る', async () => {
  stubOutboundEnv();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ data: { items: [] } }) } as unknown as Response;
    }),
  );

  await fetchLiveShipPlan('2026-07-30');

  expect(calls[0].url).toBe(`${BASE_URL}/api/wms/ship-plan?date=2026-07-30`);
  expect(calls[0].init.method).toBe('GET');
  const headers = calls[0].init.headers as Record<string, string>;
  // body 空で署名しているので CraftSmile 側（body 空で検証）と噛み合う
  expect(
    craftsmileVerifySignature(SECRET, Number(headers['X-WMS-Timestamp']), '', headers['X-WMS-Signature']),
  ).toBe(true);
});

test('ship-plan: 連携未設定なら null（FactoryShipPlan キャッシュへフォールバックさせる）', async () => {
  vi.stubEnv('FACTORY_OUTBOUND_HMAC_SECRET', '');
  vi.stubEnv('FACTORY_BASE_URL', '');
  const calls = captureFetch();

  expect(await fetchLiveShipPlan('2026-07-30')).toBeNull();
  expect(calls).toHaveLength(0);
});

test('ship-plan: 相手が 401/404 を返したら null（画面を落とさない）', async () => {
  stubOutboundEnv();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }) as unknown as Response),
  );

  expect(await fetchLiveShipPlan('2026-07-30')).toBeNull();
});

// ───────────────────────────────────────────────────────────
// 6. 熨斗フラグ → QR 印刷フラグ（呼称統一・CLAUDE.md §6）
// ───────────────────────────────────────────────────────────

test('契約: 熨斗フラグ → QR 印刷フラグの読み替え', () => {
  expect(parseQrPrintFlag('1')).toBe(true);
  expect(parseQrPrintFlag('あり')).toBe(true);
  expect(parseQrPrintFlag('0')).toBe(false);
  expect(parseQrPrintFlag('false')).toBe(false);
  expect(parseQrPrintFlag('なし')).toBe(false);
  expect(parseQrPrintFlag('')).toBe(false);
  expect(parseQrPrintFlag(null)).toBe(false);
  expect(parseQrPrintFlag(undefined)).toBe(false);
});
