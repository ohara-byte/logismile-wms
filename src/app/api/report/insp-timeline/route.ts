/**
 * GET /api/report/insp-timeline?from=&to=&basis=ship|start&limit=
 *
 * 検品タイムラインの**画面プレビュー**（現場依頼・2026-09-17）。
 * CSV 本体は /api/report/insp-timeline/export（分割取得＋ストリーミング）。
 *
 * 件数が多い（1日 2,000〜3,000 件）ので、ここでは先頭 limit 件と総件数だけ返す。
 */

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/permissions';
import { parsePeriodFromUrl } from '@/lib/report-period';
import {
  TIMELINE_HEADERS,
  parseBasis,
  timelineRow,
} from '@/lib/insp-timeline';
import {
  countTimeline,
  fetchTimelinePage,
  loadAirpackKeyword,
  loadStaffNames,
} from '@/lib/insp-timeline-query';

const MAX_PREVIEW = 200;

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const range = parsePeriodFromUrl(req);
  if ('error' in range) return range.error;

  const { searchParams } = new URL(req.url);
  const basis = parseBasis(searchParams.get('basis'));
  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') ?? '100', 10) || 100, 1),
    MAX_PREVIEW,
  );

  const [total, sources, airpackKeyword, nameOf] = await Promise.all([
    countTimeline(range, basis),
    fetchTimelinePage(range, basis, limit, null),
    loadAirpackKeyword(),
    loadStaffNames(),
  ]);

  const rows = sources.map((s) => timelineRow(s, nameOf, airpackKeyword));

  return NextResponse.json({
    data: {
      headers: TIMELINE_HEADERS,
      rows,
      total,
      shown: rows.length,
      basis,
      /** 判定語が未設定だとエアパック欄は空になる（画面で注意喚起する） */
      airpackKeyword,
    },
    message: 'OK',
  });
}
