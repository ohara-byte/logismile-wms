# 大江ノ郷自然牧場 WMS — DB設計書

**対象DB**: PostgreSQL 16  
**ORM**: Prisma 5.x  
**作成日**: 2026-05-01  
**改訂**: 2026-05-02 v1.5要件定義書に整合（シフト/メンバー割当/プリンタ/論理削除/QR印刷フラグ 反映）

---

## テーブル一覧

### マスタ系

| # | テーブル名 | 説明 |
|---|-----------|------|
| 1 | `products` | 構成商品マスタ |
| 2 | `product_aux_attrs` | 商品属性補助（外寸・温度帯等） |
| 3 | `set_comps` | 構成品/同梱物マスタ（親商品定義） |
| 4 | `set_comp_children` | 構成品明細（子商品リスト） |
| 5 | `boxes` | 箱マスタ |
| 6 | `carriers` | 運送会社マスタ |
| 7 | `staff` | 担当者マスタ（社員番号ログイン用） |
| 8 | `devices` | 端末マスタ |
| 9 | `inspection_groups` | 検品グループマスタ |
| 10 | `std_times` | 標準梱包時間マスタ |
| 11 | `shift_patterns` | ★ シフトパターンマスタ |
| 12 | `employment_types` | ★ 雇用区分マスタ |
| 13 | `shifts` | ★ シフトマスタ（日次） |
| 14 | `printers` | ★ プリンターマスタ |
| 15 | `device_printer_map` | ★ 端末×既定プリンター |
| 16 | `notices` | 連絡事項 |

### トランザクション系

| # | テーブル名 | 説明 |
|---|-----------|------|
| 17 | `shipping_orders` | 出荷指示ヘッダ（論理削除対応） |
| 18 | `shipping_order_items` | 出荷指示明細 |
| 19 | `insp_sessions` | 検品セッション |
| 20 | `insp_logs` | 検品操作ログ |
| 21 | `thomas_imports` | 基幹取込履歴 |
| 22 | `alerts` | アラート管理 |
| 23 | `member_assignments` | ★ メンバー割当（Gantt） |
| 24 | `print_logs` | ★ QR印刷履歴 |
| 25 | `order_audit_logs` | ★ 伝票監査ログ（削除/復活/編集） |

### システム系

| # | テーブル名 | 説明 |
|---|-----------|------|
| 26 | `users` | 認証ユーザー（管理PC用） |
| 27 | `sessions` | NextAuth セッション |

---

## 主キー・重要仕様

| データ | 主キー / 一意性 |
|---|---|
| 出荷伝票 | **★ ピッキング№（pk_no）一意。重複時は取込エラー** |
| 納品書№ | **★ 非主キー。重複可（ピッキング№配下）** |
| 構成商品 | 商品コード一意 |
| **JANコード** | **★ 非主キー、重複可（インデックスのみ／取込時のフォーマット検証あり）** |
| 担当者 | 担当者コード一意。`emp_code`はGPシフトCSV突合キー |

論理削除：`shipping_orders.deleted_at` で実装。物理削除は1年後の年次バッチ。

---

## テーブル詳細

### 1. `products`（構成商品マスタ）

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| code | VARCHAR(20) | PK | ✓ | | 構成商品コード（例: E-RAW-10） |
| jan | VARCHAR(13) | INDEX | | | JANコード（**重複可**） |
| name | VARCHAR(100) | | ✓ | | 構成商品名 |
| cat | VARCHAR(20) | | ✓ | | カテゴリ（egg/sweet/meat/frozen/soup/gift/set） |
| pkg | VARCHAR(20) | | ✓ | '箱' | 梱包形態 |
| price | INTEGER | | ✓ | 0 | 税込価格（円） |
| lead_days | INTEGER | | ✓ | 0 | 事前リード日数 |
| std_sec | INTEGER | | ✓ | 0 | 標準作業時間（秒/件） |
| frozen | BOOLEAN | | ✓ | false | 冷凍便対象 |
| special | BOOLEAN | | ✓ | false | 特殊梱包 |
| noshi | BOOLEAN | | ✓ | false | のし対応可 |
| active | BOOLEAN | | ✓ | true | 取扱中 |
| note | TEXT | | | | 備考 |
| created_at | TIMESTAMPTZ | | ✓ | NOW() | |
| updated_at | TIMESTAMPTZ | | ✓ | NOW() | |

**インデックス**: `jan`（重複可だが検索頻度高のためINDEX）, `cat`

> **★ JAN重複は許容**：構成商品コードが異なる場合に同一JANを共有可。一意制約（UNIQUE）ではなくINDEXで実装。

---

### 2. `product_aux_attrs`（商品属性補助マスタ）

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| id | SERIAL | PK | ✓ | | |
| product_code | VARCHAR(20) | FK→products.code UQ | ✓ | | |
| disp_name | VARCHAR(100) | | | | WMS表示名 |
| temp_zone | VARCHAR(10) | | ✓ | 'ambient' | ambient/ref/frozen |
| special_pkg | VARCHAR(30) | | | | 特殊梱包種別 |
| std_sec | INTEGER | | ✓ | 0 | 標準時間参照値 |
| transferred | BOOLEAN | | ✓ | false | 基幹移管完了 |
| w_mm | INTEGER | | ✓ | 0 | 外寸W（mm） |
| d_mm | INTEGER | | ✓ | 0 | 外寸D（mm） |
| h_mm | INTEGER | | ✓ | 0 | 外寸H（mm） |
| note | TEXT | | | | |

---

### 3. `set_comps`（構成品/同梱物マスタ）

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| id | VARCHAR(30) | PK | ✓ | | 例: SC-G-GIFT-A |
| parent_code | VARCHAR(20) | | ✓ | | 親商品コード |
| parent_name | VARCHAR(100) | | ✓ | | 親商品名（非正規化） |
| type | VARCHAR(20) | | ✓ | | set/noshi/pamphlet/addon |
| fixed_box_code | VARCHAR(30) | FK→boxes.code | | | 固定箱コード |
| packing_note | TEXT | | | | 同梱物注意・梱包メモ |
| note | TEXT | | | | |
| created_at | TIMESTAMPTZ | | ✓ | NOW() | |
| updated_at | TIMESTAMPTZ | | ✓ | NOW() | |

---

### 4. `set_comp_children`（構成品明細）

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| id | SERIAL | PK | ✓ | | |
| set_comp_id | VARCHAR(30) | FK→set_comps.id | ✓ | | |
| child_code | VARCHAR(20) | | ✓ | | 子構成商品コード |
| child_name | VARCHAR(100) | | | | 商品名（非正規化） |
| qty | INTEGER | | ✓ | 1 | 構成数量 |
| sort_order | INTEGER | | ✓ | 0 | |

---

### 5. `boxes`（箱マスタ）

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| code | VARCHAR(30) | PK | ✓ | | 例: BOX-FX-GIFT-A |
| name | VARCHAR(100) | | ✓ | | |
| type | VARCHAR(20) | | ✓ | | fixed/variable/extension |
| size_rank | INTEGER | | ✓ | | 60/80/100/120/140 |
| w_mm / d_mm / h_mm | INTEGER | | ✓ | 0 | 外寸 |
| inner_w_mm / inner_d_mm / inner_h_mm | INTEGER | | ✓ | 0 | 内寸 |
| frozen | BOOLEAN | | ✓ | false | |
| noshi | BOOLEAN | | ✓ | false | |
| target_products | TEXT[] | | ✓ | {} | 固定箱の対象親商品コード配列 |
| priority | INTEGER | | ✓ | 50 | |
| note | TEXT | | | | |

---

### 6. `carriers`（運送会社マスタ）

| カラム名 | 型 | PK | NOT NULL | デフォルト | 説明 |
|---------|-----|----|----------|-----------|------|
| code | VARCHAR(20) | PK | ✓ | | YMT-N等 |
| name | VARCHAR(50) | | ✓ | | |
| short | VARCHAR(20) | | | | 略称 |
| priority | INTEGER | | ✓ | 99 | |
| cutoff | VARCHAR(5) | | | | 受付締切（HH:MM） |
| pickup | VARCHAR(5) | | | | 集荷時刻 |
| cool | BOOLEAN | | ✓ | false | クール便 |
| wb_type | VARCHAR(30) | | | | 送り状種類 |
| contact | VARCHAR(100) | | | | |
| active | BOOLEAN | | ✓ | true | |
| note | TEXT | | | | |

---

### 7. `staff`（担当者マスタ） ★ 拡張

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| code | VARCHAR(10) | PK | ✓ | | 担当者コード |
| **emp_code** | **VARCHAR(20)** | **UQ** | **✓** | | **★ 社員番号（タブレット/ハンディログインキー / GPシフトCSV突合キー）** |
| name | VARCHAR(30) | | ✓ | | 氏名 |
| kana | VARCHAR(40) | | | | ふりがな |
| role | VARCHAR(20) | | ✓ | 'staff' | admin/manager/staff |
| **employment_type_code** | **VARCHAR(20)** | **FK→employment_types.code** | | | **★ 雇用区分** |
| group_id | VARCHAR(10) | FK→inspection_groups.id | | | 所属グループ |
| **default_shift_pattern** | **VARCHAR(10)** | **FK→shift_patterns.code** | | | **★ 標準シフトパターン** |
| **tel** | VARCHAR(20) | | | | 連絡先 |
| **joined** | DATE | | | | 入社日 |
| assignable | BOOLEAN | | ✓ | true | 割当可フラグ |
| active | BOOLEAN | | ✓ | true | 稼働フラグ |
| note | TEXT | | | | |

**インデックス**: `emp_code`（一意・ログイン高速化）

---

### 8. `devices`（端末マスタ）

| カラム名 | 型 | PK | NOT NULL | デフォルト | 説明 |
|---------|-----|----|----------|-----------|------|
| code | VARCHAR(20) | PK | ✓ | | 端末コード |
| name | VARCHAR(50) | | ✓ | | 端末名 |
| type | VARCHAR(20) | | ✓ | | tablet/handy/pc |
| model | VARCHAR(50) | | | | HP14 / KEYENCE BT-A500 等 |
| location | VARCHAR(50) | | | | 配置場所 |
| active | BOOLEAN | | ✓ | true | |

---

### 9. `inspection_groups`（検品グループマスタ）

| カラム名 | 型 | PK | NOT NULL | デフォルト | 説明 |
|---------|-----|----|----------|-----------|------|
| id | VARCHAR(10) | PK | ✓ | | ABL等 |
| name | VARCHAR(20) | | ✓ | | グループ名 |
| tables | TEXT[] | | ✓ | {} | 所属テーブル |
| category | VARCHAR(20) | | ✓ | | main/sweet/meat/frozen/gift |
| need_staff | INTEGER | | ✓ | 1 | 必要人員数 |
| note | TEXT | | | | |

---

### 10. `std_times`（標準梱包時間マスタ）

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| code | VARCHAR(20) | PK | ✓ | | ST-ABL-A 等 |
| group_id | VARCHAR(10) | FK | ✓ | | |
| table_id | VARCHAR(5) | | ✓ | | |
| std_min | DECIMAL(5,2) | | ✓ | 2.00 | 標準時間（分/件） |
| source | VARCHAR(10) | | ✓ | 'manual' | manual/auto |
| updated_at | DATE | | ✓ | | |
| note | TEXT | | | | |

---

### 11. `shift_patterns`（シフトパターンマスタ） ★ 新規

| カラム名 | 型 | PK | NOT NULL | デフォルト | 説明 |
|---------|-----|----|----------|-----------|------|
| code | VARCHAR(10) | PK | ✓ | | G7/G6/A7/A6/B7/D7/E6/公休/有休 等 |
| name | VARCHAR(50) | | ✓ | | パターン名（フル表記） |
| start_time | VARCHAR(5) | | | | HH:MM（休系はNULL） |
| end_time | VARCHAR(5) | | | | HH:MM |
| break_min | INTEGER | | ✓ | 0 | 休憩（分） |
| is_off | BOOLEAN | | ✓ | false | 休系フラグ |
| sort_order | INTEGER | | ✓ | 0 | |
| active | BOOLEAN | | ✓ | true | |

> **編集可能。担当者マスタの選択肢に即反映される運用**

---

### 12. `employment_types`（雇用区分マスタ） ★ 新規

| カラム名 | 型 | PK | NOT NULL | デフォルト | 説明 |
|---------|-----|----|----------|-----------|------|
| code | VARCHAR(20) | PK | ✓ | | seishain_a / jun_8 / short / shokutaku 等 |
| name | VARCHAR(50) | | ✓ | | 正社員A / 準社員8h 等 |
| daily_hours | DECIMAL(4,2) | | ✓ | 8.00 | 日当たり標準稼働時間 |
| sort_order | INTEGER | | ✓ | 0 | |
| active | BOOLEAN | | ✓ | true | |

---

### 13. `shifts`（シフトマスタ） ★ 新規

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| id | SERIAL | PK | ✓ | | |
| date | DATE | | ✓ | | 対象日 |
| staff_code | VARCHAR(10) | FK→staff.code | ✓ | | |
| pattern_code | VARCHAR(10) | FK→shift_patterns.code | ✓ | | |
| start_time | VARCHAR(5) | | | | 個別調整時のHH:MM |
| end_time | VARCHAR(5) | | | | |
| source | VARCHAR(10) | | ✓ | 'manual' | manual/gp_csv |
| imported_at | TIMESTAMPTZ | | | | GPシフトCSV取込日時 |
| note | TEXT | | | | |

**ユニーク制約**: `(date, staff_code)`  
**インデックス**: `date`

---

### 14. `printers`（プリンターマスタ） ★ 新規

| カラム名 | 型 | PK | NOT NULL | デフォルト | 説明 |
|---------|-----|----|----------|-----------|------|
| code | VARCHAR(20) | PK | ✓ | | プリンター識別コード |
| name | VARCHAR(50) | | ✓ | | プリンター名 |
| ip_address | VARCHAR(15) | | ✓ | | 固定IPアドレス |
| port | INTEGER | | ✓ | 9100 | プリンタ接続ポート |
| model | VARCHAR(50) | | ✓ | 'SCeaTa CT4-LX' | 機種名 |
| location | VARCHAR(50) | | | | 配置場所 |
| label_size | VARCHAR(20) | | ✓ | '30x40' | ラベルサイズ |
| active | BOOLEAN | | ✓ | true | |
| note | TEXT | | | | |

**ユニーク制約**: `ip_address`

---

### 15. `device_printer_map`（端末×既定プリンター） ★ 新規

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| id | SERIAL | PK | ✓ | | |
| device_code | VARCHAR(20) | FK→devices.code UQ | ✓ | | 端末 |
| printer_code | VARCHAR(20) | FK→printers.code | ✓ | | 既定プリンター |
| updated_at | TIMESTAMPTZ | | ✓ | NOW() | |
| updated_by | VARCHAR(10) | | | | 設定担当者 |

---

### 16. `notices`（連絡事項）

| カラム名 | 型 | PK | NOT NULL | デフォルト | 説明 |
|---------|-----|----|----------|-----------|------|
| id | SERIAL | PK | ✓ | | |
| date | DATE | | ✓ | | 対象日 |
| title | VARCHAR(100) | | ✓ | | |
| body | TEXT | | | | |
| target_type | VARCHAR(10) | | ✓ | 'all' | all/group/table |
| target_id | VARCHAR(20) | | | | グループID/テーブルID |
| priority | INTEGER | | ✓ | 50 | |
| active | BOOLEAN | | ✓ | true | |
| created_at | TIMESTAMPTZ | | ✓ | NOW() | |

---

### 17. `shipping_orders`（出荷指示ヘッダ） ★ 拡張

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| id | UUID | PK | ✓ | gen_random_uuid() | |
| **pk_no** | **VARCHAR(30)** | **UQ** | **✓** | | **★ ピッキング№（一意・主キー扱い）** |
| import_id | INTEGER | FK→thomas_imports.id | | | 取込バッチID |
| ship_date | DATE | | ✓ | | 出荷予定日 |
| carrier_code | VARCHAR(20) | FK→carriers.code | ✓ | | |
| status | VARCHAR(20) | | ✓ | 'pending' | pending/inspecting/packed/shipped/held |
| **qr_print_flag** | **BOOLEAN** | | **✓** | **false** | **★ QR印刷フラグ（基幹「熨斗フラグ」を読み替え／検品画面で手動切替可）** |
| noshi_name | VARCHAR(50) | | | | のし名称 |
| dest_zip | VARCHAR(8) | | | | 配送先郵便番号 |
| dest_addr | VARCHAR(200) | | | | 配送先住所 |
| dest_name | VARCHAR(100) | | | | 配送先名 |
| **invoice_no** | **VARCHAR(30)** | | | | **★ 納品書№（重複可・QRエンコード値）** |
| hold_reason | TEXT | | | | 保留理由 |
| **deleted_at** | **TIMESTAMPTZ** | | | NULL | **★ 論理削除日時（NULL=有効）** |
| **deleted_by** | **VARCHAR(10)** | | | | **★ 削除実行担当者** |
| **delete_reason** | **TEXT** | | | | **★ 削除理由** |
| created_at | TIMESTAMPTZ | | ✓ | NOW() | |
| updated_at | TIMESTAMPTZ | | ✓ | NOW() | |

**インデックス**: `pk_no`（一意）, `(ship_date, status)`, `(deleted_at)`

> 通常の一覧では `WHERE deleted_at IS NULL` でフィルタする。論理削除されても1年保持→年次バッチで物理削除。

---

### 18. `shipping_order_items`（出荷指示明細）

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| id | SERIAL | PK | ✓ | | |
| order_id | UUID | FK→shipping_orders.id | ✓ | | |
| product_code | VARCHAR(20) | FK→products.code | ✓ | | |
| product_name | VARCHAR(100) | | ✓ | | 取込時点の名称（非正規化） |
| qty | INTEGER | | ✓ | | 指示数量 |
| scanned_qty | INTEGER | | ✓ | 0 | スキャン済 |
| force_ok | BOOLEAN | | ✓ | false | 強制OK |
| force_reason | TEXT | | | | 強制OK 理由 |
| sort_order | INTEGER | | ✓ | 0 | |

**ユニーク制約**: `(order_id, product_code)`

---

### 19. `insp_sessions`（検品セッション）

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| id | UUID | PK | ✓ | | |
| order_id | UUID | FK→shipping_orders.id UQ | ✓ | | |
| staff_code | VARCHAR(10) | FK→staff.code | ✓ | | |
| device_code | VARCHAR(20) | FK→devices.code | | | |
| started_at | TIMESTAMPTZ | | ✓ | NOW() | |
| completed_at | TIMESTAMPTZ | | | | NULL=未完了 |
| box_code | VARCHAR(30) | FK→boxes.code | | | |
| force_ok_count | INTEGER | | ✓ | 0 | |
| duration_sec | INTEGER | | | | 所要時間 |

---

### 20. `insp_logs`（検品操作ログ）

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| id | SERIAL | PK | ✓ | | |
| session_id | UUID | FK→insp_sessions.id | ✓ | | |
| type | VARCHAR(20) | | ✓ | | scan/force_ok/hold/complete/error/qr_flag_toggle |
| item_code | VARCHAR(20) | | | | スキャン値 |
| qty | INTEGER | | | | |
| note | TEXT | | | | エラー内容等 |
| created_at | TIMESTAMPTZ | | ✓ | NOW() | |

---

### 21. `thomas_imports`（基幹取込履歴）

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| id | SERIAL | PK | ✓ | | |
| filename | VARCHAR(200) | | ✓ | | |
| file_type | VARCHAR(20) | | ✓ | | products/orders/sort |
| imported_at | TIMESTAMPTZ | | ✓ | NOW() | |
| total_rows | INTEGER | | ✓ | 0 | |
| success_count | INTEGER | | ✓ | 0 | |
| error_count | INTEGER | | ✓ | 0 | |
| **jan_error_count** | **INTEGER** | | **✓** | **0** | **★ JAN形式不正件数（重複は対象外）** |
| unmap_count | INTEGER | | ✓ | 0 | |
| imported_by | VARCHAR(10) | FK→staff.code | | | |
| note | TEXT | | | | |

---

### 22. `alerts`（アラート管理）

| カラム名 | 型 | PK | NOT NULL | デフォルト | 説明 |
|---------|-----|----|----------|-----------|------|
| id | SERIAL | PK | ✓ | | |
| type | VARCHAR(30) | | ✓ | | unmap_product/jan_error/force_ok/delay/duplicate_pkno 等 |
| severity | VARCHAR(10) | | ✓ | 'warn' | warn/error/info |
| title | VARCHAR(100) | | ✓ | | |
| body | TEXT | | | | |
| ref_code | VARCHAR(50) | | | | 商品コード/PkNo等 |
| resolved | BOOLEAN | | ✓ | false | |
| resolved_at | TIMESTAMPTZ | | | | |
| resolved_by | VARCHAR(10) | | | | |
| created_at | TIMESTAMPTZ | | ✓ | NOW() | |

---

### 23. `member_assignments`（メンバー割当） ★ 新規

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| id | SERIAL | PK | ✓ | | |
| date | DATE | | ✓ | | 対象日 |
| staff_code | VARCHAR(10) | FK→staff.code | ✓ | | |
| group_id | VARCHAR(10) | FK→inspection_groups.id | ✓ | | グループ |
| start_time | VARCHAR(5) | | ✓ | | HH:MM（30分単位） |
| end_time | VARCHAR(5) | | ✓ | | HH:MM |
| created_at | TIMESTAMPTZ | | ✓ | NOW() | |
| updated_at | TIMESTAMPTZ | | ✓ | NOW() | |
| created_by | VARCHAR(10) | | | | 設定担当者 |

**インデックス**: `(date, staff_code)`, `(date, group_id)`

> Gantt UI で30分単位ドラッグ操作。保存時にこのテーブルへ全件書き込み。

---

### 24. `print_logs`（QR印刷履歴） ★ 新規

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| id | SERIAL | PK | ✓ | | |
| order_id | UUID | FK→shipping_orders.id | ✓ | | |
| pk_no | VARCHAR(30) | | ✓ | | ピッキング№（参照用） |
| invoice_no | VARCHAR(30) | | | | 納品書№（QRエンコード値） |
| printer_code | VARCHAR(20) | FK→printers.code | ✓ | | 出力プリンター |
| device_code | VARCHAR(20) | FK→devices.code | | | 印刷指示元端末 |
| staff_code | VARCHAR(10) | FK→staff.code | | | 印刷指示者 |
| printed_at | TIMESTAMPTZ | | ✓ | NOW() | 印刷時刻 |
| is_reprint | BOOLEAN | | ✓ | false | 再印刷フラグ |
| status | VARCHAR(10) | | ✓ | 'success' | success/failed |
| error_msg | TEXT | | | | 失敗時のエラー |

---

### 25. `order_audit_logs`（伝票監査ログ） ★ 新規

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| id | SERIAL | PK | ✓ | | |
| order_id | UUID | FK→shipping_orders.id | ✓ | | |
| pk_no | VARCHAR(30) | | ✓ | | |
| action | VARCHAR(20) | | ✓ | | delete/restore/edit/qr_flag_change |
| acted_by | VARCHAR(10) | FK→staff.code | ✓ | | 実行者 |
| acted_at | TIMESTAMPTZ | | ✓ | NOW() | 実行時刻 |
| reason | TEXT | | | | 理由 |
| diff | JSONB | | | | 変更差分（before/after） |

**インデックス**: `(order_id)`, `(acted_at)`

---

### 26. `users`（認証ユーザー：管理PC用）

| カラム名 | 型 | PK/FK | NOT NULL | デフォルト | 説明 |
|---------|-----|-------|----------|-----------|------|
| id | UUID | PK | ✓ | gen_random_uuid() | |
| staff_code | VARCHAR(10) | FK→staff.code UQ | | | |
| email | VARCHAR(100) | UQ | ✓ | | ログインID（メール） |
| password_hash | VARCHAR(200) | | ✓ | | bcrypt |
| role | VARCHAR(20) | | ✓ | 'staff' | admin/manager/staff |
| active | BOOLEAN | | ✓ | true | |
| last_login | TIMESTAMPTZ | | | | |
| created_at | TIMESTAMPTZ | | ✓ | NOW() | |

> **管理PC専用**：タブレット/ハンディは `staff.emp_code` のみで認証するため、users テーブルには登録不要。

---

## ER図（主要関連）

```
products ────── product_aux_attrs (1:1)
   │
   ├── set_comps ─── set_comp_children
   │       └── boxes (固定箱)
   │
shipping_orders ──── shipping_order_items
   │   ├── carriers
   │   ├── insp_sessions ── insp_logs
   │   ├── print_logs (QR印刷履歴)
   │   └── order_audit_logs (削除/復活/編集)
   │
staff ─── shifts ─── shift_patterns
   │   └── member_assignments ── inspection_groups
   │   └── employment_types
   │
devices ─── device_printer_map ─── printers
   │
users (管理PCログイン用)
```

---

## 初期データ（シード）

モックHTML / GPシフトCSV / 設計メモv2.1から取込：

- `products`：50件（MST_PRODUCT）
- `product_aux_attrs`：12件
- `set_comps` + `set_comp_children`：7件
- `boxes`：17件
- `carriers`：5件
- `staff`：43件（うちGPシフト連携 24名 / `emp_code` 必須）
- `inspection_groups`：7グループ
- `shift_patterns`：15パターン（G7/G6/A7/A6/A4/A3/B7/D7/D6/E6/公休/有休/希休/特休/欠勤）
- `employment_types`：8区分
- `shifts`：720行（GPシフトCSV取込）
- `printers`：6台（SCeaTa CT4-LX 各IP）
- `device_printer_map`：15件（タブレット10+ハンディ5）

---

## マイグレーション順序

1. マスタ系（依存なし）：`products`, `boxes`, `carriers`, `inspection_groups`, `shift_patterns`, `employment_types`, `printers`
2. 担当者系：`staff` (emp_code) → `devices` → `device_printer_map`
3. 商品関連：`product_aux_attrs`, `set_comps`, `set_comp_children`, `std_times`
4. シフト：`shifts`
5. 取込・伝票：`thomas_imports` → `shipping_orders` → `shipping_order_items`
6. 検品：`insp_sessions` → `insp_logs` → `print_logs` → `order_audit_logs`
7. その他：`alerts`, `notices`, `member_assignments`
8. 認証：`users`, `sessions`
