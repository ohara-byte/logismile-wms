-- StockMovement に発送日(出荷日) を追加（③ Phase 1・2026-07-01）。
--   工場納品(inbound)で CraftSmile が商品ごとに紐づけた発送予定日を保持し、
--   在庫を「発送日」で色分け表示する（Phase 2）。nullable＝既存行・従来経路に影響なし。
ALTER TABLE "stock_movements" ADD COLUMN "ship_date" DATE;
CREATE INDEX "stock_movements_product_code_ship_date_idx" ON "stock_movements"("product_code", "ship_date");
