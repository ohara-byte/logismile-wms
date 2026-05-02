@echo off
REM ===================================================================
REM WMS テスト運用 起動スクリプト
REM   Postgres / pgAdmin (Docker) → Next.js 本番モードで起動
REM
REM 使い方:
REM   ダブルクリック または タスクスケジューラから起動
REM   停止は scripts\stop-prod.bat
REM ===================================================================

cd /d "%~dp0\.."

echo [1/3] Docker (Postgres / pgAdmin) を起動 ...
docker compose up -d
if errorlevel 1 (
  echo [ERROR] Docker 起動失敗。Docker Desktop が動いているか確認してください
  pause
  exit /b 1
)

echo [2/3] Postgres の準備待機 (最大 30 秒) ...
set /a count=0
:wait_postgres
docker exec wms_db pg_isready -U wms_user -d wms_db >nul 2>&1
if %errorlevel% == 0 goto postgres_ready
set /a count+=1
if %count% geq 30 (
  echo [ERROR] Postgres が起動しません
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait_postgres
:postgres_ready
echo   Postgres 準備完了

echo [3/3] Next.js を本番モードで起動 (ポート 3000) ...
echo   アクセス URL: http://192.168.1.139:3000
echo   このウィンドウを閉じるとサーバーが停止します
echo   バックグラウンド常駐は タスクスケジューラ または scripts\install-service.bat を使用
echo.
call npm run start
