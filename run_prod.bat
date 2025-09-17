@echo off
setlocal
rem === Set UTF-8 code page to avoid mojibake ===
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv" (
  py -3 -m venv .venv
)
call .venv\Scripts\activate

if not exist "data" mkdir "data" 2>nul
if not exist "data\app.sqlite" (
  echo [setup] initializing SQLite...
  python tools\init_db.py --db data\app.sqlite --schema db\schema.sql
)

set TDB_AUTO_OPEN=0
set TDB_POOL_SIZE=8

echo [prod] starting server at http://127.0.0.1:8000/ui/
python -m uvicorn api.main:app --host 127.0.0.1 --port 8000
