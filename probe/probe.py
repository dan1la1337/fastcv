import json, re
import careers
out = {}
f = careers.Fetcher(); f.use_russian_ca()
yc = next(c for c in careers.COMPANIES if c.key == "yandex")
r = f.session.get("https://yandex.ru/jobs/api/sitemap/vacancies.xml", timeout=30)
out["direct"] = {"status": r.status_code, "url": r.url, "len": len(r.text), "head": r.text[:200]}
try:
    live = careers.sitemap_vacancies(f, yc)
    out["live"] = len(live)
except Exception as e:
    out["err"] = repr(e)
json.dump(out, open("probe/result.json", "w"), ensure_ascii=False, indent=1)
