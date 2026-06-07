# B. Tailscale 設定手順書（ミニPC 到着後の構築手順）

## 0. 全体像

```
   外部                                    社内
┌─────────┐                       ┌─────────────────────┐
│ 在宅 PC │──Tailscale──┐         │                     │
└─────────┘            │         │  ┌───────────────┐  │
                       │         │  │ Win11 ミニPC  │  │
┌─────────┐           ↓         │  │ (Tailscale     │  │
│ Xserver │←─Tailscale─┼─────────┼─▶│  subnet router)│──┼──┬─▶ プリンタ x5
│  VPS    │           │         │  └───────────────┘  │  │   192.168.1.x
└─────────┘            │         │                     │  ├─▶ タブレット x10
                       │         │                     │  └─▶ ハンディ x5
┌─────────┐            │         │   ※社内LAN          │
│ 出張中  │──Tailscale──┘         │   192.168.1.0/24    │
└─────────┘                       └─────────────────────┘
```

**役割**:
- ミニ PC = "subnet router"（192.168.1.0/24 を Tailscale 経由で公開）
- Xserver VPS = Tailscale ノード（外部から VPN 内のプリンタへ印刷指示送出）
- 在宅 / 出張社員 = Tailscale クライアント（社内 LAN 越しに WMS フル機能）

---

## 1. アカウント準備（事前作業）

### 1-1. プラン選定

| プラン | 月額 | デバイス数 | ユーザー数 | SSO | 適合度 |
|---|---|---|---|---|---|
| Personal | 無料 | 100 | 3 | × | 個人テスト向け |
| **Personal Pro** | $5 | 100 | 3 | × | ★ 検証段階 |
| **Premium** | $18/user | 無制限 | 無制限 | ◎ | ★★ 本番運用 |
| Enterprise | 要相談 | 無制限 | 無制限 | ◎+監査 | 大企業向け |

**おすすめ**：最初 Personal Pro $5/月で開始 → 本番運用切替時に Premium へアップグレード。

### 1-2. アカウント作成

1. https://tailscale.com/ → "Sign up free"
2. ログイン方法選択：
   - **推奨**: Google Workspace（@oenosato.net）の SSO 連携
   - 代替: GitHub / Microsoft アカウント
3. tailnet 名（=テナント名）を確認。例: `oenosato.org.github`

### 1-3. 管理画面の初期設定

1. **タブ "Settings" > "General"**:
   - Tailnet name: `oenosato`（変更推奨）
   - Magic DNS: ✅ 有効
2. **タブ "Settings" > "Keys"**:
   - 後で必要になるので画面の場所だけ把握しておく

---

## 2. ミニ PC（Win11）への Tailscale インストール

### 2-1. インストール

1. ミニ PC で `https://tailscale.com/download/windows` にアクセス
2. インストーラをダウンロード → 実行（管理者権限）
3. 完了後、タスクトレイの Tailscale アイコンを右クリック → "Log in..."
4. ブラウザが開く → tailnet にサインイン
5. デバイス名を入力 → 例: `wms-minipc`
6. tailnet にデバイスが追加されたことを管理画面で確認

### 2-2. subnet router 設定

```powershell
# PowerShell を管理者権限で起動
# Tailscale クライアントを subnet router モードで再認証

tailscale up --advertise-routes=192.168.1.0/24 --accept-routes
```

→ ブラウザが開いてサインイン要求 → 完了。

### 2-3. 管理画面で subnet route を承認

1. https://login.tailscale.com/admin/machines にアクセス
2. `wms-minipc` の行 → 右側 "..." → "Edit route settings"
3. `192.168.1.0/24` を ✅ チェック → "Save"

### 2-4. Windows のスリープ / 自動再起動を無効化

24/7 運用するので：

```powershell
# 電源プラン: 高パフォーマンス & スリープなし
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 0

# 自動再起動を無効（Windows Update 後の勝手な再起動を防ぐ）
# Settings > Windows Update > Advanced options で
#   "Active hours" を 0:00 - 23:59 に設定
```

### 2-5. Tailscale をサービスとして自動起動

Tailscale クライアントは標準で Windows サービスとして登録されます。再起動後も自動起動されることを確認：

```powershell
Get-Service Tailscale | Format-Table -AutoSize
# Status が "Running" であること
```

「サービス」アプリでも確認可：`services.msc` → "Tailscale" → スタートアップの種類 = "自動"

### 2-6. Windows ファイアウォール例外

Tailscale はインストール時に必要なファイアウォール例外を自動追加しますが、念のため確認：

```powershell
Get-NetFirewallRule -DisplayName "Tailscale*" | Select-Object DisplayName, Enabled, Direction
```

---

## 3. Xserver VPS への Tailscale インストール

### 3-1. SSH で VPS に接続

```bash
ssh root@<VPS-IP>
```

### 3-2. Tailscale インストール（Ubuntu/Debian の場合）

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

### 3-3. tailnet に参加

```bash
sudo tailscale up --ssh
```

→ ブラウザで開く URL が表示されるので、ローカル PC で開いて認証。

### 3-4. デバイス名を `wms-vps` に変更

管理画面 → `<生成された名前>` → 名前変更 → `wms-vps`

### 3-5. 自動再認証用キー設定（オプション）

VPS を auto-renew にしたい場合、管理画面 "Keys" タブで auth key 発行 → 環境変数化：

```bash
# 90 日でキー期限切れする問題を回避するため、Tag を付与してから auth key を再認証
sudo tailscale up --auth-key=tskey-auth-xxxxxxxx --ssh
```

→ ただし、**運用上は普通の OAuth 認証で十分**。期限切れは通知が来るので手動更新。

---

## 4. 動作確認

### 4-1. 管理画面で全ノード表示

https://login.tailscale.com/admin/machines に以下が出ているか：

| デバイス | IP | 状態 |
|---|---|---|
| wms-minipc | 100.x.x.x（CGNAT 帯） | Connected |
| wms-vps | 100.y.y.y | Connected |

### 4-2. VPS からプリンタへの ping

```bash
# VPS にログインして
ssh root@<VPS-public-IP>

# プリンタ IP を Tailscale 経由で ping
ping 192.168.1.101  # プリンタ 1 の IP
```

→ 応答が返ってくれば subnet routing 成功。

### 4-3. VPS からプリンタへの TCP 接続

```bash
# SBPL は TCP 9100 番
nc -zv 192.168.1.101 9100
# Connection to 192.168.1.101 9100 port [tcp/*] succeeded!
```

### 4-4. 在宅 PC からの WMS アクセス（動作確認）

1. 在宅 PC に Tailscale クライアントインストール → 同じ tailnet にログイン
2. ブラウザで `http://192.168.1.139:3000`（テスト環境）または `https://logismile.oenosato.net` にアクセス
3. ログイン画面が出れば OK

---

## 5. ACL（Access Control List）設定

社員ごとに「VPN 入っても見られるもの・見られないもの」を制御。

### 5-1. 管理画面 → Access Controls タブで JSON 編集

```json
{
  "tagOwners": {
    "tag:server":  ["autogroup:admin"],
    "tag:printer": ["autogroup:admin"],
    "tag:staff":   ["autogroup:admin"]
  },
  "acls": [
    // 全ノードが VPN 内通信可
    { "action": "accept", "src": ["*"], "dst": ["*:*"] }

    // ↓ より厳密にやる場合の例
    // staff デバイスは WMS と Groupware のみ許可
    // {
    //   "action": "accept",
    //   "src": ["tag:staff"],
    //   "dst": ["tag:server:80,443,3000"]
    // },
    // staff デバイスはプリンタへ直接アクセス不可
    // {
    //   "action": "deny",
    //   "src": ["tag:staff"],
    //   "dst": ["tag:printer:*"]
    // }
  ],
  "ssh": [
    // SSH は admin のみ
    {
      "action": "accept",
      "src": ["autogroup:admin"],
      "dst": ["tag:server"],
      "users": ["autogroup:nonroot", "root"]
    }
  ]
}
```

### 5-2. デバイスへのタグ付与

管理画面 → 各デバイス → "Edit ACL tags":
- `wms-minipc` → `tag:server`
- `wms-vps` → `tag:server`
- 各プリンタ → `tag:printer`（subnet 経由なので直接タグは不要、subnet ルール参照）
- 社員端末 → `tag:staff`

---

## 6. MagicDNS（オプション・推奨）

VPN 内で IP の代わりに名前で解決できるように：

1. 管理画面 → "DNS" タブ
2. "Magic DNS" を ✅ 有効
3. これで以下のような名前で疎通可：
   - `wms-vps.oenosato.tail-net-name.ts.net`
   - `wms-minipc.oenosato.tail-net-name.ts.net`
4. WMS の `.env.production` で IP の代わりに上記名前を使える

---

## 7. トラブルシューティング

| 症状 | 原因 | 対策 |
|---|---|---|
| VPS からプリンタ ping 通らず | subnet route 未承認 | 管理画面で route 承認再確認 |
| Tailscale デバイス "Expired" 表示 | キー期限切れ（90日） | デバイス側で `tailscale up` 再実行 |
| 社員端末から WMS に繋がらない | ACL ブロック | "Access Controls" → JSON 再確認 |
| 印刷ジョブが届かない | ミニ PC 経由の routing 失敗 | `tailscale netcheck` → IPv4 NAT 通過確認 |
| MagicDNS が解決しない | クライアント側 DNS 設定 | `tailscale up --accept-dns` で再認証 |

### 7-1. 切り分け用コマンド

```bash
# VPS / minipc 共通
tailscale status              # 全ノード一覧
tailscale ping wms-minipc     # ノード間 ping
tailscale netcheck            # NAT 通過状態確認
sudo tailscale up --reset     # 設定リセット
```

---

## 8. ローテーション・運用ルール

| 項目 | 周期 | 対応 |
|---|---|---|
| デバイスキー期限切れ | 90 日 | 管理画面で通知 → デバイス側で再認証 |
| ACL 見直し | 半年 | 退職者・新規入社者の権限見直し |
| 利用ログ確認 | 月次 | 管理画面 "Audit logs" で異常通信なきか確認 |
| Tailscale バージョン更新 | 半年 | minipc / vps で `sudo tailscale update` |

---

## 9. 緊急時の対応

### 全社員の Tailscale 接続を一斉切断したい

管理画面 → "Machines" → 全選択 → "Disable" or "Delete"

### 特定社員のアクセスを即座に止めたい

1. 管理画面 → "Users" → 該当社員 → "Suspend"
2. デバイスごとの場合: 該当 device → "Disable"

### キーが漏洩した疑い

1. 管理画面 → "Settings" → "Keys" → 全 auth key を Revoke
2. デバイスごとに `sudo tailscale logout` → 再認証

---

## 10. 構築完了チェックリスト

```
□ Tailscale アカウント開設（@oenosato.net で SSO 推奨）
□ ミニ PC に Tailscale インストール
□ subnet router モードで起動（--advertise-routes=192.168.1.0/24）
□ 管理画面で subnet route 承認
□ Windows スリープ無効化・自動起動確認
□ Xserver VPS に Tailscale インストール
□ tailnet に参加 → デバイス名 wms-vps
□ MagicDNS 有効化
□ ACL 設定（最低限の "全許可" でも可、後で絞れる）
□ VPS から 192.168.1.101 へ ping 成功
□ VPS から 192.168.1.101:9100 へ TCP 接続成功
□ 在宅 PC から VPN 経由で WMS アクセス成功
□ 朝礼で全社員に Tailscale 利用ルール周知
```

これが全部 ✅ になれば、印刷リレー基盤として運用開始できます。
