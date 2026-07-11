@echo off
rem ── Запуск Kira (готовая собранная версия, без консоли разработчика) ──
cd /d "%~dp0"

if not exist "out\main\index.js" (
  echo Первая сборка Kira, подождите...
  call npm run build
)

start "" "node_modules\electron\dist\electron.exe" .
exit
