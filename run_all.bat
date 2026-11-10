@echo off
echo ========================================================
echo   Launching Practune AI Music Analysis & Learning Studio
echo ========================================================
cd /d "%~dp0"
start "Practune Backend (FastAPI)" cmd /c run_backend.bat
start "Practune Frontend (Vite)" cmd /c run_frontend.bat
echo Both services started!
echo Frontend: http://127.0.0.1:5173
echo Backend:  http://127.0.0.1:8000/docs
