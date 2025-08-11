import re, hashlib
from html import unescape

TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")

def normalize_plain(text: str, lang: str) -> str:
    if text is None:
        return ''
    t = unescape(text)
    t = TAG_RE.sub(' ', t)
    t = SPACE_RE.sub(' ', t).strip()
    if lang == 'en':
        t = t.lower().replace('’', "'").replace('–', '-').replace('—', '-')
    return t

def hash_text(text: str) -> str:
    return hashlib.sha1(text.encode('utf-8')).hexdigest()
