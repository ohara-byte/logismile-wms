-- StockMovement に検品実数(inspected_qty) を追加（発送日別 受入検品・Phase 5・2026-07-02）。
--   inspection_count で「その発送日ぶんを何個検品したか」の実数を保持。検品照合グリッド④⑧の集計元。
--   発送日別受入検品では qty_delta=0（在庫プールは触らない）。nullable＝既存行・旧経路に影響なし。
ALTER TABLE "stock_movements" ADD COLUMN "inspected_qty" INTEGER;
