@echo off
:: ============================================================
:: OceanZ Sync Service Launcher
:: ============================================================
:: This script starts the Firebase-based sync service with
:: automatic scheduled syncs:
::   - IP Logs: Every 2 minutes
::   - FDB Database: Every 15 minutes
::
:: Place this in Windows Startup folder to run automatically:
:: %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
:: ============================================================

title OceanZ Sync Service

echo.
echo  ====================================================
echo   OceanZ Sync Service
echo  ====================================================
echo   Auto-Sync Schedule:
echo     - IP Logs:     Every 2 minutes
echo     - FDB Data:    Every 15 minutes
echo     - Manual:      Via Firebase request (Web UI)
echo  ====================================================
echo.

cd /d "%~dp0"

:: Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH
    echo Please install Python 3.8+ and add it to PATH
    pause
    exit /b 1
)

:: Check if firebase_admin is installed
python -c "import firebase_admin" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing required packages...
    pip install firebase-admin fdb
    echo.
)

:: Run the sync service
echo [INFO] Starting sync service with auto-scheduling...
echo [INFO] Press Ctrl+C to stop
echo.

python sync_service.py

:: If we get here, service stopped
echo.
echo [INFO] Sync service stopped
pause
