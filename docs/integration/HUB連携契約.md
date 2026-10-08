# HUB（OENO EC Hub）→ LogiSmile 連携契約

- 決定：小原様 2026-10-07〜08（「HUB 起点で連携」「憶測 NG・TDD で正確に」）
- 相手側の正本：oeno-echub `docs/requirements/33_HUB起点連携_Craftsmile_LogiSmile.md`
- 判断規則：CraftSmile `docs/decisions/ADR-030`（稼働中の実装を正・**受信側の期待を正**）
- 契約テスト：`src/lib/__tests__/hub-contract.test.ts`・`hub-handler.test.ts`・`thomas-import.test.ts`

## 1. 位置づけ

| Phase | 流れ |
|---|---|
| Phase1（田舎主義 API 連携時） | 田舎主義 → HUB → **LogiSmile**（HUB は田舎主義の Thomas 出力を加工せずに中継） |
| Phase2（HUB が送り状・納品請求を印刷） | HUB → LogiSmile（ピッキング№は HUB が振る） |

**LogiSmile から HUB へは送らない**（小原様「セキュリティ上避けたい」）。梱包状況は HUB が取りに行く（次の段階で追加）。

## 2. 共通

| 項目 | 値 |
|---|---|
| 経路 | `https://logismile.oenosato.net`（インターネット）。Caddy で `/api/integration/hub/*` を HUB の固定 IP のみに絞る（管理者作業） |
| 署名 | HMAC-SHA256・canonical = `${timestamp}\n${rawBody}`・hex |
| ヘッダ | `X-Hub-Signature` / `X-Hub-Timestamp`（UNIX 秒・±300 秒）/ `Idempotency-Key`（`[A-Za-z0-9._:-]{1,128}`・必須） |
| 鍵 | LogiSmile `HUB_TO_WMS_SECRET` = HUB `ECHUB_LOGISMILE_HMAC_SECRET`（32 文字以上・未満は 503） |
| 有効化 | `HUB_INTEGRATION_ENABLED=true`（既定は 503） |
| 冪等 | `hub_inbound_requests` に**成功した応答**を保存し、同じキーの再送にはそれを返す（`replay: true`）。失敗は保存しない＝再送でやり直せる |
| 記録者 | 取込履歴・自動引当の依頼者は社員コード **`HUB`**（ログイン不可・割当に出ない連携用レコード。migration `20261008100000`） |
| 応答 | 200 / 400（JSON・冪等キー）/ 401（署名）/ 422（契約違反・理由 20 件まで）/ 503（無効・鍵）/ 500 |

署名の基準値（3 システム共通）：鍵 `hub-contract-secret-0123456789abcdef0123`・時刻 `1760000000`・
本文は `hub-contract.test.ts` の `VECTOR.body` → 署名 `397d4695…786ca`。

## 3. `POST /api/integration/hub/products`（Thomas 商品・「優先連携」= 出荷指示より先に送る）

```json
{ "products": [{ "code": "70001", "name": "定期Ｍﾊﾟｯｸ", "jan": "2800001000010", "expireType": "", "remainingDays": "" }] }
```

CSV の 5 列（商品コード / 商品名 / JANコード / 賞味期限管理区分 / 出荷可能残日数）と同じ。
JAN の検証（12 桁は警告で取込）、既存商品の商品種別を変えない、は CSV と同じ。

## 4. `POST /api/integration/hub/orders`（Thomas 出荷指示）

```json
{
  "orders": [{
    "pkNo": "SB01245370001", "shipDate": "2026-09-25", "carrier": "ヤマト運輸",
    "invoiceNo": "61391970001", "customerCode": "823986", "orderNo": "6139197",
    "destZip": "680-0411", "destAddr": "…", "destName": "…",
    "noshiFlag": "", "noshiCode": "", "noshiName": "", "noshiPerson": "", "deliveryDate": "2026-09-26",
    "items": [{ "productCode": "70001", "productName": "定期Ｍﾊﾟｯｸ", "qty": 2 }]
  }]
}
```

- 値は田舎主義の Thomas 出力そのまま（文字列）。数量だけ整数
- `noshiFlag` は「熨斗フラグ」の値そのまま。QR 印刷フラグへの読み替え（`parseQrPrintFlag`・QR 強制マスタ）は LogiSmile が行う
- 必須：`pkNo` / `shipDate` / `carrier` / `items`（1 行以上）
- **契約に無い項目は 422**。WMS要望の列（仕分けコード・温度帯 等）を足すときは、HUB と同時にこの契約とテストを直す
- 同じ `pkNo` の伝票が 1 本の本文に 2 つあれば 422。明細は 1 回 20,000 行まで
- `noshiCode`・`deliveryDate` は受け取るが、**現在は保存していない**（CSV でも同じ。保存は WMS要望の段階で追加）

**登録の規則は CSV 取込と同じ**（`thomas-import.ts`）：
DB に既にあるピッキング№は伝票ごとスキップ（重複）／未登録商品を含む伝票は丸ごとスキップ（アラート）／
同じ伝票の同じ商品は数量を合算／配送便種は 別名マスタ → 固定表 → `YMT-N`。登録後に自動引当を行う。

応答の `slips` で伝票ごとの結果を返す：

| result | 意味 |
|---|---|
| `imported` | 登録した |
| `duplicate` | 同じピッキング№が既にある（論理削除済みを含む） |
| `dropped_unmapped` | 未登録商品を含むためスキップ（`missingProductCodes`）。商品を登録して**別の冪等キーで**再送する |
| `error` | その他（出荷予定日が不正 など・`messages`） |

## 5. 運用上の注意

- HUB からの API 取込を始めたら、**同じ出荷指示の手動 CSV アップロードはやめる**（後から入れた側が全件「重複」になる）
- 応答の保存（`hub_inbound_requests`）には件数・ピッキング№・商品コード・メッセージのみが入る（届け先の氏名・住所は入れない）
