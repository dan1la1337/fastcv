import json, collections
import ats

class Store:
    rows = []
    def career_ids(self, c): return {}
    def archive_career(self, c, ids): return 0
    def upsert_imported(self, rows): self.rows += rows; return len(rows)

s = Store()
stats = ats.import_boards(s, ats.make_get())
out = {"stats": stats, "dirs": collections.Counter(r.get("direction") for r in s.rows),
       "rows": [{k: r[k] for k in ("source_post", "title", "city", "is_remote", "posted_at")} | {"d": (r["description"] or "")[:80]} for r in s.rows]}
json.dump(out, open("probe/result.json", "w"), ensure_ascii=False, indent=0)
