@echo off
title Sosimple Data Sync
cd /d "%~dp0"
if not exist node_modules (
  echo Installing sync program for the first time...
  call npm install --omit=dev
)
if not exist .env if not exist "%USERPROFILE%\.sosimple-sync.env" (
  echo.
  echo  Missing settings. Copy .env.example to %USERPROFILE%\.sosimple-sync.env and fill in the Supabase keys.
  pause
  exit /b 1
)
node data-sync.js
pause
