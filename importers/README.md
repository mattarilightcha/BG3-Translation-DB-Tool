# Importers

- CSV: UTF-8, 1行目はヘッダー (A=English, B=Japanese)
- XML: english.loca.xml / japanese.loca.xml （contentuid, version, 本文）

正規化規則（要約）
- text_plain: タグ除去、空白畳み、英語は小文字化
- text_hash: text_plain のハッシュ（SHA1 など）
- UID優先でペア化、UIDなしは en.text_hash で合流
- priority による採用判定（公式XML=100、公式CSV=80 など）
