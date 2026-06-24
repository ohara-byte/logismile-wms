/**
 * POST /api/inspect/scan
 * バーコードスキャン処理（JAN または 商品コード）
 *
 * リクエスト: { sessionId, scanValue, qty }
 *
 * 処理:
 *  1. session → order の items を取得
 *  2. judgeScan() で結果区分判定
 *  3. matched なら scannedQty を加算
 *  4. insp_logs に記録（type=scan）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole, ownsSession } from '@/lib/auth/permissions';
import { judgeScan, stripPkPrefix } from '@/lib/inspection';

const Body = z.object({
  sessionId: z.string().min(1),
  scanValue: z.string().min(1),
  qty: z.number().int().positive().default(1),
});

export async function POST(req: Request) {
  // ⑤ 計測（2026-06-14）：1スキャンのサーバ処理時間を Server-Timing ヘッダで返す。
  //   ブラウザ devtools の Network → 当該 /api/inspect/scan → Timing で「サーバ時間 vs 総時間」を比較でき、
  //   遅延がサーバ側かネットワーク/クライアント側かを切り分けられる。
  const t0 = Date.now();
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const session = await prisma.inspSession.findUnique({
    where: { id: parsed.data.sessionId },
    include: {
      order: {
        include: {
          // productName（item側スナップショット）でラッピング判定（2026-06-23）
          items: {
            include: { product: { select: { jan: true } } },
          },
        },
      },
    },
  });
  if (!session) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'セッションがありません' }, { status: 404 });
  }
  if (!ownsSession(guard.auth, session)) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '他の担当者のセッションは操作できません' },
      { status: 403 },
    );
  }
  if (session.completedAt) {
    return NextResponse.json(
      { error: 'CONFLICT', message: 'セッションは既に完了しています' },
      { status: 409 },
    );
  }

  // ラッピング代替バーコード（2026-06-23）：ピッキング№コア（pkNoの先頭英字除去）と数字バーコードを照合。
  const sv = parsed.data.scanValue.trim();
  const orderCore = stripPkPrefix(session.order.pkNo);
  const isWrapTrigger = /^[0-9]/.test(sv) && sv === orderCore;
  // ラッピング判定語は既定「ラッピング」。設定があれば上書き（ラッピング経路のときだけ参照＝通常スキャンに負荷を足さない）。
  let wrappingPrefix: string | undefined;
  if (isWrapTrigger) {
    const setting = await prisma.appSetting.findUnique({
      where: { key: 'pack.wrapping_prefix' },
      select: { value: true },
    });
    wrappingPrefix = setting?.value?.trim() || undefined;
  }

  let judge = judgeScan(session.order.items, sv, parsed.data.qty, { orderCore, wrappingPrefix });

  // 取り違え検知：数字始まりで該当なし → 別伝票のコアに一致するか（=他注文のラッピング商品）。
  if (judge.result === 'not_found' && /^[0-9]/.test(sv) && sv !== orderCore) {
    const other = await prisma.shippingOrder.findFirst({
      where: { pkNo: { endsWith: sv }, deletedAt: null },
      select: { pkNo: true },
    });
    if (other && stripPkPrefix(other.pkNo) === sv && other.pkNo !== session.order.pkNo) {
      judge = { result: 'wrong_order' };
    }
  }

  // 書き込みを並列化（⑤ 微最適化）：ログ作成と明細更新は独立のため Promise.all で1往復に集約。
  //   ログは必ず残す。ラッピング代替バーコードでの割当は type=wrap_pkno で区別（監査）。
  const logType = isWrapTrigger && judge.result === 'matched' ? 'wrap_pkno' : 'scan';
  const writes: Promise<unknown>[] = [
    prisma.inspLog.create({
      data: {
        sessionId: session.id,
        type: logType,
        itemCode: parsed.data.scanValue,
        qty: parsed.data.qty,
        note: judge.result,
      },
    }),
  ];
  if (judge.result === 'matched' && judge.itemId) {
    writes.push(
      prisma.shippingOrderItem.update({
        where: { id: judge.itemId },
        data: { scannedQty: judge.nextScannedQty! },
      }),
    );
  }
  await Promise.all(writes);

  return NextResponse.json(
    {
      data: {
        result: judge.result,
        itemId: judge.itemId ?? null,
        // 2026-06-03 ④軽量化: matched 時の確定スキャン数を返し、クライアントは
        //   伝票全体の再取得(refreshOrder)なしでローカル更新できるようにする。
        scannedQty: judge.nextScannedQty ?? null,
      },
      message: 'OK',
    },
    { headers: { 'Server-Timing': `scan;dur=${Date.now() - t0}` } },
  );
}
