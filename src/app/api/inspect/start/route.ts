/**
 * POST /api/inspect/start
 * 検品セッション開始
 *
 * リクエスト: { pkNo, takeover? }
 *   ★ staffCode / deviceCode は **必ず認証情報から取得**（Body 受領を廃止）。
 *     Body 受領を許すと別人名義の検品セッションを作成できる IDOR / 監査偽装になる。
 *   takeover: 別担当者の検品セッションを引き継ぐ意思確認フラグ（現場 2026-05-31）
 *
 * 処理:
 *  1. shipping_orders.pk_no で order を取得（deleted_at IS NULL）
 *  2. packed/shipped なら 409
 *  3. 既存セッションがあれば、所有者一致時はそのまま RESUMED
 *     ・別担当者の場合：
 *       - admin/manager または保留中（held） または takeover=true → 引き継ぎ実行（TAKEN_OVER）
 *       - それ以外（staff が inspecting を引き継ぐ前の確認）→ 409 TAKEOVER_REQUIRED
 *  4. なければ新規 insp_sessions レコード作成 + status='inspecting'
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { allocateMtoForOrder } from '@/lib/allocation/allocate-on-inspection';
import { isFactoryApiMode } from '@/lib/integration/factory-mode';

const Body = z.object({
  pkNo: z.string().min(1),
  /** 別担当者のセッションを引き継ぐ意思確認（モバイル UI で確認モーダル経由） */
  takeover: z.boolean().optional(),
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

  // 認証情報のみを信頼する。Body での上書きは受け付けない。
  const staffCode = guard.auth.staffCode;
  const deviceCode = guard.auth.deviceCode;
  if (!staffCode) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '検品作業には staff レコードに紐付くアカウントが必要です' },
      { status: 403 },
    );
  }

  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo: parsed.data.pkNo, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: `ピッキング№が見つかりません` },
      { status: 404 },
    );
  }
  if (order.status === 'packed' || order.status === 'shipped') {
    return NextResponse.json(
      { error: 'CONFLICT', message: `この伝票は既に ${order.status} 状態です` },
      { status: 409 },
    );
  }

  // 既存セッションがあれば、所有者一致時のみ即座に RESUMED。
  // 2026-05-31 現場要望: 別担当者でも引き継ぎ可能に。
  //   - 保留中（held） は誰でも引き継ぎ自動 OK（held = 引き継ぎ前提状態）
  //   - admin/manager は常に引き継ぎ可
  //   - inspecting 中で別担当者 + staff ロール の場合は takeover=true で明示確認した時のみ可
  const existing = await prisma.inspSession.findUnique({
    where: { orderId: order.id },
    include: { staff: { select: { code: true, name: true } } },
  });
  if (existing) {
    const isSameStaff = existing.staffCode === staffCode;

    if (isSameStaff) {
      // 同一担当者の再開（端末変更も含む）。device_code が変わっていれば追従。
      if (existing.deviceCode !== deviceCode) {
        await prisma.inspSession.update({
          where: { id: existing.id },
          data: { deviceCode },
        });
      }
      return NextResponse.json({
        data: {
          id: existing.id,
          staffCode: existing.staffCode,
          deviceCode: deviceCode ?? existing.deviceCode,
          startedAt: existing.startedAt,
          completedAt: existing.completedAt,
        },
        message: 'RESUMED',
      });
    }

    // 別担当者ケース。引き継ぎ可能か判定。
    const isPrivileged = guard.auth.role !== 'staff'; // admin / manager は常に可
    const isHeld = order.status === 'held'; // 保留中は誰でも引き継ぎ可
    const isExplicitTakeover = parsed.data.takeover === true;
    const allowTakeover = isPrivileged || isHeld || isExplicitTakeover;

    if (!allowTakeover) {
      // 確認モーダルを促す。元担当者の情報は返すが端末コードは返さない（プライバシー考慮）。
      return NextResponse.json(
        {
          error: 'TAKEOVER_REQUIRED',
          message: '他の担当者が検品中の伝票です。引き継ぎますか？',
          currentOwner: {
            staffCode: existing.staffCode,
            staffName: existing.staff?.name ?? null,
          },
        },
        { status: 409 },
      );
    }

    // 引き継ぎ実行: セッション所有者を更新し、監査ログを残す。
    const note = `引き継ぎ: ${existing.staffCode}${existing.staff?.name ? `(${existing.staff.name})` : ''} → ${staffCode}` +
      (existing.deviceCode !== deviceCode
        ? ` / 端末: ${existing.deviceCode ?? '-'} → ${deviceCode ?? '-'}`
        : '');
    await prisma.$transaction([
      prisma.inspLog.create({
        data: {
          sessionId: existing.id,
          type: 'takeover',
          note,
        },
      }),
      prisma.inspSession.update({
        where: { id: existing.id },
        data: { staffCode, deviceCode },
      }),
    ]);
    return NextResponse.json({
      data: {
        id: existing.id,
        staffCode,
        deviceCode,
        startedAt: existing.startedAt,
        completedAt: existing.completedAt,
      },
      message: 'TAKEN_OVER',
    });
  }

  const [, session] = await prisma.$transaction([
    prisma.shippingOrder.update({
      where: { id: order.id },
      data: { status: 'inspecting' },
    }),
    prisma.inspSession.create({
      data: {
        orderId: order.id,
        staffCode,
        deviceCode,
      },
      select: { id: true, staffCode: true, deviceCode: true, startedAt: true, completedAt: true },
    }),
  ]);

  // Sprint Z-5: 受注生産（made_to_order）品を検品開始順（FIFO）でプールから引き当てる。
  //   失敗（在庫不足）はサイレントに継続し、検品自体はブロックしない。
  // Sprint Z-8: factory_api モード時は allocate-order 側で伝票引当済のため、
  //   ここでの追加引当は不要（重複防止）。
  let mtoAlloc: Awaited<ReturnType<typeof allocateMtoForOrder>> | null = null;
  if (!isFactoryApiMode()) {
    try {
      mtoAlloc = await allocateMtoForOrder(order.id);
    } catch (e) {
      console.error('[inspect/start] MTO allocation failed', e);
    }
  }

  return NextResponse.json({
    data: { ...session, mtoAlloc },
    message: 'OK',
  });
}
