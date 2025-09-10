# BG3 Translation DB Tool
**【Baldur’s Gate 3】MOD日本語化・翻訳作業補助ツール**  
ローカルの辞書DB（SQLite/FTS5）で **検索・照会・編集・XMLインポート** を高速に行える、オフライン前提の作業ツールです。  
UI はブラウザ（シングルHTML/JS/CSS）、API は FastAPI で提供します。
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

### 検索（一覧）タブ
- キーワードで FTS 検索。`min_priority` で下限を設定可能。
- 行の **編集** をクリックで **インライン編集** → **保存**（Ctrl/Cmd + S でも保存）。
- 検索結果は TSV コピー可。  

### 照会（LLM補助）タブ
- 1行1語/フレーズで貼り付け、`Top-K` 件の候補を表示。
- オプション：**完全一致優先** / **単語境界（厳密）** / **min_priority**。
- **プロンプト前置**：プロンプトを選択し、コピー/保存（JSONL/TSV/CSV）の先頭へ自動で挿入できます。  

### インポート（XML）タブ
- EN/JA 両方の `.loca.xml` を指定。`ソース名（EN/JA）` と `priority` を設定して **XMLインポート**。
- ソース名は、選択したファイル名から自動生成されます（例：`english.xml` → `english_Loca EN`、`japanese.xml` → `japanese_Loca JP`）。必要に応じて手動で上書き可能です。
- 既定は **厳密モード**（`strict=True`）：**ID集合が完全一致しない場合は取り込みを拒否**し、詳細な差分を表示します。  
  - `only_in_en/only_in_ja` のサンプルID（上限つき）や、`common` 数をWebUIへそのまま出します。
- **上書き運用**（`replace_src=True`）：同じ `source_name` の既存行を一旦削除してから挿入します。
- FTS は取り込み完了時に自動で再構築されます。  

### 比較（XML差分）タブ
- EN/JA の XML から `contentuid` 単位で本文を抽出し、UIDごとに「原文 / 状態 / 備考」の3列で一覧表示します。
- 原文は Prism による XML ハイライトで見やすく表示（折返し有効・横スクロール不要）。
- 「JAなしをコピー」ボタンで、状態が「JAなし」の原文 XML だけをクリップボードへ一括コピーできます（余計な空行なし）。
- ヘッダーの「全幅」ボタンでページ全体をワイド表示に切替できます（状態は保存）。

### BG3 翻訳照合（MODと公式の突き合わせ）タブ
- MODの XML と、公式の EN/JA ディレクトリ群を突き合わせ、対応する訳を自動抽出します。
- 使い方の例（Windows）:
  - 基準フォルダ（任意）: 空欄のままで OK（既定は `data\bundles\bg3_official`）。
  - EN ディレクトリ: 未入力なら自動で `data\bundles\bg3_official\English` をセット。
  - JA ディレクトリ: 未入力なら自動で `data\bundles\bg3_official\Japanese` をセット。
  - 公式ファイルを別の場所に置いている場合は、EN/JA にフルパスを入れるか、基準フォルダ＋相対（`English`/`Japanese`）で指定します。
- オプション:
  - fuzzy: あいまい一致を使って近い文章も候補に含めます。
  - cutoff: fuzzy の厳しさ（0〜1）。1に近いほど厳密、0に近いほど緩やか（既定 0.92）。
  - workers: 並列処理数。PCが速い場合は 2〜4 に上げると高速化する場合があります。
- 出力:
  - matched.xml（JAあり＋JAなしを含む一覧）、unmatched.xml（EN未一致）、review.csv（fuzzy時の検証用）。
  - 「比較へ移行」ボタンで、結果をそのまま比較タブに持ち込み可能。

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

## 変更点（最近）
- 比較タブを「原文 / 状態 / 備考」の3列に刷新し、Prism による XML ハイライト・折返し表示を導入。
- 「JAなしをコピー」ボタンを追加（余計な空行なしでコピー）。
- ヘッダーに「全幅」ボタンを追加（ワイド表示切替）。
- BG3 翻訳照合タブをわかりやすい文言・ツールチップに整理。`基準フォルダ` は空欄でOK、EN/JAは未入力時に既定フォルダを自動セット。
- インポートのソース名を XML ファイル名から自動生成（`xxx_Loca EN` / `xxx_Loca JP`）。

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
