@echo off
rem Kira installer - launches the PowerShell script (reliable with Cyrillic text)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
echo.
pause
