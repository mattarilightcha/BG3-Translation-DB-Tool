@echo off
setlocal ENABLEDELAYEDEXPANSION

rem === スクリプトのある場所へ移動 ===
cd /d "%~dp0"

rem === 仮想環境が無ければ作成（初回のみ）===
if not exist ".venv" (
  echo [setup] creating venv...
  py -3 -m venv .venv
)

rem === 仮想環境を有効化 ===
call .venv\Scripts\activate

rem === 依存をインストール（失敗してもサーバは起動できるよう続行）===
echo [setup] pip install -r requirements.txt
pip install -r requirements.txt
if errorlevel 1 (
  echo [warn] requirements のインストールでエラーが出ましたが、既に入っていれば続行します。
)

rem === DBが無ければ初期化 ===
if not exist "data" mkdir data
if not exist "data\app.sqlite" (
  echo [setup] initializing SQLite...
  python tools\init_db.py --db data\app.sqlite --schema db\schema.sql
)

rem === API起動（起動時にUIを自動オープン）===
set TDB_AUTO_OPEN=0
set TDB_POOL_SIZE=4

echo.
echo [dev] starting server at http://127.0.0.1:8000/ui/
python -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload

echo.
echo [dev] server stopped.
pause
