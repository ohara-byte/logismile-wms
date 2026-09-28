-- 検品グループに「作業ペースの目標値」を追加（要望書 2026-09-27 要望③・小原様承認 2026-09-28）。
--   pace_yellow_min … 🔴要注意 と 🟡標準 の境界（この値以上なら 🟡）
--   pace_green_min  … 🟡標準 と 🟢好調 の境界（この値以上なら 🟢）
--
-- 現場端末（タブレット・ハンディ）の待受け画面に出す自己確認用バッジで使う。
-- 人員構成や繁忙期に応じて現場で調整できるよう、コードに固定せずマスタで持つ。
-- nullable＝既存行はそのまま（未設定のグループはバッジを出さない）。
ALTER TABLE "inspection_groups" ADD COLUMN "pace_yellow_min" INTEGER;
ALTER TABLE "inspection_groups" ADD COLUMN "pace_green_min" INTEGER;
