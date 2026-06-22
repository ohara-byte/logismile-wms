-- 基幹(Thomas)マスタ統合（2026-06-22）
-- セット梱包標準時間・種別、梱包時間の全体設定（のし/エアパック加算）を追加。
-- エアパックは熨斗名称(noshi_name)内のキーワードで判定するため ShippingOrder への追加列は無し。

-- SetComp: セット標準時間(秒)・種別・出所
ALTER TABLE "set_comps" ADD COLUMN "std_sec" INTEGER;
ALTER TABLE "set_comps" ADD COLUMN "set_kind" VARCHAR(20);
ALTER TABLE "set_comps" ADD COLUMN "std_sec_source" VARCHAR(10);

-- CreateIndex: 親コード逆引き（取込/ETA）
CREATE INDEX "set_comps_parent_code_idx" ON "set_comps"("parent_code");

-- Box: 箱自身の田舎主義(Thomas)コード（BOM子Codeと突合→セット固定箱判定）
ALTER TABLE "boxes" ADD COLUMN "thomas_code" VARCHAR(20);
CREATE INDEX "boxes_thomas_code_idx" ON "boxes"("thomas_code");

-- Product: カタログ商品番号（構成商品サイズ一覧との突合キー）
ALTER TABLE "products" ADD COLUMN "catalog_no" VARCHAR(30);
CREATE INDEX "products_catalog_no_idx" ON "products"("catalog_no");

-- CreateTable: アプリ設定（key-value）
CREATE TABLE "app_settings" (
    "key" VARCHAR(50) NOT NULL,
    "value" VARCHAR(200) NOT NULL,
    "value_type" VARCHAR(10) NOT NULL DEFAULT 'string',
    "label" VARCHAR(100),
    "note" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(10),

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- 梱包時間設定の初期値（秒・編集可）。のし/エアパックの追加工数と、エアパック判定語。
INSERT INTO "app_settings" ("key", "value", "value_type", "label", "note", "updated_at") VALUES
  ('pack.noshi_add_sec',   '60',       'int',    'のし追加工数(秒)',       '熨斗名称が（エアパック語を除いて）非空のとき梱包予定時間へ加算', CURRENT_TIMESTAMP),
  ('pack.airpack_add_sec', '120',      'int',    'エアパック追加工数(秒)', '熨斗名称にエアパック語を含むとき梱包予定時間へ加算',             CURRENT_TIMESTAMP),
  ('pack.airpack_keyword', 'エアパック', 'string', 'エアパック判定語',       '熨斗名称(O列)内にこの語を含めばエアパック扱い',                  CURRENT_TIMESTAMP);
