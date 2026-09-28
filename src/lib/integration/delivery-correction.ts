/**
 * 工場納品の訂正（数量修正・取り戻し）の純ロジック。
 *
 * 背景（小原様ご依頼 2026-09-28）：
 *   > 納品済みの商品が後で数相違が発覚、もしくは戻して欲しい。
 *   > 納品済み修正ボタンを追加し、数量修正と取り戻しのを選択し、
 *   > 加算・減算を出来るようしたい。
 *
 * CraftSmile が送ってくる訂正を WMS の在庫へ反映する。
 * 元の納品（`POST /api/integration/factory/delivery`）は
 * `qty` が 1 以上の正の数しか受け取れず、減らす口が無かった。
 *
 * ★ 在庫は **0 未満にしない**（小原様確定 2026-09-28）。
 *   倉庫の実在庫がマイナスになることは有り得ないため、引ける分だけ引き、
 *   実際に適用できた数を応答で返す（黙って全部引いたことにしない）。
 *
 * ★ 引当済み（`Stock.allocatedQty`）は**見ない**。
 *   2026-07-01 に「引当済みを下回る在庫変更を拒否する」ガードが
 *   業務停止の原因として撤去済み（前日引当の運用では予約>現物が正常）。
 *   差分は必ず `StockMovement` に残るため追跡できる。
 *
 * DB へは触らない純関数だけを置く（テスト可能にするため）。
 */

/** 訂正の区分。応答・ログの表示にだけ使い、計算は変えない。 */
export type CorrectionReason = 'qty_fix' | 'return'

export const CORRECTION_REASON_LABEL: Record<CorrectionReason, string> = {
  qty_fix: '数量修正',
  return: '取り戻し',
}

export function parseCorrectionReason(v: string): CorrectionReason {
  return v === 'return' ? 'return' : 'qty_fix'
}

export type AppliedDelta = {
  /** 実際に在庫へ反映する増減（0 未満に落ちないよう詰めた後） */
  applied: number
  /** 要求のうち反映できなかった数（>0 なら在庫が足りず引ききれなかった） */
  shortfall: number
};

/**
 * 在庫を 0 未満にしないよう詰めた増減を返す。
 *
 *  - 加算（qtyDelta > 0）はそのまま通す
 *  - 減算（qtyDelta < 0）は現在庫までしか引かない
 *
 * @param currentQty  いまの在庫数（負の在庫が混じっていても 0 として扱う）
 * @param qtyDelta    要求された増減（＋は加算・−は減算）
 */
export function applicableDelta(currentQty: number, qtyDelta: number): AppliedDelta {
  const delta = Math.trunc(qtyDelta);
  if (delta >= 0) return { applied: delta, shortfall: 0 };

  const have = Math.max(0, Math.trunc(currentQty));
  const want = -delta; // 引きたい数（正）
  const take = Math.min(have, want);
  // take が 0 のとき `-take` は -0 になる。JSON にも比較にも -0 を漏らさない。
  return { applied: take === 0 ? 0 : -take, shortfall: want - take };
}

/**
 * 訂正を在庫増減ログに残すときの表示文。
 * 「いつ・どの納品を・なぜ・いくつ」直したかが1行で分かるようにする。
 */
export function correctionNote(params: {
  correctionNo: string;
  originalDeliveryNo: string;
  reason: CorrectionReason;
  requestedDelta: number;
  appliedDelta: number;
  note?: string | null;
}): string {
  const head =
    `工場納品訂正 ${params.correctionNo}` +
    `（元 ${params.originalDeliveryNo} / ${CORRECTION_REASON_LABEL[params.reason]}）`;
  const amount =
    params.requestedDelta === params.appliedDelta
      ? `${signed(params.appliedDelta)}`
      : `${signed(params.appliedDelta)}（要求 ${signed(params.requestedDelta)}・在庫不足で一部のみ）`;
  const tail = params.note?.trim() ? ` ${params.note.trim()}` : '';
  return `${head} ${amount}${tail}`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** 在庫増減ログの種別。工場納品(inbound)と区別できるようにする。 */
export const CORRECTION_MOVEMENT_TYPE = 'factory_correction';

/** 在庫増減ログの参照種別。 */
export const CORRECTION_REF_TYPE = 'factory_delivery_correction';
