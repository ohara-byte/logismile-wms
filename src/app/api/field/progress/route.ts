/**
 * GET /api/field/progress
 *
 * 現場端末（タブレット・ハンディ）の進捗表示（要望書 2026-09-27 要望①②③）。
 *
 * 管理PC の `/api/dashboard/progress` とは別口にする：
 *  - 端末は数秒おきに引くので、終了予測・段階目標といった重い計算は載せない
 *  - 「自分のテーブル」「自分の件数・ペース」はログイン担当者ごとに変わる
 *
 * 認証は**社員番号ログイン**（タブレット／ハンディのセッション）。
 * 担当者・端末はセッションから取り、クエリでは受け取らない
 * （他人の件数を覗ける口にしない）。
 */

import { NextResponse } from 'next/server';
import { getEmployeeSession } from '@/lib/auth/employee-session';
import { getFieldProgress } from '@/lib/dashboard/field-progress';
import { todayJstAsUTC, parseDateAsUTC } from '@/lib/date-utils';
import { maskError } from '@/lib/api-errors';

export async function GET(req: Request) {
  const session = await getEmployeeSession();
  if (!session) {
    return NextResponse.json(
      { data: null, message: 'ログインが必要です', error: 'AUTH' },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(req.url);
  // 既定は当日。日付指定は確認用（現場の運用では使わない）
  const date = parseDateAsUTC(searchParams.get('date')) ?? todayJstAsUTC();

  try {
    const data = await getFieldProgress({
      date,
      staffCode: session.staffCode ?? null,
      deviceCode: session.deviceCode ?? null,
    });
    return NextResponse.json({ data, message: 'OK', error: null });
  } catch (e) {
    return maskError(
      '[GET /api/field/progress]',
      e,
      'INTERNAL',
      500,
      '進捗の取得に失敗しました',
    );
  }
}
