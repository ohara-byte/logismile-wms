/**
 * HUB ← LogiSmile 梱包状況（POST /api/integration/hub/status・2026-10-09）。
 *
 * 小原様「WMS 出荷状況をリアルに HUB が取得（Logi から HUB へはセキュリティ上避けたいので、
 * 取りに行く方法で構築が希望）」「（間隔は）3 分」。HUB がピッキング№をまとめて送り、
 * LogiSmile は伝票ごとの状態を返す。**読むだけ**（DB に書かない）。
 *
 *   無効(503) → 署名(401) → 冪等キー(400) → JSON(400) → 本文(422) → 状態を返す
 *
 * 認証は登録の口（hub-handler.ts）と同じ verifyHubRequest。読むだけなので冪等キーは保存しない
 * （再送でも毎回いまの状態を返す）。送付先の氏名・住所は返さない。
 *
 * 状態は shipping_orders.status をそのまま返す（pending / inspecting / packed / shipped / held）。
 * 読み替えは HUB 側で行う（値が増えても LogiSmile 側を直さずに済む）。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { HUB_HEADERS, verifyHubRequest } from './hub-auth';

/** 1 回で問い合わせるピッキング№の上限 */
export const HUB_STATUS_MAX_PKNOS = 1000;

export const HubStatusBody = z
  .object({
    pkNos: z.array(z.string().trim().min(1).max(30)).min(1).max(HUB_STATUS_MAX_PKNOS),
  })
  .strict();

/** DB から引く 1 伝票（route.ts が Prisma で作る） */
export type HubStatusRow = {
  pkNo: string;
  status: string;
  holdReason: string | null;
  deletedAt: Date | null;
  /** 検品完了の時刻（insp_sessions.completed_at）。未検品照合で梱包済にした伝票は無い */
  packedAt: Date | null;
  updatedAt: Date;
};

export type HubSlipStatus = {
  pkNo: string;
  status: string;
  holdReason: string | null;
  packedAt: string | null;
  deleted: boolean;
  updatedAt: string;
};

export type HubStatusDeps = {
  enabled: boolean;
  secret: string | null;
  nowSec?: number;
  findOrders: (pkNos: string[]) => Promise<HubStatusRow[]>;
};

const PACKED = new Set(['packed', 'shipped']);

export function toHubSlipStatus(r: HubStatusRow): HubSlipStatus {
  return {
    pkNo: r.pkNo,
    status: r.status,
    // 保留を解いた後も hold_reason が残ることがあるので、保留中だけ返す
    holdReason: r.status === 'held' ? r.holdReason : null,
    // 検品をやり直している伝票（packed → inspecting）に前の完了時刻を出さない
    packedAt: PACKED.has(r.status) && r.packedAt ? r.packedAt.toISOString() : null,
    deleted: r.deletedAt !== null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function err(status: number, message: string, code: string, errors?: string[]) {
  return NextResponse.json({ data: null, message, error: code, ...(errors ? { errors } : {}) }, { status });
}

export async function handleHubStatus(req: Request, deps: HubStatusDeps): Promise<Response> {
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
  const parsed = HubStatusBody.safeParse(json);
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`);
    return err(422, '本文が契約と合いません', 'VALIDATION', errors);
  }

  const pkNos = [...new Set(parsed.data.pkNos)];
  try {
    const rows = await deps.findOrders(pkNos);
    const found = new Set(rows.map((r) => r.pkNo));

    return NextResponse.json({
      data: {
        slips: rows.map(toHubSlipStatus),
        missing: pkNos.filter((p) => !found.has(p)),
      },
      message: 'OK',
    });
  } catch (e) {
    console.error('[hub status]', e);
    return err(500, '状態の取得に失敗しました', 'INTERNAL');
  }
}
