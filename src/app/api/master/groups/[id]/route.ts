import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  name: z.string().min(1).max(20),
  tables: z.union([z.string(), z.array(z.string())]).optional(),
  category: z.string().min(1).max(20),
  needStaff: z.number().int().min(0).default(1),
  // Sprint Y-10: ダッシュボード表示順
  sortOrder: z.number().int().min(0).default(100),
  note: z.string().nullable().optional(),
});

function normalizeTables(v: string | string[] | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return v
    .split(/[,、\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }
  const id = decodeURIComponent(params.id);
  try {
    const updated = await prisma.inspectionGroup.update({
      where: { id },
      data: { ...parsed.data, tables: normalizeTables(parsed.data.tables) },
    });
    return NextResponse.json({ data: updated, message: 'OK' });
  } catch {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'グループが見つかりません' },
      { status: 404 },
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const id = decodeURIComponent(params.id);

  // Sprint Y-9: `?force=true` で参照スタッフ・割当を null 化してから削除
  const { searchParams } = new URL(req.url);
  const force = searchParams.get('force') === 'true';

  // 参照中レコードを集計
  const [staffReferrers, memberAssignmentCount, stdTimeCount] = await Promise.all([
    prisma.staff.findMany({
      where: { groupId: id },
      select: { code: true, name: true },
    }),
    prisma.memberAssignment.count({ where: { groupId: id } }),
    prisma.stdTime.count({ where: { groupId: id } }),
  ]);

  const totalRefs = staffReferrers.length + memberAssignmentCount + stdTimeCount;

  if (totalRefs > 0 && !force) {
    const parts: string[] = [];
    if (staffReferrers.length > 0) {
      parts.push(
        `スタッフ ${staffReferrers.length} 名 (${staffReferrers
          .slice(0, 3)
          .map((s) => s.name)
          .join('、')}${staffReferrers.length > 3 ? ' 他' : ''})`,
      );
    }
    if (memberAssignmentCount > 0)
      parts.push(`メンバー割当 ${memberAssignmentCount} 件`);
    if (stdTimeCount > 0) parts.push(`標準時間 ${stdTimeCount} 件`);
    return NextResponse.json(
      {
        error: 'CONFLICT',
        message: `このグループは以下から参照されているため削除できません: ${parts.join(' / ')}\n（参照ごと削除するには ?force=true）`,
        meta: {
          staffReferrers,
          memberAssignmentCount,
          stdTimeCount,
        },
      },
      { status: 409 },
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (force) {
        // Sprint Y-10: 参照レコードを順に処理
        // 1. 参照スタッフの groupId を null に
        if (staffReferrers.length > 0) {
          await tx.staff.updateMany({
            where: { groupId: id },
            data: { groupId: null },
          });
        }
        // 2. メンバー割当を削除（履歴も含む）
        if (memberAssignmentCount > 0) {
          await tx.memberAssignment.deleteMany({ where: { groupId: id } });
        }
        // 3. 標準時間を削除
        if (stdTimeCount > 0) {
          await tx.stdTime.deleteMany({ where: { groupId: id } });
        }
      }
      await tx.inspectionGroup.delete({ where: { id } });
    });
    return NextResponse.json({
      data: {
        id,
        forced: force,
        unlinkedStaff: staffReferrers.length,
        deletedMemberAssignments: force ? memberAssignmentCount : 0,
        deletedStdTimes: force ? stdTimeCount : 0,
      },
      message: force
        ? `グループを削除しました（スタッフ ${staffReferrers.length} 名 / 割当 ${memberAssignmentCount} 件 / 標準時間 ${stdTimeCount} 件 を解除）`
        : 'OK',
    });
  } catch (e) {
    return maskError(
      '[DELETE /api/master/groups]',
      e,
      'CONFLICT',
      409,
      '削除できません（予期しない参照あり）',
    );
  }
}
