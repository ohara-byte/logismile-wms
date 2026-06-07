# E. VPS 本番デプロイ手順（GW引き継ぎ資料 整合版・2026-06-06）

GWチームの `deploy-handover-logismile-craftsmile.md` を正として、**実際のVPS構成に合わせた**
LogiSmile WMS デプロイ手順。D-本番移行ランブックの Phase 2-6 を本書で上書きする。

## 前提（引き継ぎ資料からの確定事項）

| 項目 | 値 / 方針 |
|---|---|
| VPS | Xserver Business 12GB / Ubuntu 24.04 / グローバルIP `85.131.250.41` |
| 公開URL | `https://logismile.oenosato.net`（**DNS・SSL・Caddy 設定済**＝我々の作業不要） |
| SSH | 鍵認証のみ・ユーザー `deploy`（sudo可）。公開鍵を ohara@oenosato.net へ |
| アプリ待受 | **127.0.0.1:3001（HTTP）**。Caddy が https を終端しここへプロキシ |
| 80/443 | bind 禁止（Caddy 使用中） |
| DB/Redis | compose 内部ネットで完結。**ホストにポート公開しない** |
| RAM | 1アプリ **3GB 以内**目安（本compose: app 2g + db 768m） |
| `/healthz` | **Caddy 予約**（アプリに届かない）。WMS の health は `/api/integration/factory/health`＝衝突なし |
| プロキシ | Caddy が `X-Forwarded-For/Proto` 付与 → アプリの IP 判定が機能 |
| 命名 | コンテナ/ネット/ボリュームは **logismile_** 前置（本compose対応済） |
| Caddyfile | **編集禁止**（変更は ohara に依頼） |

## 本リポジトリに追加済みの成果物
- `Dockerfile` … Next.js + Prisma 本番イメージ（Linuxエンジン同梱、起動時 `prisma migrate deploy`）
- `docker-compose.vps.yml` … `logismile_app`(127.0.0.1:3001) + `logismile_db`(内部)、RAM上限・命名規約準拠
- `.env.vps.example` … 本番 .env テンプレート（プレースホルダのみ。実値はVPS上で投入）
- `.dockerignore` … 秘密/不要物をビルドコンテキストから除外
- `prisma/schema.prisma` … `binaryTargets = ["native", "debian-openssl-3.0.x"]` 追加済

---

## Phase 2-A：SSH アクセス取得（入口）

1. 開発/管理PCで ed25519 鍵を生成（未作成なら）:
   ```bash
   ssh-keygen -t ed25519 -C "logismile-deploy" -f ~/.ssh/logismile_vps
   ```
2. **公開鍵**（`~/.ssh/logismile_vps.pub`）を ohara@oenosato.net に送付 → `deploy` ユーザーに登録。
   （※ 秘密鍵 `logismile_vps` は絶対に共有しない）
3. 接続確認:
   ```bash
   ssh -i ~/.ssh/logismile_vps deploy@85.131.250.41
   ```

## Phase 2-B：VPS が倉庫プリンタへ到達できるようにする（Tailscale）

ミニPC（`oenosato-mini01` / 100.96.133.28）が `192.168.1.0/24` を公開済。VPS をテイルネットに参加させ
ルートを受け取ると、VPS（およびその上の Docker コンテナ）が `192.168.1.x` のプリンタへ到達できる。

```bash
# VPS 上で（管理者=ohara 操作。ルート追加は影響軽微）
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --accept-routes --hostname=logismile-vps
```
- 管理コンソール（login.tailscale.com/admin/machines）で `logismile-vps` を承認。
- 確認: `ip route | grep 192.168.1` に tailscale 経由の経路が出る → `ping 192.168.1.<プリンタIP>`。
- Docker コンテナの外向き通信はホストの経路表を使うため、**コンテナ側の追加設定は不要**
  （compose 内部ネットは 172.x。`192.168.1.x` と衝突しない）。

## Phase 2-C：WMS デプロイ

```bash
# 1) 配置（GW が用意した置き場へ。例: /var/www/logismile）
sudo mkdir -p /var/www/logismile && sudo chown deploy:deploy /var/www/logismile
git clone <repo-url> /var/www/logismile
cd /var/www/logismile

# 2) 本番 .env を作成（テンプレートから。実値はここで直接入力）
cp .env.vps.example .env
nano .env
#   - POSTGRES_PASSWORD と DATABASE_URL のパスワードを一致させる
#   - NEXTAUTH_SECRET = openssl rand -base64 32
#   - INTRANET_CIDR_LIST に事務所固定グローバルIP/32 を設定（最重要・未設定=全許可）
#   - FACTORY_* は docs/secrets の本番分（連携有効化時）

# 3) ビルド & 起動（初回はイメージビルドに数分）
docker compose -f docker-compose.vps.yml up -d --build

# 4) 状態確認
docker compose -f docker-compose.vps.yml ps        # app/db が healthy/up
docker compose -f docker-compose.vps.yml logs -f app
curl -s http://127.0.0.1:3001/ -o /dev/null -w "%{http_code}\n"   # 200/302 が返ればOK
```
- 起動時に `prisma migrate deploy` が走り、空DBへスキーマが作られる。
- Caddy が `https://logismile.oenosato.net` → `127.0.0.1:3001` をプロキシ済なら、ブラウザで疎通確認。

## Phase 2-D：マスタ移行（テスト運用PC → VPS）

調整済みマスタのみ移行。出荷指示・在庫・検品などの運用データは移行しない（本番初日にCSV取込）。

```bash
# 現テスト運用PC（このPC）で data-only dump
docker exec wms_db pg_dump -U wms_user -d wms_db --data-only \
  -t products -t carriers -t carrier_aliases -t inspection_groups -t staff \
  -t devices -t printers -t device_printer_map -t boxes -t employment_types \
  -t shift_patterns -t noshi_exclusions -t qr_force_keywords -t users -t std_times \
  > masters.sql

# VPS へ転送 → 投入（FK 依存順エラー回避に replica ロール）
scp -i ~/.ssh/logismile_vps masters.sql deploy@85.131.250.41:/var/www/logismile/
# VPS 上で:
docker compose -f docker-compose.vps.yml exec -T db \
  psql -U wms_user -d wms_db -c "SET session_replication_role = replica;" -f - < masters.sql
```
> FK 順で失敗する場合は full dump（スキーマ込み）に切替も可。テーブル名は schema の @@map で確認済。
> 投入後 `staff`↔`users` の staffCode リンクを必ず確認（未リンクだと削除/保留/検品戻し/監査が 403/500）。

## Phase 2-E：本番前チェックリスト

- [ ] `INTRANET_CIDR_LIST` に事務所固定グローバルIP（未設定=全許可）
- [ ] `NEXTAUTH_SECRET` 本番ランダム値 / `NEXTAUTH_URL=https://logismile.oenosato.net`
- [ ] 全 users の staffCode が staff にリンク済み
- [ ] `PRINTER_DRY_RUN=false` + VPS から `nc -zv 192.168.1.<プリンタIP> 9100` 成功（Tailscale経由）
- [ ] `docker compose ps` で app/db が healthy・`restart: always`
- [ ] （任意・多層防御）Caddy 側 IP 制限を ohara に依頼（事務所IPのみ 443 許可）
- [ ] バックアップ（pg_dump cron → 外部保存）の運用決定

## Phase 2-F：go-live 検証 & ロールバック

検証:
1. 事務所LANから `https://logismile.oenosato.net` ログイン → ピッキング№→商品→納品書№→完了→印刷確認→**実印字**
2. **スキャン遅延の体感**（クラウド往復。国内VPSで ~10-30ms 想定。④軽量化が効くはず）
3. 出荷照合の総件数が実数（1000で頭打ちにならない）
4. 事務所外（スマホ4G）から弾かれること（IP制限）

ロールバック:
- 不調時は現テスト運用PC（192.168.1.139）に一時復帰。Caddy 設定変更が要る場合は ohara へ。
- 印刷不調は `tailscale status` / ルート承認 / プリンタIP を確認。
