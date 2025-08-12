# BG3 Translation DB Tool
**【Baldur’s Gate 3】MOD日本語化・翻訳作業補助ツール**  
ローカルの辞書DB（SQLite/FTS5）で **検索・照会・編集・XMLインポート** を高速に行える、オフライン前提の作業ツールです。  
UI はブラウザ（シングルHTML/JS/CSS）、API は FastAPI で提供します。

> 画像を差し込む場合の目安：  
> - （画像：トップ画面・ダークテーマ / タブ「照会」）  
> - （画像：検索タブ・インライン編集中の行 / 保存ボタン）  
> - （画像：ソース選択メニュー・削除ボタンの例）  
> - （画像：XMLインポート欄・エラー詳細の表示例）  
> - （画像：プロンプト管理タブ・テンプレ一覧と本文）

---

## これは何？
- BG3（Baldur’s Gate 3）の MOD 翻訳（日本語化）を効率化するための **ローカル辞書＋UI**。
- **全文検索（FTS5）** と **完全一致の優先**、**単語境界（\b）厳密チェック** に対応。
- **UI でのインライン編集 → 保存**（FTSへ即時反映）。
- **XML（.loca.xml）インポート**：ID一致の **厳密モード**、**上書き運用（replace_src）**、**詳細な差分ログ**。
- **複数ソースの切り替え**：プルダウン＋チェックで対象を絞り込み。**ソース単位の削除**も可能。
- **エクスポート**：JSONL / TSV / CSV（照会結果、プロンプトの前置も可）。
- **プリセット・プロンプト管理**：複数パターンを保存し、照会タブで素早く切替。

### すぐ使える：DBと公式訳付き
リポジトリには **作成済みDB**（`data/app.sqlite`）を同梱。  
さらに **BG3 公式訳の XML / CSV** を同梱しているため、初回から検索・照会を試せます。  
（必要に応じて XML インポートから自分のファイルを追加／上書きしてください。）

> （画像：同梱DBでの検索結果サンプル）

---

## 動作要件
- Python 3.11+（3.12/3.13 でも可）
- Windows / macOS / Linux

> **lxml について**  
> `requirements.txt` に `lxml` が含まれていますが、**本ツールは標準の `xml.etree.ElementTree` で動作**します。  
> Windows で lxml のビルドに失敗する場合は、以下のいずれかで回避してください：  
> - 事前ビルド版を入れる：`pip install --only-binary=:all: lxml==5.2.2`  
> - あるいは `requirements.txt` の `lxml==...` 行を一時的にコメントアウトしてインストール（高速化機能を使わない方針）。

---

## クイックスタート

### 1) 仮想環境と依存関係
```powershell
# Windows (PowerShell)
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
```

```bash
# macOS / Linux
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

> **ビルドに失敗する場合**：上の「lxmlについて」を参照

### 2) サーバ起動（自動でWeb UIが開きます）
```powershell
# 開発用（ホットリロード）
.\run_dev.bat

# 本番用（リロードなし）
.\run_prod.bat
```
または手動で：
```bash
uvicorn api.main:app --reload
# → http://127.0.0.1:8000/ui/
```

---

## UIの使い方（主なタブ）

### ソース選択（ルート）
- 「ソース選択」 → チェックONのソースだけが検索・照会対象になります。（未選択＝全ソース）
- 右側に件数表示。状態はブラウザの `localStorage` に保存。
- **削除**：メニュー内の「🗑️」からソース単位で削除（`DELETE /sources/{source_name}` を呼びます）。  
  > （画像：ソース選択メニュー・削除アイコン）

### 検索（一覧）タブ
- キーワードで FTS 検索。`min_priority` で下限を設定可能。
- 行の **編集** をクリックで **インライン編集** → **保存**（Ctrl/Cmd + S でも保存）。
- 検索結果は TSV コピー可。  
  > （画像：検索タブ・インライン編集の様子）

### 照会（LLM補助）タブ
- 1行1語/フレーズで貼り付け、`Top-K` 件の候補を表示。
- オプション：**完全一致優先** / **単語境界（厳密）** / **min_priority**。
- **プロンプト前置**：プロンプトを選択し、コピー/保存（JSONL/TSV/CSV）の先頭へ自動で挿入できます。  
  > （画像：照会タブ・出力とプロンプト前置の例）

### インポート（XML）タブ
- EN/JA 両方の `.loca.xml` を指定。`src_en` / `src_ja` / `priority` を設定して **XMLインポート**。
- 既定は **厳密モード**（`strict=True`）：**ID集合が完全一致しない場合は取り込みを拒否**し、詳細な差分を表示します。  
  - `only_in_en/only_in_ja` のサンプルID（上限つき）や、`common` 数をWebUIへそのまま出します。
- **上書き運用**（`replace_src=True`）：同じ `source_name` の既存行を一旦削除してから挿入します。
- FTS は取り込み完了時に自動で再構築されます。  
  > （画像：XMLインポート欄・エラー詳細の表示例）

### プロンプト管理タブ
- 任意のプロンプトを複数保存（名前＋本文）。
- 既定に設定したプロンプトは、照会タブで自動選択されます。  
  > （画像：プロンプト管理タブ）

---

## API（抜粋）

| Method/Path | 説明 |
|---|---|
| `GET /health` | ヘルスチェック |
| `GET /sources` | ソース一覧（`name` と件数） |
| `DELETE /sources/{source_name}` | 指定ソースを全削除（FTS再構築） |
| `GET /search?q=...&size=...&min_priority=...&sources=...` | FTS検索（フレーズ→0件なら語句） |
| `POST /query` | 照会（Top-K 候補、完全一致優先、単語境界など） |
| `GET /entry/{id}` | 行を取得（インライン編集用） |
| `PATCH /entry/{id}` | 行を更新 → FTS差し替え |
| `POST /import/xml` | EN/JA の `.loca.xml` をインポート（`strict`/`replace_src` あり） |

### `/import/xml` の挙動（重要）
- `source_name` は `XML:{src_en}|{src_ja}` の形式。
- **厳密モード（strict=True）**：EN/JAのID集合が一致しない場合、`400` で **差分詳細** を返します。  
  WebUI はこれをそのまま読み、画面に見やすく表示します。
- **上書き（replace_src=True）**：同名ソースを **一括削除してから挿入**。  
- **ユニーク性**：`(source_name, entry_key)` の組でUPSERT可能な設計（インポートでは `entry_key="xmlid:{id}"` を使用）。

---

## データベース
- メインテーブル：`entry_pairs(id INTEGER PK, en_text, ja_text, source_name, priority, entry_key)`  
- FTS5：`entries_fts(en_text, ja_text)`（contentless ではなく影テーブル、保存時に更新）
- 代表的な運用：
  - 公式訳（ソース例：`Loca EN/Loca JP`、`BG3 Official`）
  - MOD毎の XML を `XML:...` で取り込み、必要に応じて上書き・削除

---

## よくある質問（FAQ）
**Q. インストール時に lxml のビルドで落ちます**  
A. 回避策は上記「lxmlについて」を参照。標準 `xml.etree` だけでも動作します。

**Q. インポートが 0 行になった**  
A. `strict=True` で ID集合が完全一致していない可能性があります。UI のエラー詳細を確認し、元XMLを整合させてください。

**Q. 検索で何も出ない**  
A. ソースの絞り込みがかかっていないか確認してください（メニュー「ソース選択」）。また、フレーズ検索 → 0件時に語句検索へ自動フォールバックします。

---

## ライセンス
MIT License（同梱の `LICENSE` を参照）。

## 謝辞
- Larian Studios / Baldur’s Gate 3  
- 公式訳・有志MOD翻訳コミュニティの皆さまに感謝します。

---

## 開発メモ
- Python: FastAPI + Uvicorn。UIはプレーンな HTML/CSS/JS。
- FTS: `bm25()` によるスコアで昇順。フレーズ検索を優先し、0件時のみ語句へ。  
- 今後：CSV/TSV一括インポート、差分マージ、さらに高精度の正規化などを検討中。
