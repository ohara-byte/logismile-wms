@echo off
REM ===================================================================
REM WMS リビルド + 起動
REM   コード変更があった or 「ページが見つからない」エラーが出たら使用
REM
REM   .next フォルダを削除してから build → start
REM   通常の起動は start-prod.bat（ビルドはスキップ）
REM ===================================================================

cd /d "%~dp0\.."

echo [1/5] 起動中の Next.js を停止 ...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
)

echo [2/5] 古いビルド成果物を削除 ...
if exist .next rmdir /s /q .next

echo [3/5] Docker (Postgres / pgAdmin) を起動 ...
docker compose up -d
if errorlevel 1 (
  echo [ERROR] Docker 起動失敗
  pause
  exit /b 1
)

echo [4/5] 本番ビルド（数分かかります）...
call npm run build
if errorlevel 1 (
  echo [ERROR] ビルド失敗
  pause
  exit /b 1
)

echo [5/5] Next.js を本番モードで起動 ...
echo   アクセス URL: http://192.168.1.139:3000
echo   このウィンドウを閉じるとサーバーが停止します
echo.
call npm run start
