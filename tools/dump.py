#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CLI: 辞書照会のバッチ出力
例:
  python tools/dump.py --db data/app.sqlite --q "saving throw" --top_k 3
  python tools/dump.py --db data/app.sqlite --file terms.txt --top_k 5 --max_len 240 --wb
"""
import argparse, sqlite3, sys, json, re, unicodedata

def jnorm(text: str) -> str:
    if not text:
        return ""
    s = unicodedata.normalize("NFKC", text)
    z2h = {"，":"、","．":"。","･":"・","ｰ":"ー","－":"ー","—":"ー","―":"ー","〜":"～","～":"～"}
    for k,v in z2h.items():
        s = s.replace(k, v)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/app.sqlite")
    ap.add_argument("--q", help="単語/フレーズ（単体）")
    ap.add_argument("--file", help="改行区切りの語リストファイル（--q と併用可）")
    ap.add_argument("--top_k", type=int, default=3)
    ap.add_argument("--max_len", type=int, default=0)
    ap.add_argument("--exact", action="store_true", help="完全一致を優先/使用")
    ap.add_argument("--wb", action="store_true", help="単語境界（Pythonの\\bで厳密化）")
    ap.add_argument("--source", action="append", help="source_name フィルタ（複数可）")
    ap.add_argument("--min_priority", type=int, default=None)
    args = ap.parse_args()

    terms = []
    if args.q:
        terms.append(args.q)
    if args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            terms.extend([line.strip() for line in f if line.strip()])

    con = sqlite3.connect(args.db, check_same_thread=False)
    con.row_factory = sqlite3.Row

    filters = []
    params_base = []
    if args.source:
        placeholders = ",".join(["?"]*len(args.source))
        filters.append(f"source_name IN ({placeholders})")
        params_base.extend(args.source)
    if args.min_priority is not None:
        filters.append("priority >= ?")
        params_base.append(args.min_priority)
    where_tail = (" AND " + " AND ".join(filters)) if filters else ""
    and_filters = ("AND " + " AND ".join(filters)) if filters else ""

    for raw in terms:
        term = jnorm(raw)
        if not term:
            continue
        matches = []
        seen = set()
        re_pat = re.compile(rf"\b{re.escape(term)}\b", re.IGNORECASE) if args.wb else None
        cur = con.cursor()

        if args.exact:
            cur.execute(
                f"""
                SELECT en_text, ja_text, source_name AS source, priority
                FROM entry_pairs
                WHERE lower(en_text) = lower(?) {where_tail}
                LIMIT ?
                """,
                [term, *params_base, args.top_k]
            )
            for r in cur.fetchall():
                en, ja = r["en_text"] or "", r["ja_text"] or ""
                if re_pat and not re_pat.search(en):
                    continue
                key = (en.lower(), ja.lower())
                if key in seen: continue
                seen.add(key); matches.append([en, ja, r["source"], r["priority"]])
                if len(matches) >= args.top_k: break

        remain = args.top_k - len(matches)
        if remain > 0:
            cur.execute(
                f"""
                SELECT e.en_text AS en, e.ja_text AS ja, e.source_name AS source, e.priority AS priority
                FROM entries_fts
                JOIN entry_pairs e ON entries_fts.rowid = e.id
                WHERE entries_fts MATCH ?
                {and_filters}
                LIMIT ?
                """,
                [term, *params_base, remain*6]
            )
            for r in cur.fetchall():
                en, ja = r["en"] or "", r["ja"] or ""
                if re_pat and not re_pat.search(en):
                    continue
                key = (en.lower(), ja.lower())
                if key in seen: continue
                seen.add(key); matches.append([en, ja, r["source"], r["priority"]])
                if len(matches) >= args.top_k: break

        if args.max_len and matches:
            def snip(t):
                if not t: return ""
                low = t.lower(); ix = low.find(term.lower())
                if ix < 0: return (t[:args.max_len] + "…") if len(t) > args.max_len else t
                pad = args.max_len//2; st = max(ix-pad,0); ed = min(ix+len(term)+pad, len(t))
                s = t[st:ed]; 
                if st>0: s = "…" + s
                if ed<len(t): s = s + "…"
                return s
            matches = [[snip(en), snip(ja), src, pr] for en,ja,src,pr in matches]

        rec = {"term": term, "candidates": matches}
        print(json.dumps(rec, ensure_ascii=False))
    con.close()

if __name__ == "__main__":
    main()
