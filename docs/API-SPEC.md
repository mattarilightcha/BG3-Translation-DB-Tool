# API Spec (v0)

## GET /health
- 200: { ok: true }

## GET /search
Query Params:
- q: string
- page: int (default 1)
- size: int (default 50)
- lang_hint: "en"|"ja"|"auto"

Response:
```json
{
  "items": [
    {"id": 123, "en": "...", "ja": "...", "score": 0.98, "pair_key": "...", "decided_by": "uid"}
  ],
  "total": 1234
}
