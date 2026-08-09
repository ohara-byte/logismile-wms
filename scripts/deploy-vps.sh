#!/usr/bin/env bash
# ===================================================================
# LogiSmile WMS — VPS 本番 更新デプロイ
#
#   使い方（VPS 上・配置先 /var/www/logismile で実行）:
#     ./scripts/deploy-vps.sh              # 通常の更新デプロイ
#     ./scripts/deploy-vps.sh --prune      # 併せて宙ぶらりんイメージを掃除
#     DEPLOY_BRANCH=xxx ./scripts/deploy-vps.sh   # 取得ブランチを変更（既定 main）
#
#   何をするか:
#     git pull → docker イメージ再ビルド → 起動 → 疎通確認 まで一括。
#
#   ★ Next.js はビルド成果物なので `git pull` だけでは反映されない。
#      本スクリプトは `--build` の付け忘れを防ぐのが主目的。
#
#   初回構築は docs/migration/E-vps-deploy.md「Phase 2-C」を参照。
# ===================================================================
set -euo pipefail

readonly COMPOSE_FILE='docker-compose.vps.yml'
readonly BRANCH="${DEPLOY_BRANCH:-main}"
# 認証なしで JSON を返すエンドポイント。`/` はログインへ 302 するため判定に使わない。
readonly HEALTH_URL='http://127.0.0.1:3001/api/integration/factory/health'
readonly HEALTH_TIMEOUT_SEC=60

PRUNE=0
for arg in "$@"; do
  case "$arg" in
    --prune) PRUNE=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "[ERROR] 不明な引数: $arg（--prune / --help のみ）" >&2; exit 2 ;;
  esac
done

# どこから実行してもリポジトリルートで動くようにする
cd "$(dirname "$0")/.."

echo "=== LogiSmile WMS 更新デプロイ ==="
echo "  配置先 : $(pwd)"
echo "  ブランチ: ${BRANCH}"
echo

# ---- [1/6] 事前チェック -------------------------------------------------
echo "[1/6] 事前チェック ..."
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[ERROR] ${COMPOSE_FILE} が見つかりません。配置先が違う可能性があります。" >&2
  exit 1
fi
if [ ! -f .env ]; then
  echo "[ERROR] .env が見つかりません。本番設定が未投入の可能性があります。" >&2
  echo "        初回構築は docs/migration/E-vps-deploy.md を参照してください。" >&2
  exit 1
fi
# VPS 上で直接編集した内容を pull で壊さない（.env は .gitignore 済みなので出てこない）
if [ -n "$(git status --porcelain)" ]; then
  echo "[ERROR] コミットされていない変更があります。デプロイを中止しました。" >&2
  echo "        内容を確認してください:" >&2
  git status --short >&2
  exit 1
fi

# ---- [2/6] 更新の取得 ---------------------------------------------------
BEFORE="$(git rev-parse HEAD)"
echo "[2/6] ${BRANCH} を取得 ..."
# --ff-only: 予期せぬマージコミットを作らせない
git pull --ff-only origin "$BRANCH"
AFTER="$(git rev-parse HEAD)"

# ---- [3/6] 差分の表示 ---------------------------------------------------
echo "[3/6] 今回反映される変更 ..."
if [ "$BEFORE" = "$AFTER" ]; then
  echo "  更新はありません（既に最新です）。"
  echo
  echo "  ※ コードは最新でも、前回のデプロイが未完了の可能性はあります。"
  echo "     強制的に再ビルドする場合: docker compose -f ${COMPOSE_FILE} up -d --build"
  exit 0
fi
git --no-pager log --oneline "${BEFORE}..${AFTER}"
echo

# ---- [4/6] 再ビルド & 起動 ---------------------------------------------
echo "[4/6] イメージを再ビルドして起動（数分かかります）..."
if ! docker compose -f "$COMPOSE_FILE" up -d --build; then
  echo >&2
  echo "[ERROR] ビルドまたは起動に失敗しました。" >&2
  echo "        ログ  : docker compose -f ${COMPOSE_FILE} logs --tail=100 app" >&2
  echo "        戻す  : git reset --hard ${BEFORE} && docker compose -f ${COMPOSE_FILE} up -d --build" >&2
  exit 1
fi

# ---- [5/6] 疎通確認 -----------------------------------------------------
echo "[5/6] 疎通確認（最大 ${HEALTH_TIMEOUT_SEC} 秒）..."
deadline=$((SECONDS + HEALTH_TIMEOUT_SEC))
healthy=0
while [ "$SECONDS" -lt "$deadline" ]; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
  if [ "$code" = '200' ]; then
    healthy=1
    break
  fi
  sleep 3
done
if [ "$healthy" -ne 1 ]; then
  echo >&2
  echo "[ERROR] ${HEALTH_TIMEOUT_SEC} 秒待っても応答がありません（最後の HTTP: ${code:-なし}）。" >&2
  echo "        ログ  : docker compose -f ${COMPOSE_FILE} logs --tail=100 app" >&2
  echo "        戻す  : git reset --hard ${BEFORE} && docker compose -f ${COMPOSE_FILE} up -d --build" >&2
  exit 1
fi
echo "  OK（HTTP 200）"

# ---- [6/6] 後片付け & 結果 ---------------------------------------------
echo "[6/6] 状態 ..."
if [ "$PRUNE" -eq 1 ]; then
  # dangling（宙ぶらりん）イメージのみ削除。使用中のイメージには触れない。
  echo "  宙ぶらりんイメージを削除 ..."
  docker image prune -f
fi
docker compose -f "$COMPOSE_FILE" ps

cat <<EOF

=== デプロイ完了 ===
  反映前: ${BEFORE:0:7}
  反映後: ${AFTER:0:7}
  URL   : https://logismile.oenosato.net

  ★ タブレット / ハンディは画面を再読込してください
    （古い JavaScript がブラウザのキャッシュに残るため）
EOF
