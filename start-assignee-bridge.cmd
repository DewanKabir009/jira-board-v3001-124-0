@echo off
setlocal

cd /d "%~dp0"

start "JiraBridge" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-assignee-bridge.ps1"

endlocal
