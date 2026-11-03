@echo off
title Sosimple Data Sync - setup
cd /d "%~dp0"
echo.
echo  ============================================================
echo    Sosimple Data Sync - one-time setup
echo  ============================================================
echo.
echo  1. In Supabase open:  Project Settings  ^>  API Keys
echo  2. Find the "service_role" key (or the "secret" key), click Reveal, then Copy.
echo  3. Come back to this window, RIGHT-CLICK to paste it, and press Enter.
echo.
set "KEY="
set /p "KEY=  Paste the key here and press Enter: "
if "%KEY%"=="" (
  echo.
  echo  No key was pasted. Close this window and try again.
  pause
  exit /b 1
)
set "SETTINGS=%USERPROFILE%\.sosimple-sync.env"
> "%SETTINGS%" echo SUPABASE_URL=https://faumtfvntlmshakuvmwq.supabase.co
>> "%SETTINGS%" echo SUPABASE_SERVICE_ROLE_KEY=%KEY%
>> "%SETTINGS%" echo DATA_FILE=%~dp0..\Data.xlsx
>> "%SETTINGS%" echo DEBOUNCE_SECONDS=5
>> "%SETTINGS%" echo POLL_SECONDS=60
set "KEY="
echo.
echo  Settings saved to %SETTINGS%
echo  (outside OneDrive, so the key is not shared with the team drive)
echo.
if not exist node_modules (
  echo  Installing the sync program - this takes about a minute the first time...
  call npm install --omit=dev
)
echo.
echo  Testing - reading Data.xlsx (nothing is uploaded yet)...
echo.
node data-sync.js --dry-run
echo.
echo  If you see "Sync finished" above, setup is done.
echo  Next: double-click start-sync.bat to start the live sync.
echo.
pause
