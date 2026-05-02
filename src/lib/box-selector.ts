/**
 * 箱選定ロジック（Phase 6-5, 6-7 完成版）
 *
 * 設計（CLAUDE.md §5 + 設計メモ v2.1 §8 ）：
 *  - 親商品 ↔ 構成商品 ↔ 固定箱 のマッピングが set_comps にある場合は最優先
 *  - 単品の場合は **容積計算** で可変箱を選定
 *  - 複数明細の場合は外寸/内寸の合計と内寸容積を比較
 *  - 冷凍商品が含まれる場合は冷凍対応箱（box.frozen=true）に絞る
 *  - 箱マスタ box.priority（小さい程優先）も尊重
 *
 * 入力:
 *  - shippingOrderItems（productCode + qty）
 *  - 商品の外寸（product_aux_attrs.{w_mm, d_mm, h_mm}）から容積を集計
 *
 * アルゴリズム:
 *  Step 1. 子コード集合から set_comps を逆引き → 完全一致なら fixed_box を最優先
 *  Step 2. それ以外は商品の総容積を求め、内寸容積が必要量の 1.2 倍以上ある最小の箱を選ぶ
 *  Step 3. 冷凍 / のし要件があれば該当フラグの箱に絞る
 *
 * フォールバック:
 *  - 外寸 0 の商品が含まれていたら容積計算は精度が出ないので「個数→sizeRank」推定にフォールバック
 *
 * 戻り値:
 *  - recommended（一番おすすめ）+ candidates（選定対象の全候補）
 *  - reasoning（選定理由を構造化）
 */

import { prisma } from './db';

export interface BoxCandidate {
  code: string;
  name: string;
  type: string;
  sizeRank: number;
  frozen: boolean;
  noshi: boolean;
  innerVolumeMm3: number;
}

export interface BoxSelectionReasoning {
  totalQty: number;
  hasFrozen: boolean;
  hasNoshi: boolean;
  /** 商品の合計容積（mm^3）。0 なら容積データが不足。 */
  totalProductVolumeMm3: number;
  /** 必要な内寸容積（mm^3）= 商品合計 × ゆとり係数 1.2 */
  requiredInnerMm3: number;
  /** どの判定経路で recommended を選んだか */
  strategy: 'fixed-set' | 'volume' | 'size-rank-fallback';
  /** 親商品が見つかった場合 */
  setCompMatch?: { id: string; parentCode: string; parentName: string; exact: boolean };
  notes?: string[];
}

export interface BoxSelectionResult {
  recommended: BoxCandidate | null;
  candidates: BoxCandidate[];
  reasoning: BoxSelectionReasoning;
}

const VOLUME_HEADROOM = 1.2;

export async function selectBoxForOrder(pkNo: string): Promise<BoxSelectionResult> {
  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo, deletedAt: null },
    select: {
      noshiName: true,
      items: {
        select: {
          qty: true,
          productCode: true,
          product: {
            select: {
              frozen: true,
              auxAttr: { select: { wMm: true, dMm: true, hMm: true } },
            },
          },
        },
      },
    },
  });
  if (!order) {
    throw new Error(`ピッキング№が見つかりません: ${pkNo}`);
  }

  const totalQty = order.items.reduce((s, i) => s + i.qty, 0);
  const hasFrozen = order.items.some((i) => i.product.frozen);
  const hasNoshi = !!order.noshiName;

  // 商品合計容積（mm^3）
  let totalProductVolumeMm3 = 0;
  let missingVolumeData = false;
  for (const it of order.items) {
    const aux = it.product.auxAttr;
    if (!aux || aux.wMm <= 0 || aux.dMm <= 0 || aux.hMm <= 0) {
      missingVolumeData = true;
      break;
    }
    totalProductVolumeMm3 += aux.wMm * aux.dMm * aux.hMm * it.qty;
  }
  const requiredInnerMm3 = Math.ceil(totalProductVolumeMm3 * VOLUME_HEADROOM);

  // 全候補箱を取得
  const allBoxes = await prisma.box.findMany({
    where: {
      ...(hasFrozen ? { frozen: true } : {}),
    },
    orderBy: [{ priority: 'asc' }, { sizeRank: 'asc' }],
    select: {
      code: true,
      name: true,
      type: true,
      sizeRank: true,
      innerWMm: true,
      innerDMm: true,
      innerHMm: true,
      frozen: true,
      noshi: true,
    },
  });

  const candidates: BoxCandidate[] = allBoxes.map((b) => ({
    code: b.code,
    name: b.name,
    type: b.type,
    sizeRank: b.sizeRank,
    frozen: b.frozen,
    noshi: b.noshi,
    innerVolumeMm3: b.innerWMm * b.innerDMm * b.innerHMm,
  }));

  // Step 1: 親商品逆引き
  const itemCodes = order.items.map((i) => i.productCode);
  const itemCodeSet = new Set(itemCodes);
  let setCompMatch: BoxSelectionReasoning['setCompMatch'] | undefined;
  let fixedBoxCode: string | null = null;
  if (itemCodes.length > 0) {
    const setComps = await prisma.setComp.findMany({
      where: {
        children: { some: { childCode: { in: itemCodes } } },
      },
      include: { children: true, fixedBox: { select: { code: true } } },
    });
    // 完全一致を最優先
    const scored = setComps.map((sc) => {
      const childCodeSet = new Set(sc.children.map((c) => c.childCode));
      const overlap = sc.children.filter((c) => itemCodeSet.has(c.childCode)).length;
      const exact =
        childCodeSet.size === overlap && itemCodes.length === overlap;
      return { sc, overlap, exact };
    });
    scored.sort((a, b) => Number(b.exact) - Number(a.exact) || b.overlap - a.overlap);
    const best = scored[0];
    if (best && best.sc.fixedBox) {
      fixedBoxCode = best.sc.fixedBox.code;
      setCompMatch = {
        id: best.sc.id,
        parentCode: best.sc.parentCode,
        parentName: best.sc.parentName,
        exact: best.exact,
      };
    }
  }

  let recommended: BoxCandidate | null = null;
  let strategy: BoxSelectionReasoning['strategy'] = 'volume';
  const notes: string[] = [];

  if (fixedBoxCode) {
    recommended = candidates.find((c) => c.code === fixedBoxCode) ?? null;
    if (recommended) {
      strategy = 'fixed-set';
      notes.push(`親商品 ${setCompMatch?.parentName} の固定箱`);
    }
  }

  // Step 2: 容積で選定
  if (!recommended && !missingVolumeData && requiredInnerMm3 > 0) {
    const fitting = candidates
      .filter((c) => c.innerVolumeMm3 >= requiredInnerMm3)
      .sort((a, b) => a.innerVolumeMm3 - b.innerVolumeMm3); // 過剰でない最小
    if (fitting.length > 0) {
      recommended = fitting[0];
      strategy = 'volume';
      notes.push(
        `必要内寸 ${Math.round(requiredInnerMm3 / 1000)} cm³ → ${
          recommended.name
        } (${Math.round(recommended.innerVolumeMm3 / 1000)} cm³)`,
      );
    } else {
      notes.push('容積を満たす箱がありません。最大箱を提案します');
      recommended = candidates.sort((a, b) => b.innerVolumeMm3 - a.innerVolumeMm3)[0] ?? null;
    }
  }

  // Step 3: フォールバック（容積データ不足時）
  if (!recommended) {
    strategy = 'size-rank-fallback';
    const targetRank = totalQty >= 5 ? 100 : totalQty >= 3 ? 80 : 60;
    notes.push(
      `容積データが不足。商品個数 ${totalQty} 件から sizeRank=${targetRank} を推定`,
    );
    recommended =
      candidates.find((c) => c.sizeRank === targetRank) ??
      candidates[0] ??
      null;
  }

  return {
    recommended,
    candidates,
    reasoning: {
      totalQty,
      hasFrozen,
      hasNoshi,
      totalProductVolumeMm3,
      requiredInnerMm3,
      strategy,
      setCompMatch,
      notes,
    },
  };
}
