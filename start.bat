@echo off
title Pico Hydropower Dashboard Launcher
echo ===================================================
echo ⚡ Starting Pico Hydropower Dashboard Servers ⚡
echo ===================================================
echo.

:: Check for Node.js installation
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js (v18+) to run this project.
    pause
    exit /b
)

:: Start Backend Express & Socket Server in a separate window
echo [+] Starting Backend Server (Port 5000)...
start "Pico Hydropower Backend" cmd /k "cd backend && node server.js"

:: Start Frontend React Development Server in a separate window
echo [+] Starting Frontend React Server (Port 5173)...
start "Pico Hydropower Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo ===================================================
echo ✔️ Both servers have been launched!
echo.
echo - Backend: API & Socket.io stream on Port 5000
echo - Frontend: React SCADA Interface on Port 5173
echo ===================================================
echo.
echo Press any key to open the dashboard in your browser...
pause > nul

:: Open local dashboard in default browser
start http://localhost:5173
