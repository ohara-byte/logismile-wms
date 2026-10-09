-- HUB 当日キャンセル（2026-10-09・小原様「WMS へチャット連絡と検品遮断をしたい」）。
-- callHUB でキャンセルした伝票に印を付け、検品の開始・スキャン・完了で止める（hub-cancel.ts）。
-- 未着手・保留の伝票はあわせて論理削除する（deleted_at・delete_reason・deleted_by='HUB'）。
ALTER TABLE "shipping_orders" ADD COLUMN "cancel_requested_at" TIMESTAMPTZ;
ALTER TABLE "shipping_orders" ADD COLUMN "cancel_reason" TEXT;
-- callHUB でキャンセルした人（表示用・30 文字まで）
ALTER TABLE "shipping_orders" ADD COLUMN "cancel_by" VARCHAR(30);
