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
# VPS 上で直接編集した内容を pull で壊さないための確認。
#   ★ 対象は「追跡中ファイルの変更」だけ（--untracked-files=no）。
#     masters.sql / バックアップ等、運用でデプロイ先に置かれる Git 管理外の
#     ファイルは pull を妨げないため、中断の理由にしない。
#     （untracked が pull で上書きされる場合は git 自身が止めてくれる）
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "[ERROR] 追跡中ファイルに未コミットの変更があります。デプロイを中止しました。" >&2
  echo "        退避する場合: git stash" >&2
  git status --short --untracked-files=no >&2
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
  # ★ ここで終了しない。
  #   「コードは最新だがイメージが古い」状態（pull だけして再ビルドし忘れた等）が
  #   実際に起きたため、更新が無くても必ず再ビルドまで通す。
  #   変更が無ければ Docker のレイヤキャッシュが効くので数秒で終わる。
  echo "  新しいコミットはありません（コードは既に最新）。"
  echo "  イメージが最新かは別問題のため、このまま再ビルドまで実行します。"
else
  git --no-pager log --oneline "${BEFORE}..${AFTER}"
fi
echo

# 失敗時の案内。更新が無い実行では同じコミットへの reset になり無意味なので出さない。
if [ "$BEFORE" = "$AFTER" ]; then
  ROLLBACK_HINT=''
else
  ROLLBACK_HINT="        戻す  : git reset --hard ${BEFORE:0:7} && docker compose -f ${COMPOSE_FILE} up -d --build"
fi

# ---- [4/6] 再ビルド & 起動 ---------------------------------------------
echo "[4/6] イメージを再ビルドして起動（数分かかります）..."
if ! docker compose -f "$COMPOSE_FILE" up -d --build; then
  echo >&2
  echo "[ERROR] ビルドまたは起動に失敗しました。" >&2
  echo "        ログ  : docker compose -f ${COMPOSE_FILE} logs --tail=100 app" >&2
  if [ -n "$ROLLBACK_HINT" ]; then echo "$ROLLBACK_HINT" >&2; fi
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
  if [ -n "$ROLLBACK_HINT" ]; then echo "$ROLLBACK_HINT" >&2; fi
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

if [ "$BEFORE" = "$AFTER" ]; then
  COMMIT_LINE="  コミット: ${AFTER:0:7}（変更なし・再ビルドのみ）"
else
  COMMIT_LINE="  コミット: ${BEFORE:0:7} → ${AFTER:0:7}"
fi

cat <<EOF

=== デプロイ完了 ===
${COMMIT_LINE}
  URL   : https://logismile.oenosato.net

  ★ タブレット / ハンディは画面を再読込してください
    （古い JavaScript がブラウザのキャッシュに残るため）
EOF
