# api/main.py
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional, Tuple
from fastapi.staticfiles import StaticFiles
import sqlite3, re, io, json, threading, time, webbrowser
import xml.etree.ElementTree as ET
import difflib, html
import os, shutil
from pathlib import Path
try:
    import tkinter as _tk
    from tkinter import filedialog as _filedialog
except Exception:
    _tk = None
    _filedialog = None

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
_BUNDLES_DIR = Path("data/bundles").resolve()

@app.on_event("startup")
def _on_startup():
    ensure_schema()
    try:
        _BUNDLES_DIR.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        print("[BUNDLES] mkdir failed:", e)
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


# ---------------- BG3 Matcher (MOD↔公式 EN/JA 照合) ----------------

def _normalize_text_bg3(s: str, aggressive: bool = True) -> str:
    if s is None:
        return ""
    s = html.unescape(s)
    s = re.sub(r"<\s*br\s*/?\s*>", " ", s, flags=re.IGNORECASE)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
    s = re.sub(r"\s+", " ", s).strip()
    if aggressive:
        try:
            import unicodedata
            s = unicodedata.normalize("NFKC", s)
        except Exception:
            pass
        s = s.strip(" .…")
    return s

def _read_xml_contents_from_text(text: str) -> List[Tuple[str, str, str]]:
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        cleaned = text[text.find("<"):]
        root = ET.fromstring(cleaned)
    rows: List[Tuple[str, str, str]] = []
    for c in root.iter("content"):
        uid = (c.attrib.get("contentuid", "") or "").strip()
        version = (c.attrib.get("version", "") or "1").strip()
        raw = "".join(c.itertext())
        rows.append((uid, version, raw))
    return rows

def _build_official_indexes(off_en_rows: List[Tuple[str, str, str]],
                            off_ja_rows: List[Tuple[str, str, str]]
                            ) -> Tuple[Dict[str, List[str]], Dict[str, str], Dict[str, str]]:
    en_text_to_uids: Dict[str, List[str]] = {}
    en_uid_to_text: Dict[str, str] = {}
    for uid, _ver, text in off_en_rows:
        key = _normalize_text_bg3(text, aggressive=True)
        if key:
            lst = en_text_to_uids.get(key)
            if lst is None:
                en_text_to_uids[key] = [uid]
            elif not lst or lst[-1] != uid:
                lst.append(uid)
        if uid and uid not in en_uid_to_text:
            en_uid_to_text[uid] = text

    ja_by_uid: Dict[str, str] = {}
    for uid, _ver, text in off_ja_rows:
        ja_by_uid[uid] = text

    return en_text_to_uids, ja_by_uid, en_uid_to_text

def _build_length_buckets(keys: List[str]) -> Dict[int, List[str]]:
    buckets: Dict[int, List[str]] = {}
    for k in keys:
        buckets.setdefault(len(k), []).append(k)
    for L in list(buckets.keys()):
        buckets[L].sort()
    return buckets

def _choose_uid_from_candidates(cands: List[str], ja_by_uid: Dict[str, str]) -> str:
    for uid in cands:
        if uid in ja_by_uid:
            return uid
    return cands[0] if cands else ""

def _choose_uid_for_text_exact(mod_key: str,
                               en_text_to_uids: Dict[str, List[str]],
                               ja_by_uid: Dict[str, str]) -> Tuple[str, str]:
    if mod_key in en_text_to_uids:
        return _choose_uid_from_candidates(en_text_to_uids[mod_key], ja_by_uid), "exact"
    return "", ""

def _choose_uid_for_text_fuzzy(mod_key: str,
                               en_text_to_uids: Dict[str, List[str]],
                               ja_by_uid: Dict[str, str],
                               key_len_buckets: Dict[int, List[str]],
                               cutoff: float) -> Tuple[str, str]:
    L = len(mod_key)
    cand_keys: List[str] = []
    for dL in (-2, -1, 0, 1, 2):
        cand_keys.extend(key_len_buckets.get(L + dL, []))
    if not cand_keys:
        cand_keys = list(en_text_to_uids.keys())
    near = difflib.get_close_matches(mod_key, cand_keys, n=1, cutoff=cutoff)
    if near:
        key = near[0]
        return _choose_uid_from_candidates(en_text_to_uids.get(key, []), ja_by_uid), "fuzzy"
    return "", ""

def _write_contentlist_xml_string(rows: List[Tuple[str, str, str]]) -> str:
    root = ET.Element("contentList")
    for uid, ver, text in rows:
        el = ET.SubElement(root, "content", attrib={"contentuid": uid, "version": ver})
        el.text = text if text is not None else ""
    tree = ET.ElementTree(root)
    try:
        ET.indent(tree, space="  ", level=0)  # type: ignore[attr-defined]
    except Exception:
        pass
    xml_bytes = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    return xml_bytes.decode("utf-8", errors="replace")

def _write_contentlist_xml_sections_string(head_rows: List[Tuple[str, str, str]],
                                           tail_rows: List[Tuple[str, str, str]],
                                           tail_label: str = "") -> str:
    root = ET.Element("contentList")
    for uid, ver, text in head_rows:
        el = ET.SubElement(root, "content", attrib={"contentuid": uid, "version": ver})
        el.text = text if text is not None else ""
    if tail_rows:
        root.append(ET.Comment(f" {tail_label or 'JA missing (empty text)'} "))
        for uid, ver, text in tail_rows:
            el = ET.SubElement(root, "content", attrib={"contentuid": uid, "version": ver})
            el.text = text if text is not None else ""
    tree = ET.ElementTree(root)
    try:
        ET.indent(tree, space="  ", level=0)  # type: ignore[attr-defined]
    except Exception:
        pass
    xml_bytes = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    return xml_bytes.decode("utf-8", errors="replace")

def _write_review_csv_string(rows: List[Dict[str, str]]) -> str:
    headers = [
        "match_kind","mod_uid","mod_version","mod_text",
        "official_en_uid","official_en_text","official_ja_text"
    ]
    buf = io.StringIO()
    # BOM付き（Excel配慮）
    buf.write("\ufeff")
    import csv as _csv
    w = _csv.DictWriter(buf, fieldnames=headers, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return buf.getvalue()

def _iter_xml_files_under(dir_path: Path) -> List[Path]:
    if not dir_path.exists() or not dir_path.is_dir():
        return []
    files = [p for p in dir_path.rglob("*.xml") if p.is_file()]
    files.sort(key=lambda p: str(p).lower())
    return files

def _safe_join(base: Path, relname: str) -> Path:
    # 相対パスを安全に連結（.. 無効化）
    rel = Path(relname).parts
    segs = [s for s in rel if s not in ("..", "/", "\\")]
    return (base.joinpath(*segs)).resolve()

def _write_uploads_to_bundle(base: Path, subdir: str, files: List[UploadFile]) -> int:
    count = 0
    target = (base / subdir)
    target.mkdir(parents=True, exist_ok=True)
    for f in files:
        try:
            name = f.filename or "file.xml"
            # 可能なら相対パスを保持
            dest = _safe_join(target, name)
            dest.parent.mkdir(parents=True, exist_ok=True)
            data = f.file.read()
            with open(dest, "wb") as out:
                out.write(data)
            count += 1
        except Exception as e:
            print("[BUNDLES] save error:", e)
    return count

@app.post("/bundles")
async def create_bundle(
    enfiles: List[UploadFile] = File(...),
    jafiles: List[UploadFile] = File(...),
    label: str = Form("")
):
    ts = time.strftime("%Y%m%d-%H%M%S")
    nid = f"b{ts}-{int(time.time()*1000)%100000}"
    base = _BUNDLES_DIR / nid
    base.mkdir(parents=True, exist_ok=True)

    # 保存
    en_count = _write_uploads_to_bundle(base, "en", enfiles)
    ja_count = _write_uploads_to_bundle(base, "ja", jafiles)

    meta = {
        "id": nid,
        "label": label or "",
        "created_at": int(time.time()),
    }
    try:
        (base / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        print("[BUNDLES] meta write failed:", e)

    return {"id": nid, "label": meta["label"], "en_files": en_count, "ja_files": ja_count}

@app.get("/bundles")
def list_bundles():
    out = []
    if not _BUNDLES_DIR.exists():
        return {"bundles": out}
    for d in sorted(_BUNDLES_DIR.iterdir(), key=lambda p: p.name):
        if not d.is_dir():
            continue
        meta = {"id": d.name, "label": "", "created_at": 0}
        meta_path = d / "meta.json"
        try:
            if meta_path.exists():
                j = json.loads(meta_path.read_text(encoding="utf-8"))
                meta.update(j)
        except Exception:
            pass
        en_files = len(_iter_xml_files_under(d / "en"))
        ja_files = len(_iter_xml_files_under(d / "ja"))
        out.append({"id": meta.get("id", d.name), "label": meta.get("label", ""), "created_at": meta.get("created_at", 0), "en_files": en_files, "ja_files": ja_files})
    return {"bundles": out}

@app.delete("/bundles/{bundle_id}")
def delete_bundle(bundle_id: str):
    base = _BUNDLES_DIR / bundle_id
    if not base.exists() or not base.is_dir():
        raise HTTPException(404, "bundle not found")
    try:
        shutil.rmtree(base)
    except Exception as e:
        raise HTTPException(500, f"failed to delete bundle: {e}")
    return {"deleted": bundle_id}

@app.post("/match/bg3")
async def match_bg3(
    modfile: UploadFile = File(...),
    en_dir: str = Form(...),
    ja_dir: str = Form(...),
    enable_fuzzy: bool = Form(False),
    cutoff: float = Form(0.92),
    workers: int = Form(1),
    base_dir: str = Form("")
):
    # 読み込み
    mod_bytes = await modfile.read()
    mod_text = mod_bytes.decode("utf-8", errors="replace")
    mod_rows = _read_xml_contents_from_text(mod_text)

    en_rows: List[Tuple[str, str, str]] = []
    ja_rows: List[Tuple[str, str, str]] = []

    # 相対ディレクトリ解決（base_dir が指定されていればそれ基準）
    def _resolve_dir(p: str) -> Path:
        raw = Path(p)
        if raw.is_absolute():
            return raw
        if base_dir:
            try:
                return (Path(base_dir) / raw).resolve()
            except Exception:
                return raw.resolve()
        return raw.resolve()

    base_en = _resolve_dir(en_dir)
    base_ja = _resolve_dir(ja_dir)
    if not base_en.exists() or not base_en.is_dir():
        raise HTTPException(400, f"en_dir invalid: {en_dir}")
    if not base_ja.exists() or not base_ja.is_dir():
        raise HTTPException(400, f"ja_dir invalid: {ja_dir}")
    for fp in _iter_xml_files_under(base_en):
        try:
            txt = fp.read_text(encoding="utf-8", errors="replace")
            en_rows.extend(_read_xml_contents_from_text(txt))
        except Exception:
            continue
    for fp in _iter_xml_files_under(base_ja):
        try:
            txt = fp.read_text(encoding="utf-8", errors="replace")
            ja_rows.extend(_read_xml_contents_from_text(txt))
        except Exception:
            continue

    en_map, ja_map, uid2en = _build_official_indexes(en_rows, ja_rows)
    buckets = _build_length_buckets(list(en_map.keys()))

    matched_ja: List[Tuple[str, str, str]] = []
    matched_noja: List[Tuple[str, str, str]] = []
    unmatched_src: List[Tuple[str, str, str]] = []
    review_rows: List[Dict[str, str]] = []

    for uid, ver, mod_text in mod_rows:
        mod_key = _normalize_text_bg3(mod_text, aggressive=True)
        chosen_uid, kind = _choose_uid_for_text_exact(mod_key, en_map, ja_map)
        if not chosen_uid and enable_fuzzy and mod_key:
            chosen_uid, kind = _choose_uid_for_text_fuzzy(mod_key, en_map, ja_map, buckets, cutoff)

        if chosen_uid:
            ja_text = ja_map.get(chosen_uid, "")
            en_text = uid2en.get(chosen_uid, "")
            if ja_text:
                matched_ja.append((uid, ver, ja_text))
            else:
                matched_noja.append((uid, ver, ""))
            review_rows.append({
                "match_kind": kind or "none",
                "mod_uid": uid,
                "mod_version": ver,
                "mod_text": mod_text,
                "official_en_uid": chosen_uid,
                "official_en_text": en_text,
                "official_ja_text": ja_text,
            })
        else:
            unmatched_src.append((uid, ver, mod_text))

    # 並列時の安全対策（単一スレッドでも影響なし）
    en_matched_mod_uids = {r["mod_uid"] for r in review_rows if r.get("official_en_uid")}
    clean_unmatched = [(u, v, t) for (u, v, t) in unmatched_src if u not in en_matched_mod_uids]

    matched_xml = _write_contentlist_xml_sections_string(matched_ja, matched_noja, "JA missing (empty text)")
    matched_ja_xml = _write_contentlist_xml_string(matched_ja)
    unmatched_xml = _write_contentlist_xml_string(clean_unmatched)
    review_csv = _write_review_csv_string(review_rows) if enable_fuzzy else None

    resp = {
        "counts": {
            "mod": len(mod_rows),
            "en": len(en_rows),
            "ja": len(ja_rows),
            "matched_ja": len(matched_ja),
            "matched_noja": len(matched_noja),
            "unmatched": len(clean_unmatched),
            "review_rows": len(review_rows),
        },
        "matched_xml": matched_xml,
        "matched_ja_xml": matched_ja_xml,
        "unmatched_xml": unmatched_xml,
        "review_csv": review_csv,
    }
    return resp


# ---------------- Local directory picker (desktop only) ----------------
@app.get("/pick/dir")
def pick_dir(title: str = "Select Folder"):
    # Launch a helper subprocess to run the Tk dialog on its own main thread.
    # This avoids "main thread is not in main loop" errors inside the web server.
    import subprocess, sys, shlex
    code = (
        "import sys, tkinter as tk\n"
        "from tkinter import filedialog\n"
        "root = tk.Tk(); root.withdraw(); root.update()\n"
        "title = sys.argv[1] if len(sys.argv)>1 else 'Select Folder'\n"
        "p = filedialog.askdirectory(title=title)\n"
        "print(p or '')\n"
    )
    try:
        proc = subprocess.run([sys.executable, "-c", code, title], capture_output=True, text=True)
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or '').strip()
            raise HTTPException(500, f"picker failed (subprocess): {err}")
        path = (proc.stdout or '').strip()
        return {"path": path}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"picker failed: {e}")
