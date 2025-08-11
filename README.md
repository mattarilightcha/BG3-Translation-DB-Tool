# Translation DB Tool (BG3 特化)

ローカルに **英⇄日 対訳DB** を構築し、**全文検索(FTS5)**・**照会(LLM補助)**・**UIからの直接編集**・**XML/CSVインポート** を行うツール。  
バルダーズゲート3の `.loca.xml` / 用語集 CSV を主対象。

## 主な機能
- **SQLite + FTS5**：bm25 による全文検索
- **検索（一覧）**：ヒット結果を **UIで直接編集→保存**（FTSも自動同期）
- **照会（LLM補助）**  
  - Top-K、完全一致優先、英語の単語境界厳密（`\b`）、長文抜粋、min_priority、**ソース名フィルタ**
  - ヒット箇所 **ハイライト**
  - **JSONL/TSV/CSV** 出力、**プロンプト前置**（テンプレ複数保存＆切替）
- **プロンプト管理**：localStorage に複数保存・既定化・切替
- **インポート**  
  - **XML ペア**（`english.loca.xml` + `japanese.loca.xml`）… `id` で対合わせ（UIからアップロード）
  - **CSV**（A=EN, B=JA, UTF-8、ヘッダ1行）※CLI/別スクリプトを利用
- **テーマ**：ダーク/ライト
- **ヘルス**：`/health`

---

## セットアップ

### 要件
- Python **3.11+**
- Windows 推奨（他OSでも可）

### 初期化
```bash
# 1) 仮想環境
py -m venv .venv
. .venv/Scripts/activate

# 2) 依存導入
pip install -r requirements.txt

# 3) DB 初期化
python tools/init_db.py --db data/app.sqlite --schema db/schema.sql
```

---

## 起動
```bash
uvicorn api.main:app --reload
# ブラウザで http://127.0.0.1:8000/ui
```

> Windows は `run.bat` を使えば一発起動（.venv 起動 → 依存導入 → DB初期化 → ブラウザ自動オープン）

---

## 使い方

### 検索（一覧）
1. 検索語を入れて **[検索]**  
2. 行の **[編集]** → EN/JA/source/priority を編集 → **[保存]**（**Ctrl+S** でも保存）
3. 保存は `/entry/{id} PATCH`、FTSも自動更新

### 照会（LLM補助）
1. 左テキスト窓に語/フレーズを**改行**で貼る  
2. Top-K、完全一致、単語境界、min_priority、**ソース選択**を指定  
3. **プロンプト**を選び、「コピー/保存に含める」をONにするとエクスポートへ前置  
   - JSONL：先頭行へ `{"type":"prompt","name":...,"prompt":...}` を追加  
   - TSV/CSV：プレーンテキストを前置 → 空行 → データ

### インポート（XML）
- UI：「**インポート**」タブで EN/JA XML を選択 → src/priority を入力 → **[XMLインポート]**  
  （EN/JA の `id` が一致する行を対訳として登録、完了後に FTS 再構築）

---

## API（抜粋）
- `GET /health` → `{ ok: true }`
- `GET /sources` → `{ sources: [{name, count}] }`
- `GET /search?q=...&size=...&max_len=...&min_priority=...&sources=...`  
  → `{ items: [{ id,en,ja,source,priority,score }], total }`
- `POST /query`
  ```json
  {
    "lines":["saving throw", "..."],
    "top_k":3, "max_len":240,
    "exact":true, "word_boundary":true,
    "min_priority":80, "sources":["BG3 Official", "Loca JP"]
  }
  ```
- `GET /entry/{id}` / `PATCH /entry/{id}`
- `POST /import/xml` (multipart：`enfile`, `jafile`, `src_en`, `src_ja`, `priority`)

---

## スキーマ
```sql
CREATE TABLE entry_pairs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  en_text TEXT NOT NULL,
  ja_text TEXT,
  source_name TEXT,
  priority INTEGER DEFAULT 100
);
CREATE VIRTUAL TABLE entries_fts USING fts5(
  en_text, ja_text, content='entry_pairs', content_rowid='id'
);
```

---

## トラブルシュート
- **検索が動かない**  
  → ブラウザの Console を確認。最新版の `ui/app.js` はイベントを安全バインド済み。  
  更新後は **Ctrl+F5**（ハードリロード）。
- **XML取り込みが長い**  
  → 正常。完了後に FTS を再構築します。
