import csv, argparse, sqlite3
from importers.common import normalize_plain, hash_text

ap = argparse.ArgumentParser()
ap.add_argument('--db', required=True)
ap.add_argument('--src', required=True)
ap.add_argument('--source-name', required=True)
ap.add_argument('--priority', type=int, default=80)
args = ap.parse_args()

con = sqlite3.connect(args.db)
cur = con.cursor()

# sources 登録（CSVはlang無しで2行作る代わりに lang=NULLでも可だが、ここではNoneで）
cur.execute("INSERT INTO sources(name, kind, priority) VALUES(?,?,?)", (args.source_name, 'csv', args.priority))
source_id = cur.lastrowid

with open(args.src, 'r', encoding='utf-8', newline='') as f:
    reader = csv.reader(f)
    header = next(reader, None)  # 1行スキップ
    for i, row in enumerate(reader, start=2):
        if not row: continue
        en = (row[0] or '').strip()
        ja = (row[1] or '').strip()
        if not en and not ja:
            continue
        # EN
        en_plain = normalize_plain(en, 'en')
        en_hash = hash_text(en_plain)
        cur.execute("""
            INSERT INTO string_units(source_id, uid, lang, text_raw, version, text_plain, text_hash, source_row)
            VALUES(?,?,?,?,?,?,?,?)
        """, (source_id, None, 'en', en, None, en_plain, en_hash, str(i)))
        en_id = cur.lastrowid
        # JA
        if ja:
            ja_plain = normalize_plain(ja, 'ja')
            ja_hash = hash_text(ja_plain)
            cur.execute("""
                INSERT INTO string_units(source_id, uid, lang, text_raw, version, text_plain, text_hash, source_row)
                VALUES(?,?,?,?,?,?,?,?)
            """, (source_id, None, 'ja', ja, None, ja_plain, ja_hash, str(i)))
            ja_id = cur.lastrowid
        else:
            ja_id = None

        # 合体: hashキー
        pair_key = en_hash
        key_kind = 'hash'
        cur.execute("SELECT id, ja_unit_id FROM entry_pairs WHERE pair_key=? AND key_kind=?", (pair_key, key_kind))
        rowp = cur.fetchone()
        if rowp:
            pid, cur_ja = rowp
            # JAが未設定なら埋める
            if ja_id and not cur_ja:
                cur.execute("UPDATE entry_pairs SET ja_unit_id=?, ja_text=(SELECT text_raw FROM string_units WHERE id=?), updated_at=CURRENT_TIMESTAMP WHERE id=?", (ja_id, ja_id, pid))
        else:
            cur.execute("""
                INSERT INTO entry_pairs(pair_key, key_kind, en_unit_id, ja_unit_id, en_text, ja_text, decided_by)
                VALUES(?,?,?,?,(SELECT text_raw FROM string_units WHERE id=?),(SELECT text_raw FROM string_units WHERE id=?),?)
            """, (pair_key, key_kind, en_id, ja_id, en_id, (ja_id or en_id), 'hash'))

con.commit()
con.close()
print("CSV import done")
