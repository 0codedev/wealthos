@echo off
cd /d "%~dp0"
:: Clear system proxy env vars so Python httpx/websockets don't fail on socks4:// proxies
set HTTP_PROXY=
set HTTPS_PROXY=
set ALL_PROXY=
set SOCKS_PROXY=
set http_proxy=
set https_proxy=
set all_proxy=
set socks_proxy=
echo ===================================================
echo   Starting Wealth Dashboard v2 - Python NSE Bridge
echo ===================================================

:: Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH!
    echo Please install Python 3.10+ and try again.
    pause
    exit /b 1
)

:: Set up virtual environment if it doesn't exist
if not exist .venv (
    echo [INFO] Creating Python virtual environment in .venv...
    python -m venv .venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create virtual environment!
        pause
        exit /b 1
      )
)

:: Activate virtual environment
echo [INFO] Activating virtual environment...
call .venv\Scripts\activate.bat

:: Install/Upgrade requirements
echo [INFO] Verifying dependencies...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies!
    pause
    exit /b 1
)

echo [INFO] Starting FastAPI server on http://127.0.0.1:8765 ...
echo Press Ctrl+C to stop.
uvicorn app:app --host 127.0.0.1 --port 8765 --reload

pause
