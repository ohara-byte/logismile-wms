/**
 * HUB ← LogiSmile 梱包状況（POST /api/integration/hub/status・2026-10-09）。
 *
 * 小原様「WMS 出荷状況をリアルに HUB が取得（Logi から HUB へはセキュリティ上避けたいので、取りに行く方法で）」
 * 「（間隔は）3 分」。HUB がピッキング№をまとめて送り、LogiSmile は伝票ごとの状態を返す。**読むだけ**。
 *
 *   無効(503) → 署名(401) → 冪等キー(400) → JSON(400) → 本文(422) → 状態を返す
 *
 * 認証は登録の口（hub-handler）と同じ。読むだけなので冪等キーは保存しない（毎回いまの状態を返す）。
 */

import { test, expect, vi, describe } from 'vitest';
import { handleHubStatus, toHubSlipStatus, HUB_STATUS_MAX_PKNOS, type HubStatusDeps, type HubStatusRow } from '../integration/hub-status';
import { hubSignature } from '../integration/hub-auth';

const SECRET = 'hub-contract-secret-0123456789abcdef0123';
const NOW = 1760000000;

function req(body: string, headers: Record<string, string | null> = {}) {
  const h = new Headers({ 'content-type': 'application/json' });
  const all: Record<string, string | null> = {
    'x-hub-signature': hubSignature(SECRET, NOW, body),
    'x-hub-timestamp': String(NOW),
    'idempotency-key': 'hub-wms-status-20261009090000-ab12',
    ...headers,
  };
  for (const [k, v] of Object.entries(all)) if (v !== null) h.set(k, v);
  return new Request('http://localhost/api/integration/hub/status', { method: 'POST', body, headers: h });
}

const row = (over: Partial<HubStatusRow> = {}): HubStatusRow => ({
  pkNo: 'P1',
  status: 'pending',
  holdReason: null,
  deletedAt: null,
  packedAt: null,
  updatedAt: new Date('2026-10-09T00:10:00Z'),
  ...over,
});

function deps(over: Partial<HubStatusDeps> = {}): HubStatusDeps {
  return {
    enabled: true,
    secret: SECRET,
    nowSec: NOW,
    findOrders: vi.fn(async () => [row()]),
    ...over,
  };
}

async function call(r: Request, d: HubStatusDeps) {
  const res = await handleHubStatus(r, d);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const BODY = JSON.stringify({ pkNos: ['P1', 'P2'] });

describe('handleHubStatus', () => {
  test('無効なら 503。DB を見ない', async () => {
    const d = deps({ enabled: false });
    expect((await call(req(BODY), d)).status).toBe(503);
    expect(d.findOrders).not.toHaveBeenCalled();
  });

  test('署名が違えば 401・冪等キーが無ければ 400（登録の口と同じ認証）', async () => {
    const d = deps();
    expect((await call(req(BODY, { 'x-hub-signature': 'a'.repeat(64) }), d)).status).toBe(401);
    expect((await call(req(BODY, { 'idempotency-key': null }), d)).status).toBe(400);
    expect(d.findOrders).not.toHaveBeenCalled();
  });

  test('本文は pkNos（1〜上限件・文字列）だけ。契約に無い項目・空・上限超えは 422', async () => {
    const d = deps();
    expect(HUB_STATUS_MAX_PKNOS).toBe(1000);
    expect((await call(req(JSON.stringify({ pkNos: [] })), d)).status).toBe(422);
    expect((await call(req(JSON.stringify({ pkNos: ['P1'], extra: 1 })), d)).status).toBe(422);
    expect((await call(req(JSON.stringify({ pkNos: [''] })), d)).status).toBe(422);
    expect((await call(req(JSON.stringify({ pkNos: Array.from({ length: 1001 }, (_, i) => `P${i}`) })), d)).status).toBe(422);
    expect((await call(req('{'), d)).status).toBe(400);
    expect(d.findOrders).not.toHaveBeenCalled();
  });

  test('★ 伝票ごとの状態を返し、LogiSmile に無いピッキング№は missing に分ける', async () => {
    const d = deps({ findOrders: vi.fn(async () => [row({ pkNo: 'P1', status: 'inspecting' })]) });
    const { status, json } = await call(req(BODY), d);
    expect(status).toBe(200);
    expect(d.findOrders).toHaveBeenCalledWith(['P1', 'P2']);
    expect(json.data).toEqual({
      slips: [{ pkNo: 'P1', status: 'inspecting', holdReason: null, packedAt: null, deleted: false, updatedAt: '2026-10-09T00:10:00.000Z' }],
      missing: ['P2'],
    });
  });

  test('同じピッキング№が 2 回来ても 1 回だけ引く（前後の空白は除く）', async () => {
    const d = deps();
    await call(req(JSON.stringify({ pkNos: [' P1 ', 'P1'] })), d);
    expect(d.findOrders).toHaveBeenCalledWith(['P1']);
  });
});

describe('toHubSlipStatus', () => {
  test('梱包済・出荷済は梱包した時刻を返す（検品完了の時刻）', () => {
    const at = new Date('2026-10-09T01:23:00Z');
    expect(toHubSlipStatus(row({ status: 'packed', packedAt: at })).packedAt).toBe('2026-10-09T01:23:00.000Z');
    expect(toHubSlipStatus(row({ status: 'shipped', packedAt: at })).packedAt).toBe('2026-10-09T01:23:00.000Z');
  });

  test('梱包前（未着手・検品中・保留）は検品の記録があっても packedAt を返さない（検品のやり直し）', () => {
    const at = new Date('2026-10-09T01:23:00Z');
    expect(toHubSlipStatus(row({ status: 'inspecting', packedAt: at })).packedAt).toBeNull();
  });

  test('保留は理由を返す。保留以外は理由を返さない', () => {
    expect(toHubSlipStatus(row({ status: 'held', holdReason: '商品破損' })).holdReason).toBe('商品破損');
    expect(toHubSlipStatus(row({ status: 'pending', holdReason: '前の保留理由' })).holdReason).toBeNull();
  });

  test('論理削除された伝票は deleted=true（状態はそのまま）', () => {
    expect(toHubSlipStatus(row({ deletedAt: new Date() }))).toMatchObject({ status: 'pending', deleted: true });
  });
});
