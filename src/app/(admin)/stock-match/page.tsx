/**
 * 検品照合（フル画面）ページ。
 *   発送日 × 製造部署 × 種別の時系列照合グリッド（Excel「検品照合」準拠）。
 *   クラフトスマイル由来の 発送予定/18時確定/製造部署 と、WMS 実績（納品/検品）を突合する。
 *   引当は概念から外す（サイレント）。列は横に多いためフル幅。
 */

import { StockMatchClient } from './_components/stock-match-client';

export default function StockMatchPage() {
  return (
    <main className="p-3">
      <h1 className="text-lg font-bold text-ink-strong mb-2">📦 検品照合</h1>
      <StockMatchClient />
    </main>
  );
}
