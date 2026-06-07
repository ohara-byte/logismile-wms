/**
 * POST /api/inspect/complete
 * 検品完了（納品書№スキャン）
 *
 * リクエスト: { sessionId, pkNo, invoiceNo, boxCode? }
 *
 * 処理:
 *  1. ピッキング№と納品書№の整合性確認
 *  2. ★ サンドイッチ検証（2026-05-31 緊急修正）: invoiceNo が
 *     - ピッキング№（pkNo）と同一 → 拒否（商品スキャン誤発火）
 *     - この伝票の商品 JAN / 商品コードのいずれかと同一 → 拒否
 *     これにより「最後の商品バーコードで完了してしまう」事故を防ぐ。
 *  3. 全アイテムが scannedQty == qty (or forceOk) であることを確認
 *  4. shipping_orders.status='packed', invoice_no を更新
 *  5. insp_sessions.completed_at, duration_sec, box_code を記録
 *  6. insp_logs に type=complete 記録
 *  7. ★ qr_print_flag=true の場合のみ自動印刷
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole, ownsSession } from '@/lib/auth/permissions';
import { isAllInspected } from '@/lib/inspection';
import { runPrintJob } from '@/lib/print-job';

const Body = z.object({
  sessionId: z.string().min(1),
  pkNo: z.string().min(1),
  invoiceNo: z.string().min(1),
  boxCode: z.string().optional(),
  /** X-3: 印刷確認モーダルで「印刷せず完了」を選んだ場合に true */
  skipPrint: z.boolean().optional(),
});

export async function POST(req: Request) {
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
        select: {
          id: true,
          pkNo: true,
          qrPrintFlag: true,
          status: true,
          invoiceNo: true, // ★ サンドイッチ照合の権威値（取込時に基幹 CSV から保存済み）
          items: {
            select: {
              qty: true,
              scannedQty: true,
              forceOk: true,
              productCode: true,
              product: { select: { jan: true } },
            },
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
  if (session.order.pkNo !== parsed.data.pkNo) {
    return NextResponse.json(
      {
        error: 'VALIDATION',
        message: `ピッキング№が一致しません（セッション=${session.order.pkNo}, 入力=${parsed.data.pkNo}）`,
      },
      { status: 422 },
    );
  }

  // ★★★ サンドイッチ検証の核心（2026-05-31 修正）★★★
  //   検品完了の最後の砦：スキャンされた納品書バーコードが、取込時に基幹 CSV から
  //   保存済みの納品書№（shipping_orders.invoice_no）と「完全一致」することを検証する。
  //   これにより「正しい納品書が正しい箱に入った」ことを保証する。
  //
  //   ※ 旧実装はスキャン値を invoice_no に「上書き保存」していただけで照合しておらず、
  //     数字（=空でない値）なら何でも検品完了になってしまっていた（現場報告）。
  const scanned = parsed.data.invoiceNo.trim();
  const stored = (session.order.invoiceNo ?? '').trim();

  const productCodeSet = new Set(session.order.items.map((it) => it.productCode));
  const productJanSet = new Set(
    session.order.items
      .map((it) => it.product?.jan)
      .filter((j): j is string => !!j),
  );

  // ① 保存済み納品書№が無い（基幹データ不備）→ 完全ブロック
  if (stored === '') {
    return NextResponse.json(
      {
        error: 'INVOICE_NOT_REGISTERED',
        message:
          'この伝票には納品書№が登録されていません。基幹データを確認してください。',
      },
      { status: 422 },
    );
  }

  // ② 完全一致しない → 拒否。誤読の種類で親切なメッセージを出し分け
  if (scanned !== stored) {
    let hint = '納品書№が一致しません。正しい納品書バーコードをスキャンしてください。';
    if (scanned === session.order.pkNo) {
      hint = 'ピッキング№が読まれています。納品書バーコードをスキャンしてください。';
    } else if (productCodeSet.has(scanned) || productJanSet.has(scanned)) {
      hint = '商品バーコードが読まれています。納品書バーコードをスキャンしてください。';
    }
    return NextResponse.json(
      { error: 'INVOICE_MISMATCH', message: hint },
      { status: 422 },
    );
  }

  if (!isAllInspected(session.order.items)) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'すべての商品が検品されていません（強制OK or スキャン）' },
      { status: 422 },
    );
  }

  const startedAt = session.startedAt;
  const completedAt = new Date();
  const durationSec = Math.max(1, Math.round((completedAt.getTime() - startedAt.getTime()) / 1000));

  // 2026-06-01 A-3: 同一伝票を 2 端末が同時完了しても二重完了させない。
  //   セッション更新を completedAt:null の楽観条件にし、claim できた 1 件のみが
  //   後続（packed 化 / complete ログ / 引当 fulfilled）を実行する。
  const ALREADY = Symbol('already_completed');
  try {
    await prisma.$transaction(async (tx) => {
      const claim = await tx.inspSession.updateMany({
        where: { id: session.id, completedAt: null },
        data: { completedAt, durationSec, boxCode: parsed.data.boxCode },
      });
      if (claim.count === 0) {
        throw ALREADY; // 別端末が先に完了済み
      }
      await tx.shippingOrder.update({
        where: { id: session.order.id },
        // invoiceNo は取込値（基幹の権威値）のまま。照合済みなので上書きしない。
        data: { status: 'packed' },
      });
      await tx.inspLog.create({
        data: {
          sessionId: session.id,
          type: 'complete',
          itemCode: stored, // 照合済みの権威値
          note: parsed.data.boxCode ? `boxCode=${parsed.data.boxCode}` : null,
        },
      });
      // Sprint Z-1: 引当行を fulfilled に更新（reserved → fulfilled）
      //   引当が無い注文（旧データ等）は updateMany が 0 件で何もしない
      await tx.allocation.updateMany({
        where: { orderId: session.order.id, status: 'reserved' },
        data: { status: 'fulfilled', fulfilledAt: completedAt },
      });
    });
  } catch (e) {
    if (e === ALREADY) {
      return NextResponse.json(
        { error: 'CONFLICT', message: 'この伝票は既に完了処理されました' },
        { status: 409 },
      );
    }
    throw e;
  }

  // ★ QR印刷フラグ ON の場合のみ自動印刷（X-3: skipPrint=true で抑止可）
  let printResult: Awaited<ReturnType<typeof runPrintJob>> | null = null;
  if (session.order.qrPrintFlag && !parsed.data.skipPrint) {
    if (!session.deviceCode) {
      // 端末コードがないと既定プリンター解決不可
      printResult = null;
    } else {
      printResult = await runPrintJob({
        orderId: session.order.id,
        pkNo: session.order.pkNo,
        invoiceNo: stored, // 照合済みの権威値（基幹由来）を印字
        deviceCode: session.deviceCode,
        staffCode: session.staffCode,
        isReprint: false,
      });
    }
  }

  return NextResponse.json({
    data: {
      sessionId: session.id,
      pkNo: session.order.pkNo,
      status: 'packed',
      invoiceNo: stored,
      durationSec,
      qrPrintFlag: session.order.qrPrintFlag,
      print: printResult ? { ok: printResult.ok, dryRun: printResult.dryRun ?? false } : null,
    },
    message: 'OK',
  });
}
