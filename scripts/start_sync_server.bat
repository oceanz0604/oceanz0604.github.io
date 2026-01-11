@echo off
title OceanZ Sync Server
cd /d "%~dp0"

echo ================================================
echo    OceanZ Gaming Cafe - Sync Server
echo ================================================
echo.
echo Starting sync server on http://127.0.0.1:5555
echo.
echo Press Ctrl+C to stop
echo.

python sync_server.py

if %errorlevel% neq 0 (
    echo.
    echo ERROR: Failed to start server.
    echo Make sure Python is installed and in PATH.
    pause
)

