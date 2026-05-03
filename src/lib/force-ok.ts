/**
 * 強制OK 関連の共通ヘルパー
 *
 * 理由コード仕様（A-05）:
 *   R01 セット品時間制約 — 日常運用のため承認対象外
 *   R02 JAN/バーコード読取不可
 *   R03 商品差替（同等品で代替）
 *   R04 ピッキング票誤記
 *   R99 その他（要管理PC報告）
 */

export type ForceReasonCode = 'R01' | 'R02' | 'R03' | 'R04' | 'R99';

export const FORCE_REASON_LABELS: Record<ForceReasonCode, string> = {
  R01: 'セット品時間制約',
  R02: 'JAN/バーコード読取不可',
  R03: '商品差替',
  R04: 'ピッキング票誤記',
  R99: 'その他',
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
