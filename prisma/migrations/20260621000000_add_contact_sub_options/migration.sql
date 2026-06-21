-- 本部連絡 サブ選択肢マスタ（②・2026-06-21）
-- タブレット／ハンディの本部連絡モーダルで、分類ごとに表示するサブ選択肢ボタン。
-- 本部へは現仕様通りテキストで送信。マスタ画面から自由に編集できる。
CREATE TABLE "contact_sub_options" (
    "id" SERIAL NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contact_sub_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_sub_options_category_label_key" ON "contact_sub_options"("category", "label");
CREATE INDEX "contact_sub_options_category_active_sort_order_idx" ON "contact_sub_options"("category", "active", "sort_order");

-- 初期サブ選択肢（②-3・小原様確認 2026-06-21）。商品 / WEB は空欄スタート。
-- 分類コード: のし=noshi / 伝票=input（既存の連絡分類コードを流用） / 商品=product / WEB=web
INSERT INTO "contact_sub_options" ("category", "label", "sort_order", "active", "created_at", "updated_at") VALUES
  ('noshi', '再印刷',       1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('noshi', 'シールへ変更', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('noshi', '白熨斗へ変更', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('noshi', '行方不明',     4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('noshi', '対象商品不明', 5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('input', '個口追加',     1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('input', 'NS再印刷',     2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
