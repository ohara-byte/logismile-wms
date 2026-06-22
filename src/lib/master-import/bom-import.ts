/**
 * Thomas BOM 取込（2026-06-22）。構成商品.csv → SetComp + SetCompChild。
 *
 * 列：col0=親Code col1=親品名 col2=子Code col3=子品名 col4=構成数量（見出し1行目）。
 * Shift-JIS（iconv-lite 必須）。
 *
 * 規則（小原様確定2026-06-22）：固定箱は構成（子Code）に田舎主義コードとして混入している。
 *  - 子Code を Box.thomasCode と突合 → 一致あれば その親を「登録対象」とし fixedBoxCode に設定。
 *  - その箱の子は SetCompChild から除外（梱包材であり検品対象でない）。
 *  - 箱一致が無い親は登録不要（スキップ）。検証実績：登録対象=606親・箱1個ずつ。
 * stdSec/setKind は別取込（set-time）が設定するため、ここでは触らない（保護）。
 */

import { prisma } from '@/lib/db';
import { readCsvRows } from './read-csv';
import type { ImportReport } from './report';

interface Child {
  code: string;
  name: string;
  qty: number;
}

export async function importBom(buf: Buffer, filename: string): Promise<ImportReport> {
  const rows = readCsvRows(buf);
  const report: ImportReport = {
    fileType: 'bom',
    filename,
    totalRows: 0,
    imported: 0,
    skipped: 0,
    unmatched: 0,
    warnings: [],
    unmatchedRows: [],
  };

  // 箱の田舎主義コード → WMS箱コード
  const boxes = await prisma.box.findMany({
    where: { thomasCode: { not: null } },
    select: { code: true, thomasCode: true },
  });
  if (boxes.length === 0) {
    report.warnings.push('箱マスタ（thomasCode付き）が未登録です。先に箱マスタを取り込んでください。');
    return report;
  }
  const boxByThomas = new Map(boxes.map((b) => [b.thomasCode as string, b.code]));

  // 親Code ごとに集約（見出し1行目 → データは index 1 以降）
  const parents = new Map<string, { name: string; children: Child[] }>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const p = (r[0] ?? '').trim();
    const cc = (r[2] ?? '').trim();
    if (!p || !cc) continue;
    const qty = parseInt((r[4] ?? '').trim(), 10);
    if (!parents.has(p)) parents.set(p, { name: (r[1] ?? '').trim(), children: [] });
    parents.get(p)!.children.push({
      code: cc,
      name: (r[3] ?? '').trim(),
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
    });
  }

  // 既存 Product コード（子が製品マスタにあるか参考表示用）
  const productCodes = new Set(
    (await prisma.product.findMany({ select: { code: true } })).map((p) => p.code),
  );

  for (const [parentCode, o] of parents) {
    const boxChildren = o.children.filter((c) => boxByThomas.has(c.code));
    if (boxChildren.length === 0) continue; // 箱なし → 登録不要
    report.totalRows++;
    if (boxChildren.length > 1) {
      report.warnings.push(`箱が複数: 親${parentCode} ${o.name}（先頭を採用）`);
    }
    const fixedBoxCode = boxByThomas.get(boxChildren[0].code)!;
    const realChildren = o.children.filter((c) => !boxByThomas.has(c.code));

    // products 未登録の子を参考記録
    for (const c of realChildren) {
      if (!productCodes.has(c.code)) {
        report.unmatchedRows.push({
          親Code: parentCode,
          親品名: o.name,
          子Code: c.code,
          子品名: c.name,
          理由: 'Product未登録(構成は登録済)',
        });
      }
    }

    const id = `BOM-${parentCode}`;
    await prisma.$transaction([
      prisma.setComp.upsert({
        where: { id },
        create: { id, parentCode, parentName: o.name, type: 'set', fixedBoxCode },
        update: { parentName: o.name, type: 'set', fixedBoxCode },
      }),
      prisma.setCompChild.deleteMany({ where: { setCompId: id } }),
      prisma.setCompChild.createMany({
        data: realChildren.map((c, idx) => ({
          setCompId: id,
          childCode: c.code,
          childName: c.name || null,
          qty: c.qty,
          sortOrder: idx,
        })),
      }),
    ]);
    report.imported++;
  }
  report.unmatched = report.unmatchedRows.length;
  return report;
}
