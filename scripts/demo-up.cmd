@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0demo-up.ps1" %*
exit /b %ERRORLEVEL%
