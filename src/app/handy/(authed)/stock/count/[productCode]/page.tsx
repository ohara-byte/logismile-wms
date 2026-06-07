/**
 * 在庫検品画面（Sprint Z-1 / Phase A-5）
 *
 * 1. /api/stocks/[productCode] で現在 qty を取得
 * 2. ハンディの数量入力で物理カウントを送信 → /api/stocks/count
 * 3. 自動で /api/allocation/run?productCode=... を呼出 → 引当進行
 * 4. 結果サマリ（引当 / 不足 / draft 製造指示）を表示
 */

import { StockCountClient } from './_components/stock-count-client';

export default function StockCountPage({
  params,
}: {
  params: { productCode: string };
}) {
  return <StockCountClient productCode={decodeURIComponent(params.productCode)} />;
}
