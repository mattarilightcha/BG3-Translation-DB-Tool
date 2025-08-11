# api/main.py
from fastapi import FastAPI, UploadFile, File, Form
from pydantic import BaseModel
from typing import List, Dict, Optional
from fastapi.staticfiles import StaticFiles
import sqlite3, re, json, io
import xml.etree.ElementTree as ET
import threading, time, webbrowser

DB_PATH = "data/app.sqlite"

# ---------- DB helpers ----------
def acquire_con():
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con

def fts_rebuild(cur: sqlite3.Cursor):
    # Rebuild FTS5 shadow from content
    cur.execute("INSERT INTO entries_fts(entries_fts) VALUES ('rebuild')")

def fts_escape_phrase(s: str) -> str:
    # 安全なフレーズ検索にする（空白/ハイフン等があっても列名扱いにならない）
    return f"\"{(s or '').replace('\"','\"\"')}\""

def normalize_sources_filter(sources: Optional[List[str]]) -> List[str]:
    return [s for s in (sources or []) if s is not None and s != ""]

# ---------- FastAPI ----------
app = FastAPI(title="Translation DB Tool API")
app.mount("/ui", StaticFiles(directory="ui", html=True), name="ui")

@app.on_event("startup")
def _auto_open():
    # 1回だけ /ui を開く（run.bat から起動時など）
    def _open():
        time.sleep(0.7)
        try:
            webbrowser.open("http://127.0.0.1:8000/ui")
        except Exception:
            pass
    threading.Thread(target=_open, daemon=True).start()

@app.get("/health")
def health():
    return {"ok": True}

# ---------- /sources ----------
@app.get("/sources")
def sources():
    with acquire_con() as con:
        cur = con.cursor()
        cur.execute("""
            SELECT COALESCE(source_name,'') AS name, COUNT(*) AS cnt
            FROM entry_pairs
            GROUP BY COALESCE(source_name,'')
            ORDER BY cnt DESC, name
        """)
        return {"sources": [{"name": r["name"], "count": r["cnt"]} for r in cur.fetchall()]}

# ---------- /search ----------
@app.get("/search")
def search(q: str, page: int = 1, size: int = 50,
           max_len: int = 240,
           min_priority: Optional[int] = None,
           sources: Optional[List[str]] = None):
    off = max(0, (page - 1) * size)
    def run_with_fts_query(fts_q: str):
        where = ["entries_fts MATCH ?"]
        params: List[object] = [fts_q]
        if min_priority is not None:
            where.append("e.priority >= ?")
            params.append(min_priority)
        srcs = normalize_sources_filter(sources)
        if srcs:
            where.append(f"COALESCE(e.source_name,'') IN ({','.join('?' for _ in srcs)})")
            params.extend(srcs)
        cur.execute(
            f"""
            SELECT e.id, e.en_text AS en, e.ja_text AS ja, e.source_name AS source, e.priority,
                   bm25(entries_fts) AS score
            FROM entries_fts
            JOIN entry_pairs e ON entries_fts.rowid = e.id
            WHERE {' AND '.join(where)}
            ORDER BY score ASC
            LIMIT ? OFFSET ?
            """,
            (*params, size, off),
        )
        rows = cur.fetchall()
        items = []
        for r in rows:
            en = r["en"] or ""
            ja = r["ja"] or ""
            if max_len and max_len > 0:
                if len(en) > max_len: en = en[:max_len] + "…"
                if len(ja) > max_len: ja = ja[:max_len] + "…"
            items.append({
                "id": r["id"],
                "en": en,
                "ja": ja,
                "source": r["source"] or "",
                "priority": r["priority"],
                "score": float(r["score"]),
            })
        return items

    srcs_dbg = normalize_sources_filter(sources)
    print(f"[SEARCH] q='{q}' size={size} minp={min_priority} sources={srcs_dbg} page={page}")

    with acquire_con() as con:
        cur = con.cursor()
        # まずはフレーズ検索（"saving throw"）
        fts_q = fts_escape_phrase(q)
        items = run_with_fts_query(fts_q)

        # 0件なら単語検索（saving throw）
        if not items and " " in q:
            print("[SEARCH] fallback to terms:", q)
            items = run_with_fts_query(q)

        print(f"[SEARCH] hits={len(items)}")
        return {"items": items, "total": len(items)}


# ---------- /query ----------
class QueryIn(BaseModel):
    lines: List[str]
    top_k: int = 3
    max_len: int = 240
    exact: bool = True
    word_boundary: bool = False
    min_priority: Optional[int] = None
    sources: Optional[List[str]] = None

_word_re_cache = {}
def word_boundary_ok(term: str, text: str) -> bool:
    key = term.lower()
    reobj = _word_re_cache.get(key)
    if not reobj:
        reobj = re.compile(rf"\b{re.escape(term)}\b", re.IGNORECASE)
        _word_re_cache[key] = reobj
    return bool(reobj.search(text or ""))

@app.post("/query")
def query(body: QueryIn):
    srcs = normalize_sources_filter(body.sources)

    def add_match(lst, en, ja, src, prio) -> bool:
        # 重複除外（大文字小文字を無視）
        key = (en or "").lower(), (ja or "").lower(), (src or "").lower(), str(prio or "")
        if key in seen: return False
        # 単語境界厳密チェック（英のみ）
        if body.word_boundary and en and not word_boundary_ok(term, en):
            return False
        lst.append([en or "", ja or "", src or "", prio])
        seen.add(key)
        return len(lst) >= body.top_k

    out: List[Dict] = []
    with acquire_con() as con:
        cur = con.cursor()
        for raw in body.lines:
            term = (raw or "").strip()
            if not term:
                out.append({"term": "", "candidates": []})
                continue

            matches: List[List[object]] = []
            seen = set()

            # 1) 完全一致（優先）
            if body.exact:
                where = ["LOWER(en_text) = LOWER(?)"]
                params: List[object] = [term]
                if body.min_priority is not None:
                    where.append("priority >= ?")
                    params.append(body.min_priority)
                if srcs:
                    where.append(f"COALESCE(source_name,'') IN ({','.join('?' for _ in srcs)})")
                    params.extend(srcs)

                cur.execute(
                    f"""
                    SELECT en_text, ja_text, source_name, priority
                    FROM entry_pairs
                    WHERE {' AND '.join(where)}
                    LIMIT ?
                    """,
                    (*params, body.top_k),
                )
                for r in cur.fetchall():
                    if add_match(matches, r["en_text"], r["ja_text"], r["source_name"], r["priority"]):
                        break

            # 2) FTS 補完
            remain = body.top_k - len(matches)
            if remain > 0:
                where = ["entries_fts MATCH ?"]
                params: List[object] = [fts_escape_phrase(term)]
                if body.min_priority is not None:
                    where.append("e.priority >= ?")
                    params.append(body.min_priority)
                if srcs:
                    where.append(f"COALESCE(e.source_name,'') IN ({','.join('?' for _ in srcs)})")
                    params.extend(srcs)

                cur.execute(
                    f"""
                    SELECT e.en_text AS en, e.ja_text AS ja, e.source_name AS src, e.priority AS pr
                    FROM entries_fts
                    JOIN entry_pairs e ON entries_fts.rowid = e.id
                    WHERE {' AND '.join(where)}
                    LIMIT ?
                    """,
                    (*params, remain * 6),
                )
                for r in cur.fetchall():
                    if add_match(matches, r["en"], r["ja"], r["src"], r["pr"]):
                        break

            # 3) 長文スニペット
            if body.max_len and body.max_len > 0:
                cut = body.max_len
                for i in range(len(matches)):
                    en, ja, src, pr = matches[i]
                    if len(en) > cut: en = en[:cut] + "…"
                    if len(ja) > cut: ja = ja[:cut] + "…"
                    matches[i] = [en, ja, src, pr]

            out.append({"term": term, "candidates": matches})
    return out

# ---------- inline edit ----------
class EntryUpdate(BaseModel):
    en_text: Optional[str] = None
    ja_text: Optional[str] = None
    source_name: Optional[str] = None
    priority: Optional[int] = None

def _update_fts_for_id(cur: sqlite3.Cursor, rowid: int, en: str, ja: str):
    cur.execute("DELETE FROM entries_fts WHERE rowid=?", (rowid,))
    cur.execute("INSERT INTO entries_fts(rowid, en_text, ja_text) VALUES (?,?,?)", (rowid, en, ja))

@app.get("/entry/{id}")
def get_entry(id: int):
    with acquire_con() as con:
        cur = con.cursor()
        cur.execute("SELECT id, en_text, ja_text, source_name, priority FROM entry_pairs WHERE id=?", (id,))
        r = cur.fetchone()
        if not r: return {"error": "not found"}, 404
        return dict(r)

@app.patch("/entry/{id}")
def patch_entry(id: int, body: EntryUpdate):
    fields = []; params: List[object] = []
    if body.en_text is not None: fields.append("en_text=?"); params.append(body.en_text)
    if body.ja_text is not None: fields.append("ja_text=?"); params.append(body.ja_text)
    if body.source_name is not None: fields.append("source_name=?"); params.append(body.source_name)
    if body.priority is not None: fields.append("priority=?"); params.append(body.priority)
    if not fields: return {"updated": 0}

    with acquire_con() as con:
        cur = con.cursor()
        cur.execute(f"UPDATE entry_pairs SET {', '.join(fields)} WHERE id=?", (*params, id))
        cur.execute("SELECT en_text, ja_text FROM entry_pairs WHERE id=?", (id,))
        row = cur.fetchone()
        if row:
            _update_fts_for_id(cur, id, row["en_text"] or "", row["ja_text"] or "")
        con.commit()
        cur.execute("SELECT id, en_text, ja_text, source_name, priority FROM entry_pairs WHERE id=?", (id,))
        return dict(cur.fetchone())

# ---------- import XML (multipart) ----------
@app.post("/import/xml")
async def import_xml(
    enfile: UploadFile = File(...),
    jafile: UploadFile = File(...),
    src_en: str = Form("Loca EN"),
    src_ja: str = Form("Loca JP"),
    priority: int = Form(100),
):
    print(f"[IMPORT/XML] recv en={enfile.filename} ja={jafile.filename} "
          f"src_en={src_en} src_ja={src_ja} prio={priority}")

    en_bytes = await enfile.read()
    ja_bytes = await jafile.read()
    print(f"[IMPORT/XML] sizes: en={len(en_bytes)} bytes, ja={len(ja_bytes)} bytes")

    en_root = ET.parse(io.BytesIO(en_bytes)).getroot()
    ja_root = ET.parse(io.BytesIO(ja_bytes)).getroot()

    def extract_pairs(root):
        pairs = {}
        for node in root.iter():
            if node.attrib.get("id"):
                text = (node.text or "").strip()
                pairs[node.attrib["id"]] = text
        return pairs

    en_map = extract_pairs(en_root)
    ja_map = extract_pairs(ja_root)
    print(f"[IMPORT/XML] parsed: EN keys={len(en_map)} JA keys={len(ja_map)}")

    inserted = 0
    with acquire_con() as con:
        cur = con.cursor()
        for k, en_text in en_map.items():
            ja_text = ja_map.get(k, "")
            cur.execute(
                "INSERT INTO entry_pairs(en_text, ja_text, source_name, priority) VALUES (?,?,?,?)",
                (en_text, ja_text, f"XML:{src_en}|{src_ja}", priority),
            )
            rowid = cur.lastrowid
            _update_fts_for_id(cur, rowid, en_text or "", ja_text or "")
            inserted += 1
        con.commit()
    print(f"[IMPORT/XML] inserted={inserted}")
    return {"inserted": inserted, "source_name": f"XML:{src_en}|{src_ja}"}
