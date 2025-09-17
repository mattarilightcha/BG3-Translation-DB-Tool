@echo off
setlocal
rem === 文字化け防止（UTF-8コードページに切替） ===
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv" (
  py -3 -m venv .venv
)
call .venv\Scripts\activate

if not exist "data" mkdir "data" 2>nul
if not exist "data\app.sqlite" (
  python tools\init_db.py --db data\app.sqlite --schema db\schema.sql
)

set TDB_AUTO_OPEN=0
set TDB_POOL_SIZE=8

python -m uvicorn api.main:app --host 127.0.0.1 --port 8000
