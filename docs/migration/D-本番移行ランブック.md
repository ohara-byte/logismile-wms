# D. 本番移行ランブック（決定版・2026-06-04）

現場最終テスト完了 → Xserver VPS 本番移行。本書は確定した構成での手順書。
（補足：詳細は B-tailscale-setup.md / C-xserver-docker-compose-design.md も参照）

## 確定した構成・方針

| 項目 | 決定 |
|---|---|
| WMS 稼働場所 | **Xserver VPS**（グループウェア・製造管理と同居、Docker 分離） |
| ミニPC（ASUS PN64-S5353AD） | **VPN中継 + 印刷リレー専用**（Tailscale サブネットルータ）。DR スタンバイは行わない |
| タブレット/ハンディ → WMS | **パブリック HTTPS + 固定IP制限**（事務所の固定グローバルIPのみ許可） |
| VPS → プリンタ | **Tailscale 経由**（ミニPCが 192.168.1.0/24 を VPN 内へ公開） |
| 事務所回線 | **固定グローバルIP あり** |

```
[タブレット/ハンディ] --HTTPS(固定IP許可)--> Caddy --> WMS(VPS)
                                                          │ Tailscale
                                                          ▼
                                            ミニPC PN64 (subnet router)
                                                          │ 192.168.1.0/24
                                                          ▼
                                                  プリンタ×6 (CT4-LX)
```

---

## Phase 1：ミニPC（PN64）セットアップ ★現場で実施

1. **初期設定**：Win11 Pro セットアップ、Windows Update 最新化、コンピュータ名を `wms-relay` 等に。
2. **固定ローカルIP**：ミニPCに倉庫LANの固定IP（例 192.168.1.250）を割当（ルータのDHCP予約 or 静的設定）。
3. **スリープ/省電力 無効化**（24/7 常駐）：
   ```powershell
   powercfg /change standby-timeout-ac 0
   powercfg /change hibernate-timeout-ac 0
   powercfg /change monitor-timeout-ac 0
   ```
   - 設定 → Windows Update → 詳細 → アクティブ時間を広く（勝手な再起動防止）
4. **Tailscale 導入**：https://tailscale.com/download/windows → インストール → サインイン（@oenosato.net 推奨）。デバイス名 `wms-relay`。
5. **サブネットルータ化**（管理者 PowerShell）：
   ```powershell
   tailscale up --advertise-routes=192.168.1.0/24 --accept-routes
   ```
6. **管理画面でルート承認**：https://login.tailscale.com/admin/machines → `wms-relay` → Edit route settings → `192.168.1.0/24` を承認。
7. **サービス自動起動確認**：`Get-Service Tailscale`（Running・自動）。再起動後も常駐すること。
8. **電源運用**：UPS 接続を推奨（停電時の中継維持）。自動ログオン or サービス運用で再起動後も無人復帰できるように。

**Phase 1 完了条件**：別PCから Tailscale 参加 → `ping 192.168.1.<プリンタIP>` が通る／`nc -zv <プリンタIP> 9100` 成功。

## Phase 2：Xserver VPS セットアップ

1. OS 更新、Docker / Docker Compose 導入、ufw + fail2ban、SSH 鍵認証のみ（C 文書 §9）。
2. Tailscale 導入：`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`。デバイス名 `wms-vps`。→ これで VPS から 192.168.1.x プリンタへ到達可能に。
3. Caddy + Postgres + WMS の docker-compose 配置（C 文書 §3-4）。
4. `.env.production` 投入（下記 Phase 3 の値）。
5. `docker compose up -d` → `docker compose exec wms npx prisma migrate deploy`。

## Phase 3：DNS・IP制限・プリンタ・シークレット

1. **DNS**（Xserver 管理画面）：`logismile.oenosato.net` A レコード → VPS グローバルIP。（必要なら `stg-logismile` も）
2. **IP制限（最重要）**：`.env.production` の `INTRANET_CIDR_LIST` に **事務所の固定グローバルIP** を設定。
   ```
   INTRANET_CIDR_LIST="<事務所の固定グローバルIP>/32,100.64.0.0/10,127.0.0.1/32"
   ```
   - `100.64.0.0/10` は Tailscale 帯（在宅管理者が VPN で入る場合用。不要なら外す）。
   - Caddy が `X-Forwarded-For` に実クライアントIP（=事務所のNAT外側IP）を載せるため、アプリの IP 判定（`clientIpFromHeaders`）が機能する。
   - 念のため Caddy / ufw でも 443 を事務所IP優先に絞ると多層防御になる（グループウェア等と共用なら app 層の制限で十分）。
3. **NEXTAUTH_URL**：`https://logismile.oenosato.net`。`NEXTAUTH_SECRET` は本番ランダム値（弱い値だと起動拒否）。
4. **プリンタマスタ**：プリンタIP（192.168.1.x）を確認。VPS から Tailscale 経由で到達するので **IPはそのまま**でOK。`PRINTER_DRY_RUN="false"`。
5. **製造連携シークレット**：`docs/secrets/` の本番分を `FACTORY_INBOUND_HMAC_SECRET` / `FACTORY_OUTBOUND_HMAC_SECRET` / `FACTORY_WEBHOOK_SECRET` に投入。連携を有効化するなら `FACTORY_INTEGRATION_MODE="factory_api"` + `FACTORY_DRY_RUN` を運用に合わせて。

## Phase 4：データ移行（マスタ）

現テスト運用PC（このPC）の Postgres には、調整済みマスタ（商品・運送会社・便種マッピング・グループ構成・担当者・端末・プリンタ・のし除外/QR強制 等）が入っている。**マスタは移行、出荷指示（shipping_orders）は本番取込で作り直し**を推奨。

1. 現PCでマスタを含む dump：
   ```bash
   docker exec wms_db pg_dump -U wms_user -d wms_db --data-only \
     -t products -t carriers -t carrier_aliases -t inspection_groups -t staff \
     -t devices -t printers -t device_printer_map -t boxes -t employment_types \
     -t shift_patterns -t noshi_exclusions -t qr_force_keywords -t users -t std_times \
     > masters.sql
   ```
   （テーブル名は schema の @@map に合わせて最終確認）
2. VPS で `migrate deploy`（空スキーマ作成）→ `psql < masters.sql` で投入。
3. **出荷指示は移行しない**（本番初日に Thomas CSV を取り込む）。在庫(stocks)・割当(allocations)・検品(insp_*)・印刷ログ等の運用データも移行不要。
4. 投入後、`staff` と `users` の **staffCode リンク**を確認（後述チェックリスト）。

> ※ 全件まるごと移したい場合は full dump も可。ただしテストの出荷指示・誤完了データが混ざるため、マスタのみ推奨。
> ※ `--data-only` の復元は FK 依存順（staff→users、carriers→carrier_aliases、devices/printers→device_printer_map 等）で失敗し得る。
>   その場合は復元時に `psql -c "SET session_replication_role = replica;"`（トリガ/FK一時無効）を使うか、`pg_restore --disable-triggers`、
>   または full dump（スキーマ含む）での移行に切替える。テーブル名は schema の @@map で最終確認済み（products/carriers/carrier_aliases/
>   inspection_groups/staff/devices/printers/device_printer_map/boxes/employment_types/shift_patterns/noshi_exclusions/qr_force_keywords/users/std_times）。

## Phase 5：本番前チェックリスト（コード以外）

- [ ] 全 PC ユーザー（users）の `staffCode` が staff にリンク済み（未リンクだと削除/保留/検品戻し/監査が 403/500。バグレビュー A-1/A-2 の前提）
- [ ] `INTRANET_CIDR_LIST` に事務所固定IPを設定（未設定だと **全許可**になる）
- [ ] `NEXTAUTH_SECRET` 本番ランダム値
- [ ] `PRINTER_DRY_RUN=false` / プリンタIP到達確認（Tailscale経由）
- [ ] DNS 伝播確認（`nslookup logismile.oenosato.net`）
- [ ] Caddy で Let's Encrypt 証明書取得（HTTPS）
- [ ] バックアップ（rclone → Google Drive）の cron 稼働確認（C 文書 §6）
- [ ] `cpus:1`（next.config）でビルド成功すること（Windows特有のビルドクラッシュ回避済。Linux VPS では影響なし＝外してもOK）

## Phase 6：切替当日・検証・ロールバック

### 検証（go-live前にVPSで）
1. **疎通**：VPS から `ping`/`nc -zv <プリンタIP> 9100` 成功
2. **タブレット/ハンディ実機**：事務所LANから `https://logismile.oenosato.net` にログイン → ピッキング№スキャン → 商品検品 → 納品書スキャン → 完了 → 印刷確認 → **実プリンタから印字**
3. **★ スキャン遅延の体感確認**（重要）：WMS がクラウド(VPS)になるため各スキャンがインターネット往復になる。Xserver は国内なので往復 ~10-30ms 想定だが、**実機で連続スキャンの体感を必ず確認**。④ の軽量化（ローカル更新・全件再取得廃止）が効くはず。遅い場合は回線品質を確認。
4. **出荷照合**：総件数が実数表示（1000で頭打ちにならない）
5. **IP制限**：事務所外（スマホ4G等）から `logismile.oenosato.net` にアクセス → **弾かれる**こと

### ロールバック
- 不調時は DNS を現テスト運用PC（192.168.1.139）へ戻す or 旧運用に復帰。Postgres は移行前にバックアップ必須。
- 印刷不調時は Tailscale `tailscale status` / ルート承認 / プリンタIP を確認（B 文書 §7）。

---

## 推奨スケジュール
1. **今日〜**：ミニPC（PN64）Phase 1 セットアップ + Tailscale 疎通
2. VPS Phase 2-3 構築（Docker/Caddy/WMS/Tailscale/DNS/IP制限）
3. マスタ移行（Phase 4）+ チェックリスト（Phase 5）
4. 検証（Phase 6）→ 問題なければ本番切替
