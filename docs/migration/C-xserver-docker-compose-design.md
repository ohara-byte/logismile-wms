# C. Xserver VPS Docker compose 構成設計書

## 0. 全体像

```
                   ┌────────────────────────────────────────┐
                   │       Xserver VPS  (12GB / 6 vCPU)     │
                   │                                        │
   Internet ──→ Caddy (443/80) ─── reverse proxy           │
                   │   │                                    │
                   │   ├─→ logismile.oenosato.net           │
                   │   │      ↓                             │
                   │   │   ┌─────────────────────┐         │
                   │   │   │  WMS LogiSmile      │         │
                   │   │   │  (Next.js + Postgres)│        │
                   │   │   └─────────────────────┘         │
                   │   │                                    │
                   │   ├─→ groupware.oenosato.net           │
                   │   │      ↓                             │
                   │   │   ┌─────────────────────┐         │
                   │   │   │  Groupware (existing)│        │
                   │   │   └─────────────────────┘         │
                   │   │                                    │
                   │   └─→ factory.oenosato.net             │
                   │          ↓                             │
                   │       ┌─────────────────────┐         │
                   │       │  製造管理（将来）       │        │
                   │       └─────────────────────┘         │
                   │                                        │
                   │   ★ Tailscale (host network)           │
                   │     ↓                                  │
                   │     社内 LAN (192.168.1.0/24) と接続    │
                   │                                        │
                   │   ★ 自動バックアップ (cron)              │
                   │     → Google Drive 14TB                │
                   └────────────────────────────────────────┘
```

## 1. ディレクトリ構成（VPS 内）

```
/opt/
├── logismile-wms/                  # WMS スタック
│   ├── docker-compose.yml
│   ├── .env                        # 本番シークレット（gitignore 相当）
│   ├── postgres-data/              # 永続ボリューム
│   ├── thomas_csv/                 # 取込 CSV 一時置き場
│   └── archives/                   # 年次アーカイブ
│
├── groupware/                      # 既存グループウェア（既設のものを移動）
│   ├── docker-compose.yml
│   ├── .env
│   └── data/
│
├── factory-system/                 # 将来：製造管理
│   ├── docker-compose.yml
│   └── ...
│
├── caddy/                          # 共通リバプロ
│   ├── docker-compose.yml
│   ├── Caddyfile
│   └── data/
│       └── caddy-data/             # Let's Encrypt 証明書置き場
│
├── backup/                         # バックアップスクリプト
│   ├── backup.sh
│   ├── rclone.conf
│   └── logs/
│
└── shared/                         # docker network 共通定義
    └── docker-compose.networks.yml
```

## 2. ネットワーク設計

### 2-1. Docker network 分離

各システムは「自身の DB」「自身のアプリ」のみ通信可能。Caddy は全システムへアクセス可。

```yaml
# /opt/shared/docker-compose.networks.yml
networks:
  caddy-public:           # Caddy ↔ 各システム の公開 LB 用
    name: caddy-public
    driver: bridge

  wms-internal:           # WMS 内部（app ↔ db）
    name: wms-internal
    driver: bridge
    internal: true        # 外部に出さない

  groupware-internal:     # 既存 groupware 内部
    name: groupware-internal
    driver: bridge
    internal: true

  factory-internal:       # 将来 製造管理 内部
    name: factory-internal
    driver: bridge
    internal: true
```

### 2-2. システム間 API 連携

WMS ⇄ 製造管理 のような **inter-system 通信** は Caddy 経由のループバックで行う：

```
WMS app → curl https://factory.oenosato.net/api/... → Caddy → 製造管理 app
```

これにより **Tailscale や外部 IP 不要**、HMAC 署名検証（既に実装済）でセキュリティ担保。

## 3. WMS スタック（docker-compose.yml 案）

```yaml
# /opt/logismile-wms/docker-compose.yml
version: '3.9'

services:
  db:
    image: postgres:16
    container_name: wms-db
    restart: always
    environment:
      POSTGRES_USER: wms_user
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: wms_db
    volumes:
      - ./postgres-data:/var/lib/postgresql/data
    networks:
      - wms-internal
    # 外部へのポート公開は無し（wms-internal のみで通信）

  wms:
    image: ghcr.io/oenosato/logismile-wms:latest
    # ↑ GitHub Actions で build → push する想定
    # 代替: build: ./app（ローカルビルド）
    container_name: wms-app
    restart: always
    depends_on:
      - db
    environment:
      DATABASE_URL: postgresql://wms_user:${POSTGRES_PASSWORD}@db:5432/wms_db
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET}
      NEXTAUTH_URL: https://logismile.oenosato.net
      INTRANET_CIDR_LIST: ${INTRANET_CIDR_LIST}
      # Tailscale 経由でプリンタへ印刷リレー
      PRINTER_DRY_RUN: 'false'
      PRINTER_LANG: 'sbpl'
      # 製造システム連携
      FACTORY_INTEGRATION_MODE: 'factory_api'
      FACTORY_INBOUND_HMAC_SECRET: ${FACTORY_INBOUND_HMAC_SECRET}
      FACTORY_OUTBOUND_HMAC_SECRET: ${FACTORY_OUTBOUND_HMAC_SECRET}
      FACTORY_WEBHOOK_SECRET: ${FACTORY_INBOUND_HMAC_SECRET}
      FACTORY_BASE_URL: https://factory.oenosato.net
      NODE_ENV: 'production'
    networks:
      - wms-internal
      - caddy-public
    volumes:
      - ./thomas_csv:/app/data/thomas_csv
      - ./archives:/app/data/archives
    # 内部 3000 → Caddy で 443 終端

networks:
  wms-internal:
    external: true
  caddy-public:
    external: true
```

## 4. Caddy リバプロ設定

```Caddyfile
# /opt/caddy/Caddyfile

# === WMS LogiSmile ===
logismile.oenosato.net {
    reverse_proxy wms-app:3000

    # 編集系 API は社内 LAN / Tailscale CGNAT のみ許可
    @internal {
        remote_ip 192.168.1.0/24 100.64.0.0/10 (Xserver_VPS_IP)
    }
    # その他は Sprint Z-9 で実装した「閲覧専用」モード
    # → X-Access-Level ヘッダで判別

    encode gzip
    log {
        output file /var/log/caddy/logismile.log
        format json
    }
}

# === Groupware（既存） ===
groupware.oenosato.net {
    reverse_proxy groupware-app:8080
    encode gzip
}

# === 製造管理（将来） ===
factory.oenosato.net {
    reverse_proxy factory-app:8000

    # HMAC 検証は app 側で実施（このプロキシは透過）
    encode gzip
}

# === 共通ヘルスチェック ===
health.oenosato.net {
    respond /healthz "OK" 200
}
```

```yaml
# /opt/caddy/docker-compose.yml
version: '3.9'

services:
  caddy:
    image: caddy:2-alpine
    container_name: caddy
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - caddy-public

volumes:
  caddy_data:
  caddy_config:

networks:
  caddy-public:
    external: true
```

## 5. リソース割り当て（12GB / 6 vCPU の配分）

| システム | RAM | vCPU | 想定負荷 |
|---|---|---|---|
| Postgres (WMS) | 2 GB | 1.5 | 中（ピーク 100 reqs/s） |
| Next.js (WMS) | 2 GB | 1.5 | 中（Server Components SSR） |
| Groupware | 1.5 GB | 1 | 低 |
| 製造管理（将来） | 2 GB | 1 | 中 |
| Caddy | 256 MB | 0.5 | 低（静的振分） |
| Tailscale + OS | 1 GB | 0.5 | 低 |
| **合計** | **8.7 GB** | **6** | **3.3 GB 余裕** |

→ **十分余裕あり**。製造管理追加後でも 12GB 中 9GB 程度。Postgres にもう少し割いてもよい。

## 6. バックアップ設計（Google Drive 14TB）

### 6-1. ツール選定

| 候補 | 推奨度 | 理由 |
|---|---|---|
| **rclone** | ★★★ | Linux 標準、Google Drive native 対応、暗号化対応 |
| restic | ★★ | 差分バックアップ強力、Drive 直書きにラッパー要 |
| 公式 Google Drive CLI | ★ | 認証が複雑、業務利用は推奨せず |

### 6-2. rclone 設定例

```bash
# /opt/backup/backup.sh
#!/bin/bash
set -euo pipefail

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=/opt/backup/tmp/${DATE}
mkdir -p ${BACKUP_DIR}

# === 1. Postgres 論理バックアップ ===
docker exec wms-db pg_dump -U wms_user wms_db | gzip > ${BACKUP_DIR}/wms_db_${DATE}.sql.gz

# === 2. CSV アーカイブ ===
tar czf ${BACKUP_DIR}/wms_archives_${DATE}.tar.gz /opt/logismile-wms/archives/

# === 3. Groupware DB（将来 同様に） ===
# docker exec groupware-db pg_dump ... > ...

# === 4. Google Drive へアップロード（暗号化済 remote） ===
rclone copy ${BACKUP_DIR}/ gdrive-crypt:logismile-backup/${DATE}/ --progress

# === 5. ローカル一時を削除 ===
rm -rf ${BACKUP_DIR}

# === 6. 30 日より古いリモートを削除 ===
rclone delete gdrive-crypt:logismile-backup/ --min-age 30d
```

### 6-3. cron 設定

```cron
# /etc/cron.d/wms-backup
# 毎日 03:00 にバックアップ
0 3 * * * root /opt/backup/backup.sh >> /opt/backup/logs/backup.log 2>&1
```

### 6-4. 復元手順（リハーサル必須）

```bash
# 1. 復元する日付選択
rclone lsd gdrive-crypt:logismile-backup/

# 2. ダウンロード
rclone copy gdrive-crypt:logismile-backup/20260801_030000/ /tmp/restore/

# 3. Postgres リストア
docker exec -i wms-db psql -U wms_user -d wms_db < /tmp/restore/wms_db_20260801_030000.sql

# 4. アーカイブ展開
tar xzf /tmp/restore/wms_archives_20260801_030000.tar.gz -C /
```

## 7. デプロイフロー

### 7-1. 初回デプロイ

```bash
# VPS で
ssh root@<VPS-IP>
cd /opt
git clone https://github.com/oenosato/logismile-wms.git logismile-wms-repo
cp -r logismile-wms-repo/docker/* logismile-wms/
cd logismile-wms

# .env を編集（シークレット投入）
cp .env.example .env
vim .env   # FACTORY_*_HMAC_SECRET 等を投入

# 起動
docker compose up -d
docker compose logs -f
```

### 7-2. 継続デプロイ（GitHub Actions 連携想定）

```yaml
# .github/workflows/deploy.yml
name: Deploy WMS to Xserver
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build & push image
        run: |
          docker build -t ghcr.io/oenosato/logismile-wms:${{ github.sha }} .
          docker push ghcr.io/oenosato/logismile-wms:${{ github.sha }}

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: deploy
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/logismile-wms
            docker compose pull
            docker compose up -d
            docker compose exec wms npx prisma migrate deploy
```

## 8. 監視・ヘルスチェック

### 8-1. 軽量監視（uptime-kuma 推奨）

別 docker でモニタリングダッシュボードを建てる：

```yaml
# /opt/uptime-kuma/docker-compose.yml
services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    ports: ["3001:3001"]
    volumes: [./data:/app/data]
    restart: always
```

→ Caddy で `monitor.oenosato.net` として公開（社内 IP 限定）

### 8-2. 監視対象

| 対象 | 監視方法 | アラート閾値 |
|---|---|---|
| WMS HTTP | GET https://logismile.oenosato.net/api/health | 5 秒タイムアウト |
| Postgres | TCP 5432 内部接続 | 3 連続失敗 |
| Tailscale | `tailscale status` cron 監視 | 10 分接続不可 |
| ディスク | df -h で 80% 超過 | 月次レポート |
| バックアップ | backup.sh の終了コード | 失敗時即時メール |

## 9. セキュリティ強化

### 9-1. OS レベル

```bash
# 1. SSH 鍵認証のみ
sudo vim /etc/ssh/sshd_config
#   PasswordAuthentication no
#   PermitRootLogin prohibit-password
sudo systemctl restart sshd

# 2. UFW でファイアウォール
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp  # SSH
# Tailscale 用は ufw 不要（kernel module）
sudo ufw enable

# 3. fail2ban
sudo apt install fail2ban
sudo systemctl enable --now fail2ban

# 4. unattended-upgrades（自動セキュリティパッチ）
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### 9-2. Docker レベル

- 全イメージは `ghcr.io/oenosato/*` の自社ビルド
- `latest` タグ禁止、必ず `:sha-<commit>` 指定
- Secrets は env file (.env) で渡し、Caddy のログから消す（→ Caddy log_skip 設定）
- 各コンテナで `read_only: true` + `tmpfs` パターン適用（できれば）

## 10. 移行スケジュール

| 週次 | 作業 |
|---|---|
| W1（6月中旬） | VPS にカーネル更新、Docker / rclone / Tailscale インストール |
| W2 | Caddy + Postgres + WMS デプロイ（staging サブドメイン） |
| W3 | 既存テスト運用データを VPS に投入、QA |
| W4 | クラフトスマイル様と HMAC 連携テスト |
| W5 | 本番ドメインへ切替（logismile.oenosato.net 公開） |
| W6 | バックアップリハーサル、監視設定 |
| W7 | 本番運用開始、現テスト運用 PC は DR スタンバイへ |

## 11. ロールバック手順

万が一切替後にトラブル：

```bash
# 1. WMS を旧バージョンに切戻し（1 分で復旧）
cd /opt/logismile-wms
docker compose down
git -C /opt/logismile-wms-repo checkout <previous-tag>
docker compose up -d

# 2. それでも復旧しない場合、テスト運用環境 (192.168.1.139:3000) に DNS 切替
# Xserver DNS 管理画面で A レコードを LAN IP に変更（社外公開停止）
# 社員には「社内 LAN 経由でアクセスしてください」と通知
```

## 12. チェックリスト

```
□ VPS のスペック確認（12GB/6vCPU）
□ ssh 鍵認証設定 + root 直接ログイン禁止
□ Docker / Docker Compose インストール
□ Caddy + Postgres + WMS の compose ファイル準備
□ DNS レコード: logismile / stg-logismile / groupware / factory
□ Caddy で Let's Encrypt 自動取得確認
□ Tailscale を VPS に install + tailnet 参加
□ rclone + Google Drive アカウント連携
□ backup.sh 動作確認（手動実行）
□ cron 登録 → 24h 後にログ確認
□ uptime-kuma で監視 dashboard 構築
□ ufw + fail2ban 有効化
□ 復元リハーサル（バックアップから別 VPS で復元成功）
□ クラフトスマイル様と疎通テスト
□ ロールバック手順テスト
□ 本番切替日決定 → 全社員へ通知
```
