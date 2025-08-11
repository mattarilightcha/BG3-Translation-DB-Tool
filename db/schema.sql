-- entries テーブル
CREATE TABLE entry_pairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    en_text TEXT NOT NULL,
    ja_text TEXT,
    source_name TEXT,
    priority INTEGER DEFAULT 100
);

-- FTS5 インデックス（全文検索用）
CREATE VIRTUAL TABLE entries_fts USING fts5(
    en_text, ja_text, content='entry_pairs', content_rowid='id'
);
