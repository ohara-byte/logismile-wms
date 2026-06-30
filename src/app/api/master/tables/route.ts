/**
 * GET /api/master/tables
 *
 * 検品テーブルの選択肢を返す（標準時間マスタの「テーブル ID」select 用・2026-06-30）。
 *   ソース＝InspectionGroup.tables（各グループが持つテーブル文字の集合）。
 *   返却形式は master フォーム基盤の optionsEndpoint 仕様に合わせる：
 *     { data: { items: [{ code, name }] } }（value=code, label=name）
 *   同一テーブル文字が複数グループに出る場合は先勝ち（重複排除）。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const groups = await prisma.inspectionGroup.findMany({
    select: { id: true, name: true, tables: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });

  const seen = new Set<string>();
  const items: { code: string; name: string }[] = [];
  for (const g of groups) {
    for (const t of g.tables) {
      const code = (t ?? '').trim().toUpperCase();
      if (!code || seen.has(code)) continue;
      seen.add(code);
      items.push({ code, name: `${code}（${g.name}）` });
    }
  }
  // テーブル文字で昇順に整える
  items.sort((a, b) => a.code.localeCompare(b.code));

  return NextResponse.json({ data: { items }, message: 'OK' });
}
