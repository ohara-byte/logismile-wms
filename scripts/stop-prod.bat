@echo off
REM ===================================================================
REM WMS テスト運用 停止スクリプト
REM   Next.js (port 3000) を停止 → Docker は残す（停止する場合は別途）
REM ===================================================================

cd /d "%~dp0\.."

echo [1/2] ポート 3000 で動いている Next.js プロセスを停止 ...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
  echo   PID %%a を停止
  taskkill /PID %%a /F >nul 2>&1
)

echo [2/2] Docker (Postgres / pgAdmin) を残して終了
echo   Docker も停止する場合: docker compose down
echo.
echo 停止完了
pause
