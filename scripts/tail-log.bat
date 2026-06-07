@echo off
REM ============================================================
REM サーバログをリアルタイム監視（tail -f 相当）
REM   サーバを起動した cmd 窓が見つからないときに使う。
REM   このスクリプトを実行すると、Next.js サーバの出力を
REM   別ウィンドウで PowerShell の Get-Content -Wait で追跡する。
REM
REM 注意: server-prod.bat 側でリダイレクトしていない場合、
REM   このスクリプトでは過去のログは見えない。
REM   印刷直後にログを確認したい場合は、サーバ起動 cmd 窓を直接見るのが確実。
REM ============================================================

echo Next.js サーバの cmd ウィンドウを探してください。
echo.
echo 起動済みの node.exe プロセス:
powershell.exe -Command "Get-Process node -ErrorAction SilentlyContinue | Select-Object Id, StartTime, MainWindowTitle | Format-Table -AutoSize"
echo.
echo もしサーバ cmd 窓が見つからない場合は、stop-prod.bat で停止 → start-prod.bat で再起動してください。
echo （新しい cmd 窓が前面で開きます）
echo.
pause
