# Translation DB Tool (WebUI + DB + Query Mode)

これは「英⇄日 対訳DB」をローカルで管理・検索し、照会モードでGeminiなどのLLMに渡す最小資料を生成するツールの初期スキャフォールドです。

- DB: SQLite + FTS5
- API: FastAPI
- UI: (後続PRで実装) React/Vite or HTMX-lite
- インポート: CSV (A=EN, B=JA, UTF-8, ヘッダー1行あり) / XML (english.loca.xml, japanese.loca.xml)

## 使い方（ローカル最小）
```bash
# 初回（Python 3.11+ 推奨）
python -m venv .venv
source .venv/bin/activate  # Windowsは .venv\\Scripts\\activate
pip install -r requirements.txt

# DBスキーマ作成
python tools/init_db.py --db data/app.sqlite --schema db/schema.sql

# (任意) サンプル取込
python importers/import_csv.py --db data/app.sqlite --src samples/glossary.csv --source-name "BG3_official_glossary.csv" --priority 80
python importers/import_xml.py --db data/app.sqlite --en samples/english.loca.xml --ja samples/japanese.loca.xml --src-name-EN "english.loca.xml" --src-name-JA "japanese.loca.xml" --priority 100

# API起動
uvicorn api.main:app --reload
