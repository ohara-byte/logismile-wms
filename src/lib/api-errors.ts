/**
 * API エラーレスポンス共通ヘルパー（Sprint B-2 / T-6）
 *
 * Prisma の例外文字列をそのまま JSON ボディに混入すると、テーブル名や
 * FK 名・スタックトレースが漏洩する。`maskError()` で内部例外を
 * console.error にだけログし、レスポンスは固定文言にする。
 */

import { NextResponse } from 'next/server';

/**
 * Prisma 例外などをマスクして固定メッセージで返却。
 *
 * 例:
 *   } catch (e) {
 *     return maskError('[POST /api/master/staff]', e, 'CONFLICT', 409,
 *       '登録に失敗しました（コード重複の可能性）');
 *   }
 */
export function maskError(
  context: string,
  e: unknown,
  code: 'CONFLICT' | 'INTERNAL' | 'NOT_FOUND' | 'VALIDATION',
  status: 400 | 404 | 409 | 422 | 500,
  publicMessage: string,
) {
  // 内部ログには詳細を残す（FK 名や stack を確認可能）
  console.error(context, e);
  return NextResponse.json({ error: code, message: publicMessage }, { status });
}
