/**
 * 日付ユーティリティ（タイムゾーン対応）
 *
 * 2026-05-20 追加：
 *   `new Date("2026-05-20")` は **UTC 真夜中** として解釈される（JST 9:00）。
 *   そこから `setHours(0,0,0,0)` を呼ぶと **JST 真夜中（= 前日 15:00 UTC）** に
 *   移動してしまい、Prisma の `@db.Date` カラムと比較すると 1 日ずれて
 *   ヒットしないバグが発生していた（メンバー割当・シフトに影響）。
 *
 *   PostgreSQL の `DATE` 型は時刻情報を持たず、Prisma 経由で読み書きする際に
 *   **UTC 真夜中** の JS Date として扱われる。よってクエリ側も
 *   **UTC 真夜中の Date** を作ってマッチさせる必要がある。
 *
 *   本ヘルパーは "YYYY-MM-DD" 形式の文字列を **UTC 真夜中** の Date に変換する。
 */

/**
 * "YYYY-MM-DD" 文字列を UTC 真夜中の Date に変換する。
 *
 * - "2026-05-20" → Date "2026-05-20T00:00:00.000Z"
 * - Prisma の `@db.Date` カラムと等値比較できる。
 *
 * 不正な日付（不正フォーマットや実在しない日付）の場合は null を返す。
 */
export function parseDateAsUTC(input: string | null | undefined): Date | null {
  if (!input) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // 月は 0-based / 簡易バリデーション
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const utc = new Date(Date.UTC(y, mo - 1, d));
  // 入力された日と一致しない場合（例: 2 月 30 日）は不正
  if (
    utc.getUTCFullYear() !== y ||
    utc.getUTCMonth() !== mo - 1 ||
    utc.getUTCDate() !== d
  ) {
    return null;
  }
  return utc;
}

/**
 * 現在日（JST タイムゾーン基準）を UTC 真夜中の Date として返す。
 *
 * - 例: JST で 2026-05-20 8:00 のとき → Date "2026-05-20T00:00:00.000Z"
 * - サーバの実 TZ に関係なく、業務日（JST 暦）を取得できる。
 */
export function todayJstAsUTC(): Date {
  const now = new Date();
  // JST = UTC+9
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()),
  );
}

/**
 * UTC 真夜中の Date を "YYYY-MM-DD" 文字列にフォーマットする。
 */
export function formatDateYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * UTC 真夜中の Date を JST 表記の "YYYY/MM/DD(曜)" にフォーマット（管理画面用）。
 */
export function formatDateJa(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${y}/${m}/${day}(${wd})`;
}

/**
 * UTC 真夜中の Date を N 日進めて新しい UTC 真夜中 Date を返す。
 */
export function addDaysUTC(d: Date, days: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days),
  );
}
