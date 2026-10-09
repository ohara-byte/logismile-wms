/**
 * HUB → LogiSmile 当日キャンセル（POST /api/integration/hub/cancel・2026-10-09）。
 *
 * 小原様「キャンセルは callHUB でオペレータがキャンセル処理をしたらそのまま送信予定」
 * 「オペレータの 2 重処理は避けたい」「WMS へチャット連絡と検品遮断をしたい」
 * 「お届先様名も追加してもらえますか」。モック: oeno-echub mockup/22b_wms_cancel_devices.html。
 *
 *   無効(503) → 署名(401) → 冪等キー(400) → JSON(400) → 本文(422) → 再送なら保存済みを返す → キャンセル
 *
 * 伝票の状態ごとの扱い（decideHubCancel）:
 *   未着手・保留   → キャンセルの印＋論理削除（ピッキング№をスキャンしても検品を始められない） → cancelled
 *   検品中         → キャンセルの印（次のスキャン・完了の操作で止める＝完了できない）        → blocked_inspecting
 *   梱包済・出荷済 → システムでは止めない（印は記録として残す）。現場へ抜き取りを連絡        → packed
 * いずれも現場へ連絡事項（了解必須・全端末・発信者 HUB）を出す（hubCancelNotice）。
 *
 * DB に触れる部分（cancelOrder）は route.ts が渡す。ここは処理順と文面をテストで固定する（hub-cancel.test.ts）。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { HUB_HEADERS, verifyHubRequest } from './hub-auth';

export const HubCancelBody = z
  .object({
    pkNo: z.string().trim().min(1).max(30),
    reason: z.string().trim().min(1).max(200),
    /** callHUB でキャンセルした人（連絡事項・記録に出す） */
    operator: z.string().trim().max(30).optional(),
  })
  .strict();
export type HubCancelInput = z.infer<typeof HubCancelBody>;

export type HubCancelResult = 'cancelled' | 'blocked_inspecting' | 'packed' | 'already_cancelled' | 'not_found';

export type HubCancelOutcome = {
  result: HubCancelResult;
  /** キャンセルを受けた時点の LogiSmile の状態（無ければ null） */
  previousStatus: string | null;
  destName: string | null;
  invoiceNo: string | null;
  /** 梱包済・出荷済のとき、検品完了の時刻（ISO） */
  packedAt: string | null;
  /** 検品中のとき、検品している担当と端末 */
  inspector: { staffCode: string; staffName: string | null; deviceCode: string | null } | null;
  noticeId: number | null;
};

export type HubCancelDeps = {
  enabled: boolean;
  secret: string | null;
  nowSec?: number;
  findSaved: (idempotencyKey: string) => Promise<unknown | null>;
  save: (idempotencyKey: string, endpoint: 'cancel', response: unknown) => Promise<void>;
  cancelOrder: (input: HubCancelInput) => Promise<HubCancelOutcome>;
};

/** 伝票の状態 → キャンセルの扱い */
export function decideHubCancel(status: string): 'cancelled' | 'blocked_inspecting' | 'packed' {
  if (status === 'packed' || status === 'shipped') return 'packed';
  if (status === 'inspecting') return 'blocked_inspecting';
  return 'cancelled';
}

const NOTICE_TITLE_MAX = 100;

/** 現場への連絡事項（notices に入れる中身） */
export function hubCancelNotice(p: {
  pkNo: string;
  invoiceNo: string | null;
  destName: string | null;
  reason: string;
  result: 'cancelled' | 'blocked_inspecting' | 'packed';
}): { title: string; body: string; ackRequired: true; targetType: 'all'; senderCode: 'HUB'; priority: number } {
  const head = p.result === 'packed' ? '【当日キャンセル・梱包済】' : '【当日キャンセル】';
  const parts = [p.destName ? `${p.destName} 様` : null, p.invoiceNo ? `納品書 ${p.invoiceNo}` : null, p.pkNo].filter(Boolean);
  let title = head + parts.join(' ／ ');
  if (title.length > NOTICE_TITLE_MAX) title = title.slice(0, NOTICE_TITLE_MAX - 1) + '…';

  const action =
    p.result === 'cancelled'
      ? '未着手のため、検品はできないようにしてあります。ピッキング済みの商品はキャンセル棚へ戻してください。'
      : p.result === 'blocked_inspecting'
        ? '検品中のため、ここで検品を止めます（完了できません）。スキャンした商品はキャンセル棚へ戻してください。'
        : '梱包済みのためシステムでは止められません。出荷前に抜き取ってください（運送会社へ渡す前に）。';

  return {
    title,
    body: `${p.reason} でキャンセルになりました。\n${action}`,
    ackRequired: true,
    targetType: 'all',
    senderCode: 'HUB',
    priority: 90,
  };
}

/**
 * キャンセル済みの伝票を検品しようとしたときの応答（409 CANCELLED）。端末はこの中身で止める画面を出す。
 * during: start = スキャンして始めようとした ／ inspect = 検品の途中（スキャン・完了）
 */
export function cancelledOrderError(
  o: { pkNo: string; invoiceNo: string | null; destName: string | null; cancelReason: string | null; cancelRequestedAt: Date },
  during: 'start' | 'inspect',
) {
  return NextResponse.json(
    {
      error: 'CANCELLED',
      message: during === 'start' ? 'この伝票はキャンセルされました' : '検品中にキャンセルされました',
      data: {
        pkNo: o.pkNo,
        invoiceNo: o.invoiceNo,
        destName: o.destName,
        reason: o.cancelReason,
        cancelledAt: o.cancelRequestedAt.toISOString(),
        during,
      },
    },
    { status: 409 },
  );
}

function err(status: number, message: string, code: string, errors?: string[]) {
  return NextResponse.json({ data: null, message, error: code, ...(errors ? { errors } : {}) }, { status });
}

export async function handleHubCancel(req: Request, deps: HubCancelDeps): Promise<Response> {
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
  const parsed = HubCancelBody.safeParse(json);
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`);
    return err(422, '本文が契約と合いません', 'VALIDATION', errors);
  }

  try {
    const saved = await deps.findSaved(auth.idempotencyKey);
    if (saved !== null && typeof saved === 'object') {
      const s = saved as { data?: Record<string, unknown> };
      return NextResponse.json({ ...s, data: { ...(s.data ?? {}), replay: true } });
    }

    const out = await deps.cancelOrder(parsed.data);
    const body = { data: { replay: false, pkNo: parsed.data.pkNo, ...out }, message: 'OK' };
    await deps.save(auth.idempotencyKey, 'cancel', body);

    return NextResponse.json(body);
  } catch (e) {
    console.error('[hub cancel]', e);
    return err(500, 'キャンセルに失敗しました', 'INTERNAL');
  }
}
