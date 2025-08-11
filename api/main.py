from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Optional, Tuple
import sqlite3, re, unicodedata, os, tempfile, threading, time, webbrowser
from queue import Queue
from contextlib import contextmanager

DB_PATH = "data/app.sqlite"

# ====== Connection Pool ======
POOL_SIZE = int(os.environ.get("TDB_POOL_SIZE", "4"))
_pool: Optional[Queue] = None

def _new_con() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    # 軽いチューニング
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

# ====== Normalization ======
_Z2H_MAP = {
    "，": "、",
    "．": "。",
    "･": "・",
    "ｰ": "ー",
    "－": "ー",
    "—": "ー",
    "―": "ー",
    "〜": "～",
    "～": "～",
}
_WS_RE = re.compile(r"\s+", re.MULTILINE)

def jnorm(text: Optional[str]) -> str:
    """NFKC + 和文記号/長音/空白の軽量正規化"""
    if not text:
        return ""
    s = unicodedata.normalize("NFKC", text)
    for k, v in _Z2H_MAP.items():
        s = s.replace(k, v)
    s = _WS_RE.sub(" ", s).strip()
    return s

# ====== App ======
app = FastAPI(title="Translation DB Tool API")
app.mount("/ui", StaticFiles(directory="ui", html=True), name="ui")

@app.on_event("startup")
def on_startup():
    init_pool()
    # UIを自動で開く（reloaderで二重起動しがちなので一度だけ）
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

# ========= /search =========
class SearchItem(BaseModel):
    id: int
    en: str
    ja: str
    source: Optional[str] = None
    priority: Optional[int] = None
    score: float
    q: str

@app.get("/search")
def search(q: str, page: int = 1, size: int = 50, max_len: int = 0):
    """
    FTS全文検索。q=検索語句
    max_len: 0なら無制限、>0ならその長さを超える候補はサマリ（…）で返す
    """
    qn = jnorm(q)
    off = (page - 1) * size

    with acquire_con() as con:
        cur = con.cursor()
        cur.execute(
            """
            SELECT e.id,
                   e.en_text AS en,
                   e.ja_text AS ja,
                   e.source_name AS source,
                   e.priority AS priority,
                   bm25(entries_fts) AS score
            FROM entries_fts
            JOIN entry_pairs e ON entries_fts.rowid = e.id
            WHERE entries_fts MATCH ?
            ORDER BY score ASC
            LIMIT ? OFFSET ?
            """,
            (qn, size, off),
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
            "id": r["id"],
            "en": en,
            "ja": ja,
            "source": r["source"],
            "priority": r["priority"],
            "score": float(r["score"]),
            "q": qn,
        })

    return {"items": items, "total": None}

# ========= /query =========
class QueryIn(BaseModel):
    lines: List[str]
    top_k: int = 3
    max_len: int = 0                 # 0=無制限、>0は抜粋
    exact: bool = True               # 完全一致をまず試す
    word_boundary: bool = False      # 単語境界（英語フレーズ向け）: Python正規表現 \b で厳密化
    sources: List[str] = []          # source_name のホワイトリスト（空なら全件）
    min_priority: Optional[int] = None  # priority の下限フィルタ

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
    """
    各語/フレーズについて:
      1) 完全一致（optional。sources/priorityフィルタ対応）
      2) FTS（word_boundary=True なら FTSヒット後に Pythonの \b で厳密フィルタ）
    を合算しTop-K返す。返却候補は (en, ja, source, priority)。
    max_len>0 なら抜粋にサマリ。
    """
    out: List[Dict] = []
    seen_terms = set()

    # 共有フィルタ句（entry_pairsに対して）
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

        # 単語境界用 正規表現（英字のみ想定）
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

            # 2) FTS 補完（多めに取って絞る）
            remain = body.top_k - len(matches)
            if remain > 0:
                fts_query = term  # 厳密境界はPython側で
                cur.execute(
                    f"""
                    SELECT e.en_text AS en,
                           e.ja_text AS ja,
                           e.source_name AS source,
                           e.priority AS priority
                    FROM entries_fts
                    JOIN entry_pairs e ON entries_fts.rowid = e.id
                    WHERE entries_fts MATCH ?
                    {and_filters}
                    LIMIT ?
                    """,
                    [fts_query, *params_base, remain * 6]
                )
                for r in cur.fetchall():
                    en, ja = r["en"] or "", r["ja"] or ""
                    if re_pat and not re_pat.search(en):
                        continue
                    if _add_pair_uniqued(matches, en, ja, r["source"], r["priority"], seen_pairs, body.top_k):
                        break

        # 3) 長すぎる候補はサマリ
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
