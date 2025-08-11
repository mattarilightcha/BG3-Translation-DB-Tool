# scripts/import_data.py
import sqlite3
import csv
import xml.etree.ElementTree as ET
import argparse
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DB_PATH_DEFAULT = REPO_ROOT / "data" / "app.sqlite"   # ← ここが DB の場所

def ensure_db(db_path: Path):
    if not db_path.exists():
        raise SystemExit(f"DB not found: {db_path}. 先に DB を初期化してください: python tools/init_db.py --db data/app.sqlite --schema db/schema.sql")

def import_csv(db_path: Path, src: Path, source_name: str):
    ensure_db(db_path)
    with sqlite3.connect(db_path) as con, open(src, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader, None)  # 1行目はヘッダーなので読み飛ばす
        rows = 0
        for row in reader:
            if len(row) < 2:
                continue
            en = (row[0] or "").strip()
            ja = (row[1] or "").strip()
            if not en and not ja:
                continue
            con.execute(
                "INSERT INTO entry_pairs (en_text, ja_text, source_name) VALUES (?,?,?)",
                (en, ja, source_name)
            )
            rows += 1
    print(f"[CSV] imported {rows} rows from {src}")

def import_xml(db_path: Path, en_file: Path, ja_file: Path, source_name_en: str, source_name_ja: str):
    ensure_db(db_path)
    en_root = ET.parse(en_file).getroot()
    ja_root = ET.parse(ja_file).getroot()

    # uid→text の辞書に
    en_map = {e.attrib.get("contentuid"): (e.text or "").strip() for e in en_root.findall(".//content")}
    ja_map = {e.attrib.get("contentuid"): (e.text or "").strip() for e in ja_root.findall(".//content")}

    inserted = 0
    with sqlite3.connect(db_path) as con:
        for uid, en_text in en_map.items():
            ja_text = ja_map.get(uid, "")
            con.execute(
                "INSERT INTO entry_pairs (en_text, ja_text, source_name) VALUES (?,?,?)",
                (en_text, ja_text, f"{source_name_en}/{source_name_ja}")
            )
            inserted += 1
    print(f"[XML] paired insert {inserted} rows from {en_file.name} + {ja_file.name}")

def rebuild_fts(db_path: Path):
    # FTS5 (content=entry_pairs) を再構築
    with sqlite3.connect(db_path) as con:
        con.execute("INSERT INTO entries_fts(entries_fts) VALUES('rebuild');")
    print("[FTS] rebuilt")

def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    s_csv = sub.add_parser("csv", help="CSV import (A列=EN, B列=JA, UTF-8, header=1行)")
    s_csv.add_argument("--db", default=str(DB_PATH_DEFAULT))
    s_csv.add_argument("--src", required=True)
    s_csv.add_argument("--source-name", required=True)

    s_xml = sub.add_parser("xml", help="XML import (english.loca.xml + japanese.loca.xml)")
    s_xml.add_argument("--db", default=str(DB_PATH_DEFAULT))
    s_xml.add_argument("--en", required=True)
    s_xml.add_argument("--ja", required=True)
    s_xml.add_argument("--src-name-EN", required=True)
    s_xml.add_argument("--src-name-JA", required=True)

    s_fts = sub.add_parser("reindex", help="Rebuild FTS index from entry_pairs")
    s_fts.add_argument("--db", default=str(DB_PATH_DEFAULT))

    args = ap.parse_args()
    dbp = Path(args.db)

    if args.cmd == "csv":
        import_csv(dbp, Path(args.src), args.source_name)
        rebuild_fts(dbp)
    elif args.cmd == "xml":
        import_xml(dbp, Path(args.en), Path(args.ja), args.src_name_EN, args.src_name_JA)
        rebuild_fts(dbp)
    elif args.cmd == "reindex":
        rebuild_fts(dbp)

if __name__ == "__main__":
    main()
