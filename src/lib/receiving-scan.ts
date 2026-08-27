/**
 * ハンディ 受入検品のスキャン解決（純関数・DB非依存）
 *
 * 2026-08-27 新規（CraftSmile スマホ納品送信との連携）:
 *   CraftSmile がスマホから納品送信するとき、1商品1枚のラベル（62×29mm）を
 *   印刷する。そのラベルには QR が入っていて、**発送日・商品コード・数量・連番**を
 *   持っている。
 *
 *     CS1|20260828|5203-1|24|001
 *      │    │         │      │   └ ラベル連番（3桁ゼロ埋め・1以上）
 *      │    │         │      └ 納品数
 *      │    │         └ 商品コード
 *      │    └ 発送日 YYYYMMDD
 *      └ 書式の版。これで「CraftSmile のラベル」と判別する
 *
 *   ★ この書式は CraftSmile 側 `src/lib/wms/mobile-send.ts` の
 *     `buildLabelQr` / `parseLabelQr` と**同一でなければならない**。
 *     連携契約テスト（src/lib/__tests__/factory-contract.test.ts）で機械的に固定している。
 *     書式を変えるときは両リポジトリのテストを必ず更新すること。
 *
 * 効きどころ：
 *   QR は**数量まで持っている**ので、商品を特定するだけでなく
 *   検品数の初期値をラベルの数量で埋められる。
 *   B案（2026-08-26）で「検品済みなら空欄」にした部分が、QR なら
 *   「今回運ばれてきた分」で埋まるため、現場の入力がゼロになる。
 */

/** ラベルQR の書式版。CraftSmile 側 `LABEL_QR_VERSION` と一致させる。 */
export const FACTORY_LABEL_QR_VERSION = 'CS1';

/** ラベルQR の中身。 */
export interface FactoryLabel {
  /** 発送日 YYYY-MM-DD */
  shipDate: string;
  productCode: string;
  qty: number;
  /** ラベル連番（1以上）。同じラベルの二度読み検知に使う */
  serial: number;
}

/**
 * ラベルQR を分解する。CraftSmile のラベルでなければ null。
 *
 * null を返した場合、呼び出し側は**従来どおり JAN／商品コードとして扱う**。
 * 既存の運用（基幹の商品バーコード）を壊さないため、判定は接頭辞で厳密に行う。
 */
export function parseFactoryLabelQr(raw: string | null | undefined): FactoryLabel | null {
  const s = (raw ?? '').trim();
  if (!s.startsWith(FACTORY_LABEL_QR_VERSION + '|')) return null;
  const parts = s.split('|');
  if (parts.length !== 5) return null;
  const ymd = parts[1] ?? '';
  const code = (parts[2] ?? '').trim();
  if (!/^\d{8}$/.test(ymd)) return null;
  if (code === '') return null;
  const qty = Number(parts[3]);
  const serial = Number(parts[4]);
  if (!Number.isInteger(qty) || qty < 0) return null;
  if (!Number.isInteger(serial) || serial < 1) return null;
  return {
    shipDate: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
    productCode: code,
    qty,
    serial,
  };
}

/**
 * ラベル1枚を一意に識別するキー。**同じラベルの二度読み**を弾くために使う。
 * 発送日・商品・連番の3つで決まる（数量は含めない＝同内容の別ラベルと区別できる）。
 */
export function labelKey(label: FactoryLabel): string {
  return `${label.shipDate}|${label.productCode}|${label.serial}`;
}

/** 検品対象の最小形（画面の PickItem のうち照合に要る2列）。 */
export interface ScanTarget {
  productCode: string;
  jan: string | null;
}

export type ScanResolution<T extends ScanTarget> =
  /** CraftSmile ラベルを読んだ。数量まで分かる */
  | { kind: 'label'; item: T; label: FactoryLabel }
  /** CraftSmile ラベルだが、この納品に無い商品 */
  | { kind: 'label_not_in_list'; label: FactoryLabel }
  /** 従来のバーコード（JAN／商品コード）で商品が特定できた */
  | { kind: 'plain'; item: T }
  /** 特定できなかった */
  | { kind: 'unknown' };

/**
 * スキャン値から検品対象を解決する。
 *
 * 順序：
 *   ① CraftSmile ラベルQR（`CS1|…`）なら商品コードで照合し、数量も返す
 *   ② それ以外は従来どおり JAN → 商品コード の順で照合
 *
 * 商品コードの比較は前後空白を除いた大小無視。JAN は完全一致
 * （既存 `findByScan` の挙動をそのまま引き継ぐ）。
 */
export function resolveScan<T extends ScanTarget>(
  raw: string | null | undefined,
  items: readonly T[],
): ScanResolution<T> {
  const v = (raw ?? '').trim();
  if (v === '') return { kind: 'unknown' };

  const label = parseFactoryLabelQr(v);
  if (label) {
    const wanted = label.productCode.toLowerCase();
    const item = items.find((it) => it.productCode.trim().toLowerCase() === wanted);
    return item ? { kind: 'label', item, label } : { kind: 'label_not_in_list', label };
  }

  const lower = v.toLowerCase();
  const item =
    items.find((it) => it.jan && it.jan === v) ??
    items.find((it) => it.productCode.trim().toLowerCase() === lower);
  return item ? { kind: 'plain', item } : { kind: 'unknown' };
}

/**
 * ラベルを読んだときに検品数欄へ入れる初期値。
 *
 * ★ ラベルの数量をそのまま入れる。「追加」は加算なので、
 *   ラベル1枚＝今回運ばれてきた分を足す、が正しい。
 *   検品済みが既にあっても、そのラベル分を足すので問題ない
 *   （手入力時に空欄にしていたのは「今回分が分からない」からで、
 *     ラベルなら分かる）。
 *
 * @param current 編集中の入力（あれば尊重する）
 */
export function resolveQtyPrefillFromLabel(params: {
  current: string | null | undefined;
  label: FactoryLabel;
}): string {
  const { current, label } = params;
  if (current != null && current !== '') return current;
  return String(label.qty);
}
