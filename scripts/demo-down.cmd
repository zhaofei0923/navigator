@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0demo-down.ps1" %*
exit /b %ERRORLEVEL%
