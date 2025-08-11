import argparse, sqlite3
from lxml import etree
from importers.common import normalize_plain, hash_text

ap = argparse.ArgumentParser()
ap.add_argument('--db', required=True)
ap.add_argument('--en', required=True)
ap.add_argument('--ja', required=True)
ap.add_argument('--src-name-EN', required=True)
ap.add_argument('--src-name-JA', required=True)
ap.add_argument('--priority', type=int, default=100)
args = ap.parse_args()

con = sqlite3.connect(args.db)
cur = con.cursor()

cur.execute("INSERT INTO sources(name, kind, lang, priority) VALUES(?,?,?,?)", (args.src_name_EN, 'xml', 'en', args.priority))
src_en = cur.lastrowid
cur.execute("INSERT INTO sources(name, kind, lang, priority) VALUES(?,?,?,?)", (args.src_name_JA, 'xml', 'ja', args.priority))
src_ja = cur.lastrowid

# XML読み
parser = etree.XMLParser(recover=True)
root_en = etree.parse(args.en, parser).getroot()
root_ja = etree.parse(args.ja, parser).getroot()

# uid→テキストの辞書化
map_en = {}
for c in root_en.findall('.//content'):
    uid = c.get('contentuid')
    ver = int(c.get('version') or 0)
    txt = (c.text or '').strip()
    plain = normalize_plain(txt, 'en')
    h = hash_text(plain)
    cur.execute("""
      INSERT INTO string_units(source_id, uid, lang, text_raw, version, text_plain, text_hash)
      VALUES(?,?,?,?,?,?,?)
    """, (src_en, uid, 'en', txt, ver, plain, h))
    map_en[uid] = cur.lastrowid

map_ja = {}
for c in root_ja.findall('.//content'):
    uid = c.get('contentuid')
    ver = int(c.get('version') or 0)
    txt = (c.text or '').strip()
    plain = normalize_plain(txt, 'ja')
    h = hash_text(plain)
    cur.execute("""
      INSERT INTO string_units(source_id, uid, lang, text_raw, version, text_plain, text_hash)
      VALUES(?,?,?,?,?,?,?)
    """, (src_ja, uid, 'ja', txt, ver, plain, h))
    map_ja[uid] = cur.lastrowid

# ペア化（UID）
for uid, en_id in map_en.items():
    ja_id = map_ja.get(uid)
    pair_key = uid
    key_kind = 'uid'
    cur.execute("SELECT id FROM entry_pairs WHERE pair_key=? AND key_kind=?", (pair_key, key_kind))
    rowp = cur.fetchone()
    if rowp:
        pid = rowp[0]
        cur.execute("UPDATE entry_pairs SET en_unit_id=?, ja_unit_id=COALESCE(ja_unit_id, ?), en_text=(SELECT text_raw FROM string_units WHERE id=?), ja_text=COALESCE(ja_text, (SELECT text_raw FROM string_units WHERE id=?)), decided_by='uid', updated_at=CURRENT_TIMESTAMP WHERE id=?", (en_id, ja_id, en_id, (ja_id or en_id), pid))
    else:
        cur.execute("""
            INSERT INTO entry_pairs(pair_key, key_kind, en_unit_id, ja_unit_id, en_text, ja_text, decided_by)
            VALUES(?,?,?,?,(SELECT text_raw FROM string_units WHERE id=?),(SELECT text_raw FROM string_units WHERE id=?),'uid')
        """, (pair_key, key_kind, en_id, ja_id, en_id, (ja_id or en_id)))

con.commit()
con.close()
print("XML import done")
