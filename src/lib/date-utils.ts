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

/** JST は UTC+9（日本は夏時間が無いため固定オフセットでよい）。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * インスタント（`@db.Timestamptz` 由来の Date）を **JST の暦日** "YYYY-MM-DD" にする。
 *
 * 2026-08-07：レポートの日別集計が `completedAt.toISOString().slice(0,10)` で
 * バケットキーを作っており、これは **UTC の暦日**だった。JST 00:00〜08:59 に完了した
 * 検品セッションが前日に振り分けられ、日別グラフ・MH が1日ずれていた。
 * 一方 `shipDate` は `@db.Date`（UTC 真夜中）なので toISOString でも正しく、
 * 同じ集計の中で2種類のキーが混在していた。
 *
 * サーバのタイムゾーン設定に依存しないよう UTC 演算だけで求める。
 */
export function jstYmd(d: Date): string {
  return formatDateYmd(new Date(d.getTime() + JST_OFFSET_MS));
}

/**
 * 暦日（UTC 真夜中の Date）→ その日の **JST 00:00:00.000** の瞬間。
 * `@db.Timestamptz` 列（createdAt / completedAt 等）の範囲指定に使う。
 *
 * ★ サーバのタイムゾーン設定に依存しない（+9時間を明示）。
 *   `setHours(0,0,0,0)` はローカル演算のため、コンテナが UTC で動いていると
 *   9時間ずれた範囲になる（CraftSmile ADR-042 の同種障害）。
 */
export function jstDayStart(dateUtcMidnight: Date): Date {
  return new Date(dateUtcMidnight.getTime() - JST_OFFSET_MS);
}

/**
 * 暦日（UTC 真夜中の Date）→ その日の **JST 23:59:59.999** の瞬間。
 * `@db.Timestamptz` 列の範囲終端に使う。
 */
export function jstDayEnd(dateUtcMidnight: Date): Date {
  return new Date(dateUtcMidnight.getTime() + 86_400_000 - JST_OFFSET_MS - 1);
}

/**
 * 以下は「瞬間（`@db.Timestamptz` 由来の Date）を **JST の時刻として読む**」ための
 * ヘルパー群。`getHours()` 等のローカル getter は実行環境の TZ 設定で結果が変わり、
 * コンテナの TZ が効いていないと**9時間ずれる**（ヒートマップの時間帯・進捗の現在時刻・
 * 終了予定時刻が全部ずれる）。設定に依存させず +9時間を明示して読む。
 */
function jstView(d: Date): Date {
  return new Date(d.getTime() + JST_OFFSET_MS);
}

/** 瞬間 → JST の「時」(0-23)。 */
export function jstHour(d: Date): number {
  return jstView(d).getUTCHours();
}

/** 瞬間 → JST の「分」(0-59)。 */
export function jstMinute(d: Date): number {
  return jstView(d).getUTCMinutes();
}

/** 瞬間 → JST の曜日（0=日曜）。 */
export function jstWeekday(d: Date): number {
  return jstView(d).getUTCDay();
}

/** 瞬間 → JST の "HH:MM"。 */
export function jstHm(d: Date): string {
  const v = jstView(d);
  return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * 瞬間 → JST の "M/D HH:MM"（一覧の時刻表示用）。
 * `pad: true` で "MM/DD HH:MM"（0 埋め）。
 */
export function jstMdHm(d: Date, opts?: { pad?: boolean }): string {
  const v = jstView(d);
  const mo = v.getUTCMonth() + 1;
  const day = v.getUTCDate();
  return opts?.pad
    ? `${String(mo).padStart(2, '0')}/${String(day).padStart(2, '0')} ${jstHm(d)}`
    : `${mo}/${day} ${jstHm(d)}`;
}

/**
 * UTC 真夜中の Date を N 日進めて新しい UTC 真夜中 Date を返す。
 */
export function addDaysUTC(d: Date, days: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days),
  );
}

/**
 * 時刻文字列を正準 "HH:MM"（0 埋め）に正規化する。
 *
 * シフトパターン/過去データ由来の表記ゆれ（コロン無し "1700"、単桁 "8:0" 等）を
 * 吸収し、常に "HH:MM" を返す。正規化できない/範囲外の値は "" を返す。
 *
 *  - "17:00" → "17:00"
 *  - "8:0"   → "08:00"
 *  - "1700"  → "17:00"  （コロン無し HHMM）
 *  - "930"   → "09:30"  （コロン無し HMM）
 *  - null / "" / "abc" / "25:00" → ""（呼び出し側で不備として扱う）
 */
export function normalizeHHMM(input: string | null | undefined): string {
  const s = (input ?? '').trim();
  let h: string | undefined;
  let m: string | undefined;
  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (colon) {
    h = colon[1];
    m = colon[2];
  } else {
    // コロン無し（"1700" / "930"）: 末尾2桁を分、先頭を時とみなす
    const compact = /^(\d{1,2})(\d{2})$/.exec(s);
    if (compact) {
      h = compact[1];
      m = compact[2];
    }
  }
  if (h == null || m == null) return '';
  const hh = h.padStart(2, '0');
  const mm = m.padStart(2, '0');
  if (Number(hh) > 23 || Number(mm) > 59) return '';
  return `${hh}:${mm}`;
}
