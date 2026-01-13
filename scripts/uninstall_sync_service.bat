@echo off
:: ============================================================
:: OceanZ Sync Service - Uninstall Script
:: ============================================================
:: Removes the scheduled task (auto-start on boot)
:: Run with Administrator privileges
:: ============================================================

setlocal

title OceanZ Sync Service - Uninstall

echo.
echo  ============================================================
echo   OceanZ Sync Service - Uninstall
echo  ============================================================
echo.

:: Check for admin privileges
net session >nul 2>&1
if errorlevel 1 (
    echo [ERROR] This script requires Administrator privileges!
    echo.
    echo Please right-click this file and select "Run as administrator"
    echo.
    pause
    exit /b 1
)

set "TASK_NAME=OceanZ Sync Service"

echo [INFO] Removing scheduled task: "%TASK_NAME%"
echo.

schtasks /query /tn "%TASK_NAME%" >nul 2>&1
if errorlevel 1 (
    echo [WARN] Task not found - may already be uninstalled
) else (
    schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Failed to remove scheduled task
    ) else (
        echo [OK] Scheduled task removed successfully!
    )
)

echo.
echo  ============================================================
echo   UNINSTALL COMPLETE
echo  ============================================================
echo.
echo   The sync service will no longer auto-start on boot.
echo.
echo   Note: The script files are still in place.
echo   You can manually run start_sync_service.bat if needed.
echo.
echo   To re-install, run: setup_sync_service.bat
echo.
echo  ============================================================
echo.

pause
