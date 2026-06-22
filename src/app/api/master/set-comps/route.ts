/**
 * GET  /api/master/set-comps   一覧（親）
 * POST /api/master/set-comps   作成（親のみ。子は別 endpoint）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  id: z.string().min(1).max(30),
  parentCode: z.string().min(1).max(20),
  parentName: z.string().min(1).max(100),
  type: z.enum(['set', 'koudoku', 'noshi', 'other']).default('set'),
  fixedBoxCode: z.string().max(30).nullable().optional(),
  packingNote: z.string().nullable().optional(),
  // セット梱包標準時間（秒）。UIで設定すると stdSecSource='manual' とし取込上書きから保護（2026-06-22）
  stdSec: z.coerce.number().int().min(0).nullable().optional(),
  setKind: z.enum(['bokujo', 'hanpukai', 'other']).nullable().optional(),
  note: z.string().nullable().optional(),
});

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  // Sprint Y-2: 親商品＝構成＋同梱品。子商品（構成商品）の情報も合わせて返す
  //   - 子商品コード／品名／点数／標準時間（productAux.stdSec から逆引き）
  //   親商品の確定は子商品コードの組合せから逆算するため、子商品情報はマスタ画面でも閲覧できる必要がある。
  const items = await prisma.setComp.findMany({
    orderBy: [{ parentCode: 'asc' }],
    include: {
      _count: { select: { children: true } },
      fixedBox: { select: { code: true, name: true } },
      children: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, childCode: true, childName: true, qty: true },
      },
    },
    take: 100000, // 2026-06-04: 上限実質撤廃
  });

  // 子商品コード一覧から標準時間（秒）を一括取得
  const childCodes = Array.from(
    new Set(items.flatMap((s) => s.children.map((c) => c.childCode))),
  );
  const auxList = childCodes.length
    ? await prisma.productAuxAttr.findMany({
        where: { productCode: { in: childCodes } },
        select: { productCode: true, stdSec: true },
      })
    : [];
  const stdSecMap = new Map(auxList.map((a) => [a.productCode, a.stdSec]));

  return NextResponse.json({
    data: {
      items: items.map((s) => ({
        id: s.id,
        parentCode: s.parentCode,
        parentName: s.parentName,
        type: s.type,
        fixedBoxCode: s.fixedBoxCode,
        fixedBoxName: s.fixedBox?.name ?? null,
        packingNote: s.packingNote,
        // セット標準時間（秒）＋種別＋出所（2026-06-22）
        stdSec: s.stdSec,
        setKind: s.setKind,
        stdSecSource: s.stdSecSource,
        note: s.note,
        childCount: s._count.children,
        // 子商品（構成商品）情報サマリ
        children: s.children.map((c) => ({
          id: c.id,
          childCode: c.childCode,
          childName: c.childName,
          qty: c.qty,
          stdSec: stdSecMap.get(c.childCode) ?? null,
        })),
        // 一覧表示用に「コードA×n / コードB×m」形式の文字列も予生成
        childrenSummary: s.children
          .map(
            (c) =>
              `${c.childCode}${c.qty > 1 ? `×${c.qty}` : ''}${c.childName ? `(${c.childName})` : ''}`,
          )
          .join(', '),
        // 標準時間合計（秒）
        totalStdSec: s.children.reduce(
          (sum, c) => sum + (stdSecMap.get(c.childCode) ?? 0) * c.qty,
          0,
        ),
        updatedAt: s.updatedAt.toISOString().slice(0, 10),
      })),
    },
    message: 'OK',
  });
}

export async function POST(req: Request) {
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
  try {
    const data = {
      ...parsed.data,
      // UI から標準時間を入れたら手動値として保護（取込で上書きさせない）
      stdSecSource: parsed.data.stdSec != null ? 'manual' : undefined,
    };
    const created = await prisma.setComp.create({ data });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return maskError(
      '[POST /api/master/set-comps]',
      e,
      'CONFLICT',
      409,
      '登録に失敗しました（ID 重複の可能性）',
    );
  }
}
