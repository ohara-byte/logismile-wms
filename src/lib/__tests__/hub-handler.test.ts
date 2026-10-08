/**
 * HUB → LogiSmile 受け口（/api/integration/hub/orders・/products）の処理順（2026-10-08）。
 * DB に触れる部分（冪等キーの読み書き・登録処理）は差し替えて、順序と応答だけを固定する。
 *
 *   無効(503) → 署名(401) → 冪等キー(400) → JSON(400) → 本文(422) → 再送なら保存済みを返す → 登録
 */

import { test, expect, vi, describe } from 'vitest';
import { handleHubImport, type HubImportDeps } from '../integration/hub-handler';
import { hubSignature } from '../integration/hub-auth';

const SECRET = 'hub-contract-secret-0123456789abcdef0123';
const NOW = 1760000000;

const ORDERS = JSON.stringify({
  orders: [{ pkNo: 'P1', shipDate: '2026-09-25', carrier: 'ヤマト運輸', items: [{ productCode: '70001', qty: 2 }] }],
});
const PRODUCTS = JSON.stringify({ products: [{ code: '70001', name: '定期Ｍﾊﾟｯｸ' }] });

function req(body: string, headers: Record<string, string | null> = {}) {
  const h = new Headers({ 'content-type': 'application/json' });
  const all: Record<string, string | null> = {
    'x-hub-signature': hubSignature(SECRET, NOW, body),
    'x-hub-timestamp': String(NOW),
    'idempotency-key': 'hub-wms-orders-20261008090000',
    ...headers,
  };
  for (const [k, v] of Object.entries(all)) if (v !== null) h.set(k, v);
  return new Request('http://localhost/api/integration/hub/orders', { method: 'POST', body, headers: h });
}

const okResult = {
  importId: 7, fileType: 'orders' as const, filename: 'hub:k', totalRows: 1, successCount: 1, errorCount: 0,
  janErrorCount: 0, duplicatePkNoCount: 0, unmapCount: 0, unmappedCodes: [], errors: [], importedPkNos: ['P1'],
};

function deps(over: Partial<HubImportDeps> = {}): HubImportDeps {
  return {
    enabled: true,
    secret: SECRET,
    nowSec: NOW,
    findSaved: vi.fn(async () => null),
    save: vi.fn(async () => {}),
    importOrders: vi.fn(async () => okResult),
    importProducts: vi.fn(async () => ({ ...okResult, fileType: 'products' as const, importedPkNos: undefined })),
    afterOrdersImported: vi.fn(async () => {}),
    ...over,
  };
}

async function call(kind: 'orders' | 'products', r: Request, d: HubImportDeps) {
  const res = await handleHubImport(kind, r, d);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('handleHubImport', () => {
  test('無効なら 503。署名も見ない', async () => {
    const d = deps({ enabled: false });
    expect((await call('orders', req(ORDERS), d)).status).toBe(503);
    expect(d.findSaved).not.toHaveBeenCalled();
  });

  test('署名不正は 401・冪等キー無しは 400・鍵未設定は 503', async () => {
    expect((await call('orders', req(ORDERS, { 'x-hub-signature': 'f'.repeat(64) }), deps())).status).toBe(401);
    expect((await call('orders', req(ORDERS, { 'idempotency-key': null }), deps())).status).toBe(400);
    expect((await call('orders', req(ORDERS), deps({ secret: null }))).status).toBe(503);
  });

  test('★ 同じ Idempotency-Key の再送は保存済みの応答を返し、登録をやり直さない', async () => {
    const saved = { data: { replay: false, importId: 1 }, message: 'OK' };
    const d = deps({ findSaved: vi.fn(async () => saved) });
    const r = await call('orders', req(ORDERS), d);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ...saved, data: { ...saved.data, replay: true } });
    expect(d.findSaved).toHaveBeenCalledWith('hub-wms-orders-20261008090000');
    expect(d.importOrders).not.toHaveBeenCalled();
  });

  test('JSON でなければ 400・契約に合わなければ 422（理由の一覧つき）', async () => {
    expect((await call('orders', req('x'), deps())).status).toBe(400);
    const bad = JSON.stringify({ orders: [{ pkNo: 'P1' }] });
    const r = await call('orders', req(bad), deps());
    expect(r.status).toBe(422);
    expect(Array.isArray(r.json.errors)).toBe(true);
  });

  test('★ 出荷指示: CSV と同じ列名の行にして登録し、伝票ごとの結果と取込番号を返して保存する', async () => {
    const d = deps();
    const r = await call('orders', req(ORDERS), d);
    expect(r.status).toBe(200);
    const [rows, opts] = (d.importOrders as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(rows[0]['ピッキングNo']).toBe('P1');
    expect(rows[0]['出荷予定数']).toBe('2');
    expect(opts).toEqual({ filename: 'hub:hub-wms-orders-20261008090000', importedBy: 'HUB' });
    expect(r.json.data).toMatchObject({
      replay: false,
      importId: 7,
      totalRows: 1,
      successCount: 1,
      slips: [{ pkNo: 'P1', result: 'imported', messages: [] }],
    });
    expect(d.save).toHaveBeenCalledWith('hub-wms-orders-20261008090000', 'orders', r.json);
  });

  test('★ 出荷指示の登録後は CSV 取込と同じ自動引当を、応答を保存してから行う（再送はやり直さない）', async () => {
    const order: string[] = [];
    const d = deps({
      save: vi.fn(async () => { order.push('save'); }),
      afterOrdersImported: vi.fn(async () => { order.push('allocate'); }),
    });
    await call('orders', req(ORDERS), d);
    expect(d.afterOrdersImported).toHaveBeenCalledWith(7);
    expect(order).toEqual(['save', 'allocate']);

    const replay = deps({ findSaved: vi.fn(async () => ({ data: {}, message: 'OK' })) });
    await call('orders', req(ORDERS), replay);
    expect(replay.afterOrdersImported).not.toHaveBeenCalled();
  });

  test('商品の取込では自動引当をしない', async () => {
    const d = deps();
    await call('products', req(PRODUCTS), d);
    expect(d.afterOrdersImported).not.toHaveBeenCalled();
  });

  test('商品: 登録して件数とエラー・警告を返す（伝票の結果は無い）', async () => {
    const d = deps();
    const r = await call('products', req(PRODUCTS), d);
    expect(r.status).toBe(200);
    expect(d.importProducts).toHaveBeenCalledTimes(1);
    expect(r.json.data).toMatchObject({ importId: 7, successCount: 1 });
    expect(r.json.data).not.toHaveProperty('slips');
  });

  test('出荷指示の本文を商品の口に送ったら 422（取り違えを黙って通さない）', async () => {
    expect((await call('products', req(ORDERS), deps())).status).toBe(422);
  });

  test('登録で例外が出たら 500（中身は応答に出さない・保存しない＝再送でやり直せる）', async () => {
    const d = deps({ importOrders: vi.fn(async () => { throw new Error('db down secret detail'); }) });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await call('orders', req(ORDERS), d);
    spy.mockRestore();
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.json)).not.toContain('secret detail');
    expect(d.save).not.toHaveBeenCalled();
  });
});
