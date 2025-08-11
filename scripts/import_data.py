import sqlite3
import csv
import xml.etree.ElementTree as ET
import sys
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "db" / "translations.db"

def init_db():
    schema_path = Path(__file__).parent.parent / "db" / "schema.sql"
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript(schema_path.read_text(encoding="utf-8"))
    print("DB initialized.")

def import_csv(file_path, source_name):
    with sqlite3.connect(DB_PATH) as conn, open(file_path, newline="", encoding="utf-8") as csvfile:
        reader = csv.reader(csvfile)
        header = next(reader, None)  # 1行目がヘッダーなら読み飛ばし
        for row in reader:
            if len(row) < 2:
                continue
            en, ja = row[0].strip(), row[1].strip()
            conn.execute(
                "INSERT INTO entry_pairs (en_text, ja_text, source_name) VALUES (?, ?, ?)",
                (en, ja, source_name)
            )
    print(f"CSV imported: {file_path}")

def import_xml(en_file, ja_file, source_name):
    en_tree = ET.parse(en_file)
    ja_tree = ET.parse(ja_file)
    en_root = en_tree.getroot()
    ja_root = ja_tree.getroot()

    en_map = {e.attrib["contentuid"]: e.text for e in en_root.findall(".//content")}
    ja_map = {e.attrib["contentuid"]: e.text for e in ja_root.findall(".//content")}

    with sqlite3.connect(DB_PATH) as conn:
        for uid, en_text in en_map.items():
            ja_text = ja_map.get(uid, "")
            conn.execute(
                "INSERT INTO entry_pairs (en_text, ja_text, source_name) VALUES (?, ?, ?)",
                (en_text.strip(), ja_text.strip(), source_name)
            )
    print(f"XML imported: {en_file} + {ja_file}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage:")
        print("  python import_data.py init-db")
        print("  python import_data.py csv <file> <source_name>")
        print("  python import_data.py xml <en_file> <ja_file> <source_name>")
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "init-db":
        init_db()
    elif cmd == "csv":
        import_csv(sys.argv[2], sys.argv[3])
    elif cmd == "xml":
        import_xml(sys.argv[2], sys.argv[3], sys.argv[4])
