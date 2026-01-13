@echo off
:: ============================================================
:: OceanZ Sync Service Launcher
:: ============================================================
:: This script starts the Firebase-based sync service with
:: automatic scheduled syncs:
::   - Terminal Status: Every 2 minutes (from FDB)
::   - FDB + Leaderboards: Every 15 minutes
::
:: To auto-start on boot, run setup_sync_service.bat once
:: (with Administrator privileges)
::
:: Scripts location: C:\oceanz0604.github.io\scripts
:: ============================================================

:: Set UTF-8 encoding for console output
chcp 65001 >nul 2>&1
set PYTHONIOENCODING=utf-8

title OceanZ Sync Service

echo.
echo  ====================================================
echo   OceanZ Sync Service
echo  ====================================================
echo   Auto-Sync Schedule:
echo     - Terminals:   Every 2 minutes (from FDB)
echo     - FDB Data:    Every 15 minutes
echo     - Leaderboards: Every 15 minutes
echo     - Manual:      Via Firebase request (Web UI)
echo  ====================================================
echo.

:: Set the scripts directory (absolute path)
set SCRIPTS_DIR=C:\oceanz0604.github.io\scripts

:: Check if scripts directory exists
if not exist "%SCRIPTS_DIR%" (
    echo [ERROR] Scripts directory not found: %SCRIPTS_DIR%
    echo Please ensure the scripts are in the correct location.
    pause
    exit /b 1
)

:: Change to scripts directory
cd /d "%SCRIPTS_DIR%"
echo [INFO] Working directory: %CD%
echo.

:: Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH
    echo Please install Python 3.8+ and add it to PATH
    pause
    exit /b 1
)

:: Check if sync_service.py exists
if not exist "sync_service.py" (
    echo [ERROR] sync_service.py not found in %SCRIPTS_DIR%
    echo Please ensure all scripts are in the correct location.
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
