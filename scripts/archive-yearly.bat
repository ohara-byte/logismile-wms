@echo off
REM ===================================================================
REM 年次バッチ — 1 年経過の削除済み伝票を物理削除 + CSV アーカイブ
REM
REM 使い方:
REM   - タスクスケジューラで毎月 1 日 2:00 に実行（または年に 1 回）
REM   - dryRun=true で試してから dryRun=false に切替
REM
REM 取り返しがつかないため、初回は必ず dryRun=true で確認すること。
REM ===================================================================

cd /d "%~dp0\.."

set BASE_URL=http://localhost:3000
set TMP_COOKIES=%TEMP%\wms_archive.cookies
set DRY_RUN=true
if "%1"=="execute" set DRY_RUN=false

echo [1/3] CSRF + admin ログイン
curl -s -c "%TMP_COOKIES%" "%BASE_URL%/api/auth/csrf" > %TEMP%\wms_csrf.json
for /f "tokens=2 delims=:" %%a in ('type %TEMP%\wms_csrf.json ^| findstr "csrfToken"') do set CSRF_RAW=%%a
set CSRF=%CSRF_RAW:"=%
set CSRF=%CSRF:,=%
set CSRF=%CSRF: =%
del %TEMP%\wms_csrf.json

curl -s -b "%TMP_COOKIES%" -c "%TMP_COOKIES%" -X POST "%BASE_URL%/api/auth/callback/credentials" ^
  -H "Content-Type: application/x-www-form-urlencoded" ^
  -d "csrfToken=%CSRF%&email=admin@wms.local&password=admin123&redirect=false&json=true" ^
  -o nul

echo [2/3] 年次アーカイブ実行 (dryRun=%DRY_RUN%)
curl -s -b "%TMP_COOKIES%" -X POST "%BASE_URL%/api/cron/archive-orders?retentionDays=365&dryRun=%DRY_RUN%"

echo.
echo [3/3] 完了
del "%TMP_COOKIES%" >nul 2>&1

if "%DRY_RUN%"=="true" (
  echo.
  echo ※ 今回は DRY-RUN です。実際に削除する場合は archive-yearly.bat execute を実行
)
