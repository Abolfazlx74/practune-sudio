@echo off
echo Starting Practune Studio Backend on http://127.0.0.1:8000 ...
cd /d "%~dp0"
backend\venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
pause
