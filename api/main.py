# api/main.py
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
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
    # 安全なフレーズ検索（列名誤解釈を避ける）
    return f"\"{(s or '').replace('\"','\"\"')}\""

def normalize_sources_filter(sources: Optional[List[str]]) -> List[str]:
    return [s for s in (sources or []) if s is not None and s != ""]

# ---------- FastAPI ----------
app = FastAPI(title="Translation DB Tool API")
app.mount("/ui", StaticFiles(directory="ui", html=True), name="ui")

@app.on_event("startup")
def _auto_open():
    # 1回だけ /ui を開く（run*.bat から起動時など）
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

    def run_with_fts_query(cur: sqlite3.Cursor, fts_q: str):
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
        items = run_with_fts_query(cur, fts_q)

        # 0件なら単語検索（saving throw）
        if not items and " " in q:
            print("[SEARCH] fallback to terms:", q)
            items = run_with_fts_query(cur, q)

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

# ---------- import XML (multipart, strict match by contentuid) ----------
def _parse_loca_xml_bytes(data: bytes):
    """
    BG3の .loca.xml 例：
      <contentList>
        <content contentuid="h12345">Text...</content>
    - キーは `contentuid`（場合により contentUID / id などフォールバック）
    - 空uid/空テキストは除外
    """
    root = ET.fromstring(data)
    items = {}
    total_nodes = 0
    # まずは <content> を優先的に走査
    for node in root.iter('content'):
        total_nodes += 1
        uid = (node.attrib.get('contentuid')
               or node.attrib.get('contentUID')
               or node.attrib.get('id')
               or '').strip()
        if not uid:
            continue
        text = (node.text or '').strip()
        if not text:
            continue
        items[uid] = text

    # 念のため、content が無い場合は全ノード走査で id を拾う（互換用）
    if total_nodes == 0:
        for node in root.iter():
            if node is root:  # ルートは除外
                continue
            total_nodes += 1
            uid = (node.attrib.get('contentuid')
                   or node.attrib.get('contentUID')
                   or node.attrib.get('id')
                   or '').strip()
            if not uid:
                continue
            text = (node.text or '').strip()
            if not text:
                continue
            items[uid] = text

    return {"total_nodes": total_nodes, "items": items}

@app.post("/import/xml")
async def import_xml(
    enfile: UploadFile = File(...),
    jafile: UploadFile = File(...),
    src_en: str = Form("Loca EN"),
    src_ja: str = Form("Loca JP"),
    priority: int = Form(100),
    strict: bool = Form(True),  # 既定＝厳密一致
):
    print(f"[IMPORT/XML] recv en={enfile.filename} ja={jafile.filename} "
          f"src_en={src_en} src_ja={src_ja} prio={priority} strict={strict}")

    en_bytes = await enfile.read()
    ja_bytes = await jafile.read()
    print(f"[IMPORT/XML] sizes: en={len(en_bytes)} bytes, ja={len(ja_bytes)} bytes")

    try:
        en = _parse_loca_xml_bytes(en_bytes)
        ja = _parse_loca_xml_bytes(ja_bytes)
    except Exception as e:
        print("[IMPORT/XML] parse error:", e)
        raise HTTPException(status_code=400, detail=f"XML parse error: {e}")

    en_ids = set(en["items"].keys())
    ja_ids = set(ja["items"].keys())

    detail_diag = {
        "en_total_nodes": en["total_nodes"],
        "ja_total_nodes": ja["total_nodes"],
        "en_valid": len(en_ids),
        "ja_valid": len(ja_ids),
    }

    # 厳密チェック：件数一致 & ID集合一致
    if strict:
        if len(en_ids) != len(ja_ids) or en_ids != ja_ids:
            only_en = sorted(list(en_ids - ja_ids))[:20]
            only_ja = sorted(list(ja_ids - en_ids))[:20]
            detail_diag["only_in_en_sample"] = only_en
            detail_diag["only_in_ja_sample"] = only_ja
            print("[IMPORT/XML] strict mismatch:", detail_diag)
            raise HTTPException(
                status_code=400,
                detail={
                    "reason": "strict_mismatch",
                    **detail_diag,
                    "message": (
                        "EN/JA の有効行が一致しません。"
                        "ファイルを見直すか strict=False で再実行してください。"
                    ),
                },
            )

    # 挿入対象
    common_ids = en_ids & ja_ids if strict else (en_ids | ja_ids)
    inserted = 0
    src_label = f"XML:{src_en}|{src_ja}"

    with acquire_con() as con:
        cur = con.cursor()
        cur.execute("BEGIN")
        try:
            for uid in common_ids:
                en_text = en["items"].get(uid, "")
                ja_text = ja["items"].get(uid, "")
                cur.execute(
                    "INSERT INTO entry_pairs(en_text, ja_text, source_name, priority) VALUES (?,?,?,?)",
                    (en_text, ja_text, src_label, priority),
                )
                _update_fts_for_id(cur, cur.lastrowid, en_text or "", ja_text or "")
                inserted += 1
            con.commit()
        except Exception as e:
            con.rollback()
            print("[IMPORT/XML] insert error, rollback:", e)
            raise HTTPException(status_code=500, detail=f"DB insert error: {e}")

    print(f"[IMPORT/XML] parsed EN_valid={len(en_ids)} JA_valid={len(ja_ids)} inserted={inserted}")
    return {
        "inserted": inserted,
        "source_name": src_label,
        **detail_diag,
        "common_ids": len(common_ids),
        "strict": strict,
    }
