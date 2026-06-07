# LogiSmile（WMS）デプロイ仕様書 — 製造チーム向け

**版**：2026-06-06　**発行**：オエノサト（ohara@oenosato.net）
**宛先**：製造システム（CraftSmile）構築チーム
**目的**：共用 Xserver VPS 上への **LogiSmile（倉庫管理システム / WMS）** デプロイを、製造チームに実施いただくための引き渡し資料。
CraftSmile（製造管理）と **API 連携する相手システム**であり、同一 VPS 上に同居するため、本書1冊で構築〜連携確認まで完結できるようまとめています。

> 🔐 **秘密情報は本書に含みません。** パスワード・HMAC シークレット・秘密鍵は別途安全な手段で受け渡します（チャット貼付禁止）。

---

## 0. 全体像

```
インターネット
   │  https://logismile.oenosato.net （SSL/Caddyは設定済）
   ▼
Caddy(443) ──► 127.0.0.1:3001 (LogiSmile / 本システム)   ← 今回構築するもの
           ──► 127.0.0.1:3002 (CraftSmile / 製造管理)     ← 既存（御社構築済）
           ──► 127.0.0.1:3003 (OENO Groupware)            ← 既存
                          │
LogiSmile ──Tailscale──► 倉庫LAN 192.168.1.0/24 ──► QRラベルプリンタ SCeaTa CT4-LX ×6
          （ミニPC oenosato-mini01 がサブネットルータとして公開済）

LogiSmile ◄──HMAC API──► CraftSmile （納品/検品完了の双方向連携）
```

- 公開 URL・DNS・SSL・リバースプロキシ（Caddy）は **GW チームが設定済**。
- LogiSmile は **127.0.0.1:3001 でプレーン HTTP を listen するだけ**で公開 URL に反映されます。
- プリンタは VPS から **Tailscale 経由**で倉庫LANに到達します（ミニPCが 192.168.1.0/24 を公開済）。

---

## 1. システム概要

| 項目 | 内容 |
|---|---|
| 名称 | LogiSmile（大江ノ郷自然牧場 WMS / 倉庫管理システム） |
| 役割 | 出荷検品（サンドイッチ方式）・QRラベル印刷・進捗ダッシュボード・基幹(Thomas)CSV取込 |
| 技術スタック | Next.js 14.2 (App Router) / React 18 / TypeScript 5 / NextAuth 4 |
| データベース | PostgreSQL 16（Prisma 5.22） |
| 実行 | Node.js 20 LTS / Docker + docker compose v2 |
| 規模 | 1日 2,000〜3,000 件（将来 4,000〜5,000） |
| 利用端末 | 管理PC / タブレット(HP14) / ハンディ(KEYENCE BT-A500) / プリンタ(SCeaTa CT4-LX×6) |

---

## 2. デプロイ構成（共用 VPS / GW 規約準拠）

| 項目 | 値 |
|---|---|
| VPS | Xserver VPS Business（Ubuntu 24.04 / グローバルIP `85.131.250.41`） |
| SSH | ポート22・**鍵認証のみ**・ユーザー `deploy`（sudo可） |
| 配備ディレクトリ | `/var/www/logismile` |
| アプリ listen 先 | **`127.0.0.1:3001`（HTTP）** ← Caddy がここへプロキシ |
| 公開 URL | `https://logismile.oenosato.net`（SSL自動・Caddy管理） |
| アクセスログ | `/var/log/caddy/logismile-access.log`（Caddy 側） |

### 共用サーバー厳守ルール（GW チーム規約）
1. **自分の割当ディレクトリ・割当ポート以外に触れない**（他アプリのコンテナ/ボリューム操作禁止）。
2. **`/etc/caddy/Caddyfile` を変更しない**（IP制限・パス追加等は ohara 経由で管理者へ依頼）。
3. **使用済みホストポート禁止**：3001(本件)/3002(CraftSmile)/3003(Groupware)/3307(MySQL)/6380(Redis)/2019(Caddy admin)。
4. コンテナ/ネットワーク/ボリューム名は **`logismile_` プレフィックス**（本リポジトリの compose 対応済）。
5. **80/443 を bind しない**。ホスト公開は **必ず `127.0.0.1` バインド**。
6. DB・Redis 等は **ホストへ expose せず compose 内部ネットで完結**（本 compose 対応済）。
7. RAM は **1アプリ 3GB 以内**目安（本 compose: app 2g + db 768m）。
8. **`/healthz` は Caddy 予約**（アプリに届かない）。アプリの死活は別パス（後述 §8）。
9. サーバー再起動・OS更新・ufw 変更など **全体影響操作は管理者(ohara/GW)のみ**。

---

## 3. リポジトリ同梱の成果物（構築用）

本システムのリポジトリには、本番デプロイ用ファイルを同梱済みです。**追加でビルド定義を書く必要はありません。**

| ファイル | 役割 |
|---|---|
| `Dockerfile` | Next.js + Prisma 本番イメージ（マルチステージ / Linux クエリエンジン同梱 / 起動時 `prisma migrate deploy`） |
| `docker-compose.vps.yml` | `logismile_app`(127.0.0.1:3001) + `logismile_db`(内部のみ)。命名・RAM上限・規約準拠 |
| `.env.vps.example` | 本番 `.env` テンプレート（プレースホルダのみ。実値はサーバー上で投入） |
| `.dockerignore` | 秘密/不要物をビルドコンテキストから除外 |
| `prisma/schema.prisma` | `binaryTargets = ["native","debian-openssl-3.0.x"]`（Linux 実行に必須・設定済） |
| `docs/migration/E-vps-deploy.md` | 詳細デプロイ手順（社内向け原本。本書はその要約＋連携情報） |

> ⚠️ ビルドは DB 接続不要（Prisma generate / next build は DB に接続しません）。

---

## 4. 事前手配（オエノサト ⇄ 製造チーム）

構築開始前に以下を受け渡し・合意してください。

| # | 項目 | 受け渡し方法 | 備考 |
|---|---|---|---|
| 1 | **SSH 公開鍵の登録** | 製造チームの ed25519 公開鍵を ohara へ → `deploy` に登録 | CraftSmile で既に `deploy` 利用中なら流用可 |
| 2 | **WMS ソースコード提供** | 後述（§4-1） | 現状 Git リモート未設定 |
| 3 | **HMAC シークレット**（連携用） | 安全な手段で別途（本書記載なし） | `FACTORY_*`（§7） |
| 4 | **NEXTAUTH_SECRET / DB パスワード** | サーバー上で生成（製造チーム実施可） | `openssl rand` で生成 |
| 5 | **事務所固定グローバルIP**（IP制限用） | ohara から通知 | `INTRANET_CIDR_LIST` に設定 |
| 6 | **プリンタIP一覧 / Tailscale 招待** | ohara から（ミニPCがルータ稼働済） | §6 |

### 4-1. ソースコード提供方法（要決定）
現在リポジトリは社内PCローカルのみ（Git リモート未設定）。以下いずれかで提供します:
- **(推奨) Git ホスティングへ push**（GitHub/GitLab 等）→ 製造チームに read 権限付与 → サーバーで `git clone`。以後の更新も pull で容易。
- **コードバンドル提供**：`git archive` の zip/tar をセキュアに受け渡し → サーバーで展開。

---

## 5. デプロイ手順（VPS 上・ターミナル）

```bash
# 1) SSH 接続（登録した鍵で）
ssh deploy@85.131.250.41

# 2) 配備ディレクトリへ取得
sudo mkdir -p /var/www/logismile && sudo chown deploy:deploy /var/www/logismile
cd /var/www/logismile
git clone <提供されたリポジトリURL> .      # または受領した bundle を展開

# 3) 本番 .env を作成（テンプレートから。実値はここで直接入力＝コミットしない）
cp .env.vps.example .env
nano .env
#   - POSTGRES_PASSWORD と DATABASE_URL のパスワードを一致させる（openssl rand -base64 24）
#   - NEXTAUTH_SECRET   = openssl rand -base64 32
#   - NEXTAUTH_URL      = https://logismile.oenosato.net
#   - INTRANET_CIDR_LIST に事務所固定グローバルIP/32 を設定（未設定=全許可になるので必須）
#   - FACTORY_* は受領したシークレットを投入（連携有効化時。当面 legacy 可）

# 4) ビルド & 起動（初回はイメージビルドに数分）
docker compose -f docker-compose.vps.yml up -d --build

# 5) 確認
docker compose -f docker-compose.vps.yml ps                 # app/db が healthy/up
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/   # 200/302 が返ればOK
curl -s http://127.0.0.1:3001/api/health                    # {"status":"ok","db":"connected"}
```

- 起動時に `prisma migrate deploy` が自動実行され、空DBにスキーマが作られます。
- Caddy が `127.0.0.1:3001` をプロキシ済なので、ブラウザで `https://logismile.oenosato.net` が実アプリに切替わります。
- **プロキシ信頼**：アプリは `X-Forwarded-For/Proto` を参照して実クライアントIPとhttpsを判定します。`NEXTAUTH_URL=https://...` を設定済なら URL も正しく https で生成されます（追加設定不要）。

---

## 6. プリンタ到達（VPS に Tailscale）

QRラベルプリンタ（倉庫LAN `192.168.1.x`）へ VPS から到達するため、VPS を Tailnet に参加させ、ミニPCが公開する経路を受け取ります。

```bash
# VPS 上で（ルート追加は影響軽微。管理者操作）
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --accept-routes --hostname=logismile-vps
# → 管理コンソールで logismile-vps を承認
ip route | grep 192.168.1        # tailscale 経由の経路が出ること
nc -zv 192.168.1.<プリンタIP> 9100   # 各プリンタの 9100/tcp に到達できること
```

- Docker コンテナの外向き通信はホスト経路表を使うため、**コンテナ側追加設定は不要**（compose 内部ネットは 172.x で衝突なし）。
- プリンタIPは WMS の「プリンタマスタ」で管理。**IPはそのまま**で到達します（`PRINTER_DRY_RUN="false"`）。

---

## 7. API 連携仕様（LogiSmile ⇄ CraftSmile）

HMAC-SHA256 署名による双方向連携。**詳細フィールド定義は別添「製造WMS連携IF仕様書 v0.2」を正とします**。本節はサーバー設定・疎通に必要な要点のみ。

### 7-1. 方向とエンドポイント

| 方向 | エンドポイント（LogiSmile 側） | メソッド | 署名ヘッダ | 検証/署名に使う鍵 |
|---|---|---|---|---|
| 製造 → WMS（納品予定） | `/api/integration/factory/delivery` | POST | `X-Factory-Signature` / `X-Factory-Timestamp` | `FACTORY_INBOUND_HMAC_SECRET` |
| 製造 → WMS（納品完了） | `/api/integration/factory/delivery-complete` | POST | 同上 | 同上 |
| 製造 → WMS（受注照会） | `/api/integration/factory/orders` | GET | 同上 | 同上 |
| WMS → 製造（検品完了通知） | （WMS が製造の Webhook へ送信） | POST | `X-WMS-Signature` / `X-WMS-Timestamp` / `Idempotency-Key` | `FACTORY_OUTBOUND_HMAC_SECRET` |
| 疎通確認（無認証） | `/api/integration/factory/health` | GET | なし | — （`{mode, wmsVersion, serverTime}` を返す） |

- **inbound**（製造→WMS）：製造側が `FACTORY_INBOUND_HMAC_SECRET` で body を署名 → `X-Factory-Signature` に載せる → WMS が同鍵で検証。
- **outbound**（WMS→製造）：WMS が `FACTORY_OUTBOUND_HMAC_SECRET` で署名 → `X-WMS-Signature`。製造側は同鍵で検証（製造側キー名 `WMS_TO_FACTORY_SECRET` と**同一値**）。
- 鍵は inbound / outbound で**別々**。両者は事前共有した同一値を双方が保持します。

### 7-2. 連携モードの段階導入
`.env` の `FACTORY_INTEGRATION_MODE` で切替：
- `legacy`（既定）：従来動作。連携 inbound は受けるが受注生産は内部プールから引当。
- `factory_api`：製造連携モード（納品API → 在庫加算 → 自動引当）。疎通確認後に切替。
- `FACTORY_DRY_RUN="true"` の間は WMS→製造 の送信を行わず log のみ（テスト）。本番疎通後 `false`。

> 連携の詳細フィールド・エラーコード・リトライ方針は別添 IF 仕様書 v0.2 を参照。
> 既往の連携修正合意は `docs/integration/WMS回答_連携修正依頼_2026-06-01.md` 参照。

---

## 8. ヘルスチェック / 監視

| パス | 用途 | 認証 | 返却 |
|---|---|---|---|
| `/healthz` | **Caddy 予約**（アプリに届かない） | — | Caddy が常に 200 "ok" |
| `/api/health` | アプリ＋DB死活（推奨の死活監視先） | なし | `{status:"ok",db:"connected"}` |
| `/api/integration/factory/health` | 連携モード状態 | なし | `{mode,wmsVersion,serverTime}` |

- compose に死活監視を足す場合は **`/api/health`** を利用（`/healthz` は使わない）。
- ログはコンテナ内（`docker compose logs app`）。肥大化対策のローテーションは自アプリ配下で。

---

## 9. データ移行（マスタ）

調整済みマスタのみ移行。出荷指示・在庫・検品などの運用データは移行せず本番初日にCSV取込。

```bash
# 現テスト運用機（オエノサト側）で data-only dump（オエノサトが実施・受け渡し）
docker exec wms_db pg_dump -U wms_user -d wms_db --data-only \
  -t products -t carriers -t carrier_aliases -t inspection_groups -t staff \
  -t devices -t printers -t device_printer_map -t boxes -t employment_types \
  -t shift_patterns -t noshi_exclusions -t qr_force_keywords -t users -t std_times \
  > masters.sql

# VPS 側で投入（FK依存順エラー回避に replica ロール）
docker compose -f docker-compose.vps.yml exec -T db \
  psql -U wms_user -d wms_db -c "SET session_replication_role = replica;" -f - < masters.sql
```
> 投入後、`staff`↔`users` の staffCode リンクを必ず確認（未リンクだと削除/保留/検品戻し/監査が 403/500）。

---

## 10. 本番前チェックリスト

- [ ] SSH 公開鍵が `deploy` に登録され、製造チームが接続可能
- [ ] WMS ソースコードを取得済（clone / bundle）
- [ ] `.env` 作成：`POSTGRES_PASSWORD`/`DATABASE_URL` 一致・`NEXTAUTH_SECRET` 本番乱数・`NEXTAUTH_URL=https://logismile.oenosato.net`
- [ ] `INTRANET_CIDR_LIST` に事務所固定グローバルIP（**未設定＝全許可**）
- [ ] `docker compose ps` で app/db が healthy・`restart: always`
- [ ] `https://logismile.oenosato.net` がブラウザ表示・ログイン可
- [ ] VPS に Tailscale 導入＋経路承認、`nc -zv <プリンタIP> 9100` 成功、`PRINTER_DRY_RUN=false`
- [ ] マスタ投入＋ staff↔users リンク確認
- [ ] 連携：`/api/integration/factory/health` が 200・HMAC 疎通（DRY_RUN で署名検証）
- [ ] （任意）Caddy 側 IP 制限を ohara 経由で管理者へ依頼（多層防御）

---

## 11. go-live 検証

1. 事務所LANから `https://logismile.oenosato.net` ログイン → ピッキング№→商品→納品書№→検品完了→印刷確認→**実プリンタ印字**
2. 事務所外（4G等）からアクセス → **IP制限で弾かれる**こと
3. 出荷照合の総件数が実数表示（頭打ちしない）
4. 連携：製造→WMS の納品API・WMS→製造 の検品完了通知が HMAC 検証込みで疎通
5. スキャン体感（クラウド往復。国内VPSで ~10-30ms 想定）

---

## 12. 連絡先

| 用途 | 窓口 |
|---|---|
| SSH鍵登録・Caddy/ポート/IP制限・サーバー全般 | ohara@oenosato.net（管理者経由でGWへ） |
| WMS 仕様・連携・マスタ・ソース提供 | ohara@oenosato.net（オエノサト） |
| 別添：製造WMS連携IF仕様書 v0.2 / HMACシークレット | 別途安全な手段で受け渡し |
