/**
 * 工場連携モード判定（Sprint Z-8）
 *
 * 製造システム稼働前は `legacy`（現行 Sprint Z-5 仕様維持）、
 * 製造システム稼働後は `factory_api`（受注生産 = 通過型と同じ運用）に切り替える。
 *
 * 切替手順：
 *   1. .env の FACTORY_INTEGRATION_MODE を 'legacy' → 'factory_api' に変更
 *   2. WMS サーバを再起動
 *   3. /settings 画面で「現在のモード」が factory_api になっていることを確認
 *
 * 切替時の挙動差は以下の通り：
 *
 * | モード      | 受注生産の引当                      | 出荷残     | 余剰在庫        |
 * |-------------|------------------------------------|-----------|----------------|
 * | legacy      | 検品開始時に Stock プールから FIFO   | 手動繰越   | 当日廃棄       |
 * | factory_api | 通過型と同じ（納品 → 自動引当）      | 自動翌日繰越 | 警告のみ・翌日継承 |
 */

export type FactoryIntegrationMode = 'legacy' | 'factory_api';

/** 現在のモードを返す。未設定時は安全側の 'legacy'。 */
export function getFactoryMode(): FactoryIntegrationMode {
  const v = (process.env.FACTORY_INTEGRATION_MODE ?? '').toLowerCase().trim();
  if (v === 'factory_api') return 'factory_api';
  return 'legacy';
}

/** factory_api モードで動作中かどうか（短縮判定）。 */
export function isFactoryApiMode(): boolean {
  return getFactoryMode() === 'factory_api';
}

/**
 * 製造システム → WMS（inbound）の HMAC 署名検証で使うシークレット。
 * 未設定時は null（factory_api モードでは必須）。
 * X-Factory-Signature の検証に使用。
 */
export function getFactoryWebhookSecret(): string | null {
  // FACTORY_INBOUND_HMAC_SECRET を優先。後方互換で FACTORY_WEBHOOK_SECRET も許容。
  const s =
    (process.env.FACTORY_INBOUND_HMAC_SECRET ?? '').trim() ||
    (process.env.FACTORY_WEBHOOK_SECRET ?? '').trim();
  return s.length >= 16 ? s : null;
}

/**
 * WMS → 製造システム（outbound）の Webhook 署名に使うシークレット（2026-06-01 依頼 B4）。
 * 未設定時は null（送信実装は本シークレット必須）。X-WMS-Signature の生成に使用。
 * 製造側キー名は `WMS_TO_FACTORY_SECRET`。名称は異なってよいが**同一値を共有**する運用。
 */
export function getFactoryOutboundSecret(): string | null {
  const s = (process.env.FACTORY_OUTBOUND_HMAC_SECRET ?? '').trim();
  return s.length >= 16 ? s : null;
}

/** WMS → 製造 Webhook の宛先ベース URL（末尾スラッシュなし）。未設定時は null。 */
export function getFactoryBaseUrl(): string | null {
  const s = (process.env.FACTORY_BASE_URL ?? '').trim();
  return s ? s.replace(/\/+$/, '') : null;
}

/** WMS → 製造 送信を実際に行わず log のみにするか（テスト用）。既定 true（安全側）。 */
export function isFactoryOutboundDryRun(): boolean {
  return (process.env.FACTORY_DRY_RUN ?? 'true').toLowerCase().trim() !== 'false';
}

/**
 * 納品受信時に「受入＝検品OK（申告数=検品数・差分0）」の検品完了通知を自動送信するか。
 * go-live 初期は true（受入検品工程なしで運用）。将来 WMS に受入検品工程を導入したら
 * `FACTORY_AUTO_INSPECT_OK=false` にして自動通知を止め、実検品結果を送る運用に切り替える。
 */
export function isFactoryAutoInspectOk(): boolean {
  return (process.env.FACTORY_AUTO_INSPECT_OK ?? 'true').toLowerCase().trim() !== 'false';
}

/** タイムスタンプ許容ズレ（秒）。リプレイ防御の窓 */
export const FACTORY_TIMESTAMP_TOLERANCE_SEC = 300;
