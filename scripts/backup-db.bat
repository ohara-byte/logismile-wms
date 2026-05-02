@echo off
REM ===================================================================
REM Postgres バックアップ（pg_dump → data\backups\wms_db_YYYYMMDD.sql）
REM
REM 使い方:
REM   - 手動: ダブルクリック
REM   - 自動: タスクスケジューラで毎日 0:00 に実行
REM
REM 7 日以上前のバックアップは自動削除（要件で 1 ヶ月にしたい場合は数値変更）。
REM ===================================================================

cd /d "%~dp0\.."

set TODAY=%date:~0,4%%date:~5,2%%date:~8,2%
set BACKUP_DIR=data\backups
set BACKUP_FILE=%BACKUP_DIR%\wms_db_%TODAY%.sql

if not exist %BACKUP_DIR% mkdir %BACKUP_DIR%

echo [1/2] pg_dump 実行 → %BACKUP_FILE%
docker exec wms_db pg_dump -U wms_user -d wms_db --format=plain --no-owner --no-acl > %BACKUP_FILE%
if errorlevel 1 (
  echo [ERROR] バックアップ失敗
  exit /b 1
)

echo [2/2] 7 日以上前のバックアップを削除
forfiles /P %BACKUP_DIR% /M wms_db_*.sql /D -7 /C "cmd /c del @path" 2>nul

echo.
echo バックアップ完了: %BACKUP_FILE%
for %%a in (%BACKUP_FILE%) do echo   サイズ: %%~za bytes
