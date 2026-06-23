/**
 * PUT /api/master/set-comps/[id]/children   構成品（子）を一括置換（2026-06-23）
 *
 * 親商品マスタの編集画面から構成品を確認・修正するための endpoint。
 * Body: { children: [{ childCode, childName?, qty }] }
 * 既存の子を全削除→受け取った内容で作り直す（BOM取込と同じ置換方式）。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  children: z
    .array(
      z.object({
        childCode: z.string().min(1).max(20),
        childName: z.string().max(100).nullable().optional(),
        qty: z.coerce.number().int().min(1).default(1),
      }),
    )
    .max(500),
});

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const id = decodeURIComponent(params.id);
  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const exists = await prisma.setComp.findUnique({ where: { id }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: 'NOT_FOUND', message: '親商品が見つかりません' }, { status: 404 });
  }

  // childCode 重複は弾く（同一構成品の二重登録を防止）
  const seen = new Set<string>();
  for (const c of parsed.data.children) {
    if (seen.has(c.childCode)) {
      return NextResponse.json(
        { error: 'VALIDATION', message: `構成品コードが重複しています: ${c.childCode}` },
        { status: 422 },
      );
    }
    seen.add(c.childCode);
  }

  // 子名称が空のものは Product マスタから補完（あれば）
  const codes = parsed.data.children.map((c) => c.childCode);
  const products = codes.length
    ? await prisma.product.findMany({ where: { code: { in: codes } }, select: { code: true, name: true } })
    : [];
  const nameByCode = new Map(products.map((p) => [p.code, p.name]));

  await prisma.$transaction([
    prisma.setCompChild.deleteMany({ where: { setCompId: id } }),
    prisma.setCompChild.createMany({
      data: parsed.data.children.map((c, i) => ({
        setCompId: id,
        childCode: c.childCode,
        childName: (c.childName?.trim() || nameByCode.get(c.childCode)) ?? null,
        qty: c.qty,
        sortOrder: i,
      })),
    }),
  ]);

  return NextResponse.json({ data: { id, count: parsed.data.children.length }, message: 'OK' });
}
