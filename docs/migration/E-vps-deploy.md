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

---

## 日常の更新デプロイ（2 回目以降・2026-09-18 改訂＝自動化）

### ★ 現在の運用：GitHub でマージすれば本番へ反映される

小原様ご依頼（2026-09-18）により、CraftSmile と同じく**マージ起点の自動デプロイ**にした。

```
作業ブランチ → PR → CI green → main へマージ
                                   ↓
                        main の CI が green になる
                                   ↓
        .github/workflows/deploy.yml が VPS へ SSH して
        ./scripts/deploy-vps.sh --prune を実行
```

**VPS にログインしての手作業は不要。** 結果は GitHub の **Actions タブ →
「Deploy to VPS」** で確認する（成功すると URL と「端末を再読込」の注意が要約に出る）。

| 論点 | 決めたこと |
|---|---|
| いつ動くか | **`main` の CI が成功したとき**（`workflow_run`）。CI が赤いときは本番を焼き直さない |
| 何をするか | VPS 上で `./scripts/deploy-vps.sh --prune`（＝従来の手順そのもの） |
| 手動実行 | Actions → Deploy to VPS → Run workflow |
| 失敗したら | **本番は直前の状態のまま**。スクリプトが戻し方を表示する |
| 同時実行 | `concurrency` で1本に直列化 |

必要な GitHub Secrets（Settings → Secrets and variables → Actions）:

| 名前 | 値 | 必須 |
|---|---|---|
| `VPS_HOST` | `85.131.250.41` | ✓ |
| `VPS_USER` | `deploy` | ✓ |
| `VPS_SSH_KEY` | `deploy` ユーザーの**秘密鍵**（`-----BEGIN` から末尾まで全文） | ✓ |
| `VPS_PORT` | 既定 `22` | |
| `VPS_DEPLOY_PATH` | 既定 `/var/www/logismile` | |

**★ 秘密鍵は GitHub Secrets にのみ置く。** リポジトリ・Issue・PR・チャットに貼らない。
GitHub Actions 用に専用の鍵を作り、`deploy` ユーザーの `~/.ssh/authorized_keys` に
追加する運用が安全（漏れたときにその鍵だけ外せる）。

```bash
# 管理PCで（Actions 専用鍵を作る）
ssh-keygen -t ed25519 -C "logismile-actions-deploy" -f ~/.ssh/logismile_actions -N ''
# 公開鍵を VPS の deploy ユーザーへ追加
ssh-copy-id -i ~/.ssh/logismile_actions.pub deploy@85.131.250.41
# 秘密鍵の中身を GitHub Secrets の VPS_SSH_KEY に貼る（画面には表示されない）
cat ~/.ssh/logismile_actions
```

### 手動で実行する場合（従来手順・切り戻しや緊急時）

自動デプロイが使えないとき（Secrets 未設定・GitHub 障害・切り戻し）は従来どおり。

```bash
ssh deploy@85.131.250.41
cd /var/www/logismile
./scripts/deploy-vps.sh
```

なお Next.js は**ビルド成果物**なので、`git pull` だけでは反映されない。
**イメージの再ビルドが必須**（スクリプトがその付け忘れを防いでいる）。

### ★ 本番に入っているかを確かめる

「マージしたのに反映されていない気がする」ときの確認手順。

```bash
ssh deploy@85.131.250.41
cd /var/www/logismile
git log --oneline -1                                   # ① 配置先のコミット
docker compose -f docker-compose.vps.yml ps            # ② コンテナの起動時刻
docker compose -f docker-compose.vps.yml images        # ③ 動いているイメージ
```

- ① が GitHub の `main` の先頭と**同じなら pull は済んでいる**
- ②の起動時刻が**マージより前**なら、pull しただけで**再ビルドしていない**
  （＝画面は古いまま）。`./scripts/deploy-vps.sh` を実行する

ブラウザだけで見るなら、**その版で増えた画面があるか**を見るのが早い
（例：レポート画面に「検品タイムライン」タブがあれば 2026-09-17 の版が入っている）。

スクリプトが以下を通しで実行する:

| 手順 | 内容 |
|---|---|
| 1 | 事前チェック（`docker-compose.vps.yml` / `.env` の存在、**追跡中ファイル**の未コミット変更の有無） |
| 2 | `git pull --ff-only origin main` |
| 3 | 今回反映されるコミットを一覧表示 |
| 4 | `docker compose -f docker-compose.vps.yml up -d --build` |
| 5 | `/api/integration/factory/health` へ疎通確認（最大 60 秒リトライ） |
| 6 | `docker compose ps` の表示 |

オプション:

```bash
./scripts/deploy-vps.sh --prune   # 宙ぶらりんイメージも掃除（ディスク逼迫時）
DEPLOY_BRANCH=xxx ./scripts/deploy-vps.sh   # main 以外を取得（既定 main）
```

### 注意

- **ビルドに数分かかる。** 業務時間中は避けるのが無難
- **反映後、タブレット / ハンディは画面を再読込する。** 古い JavaScript がブラウザの
  キャッシュに残るため、再読込しないと変更が見えない
- DB スキーマ変更を含む場合、コンテナ起動時に `prisma migrate deploy` が自動で走る。
  スキーマ変更が無ければ空振りするだけなので、事前作業は不要
- 失敗時はスクリプトが**戻し方（`git reset --hard <直前のコミット>` + 再ビルド）を表示**する
- **新しいコミットが無くても再ビルドまで実行する。**
  「コードは pull 済みだがイメージが古い」状態が実際に起きたため
  （2026-08-09。`git pull` だけ実行して `--build` を忘れると発生する）。
  変更が無ければ Docker のレイヤキャッシュが効くので数秒で終わる
- 中断するのは**追跡中ファイル**に未コミット変更がある場合のみ。
  `masters.sql` など運用でデプロイ先に置いた Git 管理外のファイルは中断理由にならない
  （意図的にコードを編集していた場合は `git stash` で退避してから再実行）

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
