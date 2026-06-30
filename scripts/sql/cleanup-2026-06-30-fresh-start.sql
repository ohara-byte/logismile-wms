-- ============================================================================
-- 本格稼働前 クリーンアップ（2026-06-30 / 翌 7/1 本格稼働に向けたフレッシュスタート）
-- ----------------------------------------------------------------------------
-- 目的:
--   A) 溜まった「在庫不足(stock_shortage)」アラートをクリア（resolved 化）
--   B) 6/29 以前の出荷残（未出荷の出荷指示）をクリア（ソフト削除＋引当解放＋在庫再計算）
--
-- 方針（安全側・取り消し可能）:
--   - アラートは DELETE せず resolved=true（履歴は残す）
--   - 出荷残は DELETE せず deleted_at をセット（ソフト削除＝元に戻せる）
--   - 出荷残の reserved 引当は released にし、影響商品の allocated_qty を再計算
--     （deleted 注文の予約で在庫が phantom 拘束されないようにする）
--
-- 対象境界（ohara 様確認済 2026-06-30）:
--   出荷残 = ship_date <= '2026-06-29'（6/29 を含む・本日 6/30 は残す）
--          かつ status IN ('pending','inspecting','held') かつ deleted_at IS NULL
--
-- 実行（本番 WMS DB / ohara 様）:
--   1) まず「Step 0 件数確認」だけを実行して件数を目視
--   2) 問題なければ「Step A」「Step B」を実行
--   ※ Step B はトランザクション。COMMIT 前に件数を確認できる。
-- ============================================================================


-- ============================================================================
-- Step 0: 件数確認（SELECT のみ・無害。まずこれだけ実行して目視する）
-- ============================================================================
SELECT count(*) AS pending_stock_shortage_alerts
FROM alerts
WHERE type = 'stock_shortage' AND resolved = false;

SELECT count(*) AS old_unshipped_orders
FROM shipping_orders
WHERE ship_date <= DATE '2026-06-29'
  AND status IN ('pending', 'inspecting', 'held')
  AND deleted_at IS NULL;


-- ============================================================================
-- Step A: 在庫不足アラートをクリア（resolved 化）
-- ============================================================================
UPDATE alerts
SET resolved = true,
    resolved_at = now(),
    resolved_by = 'cleanup20260630'
WHERE type = 'stock_shortage' AND resolved = false;


-- ============================================================================
-- Step B: 6/29 以前の出荷残をクリア（1 トランザクション）
-- ============================================================================
BEGIN;

-- 1) 対象注文の reserved 引当を解放
UPDATE allocations
SET status = 'released'
WHERE status = 'reserved'
  AND order_id IN (
    SELECT id FROM shipping_orders
    WHERE ship_date <= DATE '2026-06-29'
      AND status IN ('pending', 'inspecting', 'held')
      AND deleted_at IS NULL
  );

-- 2) 対象注文をソフト削除（deleted_by で後段の特定に使う）
UPDATE shipping_orders
SET deleted_at = now(),
    deleted_by = 'cleanup20260630',
    delete_reason = '本格稼働前の旧出荷残クリア（6/29以前）'
WHERE ship_date <= DATE '2026-06-29'
  AND status IN ('pending', 'inspecting', 'held')
  AND deleted_at IS NULL;

-- 3) 影響商品の allocated_qty を「非 released の引当合計」に再計算
--    （解放を在庫ボードへ反映＝stock-recompute 相当を対象商品に限定して実行）
UPDATE stocks s
SET allocated_qty = COALESCE((
  SELECT SUM(a.qty) FROM allocations a
  WHERE a.product_code = s.product_code AND a.status <> 'released'
), 0)
WHERE s.product_code IN (
  SELECT DISTINCT a.product_code
  FROM allocations a
  JOIN shipping_orders o ON o.id = a.order_id
  WHERE o.deleted_by = 'cleanup20260630'
);

-- 結果確認（件数が想定どおりか目視 → 問題なければ COMMIT、おかしければ ROLLBACK）
SELECT count(*) AS cleared_orders
FROM shipping_orders
WHERE deleted_by = 'cleanup20260630';

COMMIT;
-- ROLLBACK;  -- ← 想定外なら COMMIT の代わりにこちら
