/**
 * 検品タイムライン CSV（現場からの依頼・2026-09-17）。
 *
 * > 検品タイムライン（検品着手／検品完了のイベント）を、以下の項目で CSV 出力できる
 * > 機能を追加してください。……全ステータスを出力対象とする（保留・キャンセルも含める）。
 * > 出力する期間を自由に指定し、一括で抽出できるようにしてください。
 *
 * 1伝票 = 1行。検品セッションは伝票に1件（`InspSession.orderId` が @unique）なので、
 * 着手／完了はその伝票の1組で決まる。**未検品の伝票も行として出す**
 * （着手・完了は空欄）。絞り込みは受領後に現場側で行う方針のため、
 * こちらでステータスを間引かない。
 *
 * ★ 「キャンセル」は本システムでは**論理削除**（deleted_at）で表す。
 *   削除済み伝票も対象に含め、ステータス欄で区別できるようにする。
 *
 * 本ファイルには **純ロジック**（行の組み立て・ラベル・CSV 整形）だけを置く。
 * DB 取得は API 側で行い、大量件数（1日 2,000〜3,000 件 × 数か月）に備えて
 * 分割取得＋ストリーミングで書き出す。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 期間の絞り込み基準。画面のプルダウンで切り替える（小原様 2026-09-17）。 */
export type TimelineBasis = 'ship' | 'start';

export const TIMELINE_BASIS_LABEL: Record<TimelineBasis, string> = {
  ship: '出荷日',
  start: '検品着手日',
};

export function parseBasis(input: string | null | undefined): TimelineBasis {
  return input === 'start' ? 'start' : 'ship';
}

/**
 * 伝票ステータスの表示名。
 * 値は docs/DB設計書.md（pending/inspecting/packed/shipped/held）に準拠。
 * 削除済みは status ではなく deletedAt で表すため、呼び出し側で 'deleted' を渡す。
 */
export const STATUS_LABEL: Record<string, string> = {
  pending: '未着手',
  inspecting: '検品中',
  packed: '梱包完了',
  shipped: '出荷済',
  held: '保留',
  deleted: '削除済（キャンセル）',
};

export function statusLabel(status: string, deletedAt: Date | null): string {
  if (deletedAt) return STATUS_LABEL.deleted;
  return STATUS_LABEL[status] ?? status;
}

/** インスタント → JST の "YYYY-MM-DD HH:MM:SS"（サーバTZに依存しない）。 */
export function jstDateTime(d: Date | null | undefined): string {
  if (!d) return '';
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

/** `@db.Date`（UTC 真夜中）→ "YYYY-MM-DD"。 */
export function ymd(d: Date | null | undefined): string {
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

/**
 * エアパックの判定。
 *
 * 本システムは熨斗名称（基幹CSVのO列）に**判定語**が含まれるかでエアパックを見て
 * いる（`pack.airpack_keyword` / `src/lib/dashboard/order-pack-time.ts` と同じ規則）。
 * 専用の列は基幹から来ないため、ここでも同じ規則に揃える。
 *
 * 判定語が未設定のときは **判定できない**ので null を返す（「無」ではない）。
 * 依頼の「該当データが存在する場合のみ出力してほしい」に合わせ、
 * 呼び出し側は null を空欄にする。
 */
export function airPackUsed(
  noshiName: string | null | undefined,
  keyword: string,
): boolean | null {
  const kw = keyword.trim();
  if (kw === '') return null;
  return (noshiName ?? '').includes(kw);
}

/**
 * のし有無。
 * エアパック語だけの熨斗名称は「のし」ではない（梱包時間の加算規則と同じ扱い）。
 */
export function noshiUsed(noshiName: string | null | undefined, keyword: string): boolean {
  const noshi = (noshiName ?? '').trim();
  if (noshi === '') return false;
  const kw = keyword.trim();
  if (kw !== '' && noshi.includes(kw)) {
    return noshi.split(kw).join('').trim() !== '';
  }
  return true;
}

/** CSV 1行ぶんの素材（DB から取った生の形）。 */
export interface TimelineSource {
  shipDate: Date;
  pkNo: string;
  status: string;
  deletedAt: Date | null;
  noshiName: string | null;
  noshiPerson: string | null;
  itemCount: number;
  session: {
    staffCode: string;
    startedAt: Date;
    completedAt: Date | null;
  } | null;
}

/** CSV の列見出し（依頼の【出力項目】の順）。 */
export const TIMELINE_HEADERS = [
  '出荷日',
  '伝票No',
  '担当者コード',
  '担当者氏名',
  '着手時刻',
  '完了時刻',
  '商品点数',
  'ステータス',
  'のし有無',
  'のし名称',
  'のし氏名',
  'エアパック',
] as const;

/** 1伝票 → CSV の1行（文字列配列）。 */
export function timelineRow(
  src: TimelineSource,
  staffNameOf: (code: string) => string,
  airpackKeyword: string,
): string[] {
  const air = airPackUsed(src.noshiName, airpackKeyword);
  return [
    ymd(src.shipDate),
    src.pkNo,
    src.session?.staffCode ?? '',
    src.session ? staffNameOf(src.session.staffCode) : '',
    jstDateTime(src.session?.startedAt),
    jstDateTime(src.session?.completedAt),
    String(src.itemCount),
    statusLabel(src.status, src.deletedAt),
    noshiUsed(src.noshiName, airpackKeyword) ? '有' : '',
    src.noshiName ?? '',
    src.noshiPerson ?? '',
    air === null ? '' : air ? '有' : '',
  ];
}

/** CSV の1セルをエスケープする。 */
export function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function csvLine(cells: readonly string[]): string {
  return cells.map(csvCell).join(',');
}

/** ダウンロードファイル名。 */
export function timelineFilename(from: string, to: string, basis: TimelineBasis): string {
  return `insp-timeline-${basis}-${from}-${to}.csv`;
}
