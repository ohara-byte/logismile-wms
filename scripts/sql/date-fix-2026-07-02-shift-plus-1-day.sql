-- ============================================================
-- 日付根治マイグレーション（2026-07-02）: ship_date / target_date を +1日補正
-- ============================================================
-- 【背景】
--   CSV取込 parseShipDate が JST ローカル0時で日付生成していたため、Prisma の @db.Date が
--   UTC の「前日」で保存し、ShippingOrder.ship_date / ManufacturingInstruction.target_date が
--   実出荷予定日より 1 日早く保存されていた（全画面が setHours(JST) で相殺していた）。
--   コード側を「UTC 生成・UTC 照会」へ統一する root fix と同時に、既存データを +1 日補正する。
--
-- 【対象】
--   (1) shipping_orders.ship_date            … CSV由来＋翌日繰越とも一律1日前倒し → +1
--   (2) manufacturing_instructions.target_date … 生成経路(既定JST0時/realloc/import)すべて1日前倒し → +1
--   ※ stock_movements.ship_date（クラフトスマイル由来・ISO "YYYY-MM-DD"）は正しいので対象外。
--   ※ shifts.date / member_assignments.date 等（date-utils=UTC由来）も正しいので対象外。
--
-- 【必須の前提】
--   ⚠️ 実行前に必ず pg_dump でバックアップを取得すること。
--   ⚠️ コードデプロイ（parseShipDate UTC化＋全 shipDate クエリ UTC 統一）と同一メンテ枠で実施。
--      手順: バックアップ → 本SQL(COMMITまで) → コンテナ再ビルド（新コード起動）。
--      ※ 移行中に旧コードが新規レコードを作らないよう、SQL 直後に再ビルドすること。
--
-- 【実行方法】トランザクションで実行し、before/after の件数を目視確認してから COMMIT する。
-- ============================================================

BEGIN;

-- 補正前の分布（最新日が「実際の当日−1日」になっているはず）
SELECT 'BEFORE shipping_orders' AS label, ship_date, count(*) AS n
FROM shipping_orders WHERE deleted_at IS NULL
GROUP BY ship_date ORDER BY ship_date DESC LIMIT 7;

-- (1) 出荷指示 +1日
UPDATE shipping_orders SET ship_date = ship_date + INTERVAL '1 day';

-- (2) 製造指示（対象日）+1日
UPDATE manufacturing_instructions SET target_date = target_date + INTERVAL '1 day';

-- 補正後の分布（最新日が「実際の当日」になっていること・件数が before と同数であること）
SELECT 'AFTER shipping_orders' AS label, ship_date, count(*) AS n
FROM shipping_orders WHERE deleted_at IS NULL
GROUP BY ship_date ORDER BY ship_date DESC LIMIT 7;

-- ↑ 出力を確認して、問題なければ次行の COMMIT を実行。異常なら ROLLBACK; すること。
COMMIT;
