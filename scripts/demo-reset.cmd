@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0demo-reset.ps1" %*
exit /b %ERRORLEVEL%
