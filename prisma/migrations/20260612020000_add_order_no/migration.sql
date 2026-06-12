-- B（本部連絡の識別子・2026-06-12）
-- 基幹CSVの「注文番号」(N列)を出荷指示に保持。現場→本部連絡で 注文番号＋顧客コード＋顧客名 を表示。
ALTER TABLE "shipping_orders" ADD COLUMN "order_no" VARCHAR(30);
