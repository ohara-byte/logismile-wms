/**
 * POST /api/mfg/[id]/send
 *
 * Sprint Z-3: 製造指示を工場へ送信
 *  - draft / pending → sent に状態遷移
 *  - 工場連携は Sprint B-2 で実装予定。現状は DRY-RUN（ログのみ）
 *  - PRINTER_DRY_RUN と同様のパターンで FACTORY_DRY_RUN=true（既定）の場合は送信せず status のみ更新
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json(
      { error: 'VALIDATION', message: '不正な ID' },
      { status: 422 },
    );
  }

  const target = await prisma.manufacturingInstruction.findUnique({
    where: { id },
    include: { product: { select: { name: true } } },
  });
  if (!target) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: '製造指示が見つかりません' },
      { status: 404 },
    );
  }
  if (target.status !== 'draft' && target.status !== 'pending') {
    return NextResponse.json(
      {
        error: 'CONFLICT',
        message: `status=${target.status} の指示は送信できません`,
      },
      { status: 409 },
    );
  }

  // DRY-RUN: 実機連携が無くても status を sent に倒して動作確認できる
  const dryRun = process.env.FACTORY_DRY_RUN !== 'false';
  let factoryRef: string | null = target.factoryRef;

  if (dryRun) {
    factoryRef = factoryRef ?? `DRY-${target.instructionNo}`;
    console.info(
      `[mfg-send] DRY-RUN ${target.instructionNo} product=${target.productCode} qty=${target.qty} target=${target.targetDate.toISOString().slice(0, 10)} by=${guard.auth.staffCode ?? 'admin'}`,
    );
  } else {
    // TODO Sprint B-2: factory-adapter.sendInstruction(target) → factoryRef 取得
    return NextResponse.json(
      {
        error: 'INTERNAL',
        message:
          '工場連携アダプタは未実装です。FACTORY_DRY_RUN=true で動作確認してください',
      },
      { status: 501 },
    );
  }

  const updated = await prisma.manufacturingInstruction.update({
    where: { id },
    data: {
      status: 'sent',
      sentAt: new Date(),
      factoryRef,
    },
  });

  return NextResponse.json({
    data: { ...updated, dryRun },
    message: 'OK',
  });
}
