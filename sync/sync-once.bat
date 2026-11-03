@echo off
title Sosimple Data Sync - once
cd /d "%~dp0"
if not exist node_modules call npm install --omit=dev
node data-sync.js --once
pause
