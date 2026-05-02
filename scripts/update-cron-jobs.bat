@echo off
REM ===================================================================
REM 日次バッチ — 標準時間 / スキル係数 自動更新
REM
REM 使い方:
REM   - タスクスケジューラから毎日 1:00 に実行
REM
REM 認証なしでは叩けないため admin@wms.local の API を使う。
REM curl はWindows 10 以降標準搭載。
REM ===================================================================

cd /d "%~dp0\.."

set BASE_URL=http://localhost:3000
set TMP_COOKIES=%TEMP%\wms_cron.cookies

echo [1/4] CSRF トークン取得
for /f "tokens=*" %%a in ('curl -s -c "%TMP_COOKIES%" "%BASE_URL%/api/auth/csrf"') do set CSRF_RESPONSE=%%a

REM CSRF token を JSON から抽出
for /f "tokens=2 delims=:" %%a in ('echo %CSRF_RESPONSE% ^| findstr "csrfToken"') do (
  set CSRF_RAW=%%a
)
set CSRF=%CSRF_RAW:"=%
set CSRF=%CSRF:,=%
set CSRF=%CSRF: =%

echo [2/4] admin ログイン
curl -s -b "%TMP_COOKIES%" -c "%TMP_COOKIES%" -X POST "%BASE_URL%/api/auth/callback/credentials" ^
  -H "Content-Type: application/x-www-form-urlencoded" ^
  -d "csrfToken=%CSRF%&email=admin@wms.local&password=admin123&redirect=false&json=true" ^
  -o nul

echo [3/4] 標準時間を更新
curl -s -b "%TMP_COOKIES%" -X POST "%BASE_URL%/api/cron/update-std-times?windowDays=30"

echo.
echo [4/4] スキル係数を更新
curl -s -b "%TMP_COOKIES%" -X POST "%BASE_URL%/api/cron/update-skill-coefficients?windowDays=30"

echo.
del "%TMP_COOKIES%" >nul 2>&1
echo 完了
