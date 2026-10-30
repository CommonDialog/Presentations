@echo off
SET ROOT_DIR=%~dp0

echo Starting AICRM Backend Server in a new window...
start "AICRM Backend (Port 3001)" cmd /k "cd /d "%ROOT_DIR%server" && npm run dev"

echo Starting AICRM Frontend Client in a new window...
start "AICRM Frontend (Port 5173)" cmd /k "cd /d "%ROOT_DIR%client" && npm run dev"

echo Both windows launched!
echo   Backend API : http://localhost:3001
echo   Frontend UI : http://localhost:5173
