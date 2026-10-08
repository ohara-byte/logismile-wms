-- HUB（OENO EC Hub）→ LogiSmile 連携の受け口（2026-10-08・小原様「HUB 起点で連携」）。
--
-- 1) 冪等記録：同じ Idempotency-Key の再送には保存済みの応答を返す（取込をやり直さない）。
CREATE TABLE "hub_inbound_requests" (
    "id" SERIAL NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "endpoint" VARCHAR(30) NOT NULL,
    "response" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hub_inbound_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hub_inbound_requests_idempotency_key_key" ON "hub_inbound_requests"("idempotency_key");
CREATE INDEX "hub_inbound_requests_endpoint_received_at_idx" ON "hub_inbound_requests"("endpoint", "received_at");

-- 2) 連携用の社員レコード「HUB」（小原様承認 2026-10-08）。
--    取込履歴（thomas_imports.imported_by）・伝票の操作履歴（order_audit_logs.acted_by）は staff.code が
--    必須の外部キーのため、HUB からの操作はこの社員として記録する。
--    active=false：社員番号ログインできない（employee-signin は active=true のみ）。
--    assignable=false：メンバー割当・シフトに出さない。PC ログイン（users）も作らない。
INSERT INTO "staff" ("code", "emp_code", "name", "role", "assignable", "active", "note")
VALUES ('HUB', 'HUB-SYSTEM', '連携（HUB）', 'staff', false, false,
        'OENO EC Hub からの API 連携の記録用（ログイン不可・2026-10-08）')
ON CONFLICT DO NOTHING;
