/**
 * HUB → LogiSmile 受け口の本体（2026-10-08）。DB に触れる部分は引数で受け、
 * 処理順と応答をテストで固定する（src/lib/__tests__/hub-handler.test.ts）。
 *
 *   無効(503) → 署名(401) → 冪等キー(400) → JSON(400) → 本文(422) → 再送なら保存済みを返す → 登録
 *
 * 取込は 1 本ずつ流す（プロセス内の直列化）。同じピッキング№を含む取込が並走すると、
 * 重複の確認と登録の間に割り込まれるため（thomas-import.ts の pk_no 一意制約の扱いも参照）。
 */

import { NextResponse } from 'next/server';
import { HUB_HEADERS, verifyHubRequest } from './hub-auth';
import { HubOrdersBody, HubProductsBody, summarizeSlips, toThomasOrderRows, toThomasProductRows } from './hub-payload';
import type { ThomasImportOptions, ThomasRow } from './thomas-import';
import type { ImportResult } from './types';

/** HUB からの取込を記録する社員コード（ログイン不可の連携用レコード・migration で作成） */
export const HUB_STAFF_CODE = 'HUB';

export type HubImportKind = 'orders' | 'products';

export type HubImportDeps = {
  enabled: boolean;
  secret: string | null;
  nowSec?: number;
  findSaved: (idempotencyKey: string) => Promise<unknown | null>;
  save: (idempotencyKey: string, endpoint: HubImportKind, response: unknown) => Promise<void>;
  importOrders: (rows: ThomasRow[], opts: ThomasImportOptions) => Promise<ImportResult>;
  importProducts: (rows: ThomasRow[], opts: ThomasImportOptions) => Promise<ImportResult>;
  /** 出荷指示の登録後の自動引当（CSV 取込と同じ allocate-on-import.ts）。例外は内部で握り潰す前提 */
  afterOrdersImported: (importId: number) => Promise<void>;
};

function err(status: number, message: string, code: string, errors?: string[]) {
  return NextResponse.json({ data: null, message, error: code, ...(errors ? { errors } : {}) }, { status });
}

let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export async function handleHubImport(kind: HubImportKind, req: Request, deps: HubImportDeps): Promise<Response> {
  if (!deps.enabled) {
    return err(503, 'HUB 連携は無効です（HUB_INTEGRATION_ENABLED=true のときだけ有効）', 'MODE_DISABLED');
  }

  const rawBody = await req.text();
  const auth = verifyHubRequest({
    secret: deps.secret,
    signature: req.headers.get(HUB_HEADERS.signature),
    timestamp: req.headers.get(HUB_HEADERS.timestamp),
    idempotencyKey: req.headers.get(HUB_HEADERS.idempotencyKey),
    rawBody,
    nowSec: deps.nowSec,
  });
  if (!auth.ok) return err(auth.status, auth.message, 'AUTH');

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return err(400, '不正な JSON', 'VALIDATION');
  }

  const parsed = kind === 'orders' ? HubOrdersBody.safeParse(json) : HubProductsBody.safeParse(json);
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`);
    return err(422, '本文が契約と合いません', 'VALIDATION', errors);
  }

  const key = auth.idempotencyKey;
  try {
    return await serialized(async () => {
      const saved = await deps.findSaved(key);
      if (saved !== null && typeof saved === 'object') {
        const s = saved as { data?: Record<string, unknown> };
        return NextResponse.json({ ...s, data: { ...(s.data ?? {}), replay: true } });
      }

      const opts = { filename: `hub:${key}`, importedBy: HUB_STAFF_CODE };
      let body: { data: Record<string, unknown>; message: string };
      if (kind === 'orders') {
        const orders = (parsed.data as { orders: Parameters<typeof toThomasOrderRows>[0] }).orders;
        const r = await deps.importOrders(toThomasOrderRows(orders), opts);
        body = { data: { replay: false, ...pick(r), slips: summarizeSlips(orders.map((o) => o.pkNo), r) }, message: 'OK' };
      } else {
        const products = (parsed.data as { products: Parameters<typeof toThomasProductRows>[0] }).products;
        const r = await deps.importProducts(toThomasProductRows(products), opts);
        body = { data: { replay: false, ...pick(r), errors: r.errors, warnings: r.warnings ?? [] }, message: 'OK' };
      }
      // 応答を先に保存する：自動引当が長引いて HUB がタイムアウト→再送しても、取込をやり直さず保存済みを返せる
      await deps.save(key, kind, body);
      if (kind === 'orders') {
        await deps.afterOrdersImported(Number(body.data.importId));
      }
      return NextResponse.json(body);
    });
  } catch (e) {
    console.error('[hub-import]', kind, e instanceof Error ? e.message : e);
    return err(500, '取込に失敗しました（詳細はサーバログ）', 'INTERNAL');
  }
}

function pick(r: ImportResult) {
  return {
    importId: r.importId,
    totalRows: r.totalRows,
    successCount: r.successCount,
    errorCount: r.errorCount,
    duplicatePkNoCount: r.duplicatePkNoCount,
    unmapCount: r.unmapCount,
    unmappedCodes: r.unmappedCodes,
  };
}
