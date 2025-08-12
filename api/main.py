# api/main.py
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional, Tuple
from fastapi.staticfiles import StaticFiles
import sqlite3, re, io, json, threading, time, webbrowser
import xml.etree.ElementTree as ET

DB_PATH = "data/app.sqlite"

# ---------------- DB helpers & migration ----------------
def acquire_con():
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con

def fts_rebuild(cur: sqlite3.Cursor):
    # Rebuild the whole FTS shadow table from content
    cur.execute("INSERT INTO entries_fts(entries_fts) VALUES ('rebuild')")

def ensure_schema():
    with acquire_con() as con:
        cur = con.cursor()
        cur.execute("PRAGMA table_info(entry_pairs)")
        cols = {r["name"].lower() for r in cur.fetchall()}
        if "entry_key" not in cols:
            cur.execute("ALTER TABLE entry_pairs ADD COLUMN entry_key TEXT")

        # 旧インデックスを念のため削除
        cur.execute("PRAGMA index_list(entry_pairs)")
        idxs = [r["name"] for r in cur.fetchall()]
        if "uq_source_entrykey" in idxs:
            cur.execute("DROP INDEX IF EXISTS uq_source_entrykey")

        # 部分ユニーク（entry_key が NOT NULL のものだけ一意）
        try:
            cur.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_source_entrykey
                ON entry_pairs(source_name, entry_key)
                WHERE entry_key IS NOT NULL
            """)
        except sqlite3.Error as e:
            # 既存重複で作成失敗した場合でも起動は続行（ログだけ）
            print("[SCHEMA] unique index create failed:", e)

        con.commit()


def normalize_sources_filter(sources: Optional[List[str]]) -> List[str]:
    return [s for s in (sources or []) if s is not None and s != ""]

def fts_escape_phrase(s: str) -> str:
    # FTS列名扱いを避けるため強制フレーズ化
    return f"\"{(s or '').replace('\"','\"\"')}\""

# ---------------- FastAPI app ----------------
app = FastAPI(title="Translation DB Tool API")
app.mount("/ui", StaticFiles(directory="ui", html=True), name="ui")

@app.on_event("startup")
def _on_startup():
    ensure_schema()
    # ブラウザ自動オープン（1回）
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

# ---------------- /sources ----------------
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

@app.delete("/sources/{source_name}")
def delete_source(source_name: str):
    if not source_name:
        raise HTTPException(status_code=400, detail="source_name is required")
    with acquire_con() as con:
        cur = con.cursor()
        cur.execute("SELECT COUNT(*) AS c FROM entry_pairs WHERE COALESCE(source_name,'')=?", (source_name,))
        before = cur.fetchone()["c"]
        cur.execute("DELETE FROM entry_pairs WHERE COALESCE(source_name,'')=?", (source_name,))
        fts_rebuild(cur)
        con.commit()
        return {"deleted": before, "source_name": source_name}


# ---------------- /search ----------------
@app.get("/search")
def search(q: str, page: int = 1, size: int = 50,
           max_len: int = 0,
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
        # まずはフレーズ検索
        fts_q = fts_escape_phrase(q)
        items = run_with_fts_query(fts_q)
        # 0件なら語句検索
        if not items and " " in q:
            print("[SEARCH] fallback to terms:", q)
            items = run_with_fts_query(q)
        print(f"[SEARCH] hits={len(items)}")
        return {"items": items, "total": len(items)}

# ---------------- /query ----------------
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

    def add_match(lst, term, en, ja, src, prio) -> bool:
        # 単語境界（英のみ）
        if body.word_boundary and en and not word_boundary_ok(term, en):
            return False
        # 重複除外（大小無視＋src/priorityも含めて）
        key = (en or "").lower(), (ja or "").lower(), (src or "").lower(), str(prio or "")
        if key in seen: 
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

            # 1) 完全一致
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
                    if add_match(matches, term, r["en_text"], r["ja_text"], r["source_name"], r["priority"]):
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
                    if add_match(matches, term, r["en"], r["ja"], r["src"], r["pr"]):
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

# ---------------- inline edit ----------------
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
        if not r: 
            raise HTTPException(404, "not found")
        return dict(r)

@app.patch("/entry/{id}")
def patch_entry(id: int, body: EntryUpdate):
    fields = []; params: List[object] = []
    if body.en_text is not None: fields.append("en_text=?"); params.append(body.en_text)
    if body.ja_text is not None: fields.append("ja_text=?"); params.append(body.ja_text)
    if body.source_name is not None: fields.append("source_name=?"); params.append(body.source_name)
    if body.priority is not None: fields.append("priority=?"); params.append(body.priority)
    if not fields: 
        return {"updated": 0}

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

# ---------------- XML import (multipart) ----------------
ID_KEYS = ("id", "contentuid", "contentuid_lc", "handle", "uid", "guid")
TEXT_TAGS = ("string", "value", "text", "content", "_", "t", "v")

def _extract_id_text_pairs(root: ET.Element) -> Tuple[int, Dict[str, str]]:
    total = 0
    pairs: Dict[str, str] = {}
    for node in root.iter():
        node_id = None
        for k in ID_KEYS:
            if k in node.attrib:
                node_id = node.attrib[k]
                break
        if not node_id:
            continue
        total += 1

        txt = (node.text or "").strip()
        if not txt:
            for tname in TEXT_TAGS:
                child = node.find(tname)
                if child is not None:
                    c = (child.text or "").strip()
                    if c:
                        txt = c
                        break
        if not txt:
            itxt = "".join(node.itertext()).strip()
            if itxt:
                txt = itxt

        if txt != "":
            pairs[node_id] = txt
    return total, pairs

def _upsert_xml_pair(cur: sqlite3.Cursor, source_name: str, entry_key: str,
                     en_text: str, ja_text: str, priority: int) -> int:
    # まず存在チェック
    cur.execute(
        "SELECT id FROM entry_pairs WHERE source_name=? AND entry_key=?",
        (source_name, entry_key)
    )
    row = cur.fetchone()
    if row:
        rowid = int(row["id"])
        cur.execute(
            "UPDATE entry_pairs SET en_text=?, ja_text=?, priority=? WHERE id=?",
            (en_text, ja_text, priority, rowid)
        )
    else:
        cur.execute(
            "INSERT INTO entry_pairs (en_text, ja_text, source_name, priority, entry_key) VALUES (?,?,?,?,?)",
            (en_text, ja_text, source_name, priority, entry_key)
        )
        rowid = int(cur.lastrowid)
    return rowid


@app.post("/import/xml")
async def import_xml(
    enfile: UploadFile = File(...),
    jafile: UploadFile = File(...),
    src_en: str = Form("Loca EN"),
    src_ja: str = Form("Loca JP"),
    priority: int = Form(100),
    strict: bool = Form(True),
    replace_src: bool = Form(True)  # ← 同じ source_name は全削除してから入れ直す（上書き運用）
):
    source_name = f"XML:{src_en}|{src_ja}"
    print(f"[IMPORT/XML] recv en={enfile.filename} ja={jafile.filename} src_en={src_en} src_ja={src_ja} prio={priority} strict={strict} replace_src={replace_src}")

    en_bytes = await enfile.read()
    ja_bytes = await jafile.read()
    print(f"[IMPORT/XML] sizes: en={len(en_bytes)} bytes, ja={len(ja_bytes)} bytes")

    try:
        en_root = ET.parse(io.BytesIO(en_bytes)).getroot()
        ja_root = ET.parse(io.BytesIO(ja_bytes)).getroot()
    except Exception as e:
        raise HTTPException(400, f"XML parse error: {e}")

    en_total, en_map = _extract_id_text_pairs(en_root)
    ja_total, ja_map = _extract_id_text_pairs(ja_root)

    en_keys = set(en_map.keys())
    ja_keys = set(ja_map.keys())
    common_keys = en_keys & ja_keys

    # 厳格チェック：キー集合が完全一致しないとエラー
    if strict:
        only_en = sorted(list(en_keys - ja_keys))
        only_ja = sorted(list(ja_keys - en_keys))
        if only_en or only_ja:
            detail = {
                "strict_mismatch": True, 
                "en_total_nodes": en_total, "ja_total_nodes": ja_total,
                "en_valid": len(en_map), "ja_valid": len(ja_map),
                "common": len(common_keys),
                "only_in_en_count": len(only_en),
                "only_in_ja_count": len(only_ja),
                "only_in_en_sample": only_en[:50],
                "only_in_ja_sample": only_ja[:50],
            }
            print("[IMPORT/XML] strict mismatch:", detail)
            # 400で詳細を返し、UIでそのまま表示できる
            raise HTTPException(status_code=400, detail=detail)

    inserted = 0
    with acquire_con() as con:
        cur = con.cursor()

        # source名が同じ場合は全消し（上書き運用が既定）
        if replace_src:
            cur.execute("SELECT COUNT(*) AS c FROM entry_pairs WHERE COALESCE(source_name,'')=?", (source_name,))
            prev = cur.fetchone()["c"]
            if prev:
                print(f"[IMPORT/XML] replace_src: delete old rows = {prev} (source={source_name})")
                cur.execute("DELETE FROM entry_pairs WHERE COALESCE(source_name,'')=?", (source_name,))

        # 共通キーだけ登録（strict=false時も安全策として共通のみ）
        for k in sorted(common_keys):
            en_text = en_map.get(k, "")
            ja_text = ja_map.get(k, "")
            entry_key = f"xmlid:{k}"  # 同一キー再取込で上書きされる
            _upsert_xml_pair(cur, source_name, entry_key, en_text, ja_text, priority)
            inserted += 1

        # FTS再構築（大量時の同期待ち簡略化）
        fts_rebuild(cur)
        con.commit()

    print(f"[IMPORT/XML] inserted={inserted}")
    return {
        "inserted": inserted,
        "source_name": source_name,
        "strict": strict,
        "EN_valid": len(en_map),
        "JA_valid": len(ja_map),
        "common": len(common_keys)
    }
