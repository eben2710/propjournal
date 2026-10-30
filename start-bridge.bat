@echo off
title PropJournal Bridge (port 8787)
cd /d "%~dp0"
echo Starting PropJournal bridge...
node ctrader_bridge.js
pause
