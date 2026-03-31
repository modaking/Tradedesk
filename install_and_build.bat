@echo off
:: ============================================================
:: TradeDesk — Windows Install & Build Script
:: ============================================================
:: Usage: Double-click this file OR run from Command Prompt:
::   install_and_build.bat
::
:: What this script does:
::   1. Checks for Python 3.9+
::   2. Creates a virtual environment in .venv\
::   3. Installs all pip dependencies
::   4. Downloads Chart.js locally (offline requirement)
::   5. Builds a single-file Windows executable with PyInstaller
:: ============================================================

setlocal enabledelayedexpansion

echo.
echo  ████████╗██████╗  █████╗ ██████╗ ███████╗██████╗ ███████╗███████╗██╗  ██╗
echo  ╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗██╔════╝██╔════╝██║ ██╔╝
echo     ██║   ██████╔╝███████║██║  ██║█████╗  ██║  ██║█████╗  ███████╗█████╔╝
echo     ██║   ██╔══██╗██╔══██║██║  ██║██╔══╝  ██║  ██║██╔══╝  ╚════██║██╔═██╗
echo     ██║   ██║  ██║██║  ██║██████╔╝███████╗██████╔╝███████╗███████║██║  ██╗
echo     ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝
echo.
echo                  Sales ^& Inventory Dashboard — Setup
echo  ─────────────────────────────────────────────────────────────────────────
echo.

:: ── Check Python ──────────────────────────────────────────────────────────────
where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.9+ from https://python.org
    pause & exit /b 1
)

for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo [INFO]  Python found: %PYVER%

:: ── Virtual environment ───────────────────────────────────────────────────────
if not exist ".venv" (
    echo [INFO]  Creating virtual environment...
    python -m venv .venv
    if errorlevel 1 ( echo [ERROR] Failed to create venv. & pause & exit /b 1 )
) else (
    echo [INFO]  Virtual environment already exists — skipping creation.
)

call .venv\Scripts\activate.bat

:: ── Install dependencies ──────────────────────────────────────────────────────
echo [INFO]  Installing Python packages...
pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet
if errorlevel 1 ( echo [ERROR] pip install failed. & pause & exit /b 1 )
echo [OK]    Packages installed.

:: ── Download Chart.js locally (offline requirement) ───────────────────────────
set CHARTJS_DIR=frontend\static\libs
set CHARTJS_FILE=%CHARTJS_DIR%\chart.umd.min.js
if not exist "%CHARTJS_DIR%" mkdir "%CHARTJS_DIR%"

if not exist "%CHARTJS_FILE%" (
    echo [INFO]  Downloading Chart.js 4.4 for offline use...
    powershell -Command "Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js' -OutFile '%CHARTJS_FILE%'" 2>nul
    if not exist "%CHARTJS_FILE%" (
        echo [WARN]  Could not download Chart.js. Copy chart.umd.min.js manually to %CHARTJS_DIR%\
    ) else (
        echo [OK]    Chart.js downloaded.
    )
) else (
    echo [INFO]  Chart.js already present — skipping download.
)

:: ── Create __init__.py files ──────────────────────────────────────────────────
if not exist "backend\__init__.py" type nul > "backend\__init__.py"
if not exist "backend\routes\__init__.py" type nul > "backend\routes\__init__.py"
if not exist "backend\models\__init__.py" type nul > "backend\models\__init__.py"
if not exist "backend\services\__init__.py" type nul > "backend\services\__init__.py"

:: ── Build with PyInstaller ────────────────────────────────────────────────────
echo.
echo [INFO]  Building Windows executable with PyInstaller...

set ICON_ARG=
if exist "tradedesk.ico" set ICON_ARG=--icon=tradedesk.ico

pyinstaller ^
    --onefile ^
    --windowed ^
    --name "TradeDesk" ^
    %ICON_ARG% ^
    --add-data "frontend;frontend" ^
    --add-data "backend;backend" ^
    --hidden-import flask_session ^
    --hidden-import bcrypt ^
    --hidden-import pandas ^
    --hidden-import openpyxl ^
    --hidden-import xlrd ^
    --hidden-import webview ^
    run.py

if errorlevel 1 (
    echo [ERROR] PyInstaller build failed.
    pause & exit /b 1
)

echo.
echo  ─────────────────────────────────────────────────────────────────────────
echo  [SUCCESS] Build complete!
echo.
echo  Executable:  dist\TradeDesk.exe
echo  Run it:      dist\TradeDesk.exe
echo  ─────────────────────────────────────────────────────────────────────────
echo.
pause
