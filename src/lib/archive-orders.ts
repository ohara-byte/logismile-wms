/**
 * 年次アーカイブバッチ（Phase 6-11）
 *
 * 仕様（CLAUDE.md §5 ★ 伝票の修正・削除・復活 より）：
 *  - 削除済み伝票は 1 年保持
 *  - 1 年経過後、CSV にアーカイブ → 物理 DELETE
 *  - 関連する shipping_order_items / insp_sessions / insp_logs / print_logs / order_audit_logs も同時に消える
 *    （Prisma スキーマ上 onDelete: Cascade を持つ関係は自動。それ以外は手動）
 *
 * 実行モード:
 *  - dryRun = true (default): 削除候補一覧 + アーカイブ CSV だけ生成
 *  - dryRun = false: CSV 生成 + 物理 DELETE
 *
 * アーカイブ先:
 *  - ARCHIVE_DIR 環境変数（デフォルト ./data/archives）に
 *    `archive-orders-YYYY-MM-DD.csv` を出力
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './db';

export interface ArchiveResult {
  dryRun: boolean;
  cutoffDate: string; // 削除されてから 1 年経過した境界日（これ以前は対象）
  candidatesCount: number;
  archivedCsvPath: string | null;
  deletedOrderIds: string[];
}

export async function archiveOldDeletedOrders(
  options: { dryRun?: boolean; retentionDays?: number } = {},
): Promise<ArchiveResult> {
  const dryRun = options.dryRun ?? true;
  const retentionDays = options.retentionDays ?? 365;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const candidates = await prisma.shippingOrder.findMany({
    where: {
      deletedAt: { not: null, lte: cutoff },
    },
    select: {
      id: true,
      pkNo: true,
      shipDate: true,
      carrierCode: true,
      status: true,
      qrPrintFlag: true,
      noshiName: true,
      destZip: true,
      destAddr: true,
      destName: true,
      invoiceNo: true,
      deletedAt: true,
      deletedBy: true,
      deleteReason: true,
      createdAt: true,
      items: {
        select: { productCode: true, productName: true, qty: true, scannedQty: true, forceOk: true },
      },
    },
    orderBy: { deletedAt: 'asc' },
  });

  let archivedCsvPath: string | null = null;
  if (candidates.length > 0) {
    archivedCsvPath = await writeArchiveCsv(candidates);
  }

  const deletedIds: string[] = [];
  if (!dryRun && candidates.length > 0) {
    // Cascade で order_items / insp_sessions / print_logs / order_audit_logs も削除される
    // （schema.prisma の onDelete: Cascade を確認済）
    for (const c of candidates) {
      await prisma.shippingOrder.delete({ where: { id: c.id } });
      deletedIds.push(c.id);
    }
  }

  return {
    dryRun,
    cutoffDate: cutoff.toISOString().slice(0, 10),
    candidatesCount: candidates.length,
    archivedCsvPath,
    deletedOrderIds: deletedIds,
  };
}

type ArchiveCandidate = {
  id: string;
  pkNo: string;
  shipDate: Date;
  carrierCode: string;
  status: string;
  qrPrintFlag: boolean;
  noshiName: string | null;
  destZip: string | null;
  destAddr: string | null;
  destName: string | null;
  invoiceNo: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
  createdAt: Date;
  items: Array<{
    productCode: string;
    productName: string;
    qty: number;
    scannedQty: number;
    forceOk: boolean;
  }>;
};

async function writeArchiveCsv(rows: ArchiveCandidate[]): Promise<string> {
  const archiveDir = process.env.ARCHIVE_DIR ?? path.join(process.cwd(), 'data', 'archives');
  await fs.mkdir(archiveDir, { recursive: true });
  const filename = `archive-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  const filePath = path.join(archiveDir, filename);

  // CSV を flat 構造で出す（1 商品明細 = 1 行）
  const headers = [
    'pkNo',
    'shipDate',
    'carrierCode',
    'status',
    'qrPrintFlag',
    'noshiName',
    'destZip',
    'destAddr',
    'destName',
    'invoiceNo',
    'deletedAt',
    'deletedBy',
    'deleteReason',
    'createdAt',
    'productCode',
    'productName',
    'qty',
    'scannedQty',
    'forceOk',
  ];
  const escape = (v: unknown) => {
    if (v == null) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines: string[] = [headers.join(',')];
  for (const r of rows) {
    const baseValues = [
      r.pkNo,
      r.shipDate,
      r.carrierCode,
      r.status,
      r.qrPrintFlag,
      r.noshiName,
      r.destZip,
      r.destAddr,
      r.destName,
      r.invoiceNo,
      r.deletedAt,
      r.deletedBy,
      r.deleteReason,
      r.createdAt,
    ];
    if (r.items.length === 0) {
      lines.push([...baseValues, '', '', '', '', ''].map(escape).join(','));
    } else {
      for (const it of r.items) {
        lines.push(
          [...baseValues, it.productCode, it.productName, it.qty, it.scannedQty, it.forceOk]
            .map(escape)
            .join(','),
        );
      }
    }
  }

  // UTF-8 BOM 付きで Excel 互換
  await fs.writeFile(filePath, '﻿' + lines.join('\n'), 'utf8');
  return filePath;
}
