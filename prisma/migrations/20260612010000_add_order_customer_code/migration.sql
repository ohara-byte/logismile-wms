-- B（本部連絡の識別子・2026-06-12）
-- 基幹CSVの「顧客コード」を出荷指示に保持。現場→本部連絡で 納品書№＋顧客コード＋顧客名 を表示。
ALTER TABLE "shipping_orders" ADD COLUMN "customer_code" VARCHAR(30);
