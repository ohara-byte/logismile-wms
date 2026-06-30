-- StdTime（標準時間マスタ）: group_id を任意化し、inspection_groups への FK を解除。
--   グループは可変ラベル扱いとし、標準時間の基軸は table_id とする（2026-06-30）。
--   これにより「存在しない group_id を入れると FK 違反で新規登録が失敗する」問題も解消する。
ALTER TABLE "std_times" DROP CONSTRAINT "std_times_group_id_fkey";
ALTER TABLE "std_times" ALTER COLUMN "group_id" DROP NOT NULL;
