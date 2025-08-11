# api/main.py
from fastapi import FastAPI
from pydantic import BaseModel
import sqlite3
from typing import List, Dict

DB_PATH = "data/app.sqlite"

def get_con():
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con

app = FastAPI(title="Translation DB Tool API")

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/search")
def search(q: str, page: int = 1, size: int = 50):
    """
    FTS全文検索。q=検索語句
    """
    off = (page - 1) * size
    con = get_con()
    cur = con.cursor()

    # FTS5: bm25でスコア小さいほど関連高 → ORDER BY score ASC
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
        (q, size, off),
    )
    items = [
        {
            "id": r["id"],
            "en": r["en"] or "",
            "ja": r["ja"] or "",
            "score": float(r["score"]),
        }
        for r in cur.fetchall()
    ]

    # 総件数（ざっくり全行数）
    cur.execute("SELECT COUNT(*) AS c FROM entry_pairs")
    total = cur.fetchone()["c"]
    con.close()
    return {"items": items, "total": total}

class QueryIn(BaseModel):
    lines: List[str]
    top_k: int = 3

@app.post("/query")
def query(body: QueryIn):
    """
    照会モード：各行のtermに対し、完全一致 優先 → FTSで補完。EN/JA候補をTop-K返す。
    """
    con = get_con()
    cur = con.cursor()
    out: List[Dict] = []

    seen_terms = set()
    for raw in body.lines:
        term = (raw or "").strip()
        if not term or term in seen_terms:
            continue
        seen_terms.add(term)

        # 1) 完全一致（英語）
        cur.execute(
            """
            SELECT en_text, ja_text
            FROM entry_pairs
            WHERE lower(en_text) = lower(?)
            LIMIT ?
            """,
            (term, body.top_k),
        )
        matches = [(r["en_text"] or "", r["ja_text"] or "") for r in cur.fetchall()]

        # 2) 足りない分はFTSで補完（重複は除外）
        remain = body.top_k - len(matches)
        if remain > 0:
            cur.execute(
                """
                SELECT e.en_text AS en, e.ja_text AS ja
                FROM entries_fts
                JOIN entry_pairs e ON entries_fts.rowid = e.id
                WHERE entries_fts MATCH ?
                LIMIT ?
                """,
                (term, remain * 3),  # ちょい多めに取得して重複を除外
            )
            seen_pairs = set(matches)
            for r in cur.fetchall():
                pair = (r["en"] or "", r["ja"] or "")
                if pair not in seen_pairs:
                    matches.append(pair)
                    seen_pairs.add(pair)
                if len(matches) >= body.top_k:
                    break

        out.append({"term": term, "candidates": [[en, ja] for en, ja in matches]})

    con.close()
    return out
