/**
 * レポート期間 検証ヘルパー（Sprint B-2 / H-5）
 *
 * 全レポート系 API で from / to クエリの形式・妥当性を統一検証。
 * 本来の DB クエリ前で 422 を返し、Invalid Date が Prisma に到達しないようにする。
 */

import { NextResponse } from 'next/server';
import { parseDateAsUTC, addDaysUTC } from './date-utils';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366; // 1 年強。それ以上はクエリ拒否

export interface PeriodRange {
  /**
   * JST ローカル日の開始（00:00:00.000）。
   * **`@db.Timestamptz` 列（createdAt 等）用**。
   */
  from: Date;
  /**
   * JST ローカル日の終了（23:59:59.999）。
   * **`@db.Timestamptz` 列（createdAt 等）用**。
   */
  to: Date;
  /**
   * UTC 真夜中の開始（含む）。**`@db.Date` 列（shipDate 等）用**。
   *
   * `@db.Date` は時刻を持たず UTC 真夜中で読み書きされるため、
   * JST 境界の from/to を流用すると暦日が 1 日ズレる
   * （from='2026-07-01' の JST 真夜中は 2026-06-30T15:00Z ＝ 前月末を巻き込む）。
   */
  fromDate: Date;
  /**
   * UTC 真夜中の終了（**含まない** = to の翌日）。**`@db.Date` 列用**。
   * `{ gte: fromDate, lt: toDateExclusive }` の形で使う。
   */
  toDateExclusive: Date;
}

/**
 * クエリの from/to を検証して PeriodRange を返す。
 * 不正なら error response を返す。
 *
 * 用法:
 *   const range = parsePeriodFromUrl(req);
 *   if ('error' in range) return range.error;
 *   const data = await summaryReport(range.from, range.to);
 */
export function parsePeriodFromUrl(
  req: Request,
):
  | PeriodRange
  | { error: ReturnType<typeof NextResponse.json> } {
  const { searchParams } = new URL(req.url);
  return parsePeriod(searchParams.get('from'), searchParams.get('to'));
}

export function parsePeriod(
  fromStr: string | null,
  toStr: string | null,
):
  | PeriodRange
  | { error: ReturnType<typeof NextResponse.json> } {
  if (!fromStr || !toStr) {
    return {
      error: NextResponse.json(
        { error: 'VALIDATION', message: 'from / to は必須です' },
        { status: 422 },
      ),
    };
  }
  if (!DATE_PATTERN.test(fromStr) || !DATE_PATTERN.test(toStr)) {
    return {
      error: NextResponse.json(
        { error: 'VALIDATION', message: '日付形式は YYYY-MM-DD' },
        { status: 422 },
      ),
    };
  }
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return {
      error: NextResponse.json(
        { error: 'VALIDATION', message: '不正な日付' },
        { status: 422 },
      ),
    };
  }
  if (from > to) {
    return {
      error: NextResponse.json(
        { error: 'VALIDATION', message: 'from は to 以前である必要があります' },
        { status: 422 },
      ),
    };
  }
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) {
    return {
      error: NextResponse.json(
        {
          error: 'VALIDATION',
          message: `期間が長すぎます（最大 ${MAX_RANGE_DAYS} 日）`,
        },
        { status: 422 },
      ),
    };
  }
  // @db.Date 用（UTC 真夜中の暦日境界）。setHours を通す前の文字列から作る。
  const fromDate = parseDateAsUTC(fromStr)!;
  const toDateExclusive = addDaysUTC(parseDateAsUTC(toStr)!, 1);

  // @db.Timestamptz 用（JST ローカル日の境界）。従来挙動を維持する。
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to, fromDate, toDateExclusive };
}
