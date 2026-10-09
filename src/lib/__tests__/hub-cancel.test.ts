/**
 * HUB → LogiSmile 当日キャンセル（POST /api/integration/hub/cancel・2026-10-09）。
 *
 * 小原様「キャンセルは callHUB でオペレータがキャンセル処理をしたらそのまま送信予定」
 * 「WMS へチャット連絡と検品遮断をしたい」「お届先様名も追加してもらえますか」。
 *
 *   無効(503) → 署名(401) → 冪等キー(400) → JSON(400) → 本文(422) → 再送なら保存済みを返す → キャンセル
 *
 * 伝票の状態ごとの扱い（モック oeno-echub mockup/22b_wms_cancel_devices.html）:
 *   未着手・保留 → キャンセルの印＋論理削除（検品を始められない）           → cancelled
 *   検品中       → キャンセルの印（次のスキャン・完了で止める）              → blocked_inspecting
 *   梱包済・出荷済 → システムでは止めない（印は残す）。現場へ抜き取りを連絡 → packed
 * いずれも現場へ連絡事項（了解必須）を出す。
 */

import { test, expect, vi, describe } from 'vitest';
import {
  handleHubCancel,
  decideHubCancel,
  hubCancelNotice,
  cancelledOrderError,
  type HubCancelDeps,
} from '../integration/hub-cancel';
import { hubSignature } from '../integration/hub-auth';

const SECRET = 'hub-contract-secret-0123456789abcdef0123';
const NOW = 1760000000;

const BODY = JSON.stringify({ pkNo: 'SB01245370231', reason: 'お客様都合（電話）', operator: '山本' });

function req(body: string, headers: Record<string, string | null> = {}) {
  const h = new Headers({ 'content-type': 'application/json' });
  const all: Record<string, string | null> = {
    'x-hub-signature': hubSignature(SECRET, NOW, body),
    'x-hub-timestamp': String(NOW),
    'idempotency-key': 'hub-wms-cancel-12-ab12',
    ...headers,
  };
  for (const [k, v] of Object.entries(all)) if (v !== null) h.set(k, v);
  return new Request('http://localhost/api/integration/hub/cancel', { method: 'POST', body, headers: h });
}

const outcome = {
  result: 'cancelled' as const,
  previousStatus: 'pending',
  destName: '山田 一郎',
  invoiceNo: '61393550001',
  packedAt: null,
  inspector: null,
  noticeId: 7,
};

function deps(over: Partial<HubCancelDeps> = {}): HubCancelDeps {
  return {
    enabled: true,
    secret: SECRET,
    nowSec: NOW,
    findSaved: vi.fn(async () => null),
    save: vi.fn(async () => {}),
    cancelOrder: vi.fn(async () => outcome),
    ...over,
  };
}

async function call(r: Request, d: HubCancelDeps) {
  const res = await handleHubCancel(r, d);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('handleHubCancel', () => {
  test('無効なら 503。何もしない', async () => {
    const d = deps({ enabled: false });
    expect((await call(req(BODY), d)).status).toBe(503);
    expect(d.cancelOrder).not.toHaveBeenCalled();
  });

  test('署名・冪等キーは登録の口と同じ認証（401 / 400）', async () => {
    const d = deps();
    expect((await call(req(BODY, { 'x-hub-signature': 'a'.repeat(64) }), d)).status).toBe(401);
    expect((await call(req(BODY, { 'idempotency-key': null }), d)).status).toBe(400);
    expect(d.cancelOrder).not.toHaveBeenCalled();
  });

  test('本文は pkNo・reason（必須）・operator（任意）だけ。契約に無い項目・空の理由は 422', async () => {
    const d = deps();
    expect((await call(req(JSON.stringify({ pkNo: 'P1' })), d)).status).toBe(422);
    expect((await call(req(JSON.stringify({ pkNo: 'P1', reason: ' ' })), d)).status).toBe(422);
    expect((await call(req(JSON.stringify({ pkNo: 'P1', reason: 'x', extra: 1 })), d)).status).toBe(422);
    expect((await call(req(JSON.stringify({ pkNo: 'P1', reason: 'x'.repeat(201) })), d)).status).toBe(422);
    expect((await call(req('{'), d)).status).toBe(400);
    expect(d.cancelOrder).not.toHaveBeenCalled();
  });

  test('★ キャンセルして結果を返し、応答を冪等キーで保存する', async () => {
    const d = deps();
    const { status, json } = await call(req(BODY), d);
    expect(status).toBe(200);
    expect(d.cancelOrder).toHaveBeenCalledWith({ pkNo: 'SB01245370231', reason: 'お客様都合（電話）', operator: '山本' });
    expect(json.data).toEqual({ replay: false, pkNo: 'SB01245370231', ...outcome });
    expect(d.save).toHaveBeenCalledWith('hub-wms-cancel-12-ab12', 'cancel', expect.objectContaining({ message: 'OK' }));
  });

  test('★ 同じ冪等キーの再送は、保存済みの応答をそのまま返す（2 回目の連絡事項を出さない）', async () => {
    const saved = { data: { replay: false, pkNo: 'SB01245370231', ...outcome, result: 'blocked_inspecting' }, message: 'OK' };
    const d = deps({ findSaved: vi.fn(async () => saved) });
    const { json } = await call(req(BODY), d);
    expect(d.cancelOrder).not.toHaveBeenCalled();
    expect((json.data as Record<string, unknown>).result).toBe('blocked_inspecting');
    expect((json.data as Record<string, unknown>).replay).toBe(true);
  });

  test('失敗したときは保存しない（HUB の再送でやり直せる）', async () => {
    const d = deps({ cancelOrder: vi.fn(async () => { throw new Error('db down'); }) });
    expect((await call(req(BODY), d)).status).toBe(500);
    expect(d.save).not.toHaveBeenCalled();
  });
});

describe('decideHubCancel', () => {
  test('★ 未着手・保留は止める／検品中は遮断／梱包済・出荷済は止めない', () => {
    expect(decideHubCancel('pending')).toBe('cancelled');
    expect(decideHubCancel('held')).toBe('cancelled');
    expect(decideHubCancel('inspecting')).toBe('blocked_inspecting');
    expect(decideHubCancel('packed')).toBe('packed');
    expect(decideHubCancel('shipped')).toBe('packed');
  });
});

describe('hubCancelNotice', () => {
  const base = { pkNo: 'SB01245370231', invoiceNo: '61393550001', destName: '山田 一郎', reason: 'お客様都合（電話）' };

  test('★ 見出しにお届先様名・納品書・ピッキング№を入れ、了解必須で全端末へ出す', () => {
    const n = hubCancelNotice({ ...base, result: 'cancelled' });
    expect(n.title).toBe('【当日キャンセル】山田 一郎 様 ／ 納品書 61393550001 ／ SB01245370231');
    expect(n.body).toContain('お客様都合（電話）');
    expect(n.body).toContain('検品はできないようにしてあります');
    expect([n.ackRequired, n.targetType, n.senderCode]).toEqual([true, 'all', 'HUB']);
  });

  test('検品中は「止める・戻す」、梱包済は「出荷前に抜き取って」', () => {
    expect(hubCancelNotice({ ...base, result: 'blocked_inspecting' }).body).toContain('検品を止めます');
    const p = hubCancelNotice({ ...base, result: 'packed' });
    expect(p.title).toContain('【当日キャンセル・梱包済】');
    expect(p.body).toContain('出荷前に抜き取ってください');
  });

  test('お届先様名・納品書が無ければその部分を省く（見出しは 100 文字まで）', () => {
    const n = hubCancelNotice({ ...base, destName: null, invoiceNo: null, result: 'cancelled' });
    expect(n.title).toBe('【当日キャンセル】SB01245370231');
    expect(hubCancelNotice({ ...base, destName: 'あ'.repeat(120), result: 'cancelled' }).title.length).toBeLessThanOrEqual(100);
  });
});

describe('cancelledOrderError', () => {
  test('★ キャンセル済みの伝票は 409 CANCELLED で、端末に出す中身（お届先様名・理由・時刻）を返す', async () => {
    const res = cancelledOrderError({
      pkNo: 'SB01245370231', invoiceNo: '61393550001', destName: '山田 一郎',
      cancelReason: 'お客様都合（電話）', cancelRequestedAt: new Date('2026-10-09T04:40:00Z'),
    }, 'start');
    expect(res.status).toBe(409);
    const j = (await res.json()) as { error: string; message: string; data: Record<string, unknown> };
    expect(j.error).toBe('CANCELLED');
    expect(j.message).toBe('この伝票はキャンセルされました');
    expect(j.data).toEqual({
      pkNo: 'SB01245370231', invoiceNo: '61393550001', destName: '山田 一郎',
      reason: 'お客様都合（電話）', cancelledAt: '2026-10-09T04:40:00.000Z', during: 'start',
    });
  });

  test('検品の途中（スキャン・完了）は「検品中にキャンセルされました」', async () => {
    const res = cancelledOrderError({
      pkNo: 'P', invoiceNo: null, destName: null, cancelReason: null, cancelRequestedAt: new Date(),
    }, 'inspect');
    expect(((await res.json()) as { message: string }).message).toBe('検品中にキャンセルされました');
  });
});

describe('cancelInfoFrom（端末の赤い警告に渡す中身）', async () => {
  const { cancelInfoFrom } = await import('../../components/inspection/cancel-warning-modal');

  test('★ HUB の印がある伝票（待機画面のスキャン）は、お届先様名・理由・時刻つきの HUB キャンセル表示', () => {
    expect(cancelInfoFrom({
      pkNo: 'P1', invoiceNo: 'I1', destName: '山田 一郎', deleted: false,
      cancelRequestedAt: '2026-10-09T04:40:00.000Z', cancelReason: 'お客様都合',
    })).toEqual({
      pkNo: 'P1', invoiceNo: 'I1', destName: '山田 一郎', deletedAt: null, deletedBy: null, deleteReason: null,
      hubCancel: { at: '2026-10-09T04:40:00.000Z', reason: 'お客様都合', during: 'start' },
    });
  });

  test('検品 API の 409 CANCELLED の data（検品の途中）もそのまま渡せる', () => {
    expect(cancelInfoFrom({ pkNo: 'P1', cancelledAt: '2026-10-09T04:52:00.000Z', reason: '住所誤り', during: 'inspect' })?.hubCancel)
      .toEqual({ at: '2026-10-09T04:52:00.000Z', reason: '住所誤り', during: 'inspect' });
  });

  test('管理 PC で削除しただけの伝票は今までどおり（HUB の表示にしない）。どちらでもなければ null', () => {
    expect(cancelInfoFrom({ pkNo: 'P1', deleted: true, deleteReason: '訂正' })?.hubCancel).toBeNull();
    expect(cancelInfoFrom({ pkNo: 'P1', deleted: false })).toBeNull();
  });
});
