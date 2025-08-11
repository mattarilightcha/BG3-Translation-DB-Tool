from fastapi import FastAPI, UploadFile, File, Form, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Optional, Tuple
import sqlite3, re, unicodedata, os, tempfile, threading, time, webbrowser
from queue import Queue
from contextlib import contextmanager
import xml.etree.ElementTree as ET

DB_PATH = "data/app.sqlite"

# ====== Connection Pool ======
POOL_SIZE = int(os.environ.get("TDB_POOL_SIZE", "4"))
_pool: Optional[Queue] = None

def _new_con() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    try:
        con.execute("PRAGMA journal_mode=WAL;")
    except sqlite3.OperationalError:
        pass
    con.execute("PRAGMA synchronous=NORMAL;")
    con.execute("PRAGMA temp_store=MEMORY;")
    return con

def init_pool():
    global _pool
    if _pool is not None:
        return
    q: Queue = Queue(maxsize=POOL_SIZE)
    for _ in range(POOL_SIZE):
        q.put(_new_con())
    _pool = q

@contextmanager
def acquire_con():
    if _pool is None:
        init_pool()
    con = _pool.get()
    try:
        yield con
    finally:
        _pool.put(con)

# ====== Normalization / FTS helpers ======
_Z2H_MAP = {"，":"、","．":"。","･":"・","ｰ":"ー","－":"ー","—":"ー","―":"ー","〜":"～","～":"～"}
_WS_RE = re.compile(r"\s+", re.MULTILINE)

def jnorm(text: Optional[str]) -> str:
    if not text:
        return ""
    s = unicodedata.normalize("NFKC", text)
    for k, v in _Z2H_MAP.items():
        s = s.replace(k, v)
    s = _WS_RE.sub(" ", s).strip()
    return s

def fts_phrase(term: str) -> str:
    """FTS5のMATCHに安全に渡すため、常にフレーズ引用。内部の二重引用符は二重化。"""
    return '"' + term.replace('"', '""') + '"'

def rebuild_fts(con: sqlite3.Connection):
    cur = con.cursor()
    cur.execute("DELETE FROM entries_fts;")
    cur.execute("""
        INSERT INTO entries_fts(rowid, en_text, ja_text)
        SELECT id, en_text, ja_text FROM entry_pairs
    """)
    con.commit()

# ====== App ======
app = FastAPI(title="Translation DB Tool API")
app.mount("/ui", StaticFiles(directory="ui", html=True), name="ui")

@app.on_event("startup")
def on_startup():
    init_pool()
    # UIを自動で開く（reloader二重防止のためフラグ使用）
    try:
        flag = os.path.join(tempfile.gettempdir(), "tdb_ui_opened.flag")
        if not os.path.exists(flag) and os.environ.get("TDB_AUTO_OPEN", "1") == "1":
            def _open():
                time.sleep(0.8)
                webbrowser.open("http://127.0.0.1:8000/ui/")
                with open(flag, "w", encoding="utf-8") as f:
                    f.write("1")
            threading.Thread(target=_open, daemon=True).start()
    except Exception:
        pass

@app.get("/health")
def health():
    return {"ok": True}

# ========= sources list =========
@app.get("/sources")
def sources():
    with acquire_con() as con:
        cur = con.cursor()
        cur.execute("""
            SELECT COALESCE(source_name, '') AS name, COUNT(*) AS cnt
            FROM entry_pairs
            GROUP BY COALESCE(source_name, '')
            ORDER BY cnt DESC, name ASC
        """)
        rows = cur.fetchall()
    return {"sources": [{"name": r["name"], "count": r["cnt"]} for r in rows]}

# ========= /search =========
@app.get("/search")
def search(
    q: str,
    page: int = 1,
    size: int = 50,
    max_len: int = 0,
    sources: List[str] = Query(default=[]),          # /search?sources=A&sources=B...
    min_priority: Optional[int] = None
):
    qn = jnorm(q)
    off = (page - 1) * size

    filters = []
    params: List = [fts_phrase(qn)]
    if sources:
        placeholders = ",".join(["?"] * len(sources))
        filters.append(f"e.source_name IN ({placeholders})")
        params.extend(sources)
    if min_priority is not None:
        filters.append("e.priority >= ?")
        params.append(min_priority)
    and_filters = ("AND " + " AND ".join(filters)) if filters else ""

    with acquire_con() as con:
        cur = con.cursor()
        cur.execute(
            f"""
            SELECT e.id, e.en_text AS en, e.ja_text AS ja,
                   e.source_name AS source, e.priority AS priority,
                   bm25(entries_fts) AS score
            FROM entries_fts
            JOIN entry_pairs e ON entries_fts.rowid = e.id
            WHERE entries_fts MATCH ?
            {and_filters}
            ORDER BY score ASC
            LIMIT ? OFFSET ?
            """,
            (*params, size, off),
        )
        rows = cur.fetchall()

    def snippet(text: str, term: str, max_chars: int) -> str:
        if max_chars <= 0 or not text:
            return text or ""
        t = text
        low = t.lower()
        ix = low.find(term.lower())
        if ix < 0:
            return (t[:max_chars] + "…") if len(t) > max_chars else t
        pad = max_chars // 2
        start = max(ix - pad, 0)
        end = min(ix + len(term) + pad, len(t))
        s = t[start:end]
        if start > 0: s = "…" + s
        if end < len(t): s = s + "…"
        return s

    items: List[Dict] = []
    for r in rows:
        en, ja = r["en"] or "", r["ja"] or ""
        if max_len and (len(en) > max_len or len(ja) > max_len):
            en = snippet(en, qn, max_len)
            ja = snippet(ja, qn, max_len)
        items.append({
            "id": r["id"], "en": en, "ja": ja,
            "source": r["source"], "priority": r["priority"],
            "score": float(r["score"]), "q": qn,
        })
    return {"items": items, "total": None}

# ========= /query =========
class QueryIn(BaseModel):
    lines: List[str]
    top_k: int = 3
    max_len: int = 0
    exact: bool = True
    word_boundary: bool = False
    sources: List[str] = []
    min_priority: Optional[int] = None

def _snippet(text: str, term: str, max_chars: int) -> str:
    if max_chars <= 0 or not text:
        return text or ""
    t = text
    low = t.lower()
    ix = low.find(term.lower())
    if ix < 0:
        return (t[:max_chars] + "…") if len(t) > max_chars else t
    pad = max_chars // 2
    start = max(ix - pad, 0)
    end = min(ix + len(term) + pad, len(t))
    s = t[start:end]
    if start > 0: s = "…" + s
    if end < len(t): s = s + "…"
    return s

def _add_pair_uniqued(
    lst: List[Tuple[str, str, Optional[str], Optional[int]]],
    en: str, ja: str, source: Optional[str], priority: Optional[int],
    seen: set, top_k: int
) -> bool:
    key = ((en or "").lower(), (ja or "").lower())
    if key in seen:
        return False
    seen.add(key)
    lst.append((en or "", ja or "", source, priority))
    return len(lst) >= top_k

@app.post("/query")
def query(body: QueryIn):
    out: List[Dict] = []
    seen_terms = set()

    filters = []
    params_base: List = []
    if body.sources:
        placeholders = ",".join(["?"] * len(body.sources))
        filters.append(f"source_name IN ({placeholders})")
        params_base.extend(body.sources)
    if body.min_priority is not None:
        filters.append("priority >= ?")
        params_base.append(body.min_priority)
    where_tail = (" AND " + " AND ".join(filters)) if filters else ""
    and_filters = ("AND " + " AND ".join(filters)) if filters else ""

    for raw in body.lines:
        term = jnorm(raw)
        if not term or term in seen_terms:
            continue
        seen_terms.add(term)

        matches: List[Tuple[str, str, Optional[str], Optional[int]]] = []
        seen_pairs: set = set()

        re_pat = re.compile(rf"\b{re.escape(term)}\b", re.IGNORECASE) if body.word_boundary else None

        with acquire_con() as con:
            cur = con.cursor()

            # 1) 完全一致
            if body.exact:
                cur.execute(
                    f"""
                    SELECT en_text, ja_text, source_name AS source, priority
                    FROM entry_pairs
                    WHERE lower(en_text) = lower(?) {where_tail}
                    LIMIT ?
                    """,
                    [term, *params_base, body.top_k]
                )
                for r in cur.fetchall():
                    en, ja = r["en_text"] or "", r["ja_text"] or ""
                    if re_pat and not re_pat.search(en):
                        continue
                    if _add_pair_uniqued(matches, en, ja, r["source"], r["priority"], seen_pairs, body.top_k):
                        break

            # 2) FTS 補完（常に安全なフレーズ引用で投げる→ Python側で境界厳密化）
            remain = body.top_k - len(matches)
            if remain > 0:
                cur.execute(
                    f"""
                    SELECT e.en_text AS en, e.ja_text AS ja,
                           e.source_name AS source, e.priority AS priority
                    FROM entries_fts
                    JOIN entry_pairs e ON entries_fts.rowid = e.id
                    WHERE entries_fts MATCH ?
                    {and_filters}
                    LIMIT ?
                    """,
                    [fts_phrase(term), *params_base, remain * 6]
                )
                for r in cur.fetchall():
                    en, ja = r["en"] or "", r["ja"] or ""
                    if re_pat and not re_pat.search(en):
                        continue
                    if _add_pair_uniqued(matches, en, ja, r["source"], r["priority"], seen_pairs, body.top_k):
                        break

        if body.max_len and matches:
            summarized = []
            for en, ja, src, pr in matches:
                summarized.append((_snippet(en, term, body.max_len),
                                   _snippet(ja, term, body.max_len),
                                   src, pr))
            matches = summarized

        out.append({
            "term": term,
            "candidates": [[en, ja, src, pr] for en, ja, src, pr in matches]
        })

    return out

# ========= /import/xml =========
@app.post("/import/xml")
def import_xml(
    enfile: UploadFile = File(...),
    jafile: UploadFile = File(...),
    src_en: str = Form("Loca EN"),
    src_ja: str = Form("Loca JP"),
    priority: int = Form(100)
):
    """
    英/日XMLを取り込み、idで突き合わせて entry_pairs に一括登録 → FTS再構築。
    XMLは <... id="...">テキスト</...> のように id 属性を持つ要素であればOK。
    """
    en_bytes = enfile.file.read()
    ja_bytes = jafile.file.read()

    def map_from_xml(b: bytes) -> Dict[str, str]:
        m: Dict[str, str] = {}
        root = ET.fromstring(b)
        for el in root.iter():
            idv = el.attrib.get("id")
            if not idv:
                continue
            txt = "".join(el.itertext()).strip()
            if txt:
                m[idv] = txt
        return m

    en_map = map_from_xml(en_bytes)
    ja_map = map_from_xml(ja_bytes)

    count_pairs = 0
    with acquire_con() as con:
        cur = con.cursor()
        src_name = f"XML:{src_en}|{src_ja}"
        rows = []
        for k, en_text in en_map.items():
            ja_text = ja_map.get(k, "")
            # どちらか片方でもあれば入れる
            if en_text or ja_text:
                rows.append((en_text, ja_text, src_name, priority))
        if rows:
            cur.executemany(
                "INSERT INTO entry_pairs(en_text, ja_text, source_name, priority) VALUES (?,?,?,?)",
                rows
            )
            con.commit()
            rebuild_fts(con)
            count_pairs = len(rows)

    return {"inserted": count_pairs, "source_name": f"XML:{src_en}|{src_ja}"}
