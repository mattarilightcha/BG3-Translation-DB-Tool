from fastapi import FastAPI, UploadFile, File, Form
from pydantic import BaseModel
import sqlite3, io

app = FastAPI(title="Translation DB Tool API")

@app.get("/health")
def health():
    return {"ok": True}

class SearchOutItem(BaseModel):
    id: int
    en: str
    ja: str
    score: float
    pair_key: str
    decided_by: str | None = None

class SearchOut(BaseModel):
    items: list[SearchOutItem]
    total: int

@app.get("/search", response_model=SearchOut)
def search(q: str, page: int = 1, size: int = 50):
    off = (page-1)*size
    con = sqlite3.connect('data/app.sqlite')
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    # FTS: rankを使い、簡易に並べ替え
    cur.execute(
        """
        SELECT e.id, e.en_text AS en, e.ja_text AS ja, e.pair_key, e.decided_by,
               bm25(entries_fts, 1.0, 1.0) AS score
        FROM entries_fts JOIN entry_pairs e ON entries_fts.rowid=e.id
        WHERE entries_fts MATCH ?
        ORDER BY score LIMIT ? OFFSET ?
        """, (q, size, off)
    )
    items = [
        {
            "id": r["id"],
            "en": r["en"] or "",
            "ja": r["ja"] or "",
            "score": float(r["score"]),
            "pair_key": r["pair_key"],
            "decided_by": r["decided_by"],
        } for r in cur.fetchall()
    ]
    # 総数（簡易）
    cur.execute("SELECT count(*) FROM entry_pairs")
    total = cur.fetchone()[0]
    con.close()
    return {"items": items, "total": total}

class QueryIn(BaseModel):
    lines: list[str]
    top_k: int = 3
    lang_hint: str = "en"

@app.post("/query")
def query(body: QueryIn):
    # v0: ダミー合成（実装はfeatで肉付け）
    # 実際は: Exact → FTS → 再ランク → JSONL文字列で返す
    out_lines = []
    for term in dict.fromkeys([s.strip() for s in body.lines if s.strip()]):
        out_lines.append({"term": term, "candidates": []})
    return out_lines

@app.post("/import/csv")
async def import_csv(file: UploadFile = File(...), source_name: str = Form(...), priority: int = Form(80)):
    # v0: ファイル保存のみ（importersを別プロセスで実行）。featで直流し実装
    data = await file.read()
    # 保存
    return {"received": len(data), "source_name": source_name, "priority": priority}

@app.post("/import/xml")
async def import_xml(en_file: UploadFile = File(...), ja_file: UploadFile = File(...), priority: int = Form(100)):
    # v0: 同上
    n_en = len(await en_file.read())
    n_ja = len(await ja_file.read())
    return {"received_en": n_en, "received_ja": n_ja, "priority": priority}
