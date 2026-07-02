-- ============================================================
-- 【是正】日付根治マイグレーションの二重適用を -1日 で補正（2026-07-02）
-- ============================================================
-- date-fix-2026-07-02-shift-plus-1-day.sql が誤って2回実行され、ship_date /
-- target_date が +2日 になった（正しくは +1日）。本SQLで -1日 戻して +1日(正) にする。
--
-- ⚠️ マーカーテーブル(_date_fix_log)で冪等化済み。二重実行しても2回目はスキップされ安全。
-- ⚠️ コードは既に新UTC版が稼働中のため、本SQL適用後は再ビルド不要（ハードリロードのみ）。
-- ⚠️ 実行前にバックアップ推奨（既に取得済みの ~/wms-backup-20260702-datefix.sql は
--    「移行前(off-by-one)」時点。本是正後は「+1日(正)」になる）。
--
-- 期待結果(AFTER): 最新から 07-03:1474 / 07-02:1456(=本日) / 07-01:1424 / 06-30:1710 ...
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS _date_fix_log (
  key         text PRIMARY KEY,
  applied_at  timestamptz DEFAULT now()
);

SELECT 'BEFORE' AS label, ship_date, count(*) AS n
FROM shipping_orders WHERE deleted_at IS NULL
GROUP BY ship_date ORDER BY ship_date DESC LIMIT 7;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM _date_fix_log WHERE key = 'datefix_correction_minus1_20260702') THEN
    RAISE NOTICE '既に -1日補正 適用済み。スキップします。';
  ELSE
    UPDATE shipping_orders             SET ship_date   = ship_date   - INTERVAL '1 day';
    UPDATE manufacturing_instructions  SET target_date = target_date - INTERVAL '1 day';
    INSERT INTO _date_fix_log(key) VALUES ('datefix_correction_minus1_20260702');
    RAISE NOTICE '-1日補正を適用しました。';
  END IF;
END $$;

SELECT 'AFTER' AS label, ship_date, count(*) AS n
FROM shipping_orders WHERE deleted_at IS NULL
GROUP BY ship_date ORDER BY ship_date DESC LIMIT 7;

COMMIT;
