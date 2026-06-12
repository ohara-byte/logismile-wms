-- A（発送可能賞味期限管理・2026-06-12）
-- 工場(/delivery)から受け取る shippableExpiryDays（発送可能賞味期限・日数）を Product に保持。
-- 在庫検品の完了後バナー（入庫日 + 日数 - 1 = 発送可能賞味期限日）の算出源。
ALTER TABLE "products" ADD COLUMN "shippable_expiry_days" INTEGER;
