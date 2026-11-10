@echo off
echo Starting Practune Studio Frontend on http://127.0.0.1:5173 ...
cd /d "%~dp0frontend"
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173
pause
