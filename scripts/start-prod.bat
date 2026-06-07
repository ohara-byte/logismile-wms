@echo off
chcp 65001 >nul
REM ===================================================================
REM WMS production startup script
REM   Postgres / pgAdmin (Docker) -> Next.js production server
REM
REM Usage: double-click, or run from scheduled task.
REM Stop:  scripts\stop-prod.bat
REM ===================================================================

cd /d "%~dp0\.."

echo [1/3] Starting Docker (Postgres / pgAdmin) ...
docker compose up -d
if errorlevel 1 (
  echo [ERROR] Docker failed to start. Check Docker Desktop.
  pause
  exit /b 1
)

echo [2/3] Waiting for Postgres (max 30 sec) ...
set /a count=0
:wait_postgres
docker exec wms_db pg_isready -U wms_user -d wms_db >nul 2>&1
if %errorlevel% == 0 goto postgres_ready
set /a count+=1
if %count% geq 30 (
  echo [ERROR] Postgres not ready.
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait_postgres
:postgres_ready
echo   Postgres ready.

echo [3/3] Starting Next.js (port 3000) ...
echo   URL: http://192.168.1.139:3000
echo   Closing this window will stop the server.
echo.
call npm run start
echo.
echo ============================================================
echo   Server has stopped or failed to start. Check messages above.
echo   Press any key to close this window.
echo ============================================================
pause
