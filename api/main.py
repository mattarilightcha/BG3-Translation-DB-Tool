from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import sqlite3
from typing import List, Dict, Optional
import unicodedata

DB_PATH = "data/app.sqlite"

def get_con():
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con

def norm(s: Optional[str]) -> str:
    """全角/半角・合成文字を正規化して前後空白除去"""
    if s is None:
        return ""
    return unicodedata.normalize("NFKC", s).strip()

app = FastAPI(title="Translation DB Tool API")
app.mount("/ui", StaticFiles(directory="ui", html=True), name="ui")

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/search")
def search(q: str, page: int = 1, size: int = 50, max_len: int = 0):
    """
    FTS全文検索。q=検索語句
    max_len: 0なら無制限、>0ならその長さを超える候補はサマリ（…）で返す
    """
    qn = norm(q)
    off = (page - 1) * size
    con = get_con()
    cur = con.cursor()

    cur.execute(
        """
        SELECT e.id, e.en_text AS en, e.ja_text AS ja,
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
    con.close()

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

    items = []
    for r in rows:
        en, ja = r["en"] or "", r["ja"] or ""
        if max_len and (len(en) > max_len or len(ja) > max_len):
            en = snippet(en, qn, max_len)
            ja = snippet(ja, qn, max_len)
        items.append({
            "id": r["id"],
            "en": en,
            "ja": ja,
            "score": float(r["score"]),
            "q": qn,  # クライアント側のハイライト用
        })

    # total は重くなるので省略（必要なら COUNT(*) を戻す）
    return {"items": items, "total": None}

class QueryIn(BaseModel):
    lines: List[str]
    top_k: int = 3
    max_len: int = 0                 # 0=無制限、>0は抜粋
    exact: bool = True               # 完全一致をまず試す
    word_boundary: bool = False      # 単語境界（英語フレーズ向け／FTSに引用符を付ける）
    sources: List[str] = []          # source_name のホワイトリスト（空なら全件）
    min_priority: Optional[int] = None  # priority の下限フィルタ

@app.post("/query")
def query(body: QueryIn):
    """
    lines で渡された各語/フレーズについて、
      1) 完全一致（optional）
      2) FTS（word_boundary=True の時は "phrase" として検索）
    を合算し、Top-K件を重複除外で返す。
    max_len > 0 の場合は周辺抜粋にサマリする。
    sources / min_priority で候補の元を絞れる。
    """
    con = get_con()
    cur = con.cursor()
    out: List[Dict] = []
    seen_terms = set()

    # 共有フィルタ句を準備（entry_pairs に対して効く）
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

    def add_pair_uniqued(lst, en, ja, seen_pairs, top_k):
        key = ((en or "").lower(), (ja or "").lower())
        if key in seen_pairs:
            return False
        seen_pairs.add(key)
        lst.append((en or "", ja or ""))
        return len(lst) >= top_k

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

    for raw in body.lines:
        term = norm(raw)
        if not term or term in seen_terms:
            continue
        seen_terms.add(term)

        matches = []
        seen_pairs = set()

        # 1) 完全一致（entry_pairs 直照会）
        if body.exact:
            cur.execute(
                f"""
                SELECT en_text, ja_text
                FROM entry_pairs
                WHERE lower(en_text) = lower(?) {where_tail}
                LIMIT ?
                """,
                [term, *params_base, body.top_k]
            )
            for r in cur.fetchall():
                if add_pair_uniqued(matches, r["en_text"], r["ja_text"], seen_pairs, body.top_k):
                    break

        # 2) FTS 補完（entries_fts + entry_pairs）
        remain = body.top_k - len(matches)
        if remain > 0:
            fts_query = f"\"{term}\"" if body.word_boundary else term
            cur.execute(
                f"""
                SELECT e.en_text AS en, e.ja_text AS ja
                FROM entries_fts
                JOIN entry_pairs e ON entries_fts.rowid = e.id
                WHERE entries_fts MATCH ?
                {"AND " + " AND ".join(filters) if filters else ""}
                LIMIT ?
                """,
                [fts_query, *params_base, remain * 5]
            )
            for r in cur.fetchall():
                if add_pair_uniqued(matches, r["en"], r["ja"], seen_pairs, body.top_k):
                    break

        # 3) 長すぎる候補はサマリ
        if body.max_len and matches:
            summarized = []
            for en, ja in matches:
                summarized.append((snippet(en, term, body.max_len),
                                   snippet(ja, term, body.max_len)))
            matches = summarized

        out.append({
            "term": term,
            "candidates": [[en, ja] for en, ja in matches]
        })

    con.close()
    return out
