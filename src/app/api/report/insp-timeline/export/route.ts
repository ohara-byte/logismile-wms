/**
 * GET /api/report/insp-timeline/export?from=&to=&basis=ship|start
 *
 * 検品タイムライン CSV（現場依頼・2026-09-17）。
 *
 * ★ 依頼例の「2026年6月1日〜現在」は 20〜30 万行になりうる。
 *   一括で組み立てると Node のメモリを食い潰すため、
 *   **カーソルで 2,000 行ずつ取り出しながら書き出す**（ストリーミング）。
 *   ブラウザ側もダウンロードが先に始まるので、待ち時間が読める。
 */

import { requirePermission } from '@/lib/auth/permissions';
import { parsePeriodFromUrl } from '@/lib/report-period';
import {
  TIMELINE_HEADERS,
  csvLine,
  parseBasis,
  timelineFilename,
  timelineRow,
} from '@/lib/insp-timeline';
import {
  TIMELINE_PAGE_SIZE,
  fetchTimelinePage,
  loadAirpackKeyword,
  loadStaffNames,
} from '@/lib/insp-timeline-query';

export async function GET(req: Request) {
  // CSV 出力は lead にも許可（既存 /api/report/export と同じ権限）
  const guard = await requirePermission('csv_export');
  if (!guard.ok) return guard.response;

  const range = parsePeriodFromUrl(req);
  if ('error' in range) return range.error;

  const { searchParams } = new URL(req.url);
  const basis = parseBasis(searchParams.get('basis'));
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';

  const [airpackKeyword, nameOf] = await Promise.all([
    loadAirpackKeyword(),
    loadStaffNames(),
  ]);

  const encoder = new TextEncoder();
  let cursor: string | null = null;
  let done = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // UTF-8 BOM 付き（Excel が UTF-8 を認識する。既存 CSV と同じ作法）
      controller.enqueue(encoder.encode(`﻿${csvLine(TIMELINE_HEADERS)}\n`));
    },
    /**
     * 1回の pull で 1ページ（2,000 行）だけ流す。
     * ここでまとめて全ページ流すと結局すべてメモリに載るので、
     * 受け手が引いた分だけ取りにいく（バックプレッシャを効かせる）。
     */
    async pull(controller) {
      if (done) return;
      try {
        const page = await fetchTimelinePage(range, basis, TIMELINE_PAGE_SIZE, cursor);
        if (page.length > 0) {
          const body = page
            .map((s) => csvLine(timelineRow(s, nameOf, airpackKeyword)))
            .join('\n');
          controller.enqueue(encoder.encode(`${body}\n`));
          cursor = page[page.length - 1]!.pkNo;
        }
        if (page.length < TIMELINE_PAGE_SIZE) {
          done = true;
          controller.close();
        }
      } catch (e) {
        done = true;
        controller.error(e);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${timelineFilename(from, to, basis)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
