# 大江ノ郷自然牧場 WMS — API仕様書

**ベースURL**: `http://{サーバーIP}/api`  
**フォーマット**: JSON  
**認証**: NextAuth.js セッションCookie  
**作成日**: 2026-05-01  
**改訂**: 2026-05-02 v1.5要件定義書に整合（社員番号ログイン/QR印刷/削除復活/シフト/メンバー割当 反映）

---

## 共通仕様

### レスポンス形式

```typescript
// 成功時
{ "data": <ペイロード>, "message": "OK" }

// エラー時
{ "error": "<エラーコード>", "message": "<説明>" }
```

### エラーコード

| コード | HTTP | 説明 |
|--------|------|------|
| `UNAUTHORIZED` | 401 | 未認証 |
| `FORBIDDEN` | 403 | 権限不足 |
| `NOT_FOUND` | 404 | リソース未存在 |
| `CONFLICT` | 409 | 重複（ピッキング№等） |
| `VALIDATION` | 422 | バリデーションエラー（JAN形式不正等） |
| `INTERNAL` | 500 | サーバーエラー |

### 認証方式（端末別）

| 端末 | エンドポイント | 認証情報 |
|---|---|---|
| 管理PC | `/api/auth/signin` | email + password（NextAuth credentials） |
| **タブレット/ハンディ** | **`/api/auth/employee-signin`** | **★ 社員番号（emp_code）+ 端末コード（device_code）のみ** |

両方ともCookieベースのセッション。タブレット/ハンディ認証は社内ネットワーク内からのみアクセス可能（IP制限）。

---

## 1. 認証 API

### `POST /api/auth/signin`
管理PC用（NextAuth.js credentials プロバイダ）

**リクエスト**:
```json
{ "email": "user@example.com", "password": "***" }
```

### `POST /api/auth/employee-signin`
**★ タブレット/ハンディ用（社員番号のみログイン）**

**リクエスト**:
```json
{ "emp_code": "94", "device_code": "TAB-001" }
```

**レスポンス**:
```json
{
  "data": {
    "staff": {
      "code": "GP094",
      "emp_code": "94",
      "name": "山根 康稔",
      "role": "staff",
      "group_id": "POOL"
    },
    "device": { "code": "TAB-001", "type": "tablet" },
    "default_printer": { "code": "PRT-01", "ip_address": "192.168.10.101" }
  }
}
```

**処理**:
1. `staff.emp_code` で `staff` を検索（active=true）
2. `device_code` で `devices` を検索
3. `device_printer_map` から既定プリンターを取得
4. セッションCookie発行

### `POST /api/auth/signout`
ログアウト（共通）

---

## 2. マスタ API

### 構成商品マスタ

#### `GET /api/master/products`
商品一覧取得

**クエリパラメータ**:

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| q | string | 商品コード・JAN・商品名 部分一致 |
| cat | string | カテゴリフィルタ |
| active | boolean | 取扱中のみ（デフォルト: true） |
| page | number | ページ番号 |
| limit | number | 件数（デフォルト50） |

#### `POST /api/master/products`
新規登録（admin/manager のみ）。**JAN重複は許容**（フォーマット検証のみ）。

#### `GET /api/master/products/:code`
商品詳細

#### `PUT /api/master/products/:code`
更新

#### `DELETE /api/master/products/:code`
論理削除（active=false）

---

### 商品属性補助マスタ

#### `GET /api/master/product-aux`
#### `POST /api/master/product-aux`
#### `PUT /api/master/product-aux/:productCode`

外寸（W/D/H mm）・温度帯・特殊梱包の管理。

---

### 構成品/同梱物マスタ

#### `GET /api/master/set-comps`
#### `POST /api/master/set-comps`

**リクエストボディ**:
```json
{
  "parentCode": "G-GIFT-A",
  "parentName": "春の詰合せA",
  "type": "set",
  "fixedBoxCode": "BOX-FX-GIFT-A",
  "packingNote": "化粧箱内は仕切り紙を使用。",
  "children": [
    { "childCode": "E-10", "childName": "有精卵 10個入り", "qty": 1 }
  ]
}
```

#### `PUT /api/master/set-comps/:id`
子リスト全置換で更新

#### `DELETE /api/master/set-comps/:id`

---

### 箱マスタ

#### `GET /api/master/boxes`
#### `GET /api/master/boxes/suggest`
箱候補提案（容積計算）

**クエリパラメータ**:

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| orderItems | string | 商品コード:数量 のカンマ区切り |
| frozen | boolean | 冷凍便フラグ |
| noshi | boolean | のし対応フラグ |

#### `POST /api/master/boxes`
#### `PUT /api/master/boxes/:code`

---

### 運送会社マスタ

#### `GET / POST / PUT / DELETE /api/master/carriers/:code`

---

### 担当者マスタ ★ 拡張

#### `GET /api/master/staff`

**レスポンス例（emp_code・雇用区分・標準シフト含む）**:
```json
{
  "data": {
    "items": [
      {
        "code": "GP094",
        "emp_code": "94",
        "name": "山根 康稔",
        "role": "mgr",
        "employment_type_code": "seishain_a",
        "group_id": "POOL",
        "default_shift_pattern": "G7",
        "assignable": false,
        "active": true
      }
    ]
  }
}
```

#### `POST /api/master/staff`
#### `PUT /api/master/staff/:code`

---

### ★ 端末・プリンターマスタ（新規）

#### `GET /api/master/devices`
端末一覧（タブレット/ハンディ/PC）

#### `POST /api/master/devices`
#### `PUT /api/master/devices/:code`

#### `GET /api/master/printers`
プリンター一覧

**レスポンス例**:
```json
{
  "data": {
    "items": [
      {
        "code": "PRT-01",
        "name": "倉庫1F-01",
        "ip_address": "192.168.10.101",
        "port": 9100,
        "model": "SCeaTa CT4-LX",
        "location": "倉庫1F検品ステーション",
        "label_size": "30x40",
        "active": true
      }
    ]
  }
}
```

#### `POST /api/master/printers`
#### `PUT /api/master/printers/:code`

#### `GET /api/master/device-printer-map`
端末×既定プリンターの紐付け一覧

#### `PUT /api/master/device-printer-map/:deviceCode`
**リクエストボディ**: `{ "printer_code": "PRT-01" }`

---

### ★ シフト関連マスタ（新規）

#### `GET / POST / PUT /api/master/shift-patterns`
シフトパターン（G7/A6/公休 等）

#### `GET / POST / PUT /api/master/employment-types`
雇用区分

---

## 3. 出荷指示 API

### `POST /api/orders/import`
**Thomas CSV 取込（IFアダプタ層経由）**

**リクエスト**: `multipart/form-data`、`file` フィールドにCSV

**処理**:
1. 文字コード自動判定（Shift-JIS / UTF-8）
2. ファイル種別判定（products / orders / sort）
3. 商品マスタの場合：JAN空欄・桁数・チェックデジット検証（**重複は許容**）
4. 出荷指示の場合：**ピッキング№重複チェック**（重複時はスキップ・エラー報告）
5. shipping_orders/shipping_order_items に登録
6. 未マップ商品をアラート登録

**レスポンス例**:
```json
{
  "data": {
    "importId": 42,
    "fileType": "orders",
    "totalRows": 156,
    "successCount": 148,
    "errorCount": 0,
    "janErrorCount": 0,
    "duplicatePkNoCount": 2,
    "unmapCount": 8,
    "unmappedCodes": ["PROD-999", "PROD-888"]
  }
}
```

### `GET /api/orders`
出荷指示一覧

**クエリパラメータ**:

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| shipDate | date | YYYY-MM-DD |
| status | string | pending/inspecting/packed/shipped/held |
| q | string | PkNo/配送先/商品名 |
| group | string | グループID |
| table | string | テーブルID |
| carrier | string | 運送会社コード |
| includeDeleted | boolean | 削除済も含むか（デフォルト false） |
| page / limit | number | |

### `GET /api/orders/:pkNo`
出荷指示詳細（ピッキング№で検索）

**レスポンス例**:
```json
{
  "data": {
    "id": "uuid...",
    "pkNo": "PK-20260501-0001",
    "shipDate": "2026-05-01",
    "status": "inspecting",
    "qrPrintFlag": true,
    "noshiName": "感謝の気持ち",
    "destZip": "680-0000",
    "destAddr": "鳥取県鳥取市...",
    "destName": "山田 花子 様",
    "invoiceNo": "00059546010001",
    "carrier": { "code": "YMT-N", "name": "ヤマト便" },
    "items": [
      {
        "id": 1,
        "productCode": "E-RAW-10",
        "productName": "天美卵 10個入",
        "qty": 2,
        "scannedQty": 1,
        "forceOk": false
      }
    ],
    "setComp": {
      "parentCode": "G-GIFT-A",
      "packingNote": "化粧箱内は仕切り紙を使用。",
      "accompanies": [
        { "type": "noshi", "name": "のし台紙(母の日 A01)" }
      ]
    }
  }
}
```

### ★ `PUT /api/orders/:pkNo/print-flag`
**QR印刷フラグの手動切替**

**リクエスト**: `{ "qr_print_flag": true }`

**処理**: `shipping_orders.qr_print_flag` を更新し、`order_audit_logs` に `action=qr_flag_change` で記録。

### ★ `DELETE /api/orders/:pkNo`
**伝票の論理削除**（admin/manager のみ）

**リクエスト**: `{ "reason": "基幹で新ピッキング№が発行されたため旧伝票削除" }`

**処理**:
1. `status = 'inspecting'` の場合は 409 Conflict（保留→削除に誘導）
2. `deleted_at = NOW()`, `deleted_by = currentUser`, `delete_reason = reason` をセット
3. `order_audit_logs` に `action='delete'` で記録

### ★ `GET /api/orders/deleted`
削除済み伝票一覧

**クエリパラメータ**:

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| from / to | date | 削除日範囲 |
| q | string | PkNo/配送先 |
| deletedBy | string | 削除担当者 |

### ★ `POST /api/orders/:pkNo/restore`
**削除伝票の復活**（admin/manager のみ）

**リクエスト**: `{ "reason": "誤削除のため復活" }`

**処理**:
1. `deleted_at = NULL`, `deleted_by = NULL`, `delete_reason = NULL`
2. `order_audit_logs` に `action='restore'` で記録

### `GET /api/orders/:pkNo/audit-logs`
伝票の監査ログ取得（削除・復活・編集の履歴）

---

## 4. 検品 API

### `POST /api/inspect/start`
検品セッション開始

**リクエスト**:
```json
{
  "pkNo": "PK-20260501-0001",
  "staffCode": "S001",
  "deviceCode": "TAB-001"
}
```

### `POST /api/inspect/scan`
バーコードスキャン処理

**リクエスト**:
```json
{ "sessionId": "uuid...", "scanValue": "4901111000010", "qty": 1 }
```

**`result` の値**:
- `matched` — 数量加算
- `over_scan` — 数量超過
- `not_found` — 照合失敗
- `already_done` — 既完了

### `POST /api/inspect/force-ok`
強制OK

**リクエスト**:
```json
{ "sessionId": "uuid...", "itemId": 1, "reason": "在庫切れ・代替対応" }
```

### `POST /api/inspect/complete`
**★ 検品完了（納品書№スキャン）**

**リクエスト**:
```json
{
  "sessionId": "uuid...",
  "pkNo": "PK-20260501-0001",
  "invoiceNo": "00059546010001",
  "boxCode": "BOX-FX-GIFT-A"
}
```

**処理**:
1. ピッキング№と納品書№の整合性確認
2. セッション完了記録
3. `shipping_orders.status = 'packed'` に更新
4. **★ qr_print_flag = true の場合のみ、自動でQR印刷を最寄りプリンターへ送信**

### `POST /api/inspect/hold`
伝票保留

---

## 5. ★ QR印刷 API（新規）

### `POST /api/print/qr`
QR印刷指示（自動・手動両用）

**リクエスト**:
```json
{
  "pkNo": "PK-20260501-0001",
  "deviceCode": "TAB-001"
}
```

**処理**:
1. `shipping_orders.qr_print_flag = false` なら 422 Validation エラー
2. `device_printer_map` から既定プリンターを取得
3. プリンターIPへZPL/印刷ジョブ送信
4. `print_logs` に記録

### `POST /api/print/qr/reprint`
QR印刷（再印刷）

**リクエスト**: `{ "pkNo": "...", "deviceCode": "...", "reason": "ラベル破損" }`

`print_logs.is_reprint = true` で記録。

---

## 6. シフト・メンバー割当 API ★ 新規

### `GET /api/shifts`
シフト一覧

**クエリパラメータ**: `from`, `to`, `staffCode`

### `POST /api/shifts`
シフト個別登録（手動）

### `POST /api/shifts/import`
**★ GPシフトCSV取込（4ステップ・最終実行）**

**ステップ別エンドポイント**:
- `POST /api/shifts/import/upload`：① ファイルアップロード
- `POST /api/shifts/import/detect-mapping`：② 列マッピング自動検出
- `POST /api/shifts/import/preview`：③ プレビュー（突合結果確認）
- `POST /api/shifts/import/execute`：④ 実行（shifts に書き込み）

**プレビューレスポンス例**:
```json
{
  "data": {
    "totalRows": 720,
    "matched": 720,
    "matchedStaff": 24,
    "unmatchedEmpCodes": [],
    "patternStats": { "G7": 480, "公休": 96, "有休": 24 }
  }
}
```

### `GET /api/shifts/today`
当日シフト（メンバー割当ガントの初期データ）

---

### `GET /api/assignments`
メンバー割当一覧

**クエリパラメータ**: `date`（YYYY-MM-DD）

### `PUT /api/assignments`
**メンバー割当の保存（Gantt 全体保存）**

**リクエストボディ**:
```json
{
  "date": "2026-05-02",
  "assignments": [
    { "staffCode": "GP094", "groupId": "ABL", "startTime": "09:00", "endTime": "12:30" },
    { "staffCode": "GP094", "groupId": "POOL", "startTime": "13:00", "endTime": "18:00" }
  ]
}
```

**処理**:
1. 当日分の `member_assignments` を全削除
2. 新規データを bulk insert
3. ダッシュボードへ SSE で通知（終了予定再計算トリガ）

### `POST /api/assignments/load-yesterday`
昨日の割当を当日に複製

### `DELETE /api/assignments?date=YYYY-MM-DD`
当日割当を全クリア

### `GET /api/assignments/print?date=YYYY-MM-DD`
朝礼用印刷用PDF生成

---

## 7. リアルタイム更新

### `GET /api/progress/stream`
Server-Sent Events（SSE）

**イベント種別**:
- `session_start`
- `scan`
- `complete`
- `hold`
- `assignment_changed`
- `flag_changed`
- `delay_alert`

---

## 8. レポート API

### `GET /api/report/summary`
出荷サマリー

**クエリパラメータ**: `from`, `to`, `gran`（day/week/month）, `compareWith`（前期間/前年同期）

### `GET /api/report/group-mh`
**テーブルグループ別 MHレポート**

### `GET /api/report/staff-mh`
担当者別MH

### `GET /api/report/product-abc`
商品ABC分析

### `GET /api/report/heatmap`
**★ ヒートマップ**（時間帯×曜日 / 運送会社締切駆け込み）

**レスポンス例**:
```json
{
  "data": {
    "rows": [
      { "weekday": "月", "hour": 9, "count": 45, "level": "low" },
      { "weekday": "月", "hour": 16, "count": 287, "level": "high" }
    ],
    "carrierCutoffs": [
      { "carrier": "ヤマト便", "cutoff": "17:00", "rushCount": 142 },
      { "carrier": "佐川急便", "cutoff": "16:30", "rushCount": 98 }
    ]
  }
}
```

### `GET /api/report/export?format=csv|pdf`
レポートのCSV/PDF出力

---

## 9. 連絡事項 API

### `GET /api/notices?date=YYYY-MM-DD`
当日分（ハンディが起動時に取得）

### `POST /api/notices`
連絡事項登録（管理PC）

**リクエストボディ**:
```json
{
  "date": "2026-05-02",
  "title": "ABL 前裁き 2名追加",
  "body": "着手分から回してください",
  "targetType": "group",
  "targetId": "ABL",
  "priority": 50
}
```

### `PUT /api/notices/:id`
### `DELETE /api/notices/:id`

---

## 10. アラート API

### `GET /api/alerts?resolved=false`
### `PUT /api/alerts/:id/resolve`

---

## 11. ヘルスチェック

### `GET /api/health`
サーバー稼働確認（認証不要）

```json
{ "status": "ok", "db": "connected", "time": "2026-05-01T09:00:00Z" }
```

---

## 12. 権限マトリクス（API レベル）

| API | admin | manager | staff |
|---|:---:|:---:|:---:|
| `/api/auth/signin` | ○ | ○ | ○ |
| `/api/auth/employee-signin` | ○ | ○ | ○ |
| `/api/master/*` 編集 | ○ | ○ | − |
| `/api/orders/import` | ○ | ○ | − |
| `/api/orders` 一覧 | ○ | ○ | ○ |
| `/api/orders/:pkNo/print-flag` | ○ | ○ | ○ |
| `/api/orders/:pkNo` DELETE | ○ | ○ | − |
| `/api/orders/:pkNo/restore` | ○ | ○ | − |
| `/api/inspect/*` | ○ | ○ | ○ |
| `/api/print/*` | ○ | ○ | ○ |
| `/api/shifts/import/*` | ○ | ○ | − |
| `/api/assignments` PUT | ○ | ○ | − |
| `/api/report/*` | ○ | ○ | − |
| `/api/alerts/*/resolve` | ○ | ○ | − |
