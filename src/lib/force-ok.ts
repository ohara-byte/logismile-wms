/**
 * 強制OK 関連の共通ヘルパー
 *
 * 理由コード仕様（タブレット検品モック_v0.18.html L1280-1283 準拠）:
 *   R01 セット品 時間制約 — 日常運用のため承認対象外（A-05）
 *   R02 商品不具合による差替
 *   R03 システム不具合
 *   R04 その他（コメント必須）
 *   R99 その他（旧データ互換用・管理PC側のみ）
 */

export type ForceReasonCode = 'R01' | 'R02' | 'R03' | 'R04' | 'R99';

export const FORCE_REASON_LABELS: Record<ForceReasonCode, string> = {
  R01: 'セット品 時間制約',
  R02: '商品不具合による差替',
  R03: 'システム不具合',
  R04: 'その他',
  R99: 'その他',
};

/** R04 はコメント必須（モック仕様）。R01-R03 は固定理由でコメント不要 */
export const REASON_REQUIRE_COMMENT: Record<ForceReasonCode, boolean> = {
  R01: false,
  R02: false,
  R03: false,
  R04: true,
  R99: false,
};

/** R01 は承認対象外（日常運用） */
export const EXCLUDED_REASON_CODES: ForceReasonCode[] = ['R01'];

/**
 * 自由記入の理由テキストから R コードを抽出する。
 * 例: "R02 JAN読取不可" → "R02"
 *     "在庫切れ"        → null
 */
export function parseReasonCode(reason: string | null | undefined): ForceReasonCode | null {
  if (!reason) return null;
  const m = reason.trim().match(/^R(0[1-4]|99)/);
  if (!m) return null;
  return `R${m[1]}` as ForceReasonCode;
}

/** UI バッジ用の色種別（モック準拠 .reason.r0X の色階調） */
export function reasonBadgeClass(code: ForceReasonCode | null): string {
  switch (code) {
    case 'R01':
      return 'bg-orange-900 text-orange-200';
    case 'R02':
      return 'bg-red-900 text-red-200';
    case 'R03':
      return 'bg-blue-900 text-blue-200';
    case 'R04':
      return 'bg-purple-900 text-purple-200';
    case 'R99':
      return 'bg-slate-700 text-slate-100';
    default:
      return 'bg-slate-700 text-slate-300';
  }
}
