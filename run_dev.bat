@echo off
setlocal ENABLEDELAYEDEXPANSION
rem === Set UTF-8 code page to avoid mojibake ===
chcp 65001 >nul

rem === Move to script directory ===
cd /d "%~dp0"

rem === Create venv if missing (first run) ===
if not exist ".venv" (
  echo [setup] creating venv...
  py -3 -m venv .venv
)

rem === Activate venv ===
call .venv\Scripts\activate

rem === Install dependencies (continue even if it fails) ===
echo [setup] pip install -r requirements.txt
pip install -r requirements.txt
if errorlevel 1 (
  echo [warn] pip install failed, continuing assuming dependencies are already installed.
)

rem === Initialize DB if missing ===
if not exist "data" mkdir "data" 2>nul
if not exist "data\app.sqlite" (
  echo [setup] initializing SQLite...
  python tools\init_db.py --db data\app.sqlite --schema db\schema.sql
)

rem === Start API ===
set TDB_AUTO_OPEN=0
set TDB_POOL_SIZE=4

echo.
echo [dev] starting server at http://127.0.0.1:8000/ui/
python -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload

echo.
echo [dev] server stopped.
pause
