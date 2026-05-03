/**
 * GET /api/report/export?type=summary|staff-mh|group-mh|product-abc&from=&to=&format=csv
 *
 * CSV のみ対応（PDF は Phase 6 で）。
 */

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/permissions';
import {
  summaryReport,
  staffMhReport,
  groupMhReport,
  productAbcReport,
} from '@/lib/reports';
import { parsePeriod } from '@/lib/report-period';

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = headers.join(',');
  const body = rows.map((r) => headers.map((h) => escape(r[h])).join(',')).join('\n');
  return `﻿${head}\n${body}`; // UTF-8 BOM 付き（Excel が UTF-8 を認識）
}

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const format = searchParams.get('format') ?? 'csv';
  if (!type) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'type は必須' },
      { status: 422 },
    );
  }
  if (format !== 'csv') {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'format=csv のみ対応（PDF は Phase 6）' },
      { status: 422 },
    );
  }

  const range = parsePeriod(searchParams.get('from'), searchParams.get('to'));
  if ('error' in range) return range.error;
  const { from, to } = range;

  let rows: Array<Record<string, unknown>> = [];
  const filename = `report-${type}-${searchParams.get('from')}-${searchParams.get('to')}.csv`;

  if (type === 'summary') {
    const r = await summaryReport(from, to);
    rows = [r as unknown as Record<string, unknown>];
  } else if (type === 'staff-mh') {
    rows = (await staffMhReport(from, to)) as unknown as Record<string, unknown>[];
  } else if (type === 'group-mh') {
    const items = await groupMhReport(from, to);
    rows = items.flatMap((g) =>
      g.hourly.map((h) => ({
        groupId: g.groupId,
        groupName: g.groupName,
        hour: h.hour,
        count: h.count,
        mhHours: h.mhHours,
      })),
    );
  } else if (type === 'product-abc') {
    rows = (await productAbcReport(from, to, 1000)) as unknown as Record<
      string,
      unknown
    >[];
  } else {
    return NextResponse.json(
      { error: 'VALIDATION', message: `不正な type: ${type}` },
      { status: 422 },
    );
  }

  const csv = toCsv(rows);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
