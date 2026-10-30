import json, re
import careers
f = careers.Fetcher()
out = {}
for u in ["https://yandex.ru/jobs/api/sitemap/vacancies.xml", "https://yandex.ru/jobs/vacancies/x-1"]:
    out[u + " allowed"] = f.allowed(u)
import requests
r = requests.get("https://yandex.ru/jobs/api/sitemap/vacancies.xml", headers={"User-Agent": careers.USER_AGENT if hasattr(careers, "USER_AGENT") else "FastCVBot"}, timeout=30)
locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", r.text)
out["status"] = r.status_code; out["len"] = len(r.text); out["head"] = r.text[:300]; out["locs"] = len(locs); out["sample"] = locs[:5]
yc = next(c for c in careers.COMPANIES if c.key == "yandex")
out["matched"] = sum(bool(re.match(yc.vacancy, l)) for l in locs)
json.dump(out, open("probe/result.json", "w"), ensure_ascii=False, indent=1)
