# Architecture Overview

## Layers
1. DB/Search: SQLite + FTS5 (unicode tokenizer)
2. API: FastAPI (/search, /query, /import)
3. UI: Query Mode first (table + export JSONL/TSV)
4. Importers: CSV(EN,JA) + XML(en/ja)

## Data Model (概念)
- sources(id, name, kind, lang, priority, checksum, imported_at)
- string_units(id, source_id, uid, lang, text_raw, version, text_plain, text_hash, source_row, created_at)
- entry_pairs(id, pair_key, key_kind, en_unit_id, ja_unit_id, en_source_id, ja_source_id, en_text, ja_text, en_version, ja_version, score_en, score_ja, decided_by, updated_at)
- pair_history(pair_id, changed_at, reason, prev_en_unit, prev_ja_unit)
- entries_fts (FTS5 external content = entry_pairs)

### 合体ロジック要約
- まず UID 一致で en/ja をペア化（priorityで採用）
- UIDが無ければ en.text_hash をキーに合流
- 競合は priority → version → updated_at

## Search/Query (照会)
- Exact > Phrase FTS > Token FTS の段階
- スコア: exact/uid/glossary/length を合成
- 出力は LLM向け最小: `{"term":"...","candidates":[["en","ja"], ...]}` JSONL or TSV

## 拡張性
- SearchAdapter 抽象（Meilisearch 差し替え口）
- EmbeddingAdapter 追加余地（ローカルONNX等）
