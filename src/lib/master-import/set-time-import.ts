/**
 * セット梱包標準時間取込（2026-06-22）。梱包標準時間_セット.xlsx → SetComp.stdSec/setKind。
 *
 * sheet1（見出し3行目）：col0=品番 col1=商品名称 col2=種別 col3=標準時間(分:秒)。
 * 品番＝SetComp.parentCode（id=`BOM-<品番>`）。BOM 取込済みの親にのみ反映。
 * 種別：牧場セット→bokujo / 頒布会→hanpukai / その他→null。
 * stdSecSource='manual'（UI手入力）の親は保護（上書きしない）。
 */

import { prisma } from '@/lib/db';
import { readXlsxSheet } from './xlsx-lite';
import type { ImportReport } from './report';

/** "2:30"（分:秒）または時刻シリアル（0〜1の小数）→ 秒 */
function parseDurationSec(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const mmss = s.match(/^(\d+):(\d{1,2})$/);
  if (mmss) return parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10);
  const num = Number(s);
  if (Number.isFinite(num)) {
    // Excel 時刻シリアル（1日=1.0）の可能性
    if (num > 0 && num < 1) return Math.round(num * 86400);
    return Math.round(num); // 秒そのものとみなす
  }
  return null;
}

function mapKind(raw: string): string | null {
  const s = raw.trim();
  if (s.includes('牧場')) return 'bokujo';
  if (s.includes('頒布')) return 'hanpukai';
  return null;
}

export async function importSetTimes(buf: Buffer, filename: string): Promise<ImportReport> {
  const sheet = readXlsxSheet(buf, 1);
  const report: ImportReport = {
    fileType: 'set_time',
    filename,
    totalRows: 0,
    imported: 0,
    skipped: 0,
    unmatched: 0,
    warnings: [],
    unmatchedRows: [],
  };

  // BOM 取込済みの親（parentCode → {id, source}）
  const setComps = await prisma.setComp.findMany({
    where: { id: { startsWith: 'BOM-' } },
    select: { id: true, parentCode: true, stdSecSource: true },
  });
  const byParent = new Map(setComps.map((s) => [s.parentCode, s]));

  // 見出し3行目 → データは index 3 以降
  for (let i = 3; i < sheet.length; i++) {
    const r = sheet[i];
    const hinban = (r[0] ?? '').trim();
    const name = (r[1] ?? '').trim();
    const kindRaw = (r[2] ?? '').trim();
    const durRaw = (r[3] ?? '').trim();
    if (!hinban || hinban.includes('品番なし')) {
      report.skipped++;
      continue;
    }
    report.totalRows++;
    const sec = parseDurationSec(durRaw);
    if (sec == null) {
      report.unmatched++;
      report.unmatchedRows.push({ 品番: hinban, 商品名称: name, 標準時間: durRaw, 理由: '時間解析不可' });
      continue;
    }
    const target = byParent.get(hinban);
    if (!target) {
      report.unmatched++;
      report.unmatchedRows.push({ 品番: hinban, 商品名称: name, 標準時間: durRaw, 理由: 'BOM未登録の親(箱なし等)' });
      continue;
    }
    if (target.stdSecSource === 'manual') {
      report.skipped++;
      report.warnings.push(`手動値を保護: 品番${hinban}`);
      continue;
    }
    await prisma.setComp.update({
      where: { id: target.id },
      data: { stdSec: sec, setKind: mapKind(kindRaw), stdSecSource: 'imported' },
    });
    report.imported++;
  }
  return report;
}
