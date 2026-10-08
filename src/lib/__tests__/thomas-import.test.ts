/**
 * Thomas 出荷指示・商品マスタの取込処理（csv-adapter）の挙動を固定する（2026-10-08）。
 *
 * HUB（OENO EC Hub）からの API 取込（/api/integration/hub/*）は、この CSV 取込と
 * **同じ登録処理**を通す（ADR-030「受信側の期待を正」・ohara 様承認 2026-10-08）。
 * 処理を「CSV を読む」と「伝票を登録する」に分ける前に、いまの動きをここで固定し、
 * 分けた後も同じ結果になることを確かめる。
 */

import { test, expect, vi, beforeEach } from 'vitest';
import { createFakePrisma } from './helpers/fake-prisma';

const fake = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('./helpers/fake-prisma').createFakePrisma> }));

vi.mock('../db', () => ({
  get prisma() {
    return fake.current!.prisma;
  },
}));

import { CsvAdapter } from '../integration/csv-adapter';

const ORDER_HEADER =
  '出荷予定日,ピッキングNo,配送便種,商品コード,出荷予定数,品名,送付先郵便番号,送付先住所1,送付先名,納品書No,熨斗フラグ,熨斗コード,顧客コード,注文番号,熨斗名称,熨斗氏名,配達指定日';

function orderCsv(lines: string[]): Buffer {
  return Buffer.from([ORDER_HEADER, ...lines].join('\n'), 'utf8');
}

function line(o: Partial<Record<string, string>>): string {
  const v = {
    date: '2026/09/25', pk: 'SB01', carrier: 'ヤマト運輸', code: '70001', qty: '2', name: '定期Ｍﾊﾟｯｸ',
    zip: '680-0411', addr: '鳥取県', dest: '山田', inv: '61391970001', flag: '', ncode: '', cust: '823986',
    order: '6139197', nname: '', nperson: '', ddate: '2026/09/26', ...o,
  };
  return [v.date, v.pk, v.carrier, v.code, v.qty, v.name, v.zip, v.addr, v.dest, v.inv, v.flag, v.ncode,
    v.cust, v.order, v.nname, v.nperson, v.ddate].join(',');
}

beforeEach(() => {
  fake.current = null;
});

test('出荷指示: ピッキング№ごとに 1 伝票、明細はその下にまとまる', async () => {
  fake.current = createFakePrisma({ products: [{ code: '70001', name: 'a' }, { code: '70005', name: 'b' }] });
  const r = await new CsvAdapter().importShippingOrders(
    { kind: 'csv', buffer: orderCsv([line({}), line({ code: '70005', qty: '1' }), line({ pk: 'SB02' })]), filename: 'a.csv' },
    { importedBy: 'M01' },
  );

  expect(r).toMatchObject({ fileType: 'orders', totalRows: 3, successCount: 2, errorCount: 0, duplicatePkNoCount: 0 });
  const orders = fake.current.state.shippingOrders as { pkNo: string; status: string; shipDate: Date; carrierCode: string; invoiceNo: string; orderNo: string; customerCode: string; items: { create: unknown[] } }[];
  expect(orders.map((o) => o.pkNo)).toEqual(['SB01', 'SB02']);
  expect(orders[0]).toMatchObject({
    status: 'pending', carrierCode: 'YMT-N', invoiceNo: '61391970001', orderNo: '6139197', customerCode: '823986',
  });
  expect(orders[0].shipDate.toISOString()).toBe('2026-09-25T00:00:00.000Z');
  expect(orders[0].items.create).toEqual([
    { productCode: '70001', productName: '定期Ｍﾊﾟｯｸ', qty: 2, sortOrder: 0 },
    { productCode: '70005', productName: '定期Ｍﾊﾟｯｸ', qty: 1, sortOrder: 1 },
  ]);
  expect(fake.current.state.thomasImports[0]).toMatchObject({ filename: 'a.csv', fileType: 'orders', importedBy: 'M01', successCount: 2 });
});

test('出荷指示: DB に既にあるピッキング№は伝票ごとスキップし、重複エラーとアラートを残す', async () => {
  fake.current = createFakePrisma({ products: [{ code: '70001', name: 'a' }], shippingOrders: [{ pkNo: 'SB01' }] });
  const r = await new CsvAdapter().importShippingOrders(
    { kind: 'csv', buffer: orderCsv([line({})]), filename: 'a.csv' }, {},
  );

  expect(r).toMatchObject({ successCount: 0, duplicatePkNoCount: 1 });
  expect(r.errors[0]).toMatchObject({ pkNo: 'SB01', invoiceNo: '61391970001', reason: 'duplicate_pk_no' });
  expect(fake.current.state.alerts).toContainEqual(expect.objectContaining({ type: 'duplicate_pkno', refCode: 'SB01' }));
});

test('出荷指示: 未登録商品を 1 つでも含む伝票は丸ごとスキップし、伝票単位のアラートを残す', async () => {
  fake.current = createFakePrisma({ products: [{ code: '70001', name: 'a' }] });
  const r = await new CsvAdapter().importShippingOrders(
    { kind: 'csv', buffer: orderCsv([line({}), line({ code: '99999' }), line({ pk: 'SB02' })]), filename: 'a.csv' }, {},
  );

  expect(r).toMatchObject({ successCount: 1, unmapCount: 1, unmappedCodes: ['99999'] });
  expect(r.errors).toContainEqual(expect.objectContaining({ pkNo: 'SB01', productCode: '99999', reason: 'product_not_found' }));
  expect((fake.current.state.shippingOrders as { pkNo: string }[]).map((o) => o.pkNo)).toEqual(['SB02']);
  const types = fake.current.state.alerts.map((a) => a.type);
  expect(types).toContain('unmap_product');
  expect(types).toContain('order_dropped_unmapped');
});

test('出荷指示: 同じ伝票の同じ商品の複数行は数量を合算して 1 明細にする', async () => {
  fake.current = createFakePrisma({ products: [{ code: '70001', name: 'a' }] });
  await new CsvAdapter().importShippingOrders(
    { kind: 'csv', buffer: orderCsv([line({ qty: '1' }), line({ qty: '3' })]), filename: 'a.csv' }, {},
  );
  const order = fake.current.state.shippingOrders[0] as { items: { create: { qty: number }[] } };
  expect(order.items.create).toHaveLength(1);
  expect(order.items.create[0].qty).toBe(4);
});

test('出荷指示: 配送便種は 別名マスタ → 固定表 → 既定 YMT-N の順で決まる', async () => {
  fake.current = createFakePrisma({
    products: [{ code: '70001', name: 'a' }],
    carrierAliases: [{ aliasName: 'ヤマト運輸', carrierCode: 'YMT-X' }],
  });
  await new CsvAdapter().importShippingOrders(
    { kind: 'csv', buffer: orderCsv([line({}), line({ pk: 'SB02', carrier: '佐川急便' }), line({ pk: 'SB03', carrier: '不明便' })]), filename: 'a.csv' }, {},
  );
  expect((fake.current.state.shippingOrders as { carrierCode: string }[]).map((o) => o.carrierCode)).toEqual(['YMT-X', 'SGW-N', 'YMT-N']);
});

test('出荷指示: QR印刷フラグは熨斗フラグ、または熨斗名称が強制マスタと完全一致で ON', async () => {
  fake.current = createFakePrisma({
    products: [{ code: '70001', name: 'a' }],
    qrForceKeywords: [{ matchText: '特殊包装' }],
  });
  await new CsvAdapter().importShippingOrders(
    {
      kind: 'csv',
      buffer: orderCsv([line({ flag: '1' }), line({ pk: 'SB02', nname: '特殊包装' }), line({ pk: 'SB03', nperson: '特殊包装' }), line({ pk: 'SB04', flag: '0' })]),
      filename: 'a.csv',
    },
    {},
  );
  expect((fake.current.state.shippingOrders as { qrPrintFlag: boolean }[]).map((o) => o.qrPrintFlag)).toEqual([true, true, false, false]);
});

test('出荷指示: ピッキング№・商品コードが空の行、出荷予定日が不正な伝票はエラーにする', async () => {
  fake.current = createFakePrisma({ products: [{ code: '70001', name: 'a' }] });
  const r = await new CsvAdapter().importShippingOrders(
    { kind: 'csv', buffer: orderCsv([line({ pk: '' }), line({ code: '' }), line({ pk: 'SB09', date: '2026-13-45x' })]), filename: 'a.csv' }, {},
  );
  expect(r.successCount).toBe(0);
  expect(r.errors.map((e) => e.reason)).toEqual(['validation_error', 'validation_error', 'validation_error']);
});

test('商品マスタ: 商品コード・商品名が空はエラー、JAN 12 桁は警告で取り込む', async () => {
  fake.current = createFakePrisma();
  const csv = Buffer.from(
    [
      '商品コード,商品名,JANコード,賞味期限管理区分,出荷可能残日数',
      '70001,定期Ｍﾊﾟｯｸ,2800001000010,,',
      '70005,定期ＬＬﾊﾟｯｸ,280000100003,,',
      ',名無し,,,',
      '70009,,,,',
    ].join('\n'),
    'utf8',
  );
  const r = await new CsvAdapter().importProducts({ kind: 'csv', buffer: csv, filename: 'p.csv' }, {});

  expect(r).toMatchObject({ fileType: 'products', totalRows: 4, successCount: 2, errorCount: 2, janWarnCount: 1 });
  expect(fake.current.state.products).toContainEqual(expect.objectContaining({ code: '70001', jan: '2800001000010', productType: 'pass_through' }));
});

// ───────────────────────────────────────────────────────────
// 分けた後の「伝票を登録する」処理（CSV と HUB API が共通で使う）
// ───────────────────────────────────────────────────────────

import { importOrderRows, importProductRows } from '../integration/thomas-import';

function rowsOf(lines: string[]): Record<string, string>[] {
  const keys = ORDER_HEADER.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [keys[i], v])));
}

test('importOrderRows: CSV を通したときと同じ結果になり、登録したピッキング№を返す', async () => {
  fake.current = createFakePrisma({ products: [{ code: '70001', name: 'a' }], shippingOrders: [{ pkNo: 'SB03' }] });
  const r = await importOrderRows(rowsOf([line({}), line({ pk: 'SB02', code: '99999' }), line({ pk: 'SB03' })]), {
    filename: 'hub:key-1',
    importedBy: 'HUB',
  });

  expect(r).toMatchObject({ fileType: 'orders', filename: 'hub:key-1', totalRows: 3, successCount: 1, duplicatePkNoCount: 1, unmapCount: 1 });
  expect(r.importedPkNos).toEqual(['SB01']);
  expect(fake.current.state.thomasImports[0]).toMatchObject({ filename: 'hub:key-1', importedBy: 'HUB' });
});

test('importProductRows: CSV を通したときと同じく商品を登録する', async () => {
  fake.current = createFakePrisma();
  const r = await importProductRows(
    [{ 商品コード: '70001', 商品名: '定期Ｍﾊﾟｯｸ', JANコード: '2800001000010', 賞味期限管理区分: '', 出荷可能残日数: '' }],
    { filename: 'hub:key-2', importedBy: 'HUB' },
  );
  expect(r).toMatchObject({ fileType: 'products', successCount: 1, errorCount: 0 });
  expect(fake.current.state.products).toHaveLength(1);
});

test('★ 同時に取り込まれて登録の瞬間にピッキング№が重複した場合は「重複」として扱う（商品の重複と誤って出さない）', async () => {
  // findMany の時点では無かったが、create の時点で別の取込が先に入れていた（pk_no の一意制約違反）
  const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: ['pk_no'] } });
  fake.current = createFakePrisma({ products: [{ code: '70001', name: 'a' }], createErrors: { SB01: p2002 } });
  const r = await importOrderRows(rowsOf([line({})]), { filename: 'x' });

  expect(r.successCount).toBe(0);
  expect(r.duplicatePkNoCount).toBe(1);
  expect(r.errors[0]).toMatchObject({ pkNo: 'SB01', reason: 'duplicate_pk_no' });
  expect(r.importedPkNos).toEqual([]);
});

test('同一伝票内の商品の一意制約違反（P2002・pk_no 以外）は従来どおり商品の重複として出す', async () => {
  const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: ['order_id', 'product_code'] } });
  fake.current = createFakePrisma({ products: [{ code: '70001', name: 'a' }], createErrors: { SB01: p2002 } });
  const r = await importOrderRows(rowsOf([line({})]), { filename: 'x' });
  expect(r.errors[0]).toMatchObject({ reason: 'parse_error' });
  expect(r.errors[0].message).toContain('同一伝票内で商品コードが重複');
});
