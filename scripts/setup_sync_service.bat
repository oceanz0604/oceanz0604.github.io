@echo off
:: ============================================================
:: OceanZ Sync Service - One-Time Setup Script
:: ============================================================
:: This script will:
::   1. Check Python installation
::   2. Install required Python packages
::   3. Create a Windows Scheduled Task to auto-start on boot
::   4. Optionally start the service immediately
::
:: Run this script ONCE with Administrator privileges!
:: Right-click -> "Run as administrator"
:: ============================================================

setlocal EnableDelayedExpansion

:: Set UTF-8 encoding
chcp 65001 >nul 2>&1
set PYTHONIOENCODING=utf-8

title OceanZ Sync Service - Setup

echo.
echo  ============================================================
echo   OceanZ Sync Service - One-Time Setup
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

echo [OK] Running with Administrator privileges
echo.

:: ============================================================
:: CONFIGURATION - Update these paths if needed
:: ============================================================
set "SCRIPTS_DIR=C:\oceanz0604.github.io\scripts"
set "TASK_NAME=OceanZ Sync Service"
set "PYTHON_PATH=python"

:: ============================================================
:: Step 1: Check Python Installation
:: ============================================================
echo [1/5] Checking Python installation...

%PYTHON_PATH% --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH!
    echo.
    echo Please install Python 3.8+ from https://python.org
    echo Make sure to check "Add Python to PATH" during installation
    echo.
    pause
    exit /b 1
)

for /f "tokens=2" %%i in ('%PYTHON_PATH% --version 2^>^&1') do set PYTHON_VERSION=%%i
echo [OK] Python %PYTHON_VERSION% found
echo.

:: ============================================================
:: Step 2: Check/Create Scripts Directory
:: ============================================================
echo [2/5] Checking scripts directory...

if not exist "%SCRIPTS_DIR%" (
    echo [WARN] Scripts directory not found: %SCRIPTS_DIR%
    echo [INFO] Creating directory...
    mkdir "%SCRIPTS_DIR%" 2>nul
    if errorlevel 1 (
        echo [ERROR] Failed to create directory
        pause
        exit /b 1
    )
)

:: Copy current scripts if we're in a different location
set "CURRENT_DIR=%~dp0"
if /i not "%CURRENT_DIR%"=="%SCRIPTS_DIR%\" (
    echo [INFO] Copying scripts to %SCRIPTS_DIR%...
    xcopy /Y /Q "%CURRENT_DIR%*.py" "%SCRIPTS_DIR%\" >nul 2>&1
    xcopy /Y /Q "%CURRENT_DIR%*.bat" "%SCRIPTS_DIR%\" >nul 2>&1
    xcopy /Y /Q "%CURRENT_DIR%*.json" "%SCRIPTS_DIR%\" >nul 2>&1
)

echo [OK] Scripts directory ready: %SCRIPTS_DIR%
echo.

:: ============================================================
:: Step 3: Install Python Dependencies
:: ============================================================
echo [3/5] Installing Python dependencies...

%PYTHON_PATH% -m pip install --upgrade pip >nul 2>&1

echo      Installing firebase-admin...
%PYTHON_PATH% -m pip install firebase-admin >nul 2>&1
if errorlevel 1 (
    echo [WARN] firebase-admin installation may have issues
) else (
    echo      [OK] firebase-admin installed
)

echo      Installing fdb (Firebird driver)...
%PYTHON_PATH% -m pip install fdb >nul 2>&1
if errorlevel 1 (
    echo [WARN] fdb installation may have issues
) else (
    echo      [OK] fdb installed
)

echo [OK] Python dependencies installed
echo.

:: ============================================================
:: Step 4: Remove existing task (if any)
:: ============================================================
echo [4/5] Configuring Windows Scheduled Task...

:: Delete existing task if it exists
schtasks /query /tn "%TASK_NAME%" >nul 2>&1
if not errorlevel 1 (
    echo      Removing existing task...
    schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1
)

:: ============================================================
:: Step 5: Create Windows Scheduled Task
:: ============================================================
:: Create the task to run at logon with highest privileges

echo      Creating scheduled task: "%TASK_NAME%"

:: Create XML task definition for more control
set "TASK_XML=%TEMP%\oceanz_sync_task.xml"

(
echo ^<?xml version="1.0" encoding="UTF-16"?^>
echo ^<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"^>
echo   ^<RegistrationInfo^>
echo     ^<Description^>OceanZ Gaming Cafe Sync Service - Syncs FDB database with Firebase^</Description^>
echo   ^</RegistrationInfo^>
echo   ^<Triggers^>
echo     ^<LogonTrigger^>
echo       ^<Enabled^>true^</Enabled^>
echo     ^</LogonTrigger^>
echo   ^</Triggers^>
echo   ^<Principals^>
echo     ^<Principal id="Author"^>
echo       ^<LogonType^>InteractiveToken^</LogonType^>
echo       ^<RunLevel^>HighestAvailable^</RunLevel^>
echo     ^</Principal^>
echo   ^</Principals^>
echo   ^<Settings^>
echo     ^<MultipleInstancesPolicy^>IgnoreNew^</MultipleInstancesPolicy^>
echo     ^<DisallowStartIfOnBatteries^>false^</DisallowStartIfOnBatteries^>
echo     ^<StopIfGoingOnBatteries^>false^</StopIfGoingOnBatteries^>
echo     ^<AllowHardTerminate^>true^</AllowHardTerminate^>
echo     ^<StartWhenAvailable^>true^</StartWhenAvailable^>
echo     ^<RunOnlyIfNetworkAvailable^>false^</RunOnlyIfNetworkAvailable^>
echo     ^<IdleSettings^>
echo       ^<StopOnIdleEnd^>false^</StopOnIdleEnd^>
echo       ^<RestartOnIdle^>false^</RestartOnIdle^>
echo     ^</IdleSettings^>
echo     ^<AllowStartOnDemand^>true^</AllowStartOnDemand^>
echo     ^<Enabled^>true^</Enabled^>
echo     ^<Hidden^>false^</Hidden^>
echo     ^<RunOnlyIfIdle^>false^</RunOnlyIfIdle^>
echo     ^<DisallowStartOnRemoteAppSession^>false^</DisallowStartOnRemoteAppSession^>
echo     ^<UseUnifiedSchedulingEngine^>true^</UseUnifiedSchedulingEngine^>
echo     ^<WakeToRun^>false^</WakeToRun^>
echo     ^<ExecutionTimeLimit^>PT0S^</ExecutionTimeLimit^>
echo     ^<Priority^>7^</Priority^>
echo     ^<RestartOnFailure^>
echo       ^<Interval^>PT1M^</Interval^>
echo       ^<Count^>3^</Count^>
echo     ^</RestartOnFailure^>
echo   ^</Settings^>
echo   ^<Actions Context="Author"^>
echo     ^<Exec^>
echo       ^<Command^>%SCRIPTS_DIR%\start_sync_service.bat^</Command^>
echo       ^<WorkingDirectory^>%SCRIPTS_DIR%^</WorkingDirectory^>
echo     ^</Exec^>
echo   ^</Actions^>
echo ^</Task^>
) > "%TASK_XML%"

:: Import the task
schtasks /create /tn "%TASK_NAME%" /xml "%TASK_XML%" /f >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Failed to create scheduled task
    echo         Trying alternative method...
    
    :: Fallback: simpler task creation
    schtasks /create /tn "%TASK_NAME%" /tr "\"%SCRIPTS_DIR%\start_sync_service.bat\"" /sc onlogon /rl highest /f >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Could not create scheduled task
        del "%TASK_XML%" 2>nul
        pause
        exit /b 1
    )
)

del "%TASK_XML%" 2>nul

echo [OK] Scheduled task created successfully!
echo.

:: ============================================================
:: Summary and Next Steps
:: ============================================================
echo  ============================================================
echo   SETUP COMPLETE!
echo  ============================================================
echo.
echo   The sync service is now configured to:
echo     - Start automatically when you log in to Windows
echo     - Sync terminal status every 2 minutes
echo     - Sync FDB database every 15 minutes
echo     - Listen for manual sync requests from Web UI
echo.
echo   Scripts Location: %SCRIPTS_DIR%
echo   Task Name: %TASK_NAME%
echo.
echo  ============================================================
echo.

:: Ask to start now
set /p START_NOW="Do you want to start the sync service now? (Y/N): "
if /i "%START_NOW%"=="Y" (
    echo.
    echo [INFO] Starting sync service...
    echo.
    start "" "%SCRIPTS_DIR%\start_sync_service.bat"
    echo [OK] Service started in a new window
) else (
    echo.
    echo [INFO] Service will start automatically on next login
)

echo.
echo  ============================================================
echo   USEFUL COMMANDS:
echo  ============================================================
echo.
echo   Start service manually:
echo     %SCRIPTS_DIR%\start_sync_service.bat
echo.
echo   View/manage scheduled task:
echo     taskschd.msc (Task Scheduler)
echo     Look for: "%TASK_NAME%"
echo.
echo   Uninstall (remove scheduled task):
echo     schtasks /delete /tn "%TASK_NAME%" /f
echo.
echo  ============================================================
echo.

pause
