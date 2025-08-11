# api/main.py
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional
from fastapi.staticfiles import StaticFiles
import sqlite3, re, io, json
import xml.etree.ElementTree as ET
import threading, time, webbrowser

DB_PATH = "data/app.sqlite"

# ---------- DB helpers ----------
def acquire_con():
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con

def fts_rebuild(cur: sqlite3.Cursor):
    cur.execute("INSERT INTO entries_fts(entries_fts) VALUES ('rebuild')")

def _update_fts_for_id(cur: sqlite3.Cursor, rowid: int, en: str, ja: str):
    cur.execute("DELETE FROM entries_fts WHERE rowid=?", (rowid,))
    cur.execute(
        "INSERT INTO entries_fts(rowid, en_text, ja_text) VALUES (?,?,?)",
        (rowid, en or "", ja or "")
    )

def fts_escape_phrase(s: str) -> str:
    # FTSの安全なフレーズ検索
    return f"\"{(s or '').replace('\"','\"\"')}\""

def normalize_sources_filter(sources: Optional[List[str]]) -> List[str]:
    return [s for s in (sources or []) if s is not None and s != ""]

# ---------- FastAPI ----------
app = FastAPI(title="Translation DB Tool API")
app.mount("/ui", StaticFiles(directory="ui", html=True), name="ui")

@app.on_event("startup")
def _auto_open():
    def _open():
        time.sleep(0.7)
        try: webbrowser.open("http://127.0.0.1:8000/ui/")
        except Exception: pass
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
def search(q: str,
           page: int = 1,
           size: int = 50,
           max_len: int = 0,  # UIは編集前提なのでデフォ=フル本文
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

    print(f"[SEARCH] q='{q}' size={size} minp={min_priority} sources={normalize_sources_filter(sources)} page={page}")

    with acquire_con() as con:
        cur = con.cursor()
        # まずは完全フレーズ検索
        fts_q = fts_escape_phrase(q)
        items = run_with_fts_query(fts_q)

        # 0件＆スペース含むなら語句検索にフォールバック
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

    def add_match(lst, en, ja, src, prio, term) -> bool:
        # 重複除外（大文字小文字無視＋メタ含む）
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
                    if add_match(matches, r["en_text"], r["ja_text"], r["source_name"], r["priority"], term):
                        break

            # 2) FTS 補完（フレーズ優先）
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
                    if add_match(matches, r["en"], r["ja"], r["src"], r["pr"], term):
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

@app.get("/entry/{id}")
def get_entry(id: int):
    with acquire_con() as con:
        cur = con.cursor()
        cur.execute("SELECT id, en_text, ja_text, source_name, priority FROM entry_pairs WHERE id=?", (id,))
        r = cur.fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="not found")
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

# ---------- import XML (multipart, strict) ----------
def _extract_id_text_pairs(root: ET.Element):
    """
    BG3系 loca.xml など、いろんな“ID属性名/テキスト格納場所”に対応:
      - ID属性候補: id, contentuid, contentuid_lc, handle, uid, guid
      - テキスト候補: ノード直下のtext / 子要素<string|value|text|content|_|t|v> のtext
    空文字は無視（validに含めない）。戻り値は (total_nodes_with_id_attr, {id: text})
    """
    ID_KEYS = ("id", "contentuid", "contentuid_lc", "handle", "uid", "guid")
    TEXT_TAGS = ("string", "value", "text", "content", "_", "t", "v")

    total = 0
    pairs: Dict[str, str] = {}

    for node in root.iter():
        # どれかのID属性を拾う
        node_id = None
        for k in ID_KEYS:
            if k in node.attrib:
                node_id = node.attrib[k]
                break
        if not node_id:
            continue

        total += 1

        # テキストを探す：直下 text → 子要素の代表タグ → 最後は node.itertext()
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
            # それでも無いならノード以下のテキストを総なめ（空白寄せ集めは除外）
            itxt = "".join(s for s in node.itertext())
            itxt = itxt.strip()
            # あまりにも長いゴミを避けるため軽く正規化
            if itxt:
                txt = itxt

        if txt != "":
            pairs[node_id] = txt

    return total, pairs

@app.post("/import/xml")
async def import_xml(
    enfile: UploadFile = File(...),
    jafile: UploadFile = File(...),
    src_en: str = Form("Loca EN"),
    src_ja: str = Form("Loca JP"),
    priority: int = Form(100),
    strict: bool = Form(True),
):
    print(f"[IMPORT/XML] recv en={enfile.filename} ja={jafile.filename} "
          f"src_en={src_en} src_ja={src_ja} prio={priority} strict={strict}")

    en_bytes = await enfile.read()
    ja_bytes = await jafile.read()
    print(f"[IMPORT/XML] sizes: en={len(en_bytes)} bytes, ja={len(ja_bytes)} bytes")

    try:
        en_root = ET.parse(io.BytesIO(en_bytes)).getroot()
        ja_root = ET.parse(io.BytesIO(ja_bytes)).getroot()
    except ET.ParseError as e:
        raise HTTPException(status_code=400, detail=f"XML parse error: {e}")

    en_total_nodes, en_map = _extract_id_text_pairs(en_root)
    ja_total_nodes, ja_map = _extract_id_text_pairs(ja_root)

    en_ids = set(en_map.keys())
    ja_ids = set(ja_map.keys())
    only_in_en = sorted(en_ids - ja_ids)
    only_in_ja = sorted(ja_ids - en_ids)
    common_ids = len(en_ids & ja_ids)

    # 厳密：ID集合が完全一致でないと拒否
    if strict and (only_in_en or only_in_ja):
        detail = {
            "strict_mismatch": True,
            "en_total_nodes": en_total_nodes,
            "ja_total_nodes": ja_total_nodes,
            "en_valid": len(en_map),
            "ja_valid": len(ja_map),
            "common_ids": common_ids,
            "only_in_en_count": len(only_in_en),
            "only_in_ja_count": len(only_in_ja),
            # サンプル（多すぎるとUIが重いので20件まで）
            "only_in_en_sample": only_in_en[:20],
            "only_in_ja_sample": only_in_ja[:20],
            "hint": "両XMLの id が完全一致する必要があります（空文字は無視）。一致しない場合はソースデータを整合させてください。"
        }
        print("[IMPORT/XML] strict mismatch:", detail)
        raise HTTPException(status_code=400, detail=detail)

    # 挿入（strict=false の場合は共通IDのみを対象）
    target_ids = sorted(en_ids & ja_ids) if (only_in_en or only_in_ja) else sorted(en_ids)
    inserted = 0
    with acquire_con() as con:
        cur = con.cursor()
        src_name = f"XML:{src_en}|{src_ja}"
        for k in target_ids:
            en_text = en_map.get(k, "")
            ja_text = ja_map.get(k, "")
            cur.execute(
                "INSERT INTO entry_pairs(en_text, ja_text, source_name, priority) VALUES (?,?,?,?)",
                (en_text, ja_text, src_name, priority),
            )
            _update_fts_for_id(cur, cur.lastrowid, en_text, ja_text)
            inserted += 1
        con.commit()

    print(f"[IMPORT/XML] inserted={inserted}")
    return {
        "inserted": inserted,
        "source_name": f"XML:{src_en}|{src_ja}",
        "en_valid": len(en_map),
        "ja_valid": len(ja_map),
        "common_ids": common_ids,
        "strict": strict
    }
